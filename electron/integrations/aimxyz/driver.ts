import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleManifest } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestImageWindowClose, showImageWindow, waitForImage, waitForImageExit } from '../windows-process'

const MODULE_ID = 'aimxyz'
const IMAGE_NAME = 'AimxyZ.exe'

function candidateExecutables(): string[] {
  return [...new Set([
    process.env.AIMXYZ_EXE,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'AimxyZ', IMAGE_NAME) : undefined,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'AimxyZ', IMAGE_NAME) : undefined,
    'C:\\Program Files\\AimxyZ\\AimxyZ.exe',
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findExecutable(): string | null {
  return candidateExecutables().find((candidate) => fs.existsSync(candidate)) || null
}

function createManifest(executablePath: string | null, executableOverride?: string | null): ModuleManifest {
  return {
    id: MODULE_ID,
    displayName: 'AimxyZ',
    description: '头部追踪 · 静默后台启动',
    version: '2.3.12',
    icon: 'Eye',
    brandLogo: '/modules/aimxyz-icon.png',
    backgroundImage: '/modules/aimxyz-bg.png',
    executablePath: executableOverride || executablePath || undefined,
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: false, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 15_000, stopMs: 12_000, showWindowMs: 18_000 },
    actionLabels: { start: '启动', stop: '停止' },
  }
}

function startWindowHider(pid: number): ChildProcess {
  // AimxyZ explicitly shows both a Qt splash window and its main window even
  // when CreateProcess receives SW_HIDE. A short-lived watcher keeps both
  // native windows hidden while AimxyZ initializes its own system tray.
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DcsHubAimxyWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
$targetPid=${pid}
$deadline=(Get-Date).AddSeconds(12)
while((Get-Date) -lt $deadline){
  $target=Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if(-not $target){break}
  $handle=$target.MainWindowHandle
  if($handle -ne 0){[DcsHubAimxyWindow]::ShowWindowAsync($handle,0) | Out-Null}
  Start-Sleep -Milliseconds 20
}
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createAimxyZDriver(executableOverride?: string | null): ModuleDriver {
  const executablePath = executableOverride ? fs.existsSync(executableOverride) ? executableOverride : null : findExecutable()
  const manifest = createManifest(executablePath, executableOverride)
  let child: ChildProcess | null = null
  let windowHider: ChildProcess | null = null

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!executablePath) return { installState: 'not-installed', runState: 'stopped', details: '未找到 AimxyZ 安装目录' }
    const running = await isImageRunning(IMAGE_NAME, signal)
    return { installState: 'installed', runState: running ? 'running' : 'stopped' }
  }

  function stopWindowHider(): void {
    const helper = windowHider
    windowHider = null
    if (helper && helper.exitCode === null) {
      try { helper.kill() } catch { /* The helper normally exits by itself. */ }
    }
  }

  async function stopOwnedProcess(signal?: AbortSignal): Promise<void> {
    stopWindowHider()
    if (!await isImageRunning(IMAGE_NAME, signal)) return
    if (!await requestImageWindowClose(IMAGE_NAME, signal)) throw new Error('AimxyZ 没有可用的原生关闭窗口，已保留进程')
    if (!await waitForImageExit(IMAGE_NAME, 8_000, signal)) throw new Error('AimxyZ 未响应原生关闭请求，已保留进程')
    child = null
  }

  return {
    manifest,
    discover,
    async start(signal?: AbortSignal) {
      if (!executablePath) throw new Error('未找到 AimxyZ 安装目录')
      if (await isImageRunning(IMAGE_NAME, signal)) throw new Error('AimxyZ 已由外部进程启动')
      signal?.throwIfAborted()

      const startedProcess = spawn(executablePath, [], {
        cwd: path.dirname(executablePath),
        windowsHide: true,
        stdio: 'ignore',
      })
      child = startedProcess
      if (!startedProcess.pid) throw new Error('AimxyZ 进程未能创建')
      const helper = startWindowHider(startedProcess.pid)
      windowHider = helper
      helper.once('close', () => { if (windowHider === helper) windowHider = null })
      startedProcess.once('close', () => {
        if (child === startedProcess) child = null
        stopWindowHider()
      })

      try {
        if (!await waitForImage(IMAGE_NAME, 8_000, signal)) throw new Error('AimxyZ 启动失败')
        await delay(3_000, signal)
        if (startedProcess.exitCode !== null) throw new Error('AimxyZ 启动后意外退出')
      } catch (error) {
        try { await stopOwnedProcess() } catch { /* Preserve the process when it cannot close itself normally. */ }
        throw error
      }
    },
    async stop(signal?: AbortSignal) {
      await stopOwnedProcess(signal)
    },
    async showWindow(signal?: AbortSignal) {
      if (!executablePath) throw new Error('未找到 AimxyZ 安装目录')
      stopWindowHider()
      if (!await isImageRunning(IMAGE_NAME, signal)) {
        signal?.throwIfAborted()
        const application = spawn(executablePath, [], {
          cwd: path.dirname(executablePath),
          detached: true,
          stdio: 'ignore',
        })
        application.unref()
        if (!await waitForImage(IMAGE_NAME, 8_000, signal)) throw new Error('AimxyZ 窗口启动失败')
      }
      if (!await showImageWindow(IMAGE_NAME, 8_000, signal)) throw new Error('未找到 AimxyZ 主窗口')
    },
    async dispose() {
      if (child && child.exitCode === null) {
        try { await stopOwnedProcess() } catch { /* Never force-close vendor software while the Hub exits. */ }
      }
    },
  }
}
