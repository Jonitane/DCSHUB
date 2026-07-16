import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { ModuleManifest, ModuleSettings } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestTrayExit, showImageWindow, waitForImage, waitForImageExit } from '../windows-process'

const MODULE_ID = 'pimax-vr'
const CLIENT_IMAGE = 'PimaxClient.exe'

interface StoredFlag {
  existed: boolean
  value: unknown
}

function reserveLoopbackPort(signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const server = createServer()
    const onAbort = () => server.close(() => reject(signal?.reason))
    signal?.addEventListener('abort', onAbort, { once: true })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      server.close((error) => {
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

/**
 * Pimax's own Exit menu sends `windowAppQuit` from the renderer. Its main
 * process handles that event by closing the windows and tray, closing gRPC,
 * updating login state, and finally calling app.quit(). For an instance that
 * DCSHUB launched with a loopback-only DevTools port, send that exact event
 * instead of terminating any process.
 */
function requestPimaxAppExit(port: number, timeoutMs = 2_500, signal?: AbortSignal): Promise<boolean> {
  const timeout = Math.max(500, Math.round(timeoutMs))
  const script = `
$deadline=(Get-Date).AddMilliseconds(${timeout})
do {
  try {
    # Windows PowerShell 5.1 can retain a JSON top-level array as one nested
    # pipeline object when Invoke-RestMethod is wrapped in @(). Parse the raw
    # response explicitly so page selection remains stable across versions.
    $targets=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:${port}/json/list' -TimeoutSec 1 -ErrorAction Stop).Content | ConvertFrom-Json
    $target=$targets | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl } | Select-Object -First 1
    if($target) {
      $socket=New-Object System.Net.WebSockets.ClientWebSocket
      try {
        $connected=$socket.ConnectAsync([Uri]([string]$target.webSocketDebuggerUrl),[Threading.CancellationToken]::None).Wait(1500)
        if($connected -and $socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
          $message=@{
            id=1
            method='Runtime.evaluate'
            params=@{
              expression="(() => { if (!window.ipcRenderer || typeof window.ipcRenderer.send !== 'function') return false; window.ipcRenderer.send('windowAppQuit'); return true })()"
              returnByValue=$true
            }
          } | ConvertTo-Json -Compress -Depth 5
          $bytes=[Text.Encoding]::UTF8.GetBytes($message)
          $segment=[ArraySegment[byte]]::new($bytes)
          $sent=$socket.SendAsync($segment,[System.Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).Wait(1500)
          if($sent) {
            $buffer=New-Object byte[] 16384
            $received=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),[Threading.CancellationToken]::None)
            if($received.Wait(1500)) {
              $result=$received.Result
              $response=[Text.Encoding]::UTF8.GetString($buffer,0,$result.Count) | ConvertFrom-Json
              if($response.id -eq 1 -and $response.result.result.value -eq $true) {
                Write-Output 'INVOKED'
                exit 0
              }
            }
          }
        }
      } finally {
        $socket.Dispose()
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 120
} while((Get-Date) -lt $deadline)
Write-Output 'NOT_AVAILABLE'
`
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedScript], {
      windowsHide: true,
      encoding: 'utf8',
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as Error).name === 'AbortError') reject(error)
        else reject(new Error((stderr || stdout || error.message).trim()))
        return
      }
      resolve(stdout.includes('INVOKED'))
    })
  })
}

function candidateClients(): string[] {
  return [...new Set([
    process.env.PIMAX_PLAY_EXE,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Pimax', 'PimaxClient', 'pimaxui', CLIENT_IMAGE) : undefined,
    'C:\\Program Files\\Pimax\\PimaxClient\\pimaxui\\PimaxClient.exe',
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findClient(): string | null {
  return candidateClients().find((candidate) => fs.existsSync(candidate)) || null
}

function quadViewsConfigPath(): string {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Quad-Views-Foveated', 'settings.cfg')
}

function pimaxStorePath(): string {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PimaxClient', 'config.json')
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.dcs-hub-${process.pid}-${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, '\t')}\n`, 'utf8')
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try { fs.unlinkSync(temporaryPath) } catch { /* The rename normally consumed the temporary file. */ }
  }
}

function setMiniStartingFlag(enabled: boolean): StoredFlag | null {
  const filePath = pimaxStorePath()
  if (!fs.existsSync(filePath)) return null
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  const original = { existed: Object.hasOwn(store, 'MiniStartingFlag'), value: store.MiniStartingFlag }
  store.MiniStartingFlag = enabled
  writeJsonAtomic(filePath, store)
  return original
}

function restoreMiniStartingFlag(original: StoredFlag | null): void {
  if (!original) return
  const filePath = pimaxStorePath()
  if (!fs.existsSync(filePath)) return
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  if (original.existed) store.MiniStartingFlag = original.value
  else delete store.MiniStartingFlag
  writeJsonAtomic(filePath, store)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readLastNumber(content: string, key: string): number {
  const pattern = new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}\\s*=\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+))`, 'gmi')
  let value: number | null = null
  for (const match of content.matchAll(pattern)) value = Number(match[1])
  if (value === null || !Number.isFinite(value)) throw new Error(`QuadViews 配置中缺少 ${key}`)
  return value
}

function replaceAllValues(content: string, key: string, value: string): { content: string; count: number } {
  const pattern = new RegExp(`^(\\s*#?\\s*${escapeRegExp(key)}\\s*=\\s*)[^\\r\\n]*`, 'gmi')
  let count = 0
  return {
    content: content.replace(pattern, (_match, prefix: string) => {
      count += 1
      return `${prefix}${value}`
    }),
    get count() { return count },
  }
}

function writeConfigAtomic(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.dcs-hub-${process.pid}-${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, content, 'utf8')
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try { fs.unlinkSync(temporaryPath) } catch { /* The rename normally consumed the temporary file. */ }
  }
}

function requirePercent(settings: ModuleSettings, key: string, min: number, max: number): number {
  const value = settings[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} 必须在 ${min} 到 ${max} 之间`)
  }
  return Math.round(value)
}

function createManifest(clientPath: string | null, executableOverride?: string | null): ModuleManifest {
  return {
    id: MODULE_ID,
    displayName: 'PimaxVR',
    description: 'Pimax Play 与 QuadViews Companion',
    version: '1',
    icon: 'Monitor',
    brandLogo: '/modules/pimax-vr-icon.png',
    backgroundImage: '/modules/pimax-play-bg.png',
    executablePath: executableOverride || clientPath || undefined,
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: true, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 20_000, stopMs: 20_000, settingsMs: 5_000, showWindowMs: 25_000 },
    settingsSyncIntervalMs: 1_500,
    ui: {
      lifecycleCard: {
        title: 'Pimax Play',
        description: '客户端静默启动并使用原生托盘；驱动服务保持独立运行',
        backgroundImage: '/modules/pimax-play-bg.png',
      },
      settingsCard: {
        title: 'QuadViews Companion',
        description: '直接同步 settings.cfg；在其他程序中修改后会自动刷新',
        backgroundImage: '/modules/quadviews-bg.png',
        actionLabel: 'APPLY',
      },
    },
    settingsSchema: [
      { key: 'horizontalFocusSize', label: 'Horizontal focus size', kind: 'slider', min: 10, max: 90, step: 1, suffix: '% of FOV' },
      { key: 'verticalFocusSize', label: 'Vertical focus size', kind: 'slider', min: 10, max: 90, step: 1, suffix: '% of FOV' },
      { key: 'foveateResolution', label: 'Foveate resolution', kind: 'slider', min: 50, max: 300, step: 1, suffix: '% of native resolution' },
    ],
    actionLabels: { start: '启动', stop: '停止' },
  }
}

export function createPimaxVrDriver(executableOverride?: string | null): ModuleDriver {
  const clientPath = executableOverride ? fs.existsSync(executableOverride) ? executableOverride : null : findClient()
  const settingsPath = quadViewsConfigPath()
  const manifest = createManifest(clientPath, executableOverride)
  let child: ChildProcess | null = null
  let appControlPort: number | null = null
  let originalMiniStartingFlag: StoredFlag | null = null

  function watchManagedClient(startedProcess: ChildProcess, port: number): void {
    child = startedProcess
    appControlPort = port
    startedProcess.once('close', () => {
      if (child === startedProcess) child = null
      if (appControlPort === port) appControlPort = null
      try {
        restoreMiniStartingFlag(originalMiniStartingFlag)
        originalMiniStartingFlag = null
      } catch { /* The next stop/dispose pass retries restoration. */ }
    })
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!clientPath) return { installState: 'not-installed', runState: 'stopped', details: '未找到 Pimax Play 客户端' }
    const running = await isImageRunning(CLIENT_IMAGE, signal)
    return {
      installState: 'installed',
      runState: running ? 'running' : 'stopped',
      details: fs.existsSync(settingsPath) ? undefined : '未找到 QuadViews Companion 配置文件',
    }
  }

  async function requestNativeExit(signal?: AbortSignal): Promise<void> {
    try {
      if (!await isImageRunning(CLIENT_IMAGE, signal)) return

      // DCSHUB-managed instances expose a loopback-only control port. This
      // invokes the exact IPC used by Pimax's own Exit Pimax menu.
      const controlledPort = appControlPort
      if (controlledPort && await requestPimaxAppExit(controlledPort, 2_500, signal)) {
        if (await waitForImageExit(CLIENT_IMAGE, 5_000, signal)) return
        throw new Error('Pimax Play 已收到官方退出命令但没有正常结束，已保留客户端与运行时服务')
      }
      if (!await isImageRunning(CLIENT_IMAGE, signal)) return

      // An instance started outside DCSHUB has no private control port, so use
      // the application's own tray command. Failure is safe and never falls
      // back to taskkill.
      const trayExitInvoked = await requestTrayExit(
        ['Pimax', 'Pimax Play', 'PimaxPlay'],
        ['Exit Pimax', 'Exit Pimax Play', '退出 Pimax', '退出 Pimax Play'],
        6_000,
        signal,
      )
      if (!trayExitInvoked) throw new Error('未找到 Pimax 托盘中的“Exit Pimax”。请从 Pimax 托盘菜单退出；DCSHUB 没有强制结束客户端或运行时服务')
      if (!await waitForImageExit(CLIENT_IMAGE, 10_000, signal)) {
        throw new Error('Pimax Play 未在原生退出请求后正常结束，已保留进程与运行时服务')
      }
    } finally {
      if (!await isImageRunning(CLIENT_IMAGE).catch(() => true)) {
        child = null
        appControlPort = null
        restoreMiniStartingFlag(originalMiniStartingFlag)
        originalMiniStartingFlag = null
      }
    }
  }

  return {
    manifest,
    discover,
    async start(signal?: AbortSignal) {
      if (!clientPath) throw new Error('未找到 Pimax Play 客户端')
      if (await isImageRunning(CLIENT_IMAGE, signal)) throw new Error('Pimax Play 已由外部进程启动')
      signal?.throwIfAborted()

      // Pimax Play creates its own native tray. This flag is the application's
      // built-in path for keeping the main window hidden once it is ready.
      originalMiniStartingFlag = setMiniStartingFlag(true)
      const controlPort = await reserveLoopbackPort(signal)
      const startedProcess = spawn(clientPath, [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${controlPort}`,
      ], {
        cwd: path.dirname(clientPath),
        windowsHide: true,
        stdio: 'ignore',
      })
      watchManagedClient(startedProcess, controlPort)

      try {
        if (!await waitForImage(CLIENT_IMAGE, 12_000, signal) || startedProcess.exitCode !== null) {
          throw new Error('Pimax Play 客户端启动失败')
        }
      } catch (error) {
        try { await requestNativeExit() } catch { /* Preserve the client if its own exit path is unavailable. */ }
        throw error
      }
    },
    async stop(signal?: AbortSignal) {
      // The vendor's Exit Pimax command intentionally closes only the client
      // and gRPC session. Runtime, headset and Tobii services remain under
      // Pimax's own lifecycle policy and are not treated as leaked processes.
      await requestNativeExit(signal)
    },
    async showWindow(signal?: AbortSignal) {
      if (!clientPath) throw new Error('未找到 Pimax Play 客户端')
      if (!await isImageRunning(CLIENT_IMAGE, signal)) {
        signal?.throwIfAborted()
        const controlPort = await reserveLoopbackPort(signal)
        const client = spawn(clientPath, [
          '--remote-debugging-address=127.0.0.1',
          `--remote-debugging-port=${controlPort}`,
        ], {
          cwd: path.dirname(clientPath),
          stdio: 'ignore',
        })
        watchManagedClient(client, controlPort)
        if (!await waitForImage(CLIENT_IMAGE, 12_000, signal)) throw new Error('Pimax Play 窗口启动失败')
      }
      if (!await showImageWindow(CLIENT_IMAGE, 10_000, signal)) throw new Error('未找到 Pimax Play 主窗口')
    },
    async readSettings() {
      if (!fs.existsSync(settingsPath)) throw new Error('未找到 QuadViews Companion 的 settings.cfg')
      const content = fs.readFileSync(settingsPath, 'utf8')
      const horizontal = readLastNumber(content, 'horizontal_focus_section')
      const vertical = readLastNumber(content, 'vertical_focus_section')
      const focusMultiplier = readLastNumber(content, 'focus_multiplier')
      return {
        horizontalFocusSize: Math.round(horizontal * 100),
        verticalFocusSize: Math.round(vertical * 100),
        foveateResolution: Math.round(focusMultiplier * focusMultiplier * 100),
      }
    },
    async applySettings(settings) {
      if (!fs.existsSync(settingsPath)) throw new Error('未找到 QuadViews Companion 的 settings.cfg')
      const horizontal = requirePercent(settings, 'horizontalFocusSize', 10, 90)
      const vertical = requirePercent(settings, 'verticalFocusSize', 10, 90)
      const foveate = requirePercent(settings, 'foveateResolution', 50, 300)
      let content = fs.readFileSync(settingsPath, 'utf8')
      const replacements: Array<[string, string]> = [
        ['horizontal_focus_section', (horizontal / 100).toFixed(2)],
        ['horizontal_fixed_section', (horizontal / 100).toFixed(2)],
        ['vertical_focus_section', (vertical / 100).toFixed(2)],
        ['vertical_fixed_section', (vertical / 100).toFixed(2)],
        ['focus_multiplier', Math.sqrt(foveate / 100).toFixed(3)],
      ]
      for (const [key, value] of replacements) {
        const result = replaceAllValues(content, key, value)
        if (result.count === 0) throw new Error(`QuadViews 配置中缺少 ${key}`)
        content = result.content
      }
      writeConfigAtomic(settingsPath, content)
    },
    async dispose() {
      if (child && child.exitCode === null) {
        try { await requestNativeExit() } catch { /* Never force-close vendor software while the Hub exits. */ }
      }
    },
  }
}
