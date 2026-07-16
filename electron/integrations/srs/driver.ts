import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleActionState, ModuleManifest, ModuleSettings } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestImageWindowClose, showImageWindow, waitForImage, waitForImageExit } from '../windows-process'

const MODULE_ID = 'srs'
const IMAGE_NAME = 'SR-ClientRadio.exe'

interface SrsServer {
  name: string
  address: string
}

type SrsActionId = 'server-connection' | 'awacs-overlay'

function candidateExecutables(): string[] {
  return [...new Set([
    process.env.SRS_CLIENT_EXE,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'DCS-SimpleRadio-Standalone', 'Client', IMAGE_NAME) : undefined,
    'C:\\Program Files\\DCS-SimpleRadio-Standalone\\Client\\SR-ClientRadio.exe',
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findExecutable(): string | null {
  return candidateExecutables().find((candidate) => fs.existsSync(candidate)) || null
}

function readIniValue(filePath: string, section: string, key: string): string | null {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    let inSection = false
    for (const line of lines) {
      const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*$/)
      if (sectionMatch) {
        inSection = sectionMatch[1].trim().toLowerCase() === section.toLowerCase()
        continue
      }
      if (!inSection) continue
      const separator = line.indexOf('=')
      if (separator > 0 && line.slice(0, separator).trim().toLowerCase() === key.toLowerCase()) return line.slice(separator + 1).trim()
    }
  } catch { /* The default is used when SRS has not created its settings yet. */ }
  return null
}

export function parseSrsFavouriteServers(contents: string): SrsServer[] {
  const servers: SrsServer[] = []
  const seen = new Set<string>()
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [rawName, rawAddress] = line.split(',')
    const name = rawName?.trim()
    const address = rawAddress?.trim()
    const identity = `${name?.toLowerCase()}\u0000${address?.toLowerCase()}`
    if (!name || !address || seen.has(identity)) continue
    seen.add(identity)
    servers.push({ name, address })
  }
  return servers
}

function readServers(clientDirectory: string): SrsServer[] {
  let servers: SrsServer[] = []
  try { servers = parseSrsFavouriteServers(fs.readFileSync(path.join(clientDirectory, 'FavouriteServers.csv'), 'utf8')) } catch { /* Optional file. */ }
  return servers
}

function findBrandLogo(): string | undefined {
  const savedGames = path.join(os.homedir(), 'Saved Games')
  try {
    for (const entry of fs.readdirSync(savedGames, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('dcs')) continue
      const iconPath = path.join(savedGames, entry.name, 'Mods', 'Services', 'DCS-SRS', 'Theme', 'icon.png')
      if (fs.existsSync(iconPath)) return `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`
    }
  } catch { /* The Lucide icon is used when the DCS plugin icon is unavailable. */ }
  return undefined
}

function normalizePowerShellError(value: string): string {
  if (!value.includes('CLIXML')) return value.trim()
  return value
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/^#< CLIXML\s*/i, '')
    .trim()
}

function runPowerShell(script: string, signal?: AbortSignal, timeout = 18_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
      timeout,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error(normalizePowerShellError(stderr || stdout || error.message)))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function srsUiScript(operation: 'inspect' | 'set-server' | 'action', actionId: SrsActionId | '', desiredActive: boolean, serverAddress: string): string {
  const encodedServer = Buffer.from(serverAddress, 'utf8').toString('base64')
  return `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DcsHubSrsWindows {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindMainHandle(int processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner; GetWindowThreadProcessId(hWnd,out owner);
      if(owner!=(uint)processId || GetWindowTextLength(hWnd)==0) return true;
      var title=new StringBuilder(GetWindowTextLength(hWnd)+1);
      GetWindowText(hWnd,title,title.Capacity);
      if(title.ToString().IndexOf("DCS-SRS",StringComparison.OrdinalIgnoreCase)>=0){found=hWnd;return false;}
      return true;
    },IntPtr.Zero);
    return found;
  }
  public static IntPtr FindAwacsHandle(int processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint owner; GetWindowThreadProcessId(hWnd,out owner);
      if(owner!=(uint)processId || !IsWindowVisible(hWnd) || GetWindowTextLength(hWnd)==0) return true;
      var title=new StringBuilder(GetWindowTextLength(hWnd)+1);
      GetWindowText(hWnd,title,title.Capacity);
      Rect rect;
      if(title.ToString().Equals("DCS-SimpleRadio",StringComparison.OrdinalIgnoreCase) && GetWindowRect(hWnd,out rect) && rect.Right-rect.Left>=500){found=hWnd;return false;}
      return true;
    },IntPtr.Zero);
    return found;
  }
  public static bool IsAwacsVisible(int processId) {
    return FindAwacsHandle(processId)!=IntPtr.Zero;
  }
  public static bool CloseAwacs(int processId) {
    var handle=FindAwacsHandle(processId);
    return handle!=IntPtr.Zero && PostMessage(handle,0x0010,IntPtr.Zero,IntPtr.Zero);
  }
}
'@
$operation='${operation}'
$actionId='${actionId}'
$desired=${desiredActive ? '$true' : '$false'}
$server=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedServer}'))
$process=Get-Process -Name 'SR-ClientRadio' -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $process){throw 'SRS 客户端尚未运行'}
function Find-ById($root,[string]$id){
  $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
  return $root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
}
function Test-AwacsOverlay {
  return [DcsHubSrsWindows]::IsAwacsVisible($process.Id)
}
$deadline=(Get-Date).AddSeconds(9)
$root=$null
do {
  $handle=[DcsHubSrsWindows]::FindMainHandle($process.Id)
  if($handle -ne [IntPtr]::Zero){try{$root=[Windows.Automation.AutomationElement]::FromHandle($handle)}catch{$root=$null}}
  if($root){break}
  Start-Sleep -Milliseconds 120
} while((Get-Date) -lt $deadline)
if(-not $root){throw '未找到 SRS 主窗口'}
$connectButton=Find-ById $root 'StartStop'
$serverInput=Find-ById $root 'ServerIp'
if(-not $connectButton -or -not $serverInput){throw '当前 SRS 版本缺少可控制的服务器界面'}
function Test-Connected {
  $label=$connectButton.Current.Name
  return $label -match 'Disconnect|断开连接'
}
if($operation -eq 'inspect'){
  if(Test-Connected){$connected=1}else{$connected=0}
  if(Test-AwacsOverlay){$awacs=1}else{$awacs=0}
  Write-Output ('CONNECTED='+$connected+';AWACS='+$awacs)
  exit 0
}
if($operation -eq 'set-server'){
  if(Test-Connected){throw '请先断开当前 SRS 服务器'}
  $valuePattern=$serverInput.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  $valuePattern.SetValue($server)
  Write-Output 'SERVER_SET'
  exit 0
}
if($actionId -eq 'server-connection'){
  $active=Test-Connected
  if($active -ne $desired){
    if($desired){
      $valuePattern=$serverInput.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
      $valuePattern.SetValue($server)
    }
    $connectButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $deadline=(Get-Date).AddSeconds(12)
    do {
      Start-Sleep -Milliseconds 180
      $active=Test-Connected
      if($active -eq $desired){break}
    } while((Get-Date) -lt $deadline)
  }
} elseif($actionId -eq 'awacs-overlay') {
  $active=Test-AwacsOverlay
  if($active -ne $desired){
    if($desired){
      $overlayButton=Find-ById $root 'ShowAwacsOverlay'
      if(-not $overlayButton){throw '当前 SRS 版本不支持预警机浮窗'}
      $overlayButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    } else {
      [DcsHubSrsWindows]::CloseAwacs($process.Id) | Out-Null
    }
    $deadline=(Get-Date).AddSeconds(6)
    do {
      Start-Sleep -Milliseconds 120
      $active=Test-AwacsOverlay
      if($active -eq $desired){break}
    } while((Get-Date) -lt $deadline)
  }
} else { throw '未知的 SRS 操作' }
if($active -ne $desired){throw 'SRS 状态切换超时'}
if($active){Write-Output 'ACTIVE'}else{Write-Output 'INACTIVE'}
`
}

async function inspectSrsUi(signal?: AbortSignal): Promise<{ connected: boolean; awacs: boolean }> {
  const output = await runPowerShell(srsUiScript('inspect', '', false, ''), signal, 13_000)
  const match = output.match(/CONNECTED=(\d);AWACS=(\d)/)
  if (!match) throw new Error('SRS 未返回有效状态')
  return { connected: match[1] === '1', awacs: match[2] === '1' }
}

async function runSrsAction(actionId: SrsActionId, active: boolean, serverAddress: string, signal?: AbortSignal): Promise<boolean> {
  const output = await runPowerShell(srsUiScript('action', actionId, active, serverAddress), signal)
  const state = output.split(/\r?\n/).map((line) => line.trim()).findLast((line) => line === 'ACTIVE' || line === 'INACTIVE')
  if (state === 'ACTIVE') return true
  if (state === 'INACTIVE') return false
  throw new Error('SRS 未返回有效的操作状态')
}

async function setSrsServer(serverAddress: string, signal?: AbortSignal): Promise<void> {
  const output = await runPowerShell(srsUiScript('set-server', '', false, serverAddress), signal, 13_000)
  if (!output.includes('SERVER_SET')) throw new Error('SRS 服务器设置失败')
}

function startWindowHider(pid: number): ChildProcess {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DcsHubSrsWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
}
'@
$targetPid=${pid}
$deadline=(Get-Date).AddSeconds(10)
while((Get-Date) -lt $deadline){
  $target=Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if(-not $target){break}
  $target.Refresh()
  if($target.MainWindowHandle -ne 0){[DcsHubSrsWindow]::ShowWindowAsync($target.MainWindowHandle,0) | Out-Null}
  Start-Sleep -Milliseconds 35
}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

export function createSrsDriver(executableOverride?: string | null): ModuleDriver {
  const executablePath = executableOverride ? fs.existsSync(executableOverride) ? executableOverride : null : findExecutable()
  const clientDirectory = executablePath ? path.dirname(executablePath) : null
  const configPath = clientDirectory ? path.join(clientDirectory, 'global.cfg') : null
  const initialServer = configPath ? readIniValue(configPath, 'Client Settings', 'LastServer') || '127.0.0.1:5002' : '127.0.0.1:5002'
  const servers = clientDirectory ? readServers(clientDirectory) : []
  let selectedServerIndex = Math.max(0, servers.findIndex((server) => server.address.toLowerCase() === initialServer.toLowerCase()))
  let child: ChildProcess | null = null
  let windowHider: ChildProcess | null = null

  const manifest: ModuleManifest = {
    id: MODULE_ID,
    displayName: 'DCS-SRS',
    description: '',
    version: '2.3+',
    icon: 'RadioTower',
    brandLogo: findBrandLogo(),
    executablePath: executableOverride || executablePath || undefined,
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: true, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 15_000, stopMs: 12_000, settingsMs: 15_000, showWindowMs: 12_000, actionMs: 22_000 },
    settingsSchema: [{
      key: 'server',
      label: '服务器',
      kind: 'select',
      required: true,
      autoApply: true,
      quickAccess: true,
      options: servers.map((server, index) => ({ label: `${server.name} · ${server.address}`, value: String(index) })),
    }],
    actions: [
      { id: 'server-connection', label: '服务器', kind: 'toggle', inactiveLabel: '连接', activeLabel: '断开' },
      { id: 'awacs-overlay', label: '预警机浮窗', kind: 'toggle', inactiveLabel: '打开', activeLabel: '关闭' },
    ],
    ui: { settingsCard: { title: 'SRS 服务器预设' } },
    actionLabels: { start: '启动', stop: '停止' },
  }

  function stopWindowHider(): void {
    const helper = windowHider
    windowHider = null
    if (helper && helper.exitCode === null) {
      try { helper.kill() } catch { /* The watcher normally exits by itself. */ }
    }
  }

  async function startHidden(signal?: AbortSignal): Promise<void> {
    if (!executablePath) throw new Error('未找到 DCS-SRS 客户端')
    if (await isImageRunning(IMAGE_NAME, signal)) return
    const started = spawn(executablePath, [], { cwd: path.dirname(executablePath), windowsHide: true, stdio: 'ignore' })
    child = started
    if (!started.pid) throw new Error('SRS 客户端进程未能创建')
    const helper = startWindowHider(started.pid)
    windowHider = helper
    helper.once('close', () => { if (windowHider === helper) windowHider = null })
    started.once('close', () => {
      if (child === started) child = null
      stopWindowHider()
    })
    if (!await waitForImage(IMAGE_NAME, 10_000, signal)) throw new Error('SRS 客户端启动失败')
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!executablePath) return { installState: 'not-installed', runState: 'stopped', details: '未找到 DCS-SRS 客户端' }
    return { installState: 'installed', runState: await isImageRunning(IMAGE_NAME, signal) ? 'running' : 'stopped' }
  }

  return {
    manifest,
    discover,
    start: startHidden,
    async stop(signal?: AbortSignal) {
      stopWindowHider()
      if (!await isImageRunning(IMAGE_NAME, signal)) return
      if (!await requestImageWindowClose(IMAGE_NAME, signal)) throw new Error('SRS 没有可用的原生关闭窗口，已保留进程')
      if (!await waitForImageExit(IMAGE_NAME, 8_000, signal)) throw new Error('SRS 未响应原生关闭请求，已保留进程')
      child = null
    },
    async showWindow(signal?: AbortSignal) {
      if (!executablePath) throw new Error('未找到 DCS-SRS 客户端')
      stopWindowHider()
      if (!await isImageRunning(IMAGE_NAME, signal)) {
        const application = spawn(executablePath, [], { cwd: path.dirname(executablePath), detached: true, stdio: 'ignore' })
        application.unref()
        if (!await waitForImage(IMAGE_NAME, 10_000, signal)) throw new Error('SRS 客户端窗口启动失败')
      }
      if (!await showImageWindow(IMAGE_NAME, 10_000, signal, 'DCS-SRS')) throw new Error('未找到 SRS 主窗口')
    },
    async readSettings(): Promise<ModuleSettings> {
      return { server: servers.length ? String(selectedServerIndex) : '' }
    },
    async applySettings(patch: ModuleSettings, signal?: AbortSignal) {
      if (patch.server === undefined) return
      const nextIndex = typeof patch.server === 'string' ? Number.parseInt(patch.server, 10) : Number.NaN
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= servers.length) throw new Error('请选择 SRS 中已保存的服务器预设')
      selectedServerIndex = nextIndex
      if (await isImageRunning(IMAGE_NAME, signal)) await setSrsServer(servers[selectedServerIndex].address, signal)
    },
    async readActions(signal?: AbortSignal): Promise<ModuleActionState[]> {
      if (!await isImageRunning(IMAGE_NAME, signal)) return [
        { actionId: 'server-connection', active: false },
        { actionId: 'awacs-overlay', active: false },
      ]
      const state = await inspectSrsUi(signal)
      return [
        { actionId: 'server-connection', active: state.connected },
        { actionId: 'awacs-overlay', active: state.awacs },
      ]
    },
    async invokeAction(actionId: string, active: boolean, signal?: AbortSignal): Promise<boolean> {
      if (actionId !== 'server-connection' && actionId !== 'awacs-overlay') throw new Error('未知的 SRS 功能')
      if (!await isImageRunning(IMAGE_NAME, signal)) await startHidden(signal)
      if (actionId === 'server-connection' && servers.length === 0) throw new Error('请先在 SRS 中保存服务器预设')
      return runSrsAction(actionId, active, servers[selectedServerIndex]?.address || '', signal)
    },
    async dispose() { stopWindowHider() },
  }
}
