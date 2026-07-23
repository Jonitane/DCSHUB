import type { ModuleChangedEvent, ModuleLogEntry } from '../../src/shared/module-contracts'
import type { ManualLibraryProgress } from '../../src/shared/manual-library-contracts'
import type { CoreStatus } from '../../src/shared/core-contracts'
import { DcsLaunchService } from '../builtins/dcs-launch/service'
import { ManualLibraryService } from '../builtins/manual-library/service'
import { ModManagerService } from '../builtins/mod-manager/service'
import { SoftwareCatalogService } from '../builtins/software-catalog/service'
import { UpdateService } from '../builtins/update/service'
import { VrOverlayService } from '../builtins/vr-overlay/service'
import { createAimxyZDriver } from '../integrations/aimxyz/driver'
import { createEyeMouseDriver } from '../integrations/eye-mouse/driver'
import { createMozaCockpitDriver } from '../integrations/moza-cockpit/driver'
import { createPimaxVrDriver } from '../integrations/pimax-vr/driver'
import { createSrsDriver } from '../integrations/srs/driver'
import { createVoxBindDriver } from '../integrations/voxbind/driver'
import { ModuleManager } from '../modules/ModuleManager'
import { DcsProcessMonitor } from '../platform/dcs-process-monitor'
import { CoreEventBus } from './event-bus'
import { NativeCoreClient, type NativeDcsProcessStatus, type NativeSpeechDevice, type NativeSpeechResult } from './native-core-client'
import { buildCoreStatus } from './status'

export interface AppCoreEncryption {
  available: () => boolean
  protect: (value: string) => string
  unprotect: (value: string) => string
}

export interface AppCoreOptions {
  userDataDirectory: string
  packaged: boolean
  vrResourcesDirectory: string
  nativeCoreExecutable: string
  diagnosticLogDirectory: string
  appVersion: string
  encryption: AppCoreEncryption
  fetchImpl: typeof fetch
  onDcsMonitorError?: (error: Error) => void
  onModuleChanged?: (event: ModuleChangedEvent) => void
  onModuleLog?: (entry: ModuleLogEntry) => void
}

/**
 * Composition root for non-visual DCSHUB capabilities.
 *
 * The renderer and Electron window layer only depend on this boundary. Current
 * TypeScript services remain in-process for compatibility; each service can be
 * moved behind a native named-pipe client later without changing renderer IPC.
 */
export class AppCore {
  readonly events = new CoreEventBus()
  readonly modules = new ModuleManager()
  readonly modManager: ModManagerService
  readonly dcsLaunch: DcsLaunchService
  readonly manualLibrary: ManualLibraryService
  readonly updates: UpdateService
  readonly softwareCatalog: SoftwareCatalogService
  readonly vrOverlay: VrOverlayService

  private readonly nativeCore: NativeCoreClient
  private readonly fallbackDcsProcessMonitor: DcsProcessMonitor
  private readonly onDcsMonitorError?: (error: Error) => void
  private initialized = false
  private disposed = false
  private startedAt: string | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttempts = 0

  constructor(options: AppCoreOptions) {
    this.onDcsMonitorError = options.onDcsMonitorError
    this.vrOverlay = new VrOverlayService(
      options.vrResourcesDirectory,
      undefined,
      undefined,
      options.vrResourcesDirectory,
      options.diagnosticLogDirectory,
    )
    this.modManager = new ModManagerService(options.userDataDirectory)
    this.dcsLaunch = new DcsLaunchService(options.userDataDirectory)
    this.manualLibrary = new ManualLibraryService(
      options.userDataDirectory,
      options.encryption,
      () => this.dcsLaunch.status().installPath || null,
      options.fetchImpl,
      (progress: ManualLibraryProgress) => this.events.emit('manual-progress', progress),
    )
    this.updates = new UpdateService(options.userDataDirectory, options.appVersion, options.fetchImpl)
    this.softwareCatalog = new SoftwareCatalogService(options.userDataDirectory, this.modules, [
      { id: 'voxbind', createDriver: createVoxBindDriver },
      { id: 'srs', createDriver: createSrsDriver },
      { id: 'dcs-eye-mouse', createDriver: createEyeMouseDriver },
      { id: 'moza-cockpit', createDriver: createMozaCockpitDriver },
      { id: 'pimax-vr', createDriver: createPimaxVrDriver },
      { id: 'aimxyz', createDriver: createAimxyZDriver },
    ], options.packaged)
    this.fallbackDcsProcessMonitor = new DcsProcessMonitor({
      onChanged: (running) => this.events.emit('dcs-process-changed', running),
      onError: options.onDcsMonitorError,
    })
    this.nativeCore = new NativeCoreClient({
      executablePath: options.nativeCoreExecutable,
      logDirectory: options.diagnosticLogDirectory,
    })
    this.nativeCore.on('dcs-process-changed', (status: NativeDcsProcessStatus) => {
      this.events.emit('dcs-process-changed', status.running)
    })
    this.nativeCore.on('disconnected', (error: Error) => {
      if (this.disposed) return
      this.fallbackDcsProcessMonitor.start()
      this.onDcsMonitorError?.(new Error(`独立 DCSHUB Core 连接中断，已切换兼容监控：${error.message}`))
      this.scheduleNativeRestart()
    })
    if (options.onModuleChanged) this.modules.on('changed', options.onModuleChanged)
    if (options.onModuleLog) this.modules.on('log', options.onModuleLog)
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('DCSHUB Core has already been disposed')
    if (this.initialized) return
    this.vrOverlay.cleanupStaleRegistration()
    this.modules.setMonitoringActive(false)
    await this.startNativeCore()
    await this.modules.initialize()
    this.initialized = true
    this.startedAt = new Date().toISOString()
    this.events.emit('ready', this.status())
  }

  setMonitoringActive(active: boolean): void {
    this.modules.setMonitoringActive(active)
  }

  async isDcsRunning(refresh = false): Promise<boolean> {
    if (this.nativeCore.isConnected) {
      const status = refresh ? await this.nativeCore.refreshDcsStatus() : this.nativeCore.currentDcsStatus
      return status.running
    }
    return refresh ? await this.fallbackDcsProcessMonitor.refresh() : this.fallbackDcsProcessMonitor.current()
  }

  async speechDevices(): Promise<NativeSpeechDevice[]> {
    if (!this.nativeCore.isConnected) throw new Error('独立 DCSHUB Core 未连接，语音识别暂不可用')
    return await this.nativeCore.speechDevices()
  }

  async startSpeech(deviceId: string | null): Promise<void> {
    if (!this.nativeCore.isConnected) throw new Error('独立 DCSHUB Core 未连接，语音识别暂不可用')
    await this.nativeCore.startSpeech(deviceId)
  }

  async stopSpeech(modelDirectory: string): Promise<NativeSpeechResult> {
    if (!this.nativeCore.isConnected) throw new Error('独立 DCSHUB Core 未连接，语音识别暂不可用')
    return await this.nativeCore.stopSpeech(modelDirectory)
  }

  async cancelSpeech(): Promise<void> {
    if (!this.nativeCore.isConnected) return
    await this.nativeCore.cancelSpeech()
  }

  status(): CoreStatus {
    return buildCoreStatus(this.initialized, this.startedAt, this.nativeCore.isConnected)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.events.emit('stopping', undefined)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.fallbackDcsProcessMonitor.stop()
    await this.nativeCore.stop()
    try { this.vrOverlay.dispose() } finally {
      await this.modules.dispose()
      this.events.removeAllListeners()
    }
  }

  private async startNativeCore(): Promise<void> {
    try {
      await this.nativeCore.start()
      this.fallbackDcsProcessMonitor.stop()
      this.restartAttempts = 0
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.fallbackDcsProcessMonitor.start()
      this.onDcsMonitorError?.(new Error(`独立 DCSHUB Core 启动失败，已切换兼容监控：${error.message}`))
      this.scheduleNativeRestart()
    }
  }

  private scheduleNativeRestart(): void {
    if (this.disposed || this.restartTimer) return
    const delays = [1_000, 2_000, 5_000, 10_000, 30_000]
    const delay = delays[Math.min(this.restartAttempts, delays.length - 1)]
    this.restartAttempts += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.startNativeCore()
    }, delay)
    this.restartTimer.unref()
  }
}
