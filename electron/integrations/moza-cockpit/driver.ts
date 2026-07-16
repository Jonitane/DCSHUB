import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ModuleManifest } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestImageWindowClose, requestQtTrayWindowClose, showImageWindow, waitForImage, waitForImageExit, waitForPidExit } from '../windows-process'

const MODULE_ID = 'moza-cockpit'
const LAUNCHER_NAME = 'MOZA Cockpit.exe'
const SERVICE_NAME = 'MOZADeviceService.exe'

interface StoredCloseStrategy {
  existed: boolean
  value: unknown
}

function userSettingsPath(): string {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MOZA Cockpit', 'user.json')
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.dcs-hub-${process.pid}-${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 4)}\n`, 'utf8')
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try { fs.unlinkSync(temporaryPath) } catch { /* The rename normally consumed the temporary file. */ }
  }
}

/**
 * MOZA's own close button reads this setting. A DCSHUB-managed launch uses the
 * vendor's `close` strategy so WM_CLOSE follows MOZA's normal shutdown path
 * instead of merely hiding the window. The user's original choice is restored
 * only after MOZA has finished writing its state during shutdown.
 */
function setManagedCloseStrategy(): StoredCloseStrategy | null {
  const filePath = userSettingsPath()
  if (!fs.existsSync(filePath)) return null
  const settings = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  const original = { existed: Object.hasOwn(settings, 'closeStrategy'), value: settings.closeStrategy }
  settings.closeStrategy = 'close'
  writeJsonAtomic(filePath, settings)
  return original
}

function restoreCloseStrategy(original: StoredCloseStrategy | null): void {
  if (!original) return
  const filePath = userSettingsPath()
  if (!fs.existsSync(filePath)) return
  const settings = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
  // Do not overwrite a choice the user made in MOZA while it was running.
  if (settings.closeStrategy !== 'close') return
  if (original.existed) settings.closeStrategy = original.value
  else delete settings.closeStrategy
  writeJsonAtomic(filePath, settings)
}

function candidateInstallations(): string[] {
  return [...new Set([
    process.env.MOZA_COCKPIT_HOME,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'MOZA Cockpit') : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'MOZA Cockpit') : undefined,
    'C:\\Program Files (x86)\\MOZA Cockpit',
  ].filter((candidate): candidate is string => Boolean(candidate)))]
}

function findInstallation(): string | null {
  return candidateInstallations().find((candidate) => (
    fs.existsSync(path.join(candidate, LAUNCHER_NAME))
    && fs.existsSync(path.join(candidate, 'bin', LAUNCHER_NAME))
    && fs.existsSync(path.join(candidate, 'bin', SERVICE_NAME))
  )) || null
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

function readVersion(installDir: string | null): string {
  if (!installDir) return 'unknown'
  try {
    const resourceDir = path.join(installDir, 'installerResources', 'as23.pc.moza_cockpit')
    const versions = fs.readdirSync(resourceDir)
      .map((name) => name.match(/^(\d+(?:\.\d+)+)bin\.txt$/i)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort(compareVersions)
    return versions.at(-1) || 'unknown'
  } catch { return 'unknown' }
}

function createManifest(installDir: string | null, executableOverride?: string | null): ModuleManifest {
  return {
    id: MODULE_ID,
    displayName: 'MOZA Cockpit',
    description: 'MOZA 飞行设备管理 · 静默后台启动',
    version: readVersion(installDir),
    icon: 'Gamepad2',
    brandLogo: '/modules/moza-cockpit-icon.png',
    backgroundImage: '/modules/moza-cockpit-bg-hero.png',
    executablePath: executableOverride || (installDir ? path.join(installDir, 'bin', LAUNCHER_NAME) : undefined),
    integrationKind: 'builtin',
    dependencies: [],
    capabilities: { lifecycle: true, settings: false, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 15_000, stopMs: 10_000, showWindowMs: 20_000 },
    actionLabels: { start: '启动', stop: '停止' },
  }
}

export function createMozaCockpitDriver(executableOverride?: string | null): ModuleDriver {
  const selectedDirectory = executableOverride ? path.dirname(executableOverride) : null
  const overrideRoot = selectedDirectory && path.basename(selectedDirectory).toLowerCase() === 'bin' ? path.dirname(selectedDirectory) : selectedDirectory
  const installDir = overrideRoot
    ? fs.existsSync(path.join(overrideRoot, LAUNCHER_NAME)) && fs.existsSync(path.join(overrideRoot, 'bin', LAUNCHER_NAME)) ? overrideRoot : null
    : findInstallation()
  const manifest = createManifest(installDir, executableOverride)
  let child: ChildProcess | null = null
  let originalCloseStrategy: StoredCloseStrategy | null = null

  function restoreManagedCloseStrategy(): void {
    restoreCloseStrategy(originalCloseStrategy)
    originalCloseStrategy = null
  }

  async function requestVisibleUi(signal?: AbortSignal): Promise<void> {
    if (!installDir) throw new Error('未找到 MOZA Cockpit 安装目录')
    signal?.throwIfAborted()
    const launcher = spawn(path.join(installDir, LAUNCHER_NAME), [], {
      cwd: installDir,
      detached: true,
      stdio: 'ignore',
    })
    const launcherPid = launcher.pid
    launcher.unref()

    // The outer launcher asks an existing autostart instance to initialize and
    // show its full UI, then exits. Waiting prevents us from restoring MOZA's
    // launch image or its uninitialized hidden Qt shell by mistake.
    if (launcherPid) await waitForPidExit(launcherPid, 10_000, signal)
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!installDir) {
      return { installState: 'not-installed', runState: 'stopped', details: '未找到 MOZA Cockpit 安装目录' }
    }
    const running = await isImageRunning(LAUNCHER_NAME, signal)
    return { installState: 'installed', runState: running ? 'running' : 'stopped' }
  }

  async function requestNativeExit(signal?: AbortSignal): Promise<void> {
    try {
      if (!await isImageRunning(LAUNCHER_NAME, signal)) return

      // Managed launches load MOZA's native "close application" preference,
      // so the titled main window is the fastest graceful shutdown path.
      const windowCloseRequested = await requestImageWindowClose(LAUNCHER_NAME, signal)
      if (windowCloseRequested && await waitForImageExit(LAUNCHER_NAME, 1_500, signal)) {
        // MOZADeviceService intentionally outlives the UI briefly while it
        // releases hardware and then exits by itself. It is not a stop-failure
        // signal once the vendor application's main process has closed.
        return
      }

      // Externally launched instances may be configured to hide their main
      // window. Qt's tray callback WM_CLOSE requests application termination
      // directly while preserving MOZA's own cleanup and service release.
      const applicationCloseRequested = await requestQtTrayWindowClose(LAUNCHER_NAME, signal)
      if (!applicationCloseRequested || !await waitForImageExit(LAUNCHER_NAME, 5_000, signal)) {
        throw new Error('MOZA Cockpit 未响应原生退出请求，已保留进程与设备服务')
      }
      // The device service performs the same delayed self-cleanup here.
    } finally {
      if (!await isImageRunning(LAUNCHER_NAME).catch(() => true)) {
        child = null
        restoreManagedCloseStrategy()
      }
    }
  }

  return {
    manifest,
    discover,
    async start(signal?: AbortSignal) {
      if (!installDir) throw new Error('未找到 MOZA Cockpit 安装目录')
      if (await isImageRunning(LAUNCHER_NAME, signal)) throw new Error('MOZA Cockpit 已由外部进程启动')
      signal?.throwIfAborted()

      // Skip MOZA's outer bootstrap executable: it shows the launch image before
      // handing off to the real application and does not preserve SW_HIDE.
      const applicationDir = path.join(installDir, 'bin')
      const applicationPath = path.join(applicationDir, LAUNCHER_NAME)
      originalCloseStrategy = setManagedCloseStrategy()
      const startedProcess = spawn(applicationPath, ['--autostart'], {
        cwd: applicationDir,
        windowsHide: true,
        stdio: 'ignore',
      })
      child = startedProcess
      startedProcess.once('close', () => {
        if (child === startedProcess) child = null
        try { restoreManagedCloseStrategy() } catch { /* The next stop/dispose pass retries restoration. */ }
      })

      try {
        const serviceReady = await waitForImage(SERVICE_NAME, 10_000, signal)
        if (!serviceReady || startedProcess.exitCode !== null) throw new Error('MOZA Cockpit 后台服务启动失败')
        // The service becomes ready before MOZA finishes loading UI
        // preferences. Restore the user's file after initialization while the
        // managed process retains the close behavior in memory.
        await delay(3_000, undefined, { signal })
        restoreCloseStrategy(originalCloseStrategy)
      } catch (error) {
        try { await requestNativeExit() } catch { /* Preserve the process if its own exit path is unavailable. */ }
        throw error
      }
    },
    async stop(signal?: AbortSignal) {
      await requestNativeExit(signal)
    },
    async showWindow(signal?: AbortSignal) {
      if (!installDir) throw new Error('未找到 MOZA Cockpit 安装目录')
      await requestVisibleUi(signal)
      if (!await waitForImage(LAUNCHER_NAME, 10_000, signal)) throw new Error('MOZA Cockpit 窗口启动失败')
      if (!await showImageWindow(LAUNCHER_NAME, 8_000, signal, 'MOZA')) throw new Error('未找到 MOZA Cockpit 主窗口')
    },
    async dispose() {
      if (child && child.exitCode === null) {
        try { await requestNativeExit() } catch { /* Never force-close vendor software while the Hub exits. */ }
      }
    },
  }
}
