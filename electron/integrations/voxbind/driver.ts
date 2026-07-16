import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleActionState, ModuleManifest } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestImageWindowClose, showImageWindow, waitForImage, waitForImageExit } from '../windows-process'

const MODULE_ID = 'voxbind'
const IMAGE_NAME = 'voxbind.exe'

const actionPages = {
  'dcs-realtime-translation': {
    tabName: 'DCS 实时翻译',
    pageId: 'QApplication.MainWindow.QTabWidget.qt_tabwidget_stackedwidget.DCSPage',
  },
  voice: {
    tabName: '语音',
    pageId: 'QApplication.MainWindow.QTabWidget.qt_tabwidget_stackedwidget.HomePage',
  },
} as const

type VoxBindActionId = keyof typeof actionPages

function candidateExecutables(): string[] {
  return [...new Set([
    process.env.VOXBIND_EXE,
    'E:\\DCS\\ProG\\VoxBind\\voxbind.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'VoxBind', IMAGE_NAME) : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'VoxBind', IMAGE_NAME) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findExecutable(): string | null {
  return candidateExecutables().find((candidate) => fs.existsSync(candidate)) || null
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

function readLogUpdate(filePath: string, offset: number, currentState: boolean, startMarker: string, stopMarker: string): { state: boolean; offset: number } {
  try {
    const contents = fs.readFileSync(filePath)
    const safeOffset = offset <= contents.length ? offset : 0
    const appended = contents.subarray(safeOffset).toString('utf8')
    const lastStart = appended.lastIndexOf(startMarker)
    const lastStop = appended.lastIndexOf(stopMarker)
    const state = lastStart < 0 && lastStop < 0 ? currentState : lastStart > lastStop
    return { state, offset: contents.length }
  } catch {
    return { state: currentState, offset: 0 }
  }
}

function normalizePowerShellError(value: string): string {
  if (!value.includes('CLIXML')) return value.trim()
  const messages = [...value.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((match) => match[1])
  const text = (messages.join('\n') || value)
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
  return text.replace(/^#< CLIXML\s*/i, '').trim()
}

function createManifest(): ModuleManifest {
  return {
    id: MODULE_ID,
    displayName: 'VoxBind',
    description: '',
    version: '1.1.3',
    icon: 'AudioLines',
    brandLogo: '/modules/voxbind-icon.png',
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: false, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 15_000, stopMs: 12_000, showWindowMs: 15_000, actionMs: 18_000 },
    actions: [
      { id: 'dcs-realtime-translation', label: '实时翻译', kind: 'toggle' },
      { id: 'voice', label: '语音', kind: 'toggle' },
    ],
    actionLabels: { start: '启动', stop: '停止' },
  }
}

function startWindowHider(pid: number): ChildProcess {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DcsHubVoxBindWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
}
'@
$targetPid=${pid}
$deadline=(Get-Date).AddSeconds(10)
while((Get-Date) -lt $deadline){
  $target=Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if(-not $target){break}
  $target.Refresh()
  if($target.MainWindowHandle -ne 0){[DcsHubVoxBindWindow]::ShowWindowAsync($target.MainWindowHandle,0) | Out-Null}
  Start-Sleep -Milliseconds 25
}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

function runUiAction(actionId: VoxBindActionId, desiredActive?: boolean, signal?: AbortSignal): Promise<boolean> {
  const definition = actionPages[actionId]
  const tabName = Buffer.from(definition.tabName, 'utf8').toString('base64')
  const pageId = Buffer.from(definition.pageId, 'utf8').toString('base64')
  const mode = desiredActive === undefined ? 'read' : 'write'
  const desired = desiredActive ? '$true' : '$false'
  const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DcsHubVoxBindNative {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, uint flags);
  public static IntPtr FindWindow(int processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner; GetWindowThreadProcessId(hWnd, out owner);
      if(owner==(uint)processId && GetWindowTextLength(hWnd)>0){
        var title=new StringBuilder(GetWindowTextLength(hWnd)+1);
        GetWindowText(hWnd,title,title.Capacity);
        if(title.ToString().IndexOf("VoxBind",StringComparison.OrdinalIgnoreCase)>=0){found=hWnd; return false;}
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
'@
$tabName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${tabName}'))
$pageId=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pageId}'))
$process=Get-Process -Name 'voxbind' -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $process){throw 'VoxBind 尚未运行'}
$deadline=(Get-Date).AddSeconds(8)
$root=$null
do {
  $process.Refresh()
  $handle=$process.MainWindowHandle
  if($handle -eq 0){$handle=[DcsHubVoxBindNative]::FindWindow($process.Id)}
  if($handle -ne 0){try{$root=[Windows.Automation.AutomationElement]::FromHandle($handle)}catch{$root=$null}}
  if($root){break}
  Start-Sleep -Milliseconds 100
} while((Get-Date) -lt $deadline)
if(-not $root){throw '未找到 VoxBind 主窗口'}
$wasVisible=[DcsHubVoxBindNative]::IsWindowVisible($handle)
if(-not $wasVisible){
  $previousForeground=[DcsHubVoxBindNative]::GetForegroundWindow()
  $originalRect=New-Object DcsHubVoxBindNative+Rect
  [DcsHubVoxBindNative]::GetWindowRect($handle,[ref]$originalRect) | Out-Null
  $windowWidth=[Math]::Max(1,$originalRect.Right-$originalRect.Left)
  $windowHeight=[Math]::Max(1,$originalRect.Bottom-$originalRect.Top)
  $originalExStyle=[DcsHubVoxBindNative]::GetWindowLong($handle,-20)
  [DcsHubVoxBindNative]::SetWindowLong($handle,-20,$originalExStyle -bor 0x00080000) | Out-Null
  [DcsHubVoxBindNative]::SetLayeredWindowAttributes($handle,0,0,0x00000002) | Out-Null
  [DcsHubVoxBindNative]::ShowWindowAsync($handle,9) | Out-Null
  [DcsHubVoxBindNative]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 900
  $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
}
$tabType=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::TabItem)
$tabs=$root.FindAll([Windows.Automation.TreeScope]::Descendants,$tabType)
$targetTab=$null
$originalTab=$null
foreach($tab in $tabs){
  try {
    $selection=$tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
    if($selection.Current.IsSelected){$originalTab=$tab}
    if($tab.Current.Name -eq $tabName){$targetTab=$tab}
  } catch {}
}
if(-not $targetTab){throw ('未找到功能页签：'+$tabName)}
$targetSelection=$targetTab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
$targetSelection.Select()
try {
  $pageCondition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,$pageId)
  $buttonType=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
  $button=$null
  $deadline=(Get-Date).AddSeconds(6)
  do {
    $page=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$pageCondition)
    if($page){
      $buttons=$page.FindAll([Windows.Automation.TreeScope]::Descendants,$buttonType)
      foreach($candidate in $buttons){if($candidate.Current.Name -eq '启动' -or $candidate.Current.Name -eq '停止'){$button=$candidate;break}}
    }
    if($button){break}
    Start-Sleep -Milliseconds 100
  } while((Get-Date) -lt $deadline)
  if(-not $button){throw ('未找到'+$tabName+'的启动按钮')}
  $active=$button.Current.Name -eq '停止'
  if('${mode}' -eq 'write' -and $active -ne ${desired}){
    $invoke=$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    $deadline=(Get-Date).AddSeconds(8)
    do {
      Start-Sleep -Milliseconds 120
      $active=$button.Current.Name -eq '停止'
      if($active -eq ${desired}){break}
    } while((Get-Date) -lt $deadline)
    if($active -ne ${desired}){throw ($tabName+'状态切换超时')}
  }
  if($active){Write-Output 'ACTIVE'}else{Write-Output 'INACTIVE'}
} finally {
  if($originalTab -and $originalTab.Current.Name -ne $tabName){
    try{$originalTab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()}catch{}
  }
  if(-not $wasVisible){
    [DcsHubVoxBindNative]::ShowWindowAsync($handle,0) | Out-Null
    [DcsHubVoxBindNative]::SetLayeredWindowAttributes($handle,0,255,0x00000002) | Out-Null
    [DcsHubVoxBindNative]::SetWindowLong($handle,-20,$originalExStyle) | Out-Null
    [DcsHubVoxBindNative]::SetWindowPos($handle,[IntPtr]::Zero,$originalRect.Left,$originalRect.Top,$windowWidth,$windowHeight,0x0014) | Out-Null
    if($previousForeground -ne [IntPtr]::Zero){[DcsHubVoxBindNative]::SetForegroundWindow($previousForeground) | Out-Null}
  }
}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
      timeout: 17_000,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error(normalizePowerShellError(stderr || stdout || error.message)))
        return
      }
      if (stdout.includes('ACTIVE')) resolve(true)
      else if (stdout.includes('INACTIVE')) resolve(false)
      else reject(new Error('VoxBind 未返回有效的功能状态'))
    })
  })
}

export function createVoxBindDriver(executableOverride?: string | null): ModuleDriver {
  const executablePath = executableOverride ? fs.existsSync(executableOverride) ? executableOverride : null : findExecutable()
  const manifest = createManifest()
  manifest.executablePath = executableOverride || executablePath || undefined
  const installDirectory = executablePath ? path.dirname(executablePath) : null
  let child: ChildProcess | null = null
  let windowHider: ChildProcess | null = null
  let actionStateInitialized = false
  let actionStates: Record<VoxBindActionId, boolean> = { 'dcs-realtime-translation': false, voice: false }
  let actionLogOffsets = { dcs: 0, voice: 0 }

  function resetActionTracking(): void {
    actionStates = { 'dcs-realtime-translation': false, voice: false }
    if (installDirectory) {
      const logsDirectory = path.join(installDirectory, 'logs')
      actionLogOffsets = {
        dcs: fileSize(path.join(logsDirectory, 'dcs.log')),
        voice: fileSize(path.join(logsDirectory, 'voxbind.log')),
      }
    } else {
      actionLogOffsets = { dcs: 0, voice: 0 }
    }
    actionStateInitialized = true
  }

  function stopWindowHider(): void {
    const helper = windowHider
    windowHider = null
    if (helper && helper.exitCode === null) {
      try { helper.kill() } catch { /* The helper normally exits by itself. */ }
    }
  }

  async function startHidden(signal?: AbortSignal): Promise<void> {
    if (!executablePath) throw new Error('未找到 VoxBind 安装目录')
    if (await isImageRunning(IMAGE_NAME, signal)) return
    signal?.throwIfAborted()
    resetActionTracking()
    const started = spawn(executablePath, [], {
      cwd: path.dirname(executablePath),
      windowsHide: true,
      stdio: 'ignore',
    })
    child = started
    if (!started.pid) throw new Error('VoxBind 进程未能创建')
    const helper = startWindowHider(started.pid)
    windowHider = helper
    helper.once('close', () => { if (windowHider === helper) windowHider = null })
    started.once('close', () => {
      if (child === started) child = null
      stopWindowHider()
    })
    if (!await waitForImage(IMAGE_NAME, 8_000, signal)) throw new Error('VoxBind 启动失败')
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!executablePath) return { installState: 'not-installed', runState: 'stopped', details: '未找到 VoxBind 安装目录' }
    return { installState: 'installed', runState: await isImageRunning(IMAGE_NAME, signal) ? 'running' : 'stopped' }
  }

  return {
    manifest,
    discover,
    start: startHidden,
    async stop(signal?: AbortSignal) {
      stopWindowHider()
      if (!await isImageRunning(IMAGE_NAME, signal)) return
      if (!await requestImageWindowClose(IMAGE_NAME, signal)) throw new Error('VoxBind 没有可用的原生关闭窗口，已保留进程')
      if (!await waitForImageExit(IMAGE_NAME, 8_000, signal)) throw new Error('VoxBind 未响应原生关闭请求，已保留进程')
      child = null
      actionStateInitialized = false
      actionStates = { 'dcs-realtime-translation': false, voice: false }
    },
    async showWindow(signal?: AbortSignal) {
      if (!executablePath) throw new Error('未找到 VoxBind 安装目录')
      stopWindowHider()
      if (!await isImageRunning(IMAGE_NAME, signal)) {
        const application = spawn(executablePath, [], { cwd: path.dirname(executablePath), detached: true, stdio: 'ignore' })
        application.unref()
        if (!await waitForImage(IMAGE_NAME, 8_000, signal)) throw new Error('VoxBind 窗口启动失败')
      }
      if (!await showImageWindow(IMAGE_NAME, 8_000, signal, 'VoxBind')) throw new Error('未找到 VoxBind 主窗口')
    },
    async readActions(signal?: AbortSignal): Promise<ModuleActionState[]> {
      if (!await isImageRunning(IMAGE_NAME, signal)) {
        actionStateInitialized = false
        actionStates = { 'dcs-realtime-translation': false, voice: false }
        return Object.keys(actionPages).map((actionId) => ({ actionId, active: false }))
      }
      if (!installDirectory) return Object.keys(actionPages).map((actionId) => ({ actionId, active: false }))
      const logsDirectory = path.join(installDirectory, 'logs')
      const dcsLog = path.join(logsDirectory, 'dcs.log')
      const voiceLog = path.join(logsDirectory, 'voxbind.log')
      if (!actionStateInitialized) {
        actionStates = {
          'dcs-realtime-translation': await runUiAction('dcs-realtime-translation', undefined, signal),
          voice: await runUiAction('voice', undefined, signal),
        }
        actionLogOffsets = { dcs: fileSize(dcsLog), voice: fileSize(voiceLog) }
        actionStateInitialized = true
      } else {
        const dcsUpdate = readLogUpdate(dcsLog, actionLogOffsets.dcs, actionStates['dcs-realtime-translation'], '[SYS] start', '[SYS] stop')
        const voiceUpdate = readLogUpdate(voiceLog, actionLogOffsets.voice, actionStates.voice, '| VoxBind started', '| VoxBind stopped')
        actionStates = { 'dcs-realtime-translation': dcsUpdate.state, voice: voiceUpdate.state }
        actionLogOffsets = { dcs: dcsUpdate.offset, voice: voiceUpdate.offset }
      }
      return [
        { actionId: 'dcs-realtime-translation', active: actionStates['dcs-realtime-translation'] },
        { actionId: 'voice', active: actionStates.voice },
      ]
    },
    async invokeAction(actionId: string, active: boolean, signal?: AbortSignal): Promise<boolean> {
      if (!(actionId in actionPages)) throw new Error('未知的 VoxBind 功能')
      if (!await isImageRunning(IMAGE_NAME, signal)) await startHidden(signal)
      stopWindowHider()
      const resolvedActionId = actionId as VoxBindActionId
      const nextState = await runUiAction(resolvedActionId, active, signal)
      actionStates[resolvedActionId] = nextState
      return nextState
    },
    async dispose() {
      stopWindowHider()
    },
  }
}
