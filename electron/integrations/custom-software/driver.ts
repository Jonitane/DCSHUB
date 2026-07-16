import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleManifest } from '../../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from '../../modules/types'
import { isImageRunning, requestImageWindowClose, requestTrayExit, showImageWindow, startProcessTreeMinimizeWatcher, terminateProcessTree, waitForImage, waitForImageExit } from '../windows-process'

export interface CustomSoftwareDefinition {
  id: string
  displayName: string
  executablePath: string
  iconDataUrl: string | null
  version: string
}

export function createCustomSoftwareDriver(definition: CustomSoftwareDefinition): ModuleDriver {
  const imageName = path.basename(definition.executablePath)
  const manifest: ModuleManifest = {
    id: definition.id,
    displayName: definition.displayName,
    description: '',
    version: definition.version || 'unknown',
    icon: 'Package',
    brandLogo: definition.iconDataUrl || undefined,
    executablePath: definition.executablePath,
    integrationKind: 'custom',
    dependencies: [],
    capabilities: { lifecycle: true, settings: false, showWindow: true, logs: false },
    stopPolicy: 'always',
    timeouts: { discoverMs: 5_000, startMs: 18_000, stopMs: 15_000, showWindowMs: 10_000 },
    actionLabels: { start: '启动', stop: '停止' },
  }
  let child: ChildProcess | null = null
  let minimizeWatcher: ChildProcess | null = null

  function stopMinimizeWatcher(): void {
    const watcher = minimizeWatcher
    minimizeWatcher = null
    if (watcher && watcher.exitCode === null) {
      try { watcher.kill() } catch { /* Startup watcher normally exits by itself. */ }
    }
  }

  function trackOwnedProcess(application: ChildProcess): void {
    child = application
    application.once('error', () => {
      if (child === application) child = null
    })
    application.once('close', () => {
      if (child === application) child = null
    })
    application.unref()
  }

  async function discover(signal?: AbortSignal): Promise<ModuleHealth> {
    if (!fs.existsSync(definition.executablePath)) {
      return { installState: 'not-installed', runState: 'stopped', details: '软件路径已失效' }
    }
    const running = await isImageRunning(imageName, signal)
    return { installState: 'installed', runState: running ? 'running' : 'stopped' }
  }

  return {
    manifest,
    discover,
    async start(signal) {
      if (!fs.existsSync(definition.executablePath)) throw new Error('软件路径已失效，请在软件管理中重新添加')
      if (await isImageRunning(imageName, signal)) return
      const application = spawn(definition.executablePath, [], {
        cwd: path.dirname(definition.executablePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      trackOwnedProcess(application)
      if (application.pid) {
        stopMinimizeWatcher()
        minimizeWatcher = startProcessTreeMinimizeWatcher(application.pid, imageName, 18_000)
      }
      if (!await waitForImage(imageName, 8_000, signal)) throw new Error(`${definition.displayName} 启动后未检测到运行进程`)
    },
    async stop(signal) {
      stopMinimizeWatcher()
      if (!await isImageRunning(imageName, signal)) return

      const windowCloseRequested = await requestImageWindowClose(imageName, signal)
      if (windowCloseRequested && await waitForImageExit(imageName, 2_500, signal)) {
        child = null
        return
      }

      const trayExitRequested = await requestTrayExit(
        [definition.displayName, path.parse(imageName).name],
        [
          'Exit', 'Quit', 'Close', '退出', '退出程序', '关闭', '关闭程序',
          `Exit ${definition.displayName}`, `Quit ${definition.displayName}`,
          `退出 ${definition.displayName}`, `关闭 ${definition.displayName}`,
        ],
        3_000,
        signal,
      )
      if (trayExitRequested && await waitForImageExit(imageName, 3_000, signal)) {
        child = null
        return
      }

      // The hard fallback is intentionally PID-scoped and available only for
      // the exact process launched during this DCSHUB session. An externally
      // discovered process has no tracked child and is never force-terminated.
      const ownedPid = child?.pid
      if (ownedPid && child?.exitCode === null) {
        try {
          await terminateProcessTree(ownedPid, signal)
        } catch (error) {
          if (await isImageRunning(imageName, signal)) throw error
        }
        if (await waitForImageExit(imageName, 3_000, signal)) {
          child = null
          return
        }
        throw new Error(`${definition.displayName} 的 HUB 自有进程兜底关闭后仍在运行`)
      }

      throw new Error(`${definition.displayName} 未响应窗口关闭或托盘退出；该实例不是由 HUB 启动，未执行强制结束`)
    },
    async showWindow(signal) {
      stopMinimizeWatcher()
      if (!await isImageRunning(imageName, signal)) {
        const application = spawn(definition.executablePath, [], {
          cwd: path.dirname(definition.executablePath),
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        })
        trackOwnedProcess(application)
        await waitForImage(imageName, 8_000, signal)
      }
      if (!await showImageWindow(imageName, 8_000, signal)) throw new Error('没有找到可显示的软件窗口')
    },
    dispose() {
      stopMinimizeWatcher()
    },
  }
}
