import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ModuleBatchResult,
  ModuleActionResult,
  ModuleActionState,
  ModuleChangedEvent,
  ModuleError,
  ModuleId,
  ModuleLogEntry,
  ModuleManifest,
  ModuleOperationResult,
  ModuleSettings,
  ModuleSnapshot,
} from '../../src/shared/module-contracts'
import type { ModuleDriver, ModuleHealth } from './types'
import { isImageRunning } from '../integrations/windows-process'

interface ModuleEntry {
  driver: ModuleDriver
  snapshot: ModuleSnapshot
  operation: Promise<ModuleOperationResult> | null
  unsubscribeLogs: (() => void) | null
}

function toModuleError(error: unknown, code = 'MODULE_OPERATION_FAILED'): ModuleError {
  const message = error instanceof Error ? error.message : String(error)
  return { code, message, recoverable: true }
}

async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`${label}超时（${timeoutMs}ms）`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class ModuleManager extends EventEmitter {
  private readonly entries = new Map<ModuleId, ModuleEntry>()
  private readonly silentLaunchPreferences = new Map<ModuleId, boolean>()
  private enabledIds: Set<ModuleId> | null = null
  private initialized = false
  private monitoringActive = true
  private monitorTimer: ReturnType<typeof setInterval> | null = null

  setMonitoringActive(active: boolean): void {
    if (this.monitoringActive === active) return
    this.monitoringActive = active
    if (!this.initialized) return
    if (active) {
      this.startHealthMonitor()
      void this.refreshHealth()
    } else {
      this.stopHealthMonitor()
    }
  }

  configureEnabled(moduleIds: Iterable<ModuleId>): void {
    if (this.initialized) throw new Error('Enabled modules must be configured before initialization')
    this.enabledIds = new Set(moduleIds)
  }

  setSilentLaunchPreference(moduleId: ModuleId, silent: boolean): void {
    if (!this.entries.has(moduleId)) throw new Error(`Unknown module: ${moduleId}`)
    this.silentLaunchPreferences.set(moduleId, silent)
  }

  register(driver: ModuleDriver): void {
    const { id } = driver.manifest
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) || this.entries.has(id)) throw new Error(`Duplicate or invalid module id: ${id}`)
    if (driver.manifest.dependencies.includes(id)) throw new Error(`Module cannot depend on itself: ${id}`)
    if (driver.manifest.capabilities.lifecycle && (!driver.start || !driver.stop)) {
      throw new Error(`Lifecycle module must implement start and stop: ${id}`)
    }
    if (driver.manifest.capabilities.settings && (!driver.readSettings || !driver.applySettings || !driver.manifest.settingsSchema)) {
      throw new Error(`Settings module must implement read/apply and declare a schema: ${id}`)
    }
    if (driver.manifest.capabilities.showWindow && !driver.showWindow) {
      throw new Error(`Window-capable module must implement showWindow: ${id}`)
    }
    if (driver.manifest.capabilities.logs && !driver.subscribeLogs) {
      throw new Error(`Log-capable module must implement subscribeLogs: ${id}`)
    }
    if (driver.manifest.actions?.length && (!driver.readActions || !driver.invokeAction)) {
      throw new Error(`Action-capable module must implement read/invoke actions: ${id}`)
    }
    const unsubscribeLogs = driver.subscribeLogs?.((entry) => this.captureLog(entry)) ?? null
    this.entries.set(id, {
      driver,
      operation: null,
      unsubscribeLogs,
      snapshot: {
        moduleId: id,
        installState: 'unknown',
        runState: 'stopped',
        ownership: 'none',
        lastError: null,
        updatedAt: Date.now(),
      },
    })
  }

  async initialize(): Promise<void> {
    await Promise.all([...this.entries.values()].filter((entry) => this.isEnabled(entry.driver.manifest.id)).map(async (entry) => {
      try {
        const health = await withTimeout(
          (signal) => this.discoverHealth(entry, signal),
          entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
          `${entry.driver.manifest.displayName} 检测`,
        )
        this.update(entry, {
          installState: health.installState,
          runState: health.runState,
          ownership: health.runState === 'running' ? 'external' : 'none',
          lastError: health.runState === 'failed'
            ? { code: 'HEALTH_CHECK_FAILED', message: health.details || '模块健康检查失败', recoverable: true }
            : null,
        })
      } catch (error) {
        this.update(entry, { installState: 'unknown', runState: 'failed', lastError: toModuleError(error, 'DISCOVERY_FAILED') })
      }
    }))
    this.initialized = true
    if (this.monitoringActive) this.startHealthMonitor()
  }

  list(): ModuleManifest[] {
    return [...this.entries.values()].filter(({ driver }) => this.isEnabled(driver.manifest.id)).map(({ driver }) => driver.manifest)
  }

  snapshots(): ModuleSnapshot[] {
    return [...this.entries.values()].filter(({ driver }) => this.isEnabled(driver.manifest.id)).map(({ snapshot }) => ({ ...snapshot }))
  }

  allManifests(): ModuleManifest[] {
    return [...this.entries.values()].map(({ driver }) => driver.manifest)
  }

  allSnapshots(): ModuleSnapshot[] {
    return [...this.entries.values()].map(({ snapshot }) => ({ ...snapshot }))
  }

  isModuleEnabled(moduleId: ModuleId): boolean {
    return this.isEnabled(moduleId)
  }

  async setModuleEnabled(moduleId: ModuleId, enabled: boolean): Promise<void> {
    const entry = this.entries.get(moduleId)
    if (!entry) throw new Error(`Unknown module: ${moduleId}`)
    if (!this.enabledIds) this.enabledIds = new Set(this.entries.keys())
    if (enabled === this.enabledIds.has(moduleId)) return
    if (enabled) {
      this.enabledIds.add(moduleId)
      await this.discoverEntry(entry)
    } else {
      this.enabledIds.delete(moduleId)
      if (entry.snapshot.runState === 'running' || entry.snapshot.runState === 'degraded') {
        entry.snapshot = { ...entry.snapshot, ownership: 'external', updatedAt: Date.now() }
      }
    }
    this.emit('catalog-changed')
  }

  async unregister(moduleId: ModuleId): Promise<void> {
    const entry = this.entries.get(moduleId)
    if (!entry) return
    if (this.isEnabled(moduleId)) await this.setModuleEnabled(moduleId, false)
    entry.unsubscribeLogs?.()
    await entry.driver.dispose?.()
    this.entries.delete(moduleId)
    this.logs.delete(moduleId)
    this.emit('catalog-changed')
  }

  recentLogs(moduleId: ModuleId, limit = 200): ModuleLogEntry[] {
    this.requireEntry(moduleId)
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    return (this.logs.get(moduleId) || []).slice(-safeLimit)
  }

  async start(moduleId: ModuleId): Promise<ModuleOperationResult> {
    return this.runExclusive(moduleId, async (entry) => {
      if (!entry.driver.manifest.capabilities.lifecycle || !entry.driver.start) {
        return this.failure(entry, 'CAPABILITY_NOT_SUPPORTED', '该模块不支持启动操作')
      }
      if (entry.snapshot.installState !== 'installed') {
        return this.failure(entry, 'MODULE_NOT_AVAILABLE', '模块尚未安装或兼容性未确认')
      }
      if (entry.snapshot.runState === 'running' || entry.snapshot.runState === 'degraded') {
        return this.success(entry)
      }

      try {
        const currentHealth = await withTimeout(
          (signal) => this.discoverHealth(entry, signal),
          entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
          `${entry.driver.manifest.displayName} 启动前检测`,
        )
        if (currentHealth.runState === 'running' || currentHealth.runState === 'degraded') {
          this.update(entry, {
            installState: currentHealth.installState,
            runState: currentHealth.runState,
            ownership: 'external',
            lastError: null,
          })
          return this.success(entry)
        }

        this.update(entry, { runState: 'starting', lastError: null })
        const directLaunch = this.silentLaunchPreferences.get(moduleId) === false && Boolean(entry.driver.showWindow)
        await withTimeout(
          (signal) => directLaunch ? entry.driver.showWindow!(signal) : entry.driver.start!(signal),
          directLaunch
            ? entry.driver.manifest.timeouts?.showWindowMs ?? 15_000
            : entry.driver.manifest.timeouts?.startMs ?? 30_000,
          `${entry.driver.manifest.displayName} ${directLaunch ? '直接启动' : '静默启动'}`,
        )
        const health = await withTimeout(
          (signal) => this.discoverHealth(entry, signal),
          entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
          `${entry.driver.manifest.displayName} 健康检查`,
        )
        if (health.runState !== 'running' && health.runState !== 'degraded') {
          throw new Error(health.details || '启动后未通过健康检查')
        }
        this.update(entry, {
          installState: health.installState,
          runState: health.runState,
          ownership: 'hub',
          lastError: null,
        })
        return this.success(entry)
      } catch (error) {
        return this.failure(entry, 'START_FAILED', error)
      }
    })
  }

  async stop(moduleId: ModuleId): Promise<ModuleOperationResult> {
    return this.runExclusive(moduleId, async (entry) => {
      if (!entry.driver.manifest.capabilities.lifecycle || !entry.driver.stop) {
        return this.failure(entry, 'CAPABILITY_NOT_SUPPORTED', '该模块不支持停止操作')
      }
      if (entry.snapshot.runState === 'stopped') return this.success(entry)
      if (entry.driver.manifest.stopPolicy === 'never') {
        return this.failure(entry, 'STOP_POLICY_DENIED', '该模块声明为不可由 Hub 停止', false)
      }
      if (entry.snapshot.ownership === 'external' && entry.driver.manifest.stopPolicy === 'owned-only') {
        return this.failure(entry, 'EXTERNAL_PROCESS_NOT_OWNED', '模块由外部启动，Hub 不会停止该进程', false)
      }

      this.update(entry, { runState: 'stopping', lastError: null })
      try {
        await withTimeout(
          (signal) => entry.driver.stop!(signal),
          entry.driver.manifest.timeouts?.stopMs ?? 20_000,
          `${entry.driver.manifest.displayName} 停止`,
        )
        const health = await withTimeout(
          (signal) => this.discoverHealth(entry, signal),
          entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
          `${entry.driver.manifest.displayName} 健康检查`,
        )
        if (health.runState !== 'stopped') throw new Error(health.details || '停止后进程仍在运行')
        this.update(entry, {
          installState: health.installState,
          runState: 'stopped',
          ownership: 'none',
          lastError: null,
        })
        return this.success(entry)
      } catch (error) {
        return this.failure(entry, 'STOP_FAILED', error)
      }
    })
  }

  async startProfile(moduleIds: ModuleId[], rollbackOnFailure = true): Promise<ModuleBatchResult> {
    const ordered = this.resolveDependencies(moduleIds)
    const results: ModuleOperationResult[] = []
    const started: ModuleId[] = []

    for (const layer of ordered) {
      const newlyStartable = new Set(layer.filter((id) => {
        const runState = this.requireEntry(id).snapshot.runState
        return runState !== 'running' && runState !== 'degraded'
      }))
      const layerResults = await Promise.all(layer.map((id) => this.start(id)))
      results.push(...layerResults)
      started.push(...layerResults.filter((result) => newlyStartable.has(result.moduleId) && result.ok && result.snapshot?.ownership === 'hub').map((result) => result.moduleId))
      if (layerResults.some((result) => !result.ok)) {
        const rolledBack: ModuleId[] = []
        if (rollbackOnFailure) {
          for (const id of [...started].reverse()) {
            const result = await this.stop(id)
            if (result.ok) rolledBack.push(id)
          }
        }
        return { ok: false, results, rolledBack }
      }
    }
    return { ok: true, results, rolledBack: [] }
  }

  async stopProfile(moduleIds: ModuleId[]): Promise<ModuleBatchResult> {
    const layers = this.resolveDependencies(moduleIds).reverse()
    const results: ModuleOperationResult[] = []
    for (const layer of layers) results.push(...await Promise.all(layer.map((id) => this.stop(id))))
    return { ok: results.every((result) => result.ok), results, rolledBack: [] }
  }

  async readSettings(moduleId: ModuleId): Promise<ModuleSettings> {
    const entry = this.requireEntry(moduleId)
    if (!entry.driver.manifest.capabilities.settings || !entry.driver.readSettings) {
      throw new Error('该模块不支持读取设置')
    }
    return withTimeout(
      (signal) => entry.driver.readSettings!(signal),
      entry.driver.manifest.timeouts?.settingsMs ?? 10_000,
      `${entry.driver.manifest.displayName} 读取设置`,
    )
  }

  async applySettings(moduleId: ModuleId, patch: ModuleSettings): Promise<ModuleOperationResult> {
    return this.runExclusive(moduleId, async (entry) => {
      if (!entry.driver.manifest.capabilities.settings || !entry.driver.applySettings) {
        return this.failure(entry, 'CAPABILITY_NOT_SUPPORTED', '该模块不支持设置操作')
      }
      try {
        this.validateSettings(entry.driver.manifest, patch)
        await withTimeout(
          (signal) => entry.driver.applySettings!(patch, signal),
          entry.driver.manifest.timeouts?.settingsMs ?? 10_000,
          `${entry.driver.manifest.displayName} 应用设置`,
        )
        this.update(entry, { lastError: null })
        return this.success(entry)
      } catch (error) {
        return this.failure(entry, 'APPLY_SETTINGS_FAILED', error, false)
      }
    })
  }

  async showWindow(moduleId: ModuleId): Promise<ModuleOperationResult> {
    return this.runExclusive(moduleId, async (entry) => {
      if (!entry.driver.manifest.capabilities.showWindow || !entry.driver.showWindow) {
        return this.failure(entry, 'CAPABILITY_NOT_SUPPORTED', '该模块不支持显示窗口')
      }
      try {
        await withTimeout(
          (signal) => entry.driver.showWindow!(signal),
          entry.driver.manifest.timeouts?.showWindowMs ?? 10_000,
          `${entry.driver.manifest.displayName} 显示窗口`,
        )
        return this.success(entry)
      } catch (error) {
        return this.failure(entry, 'SHOW_WINDOW_FAILED', error, false)
      }
    })
  }

  async readActions(moduleId: ModuleId): Promise<ModuleActionState[]> {
    const entry = this.requireEntry(moduleId)
    if (!entry.driver.manifest.actions?.length || !entry.driver.readActions) {
      throw new Error('该模块不支持快速功能开关')
    }
    return withTimeout(
      (signal) => entry.driver.readActions!(signal),
      entry.driver.manifest.timeouts?.actionMs ?? 10_000,
      `${entry.driver.manifest.displayName} 读取功能状态`,
    )
  }

  async invokeAction(moduleId: ModuleId, actionId: string, active: boolean): Promise<ModuleActionResult> {
    const entry = this.requireEntry(moduleId)
    const definition = entry.driver.manifest.actions?.find((action) => action.id === actionId)
    if (!definition || !entry.driver.invokeAction) {
      return { ok: false, moduleId, actionId, error: { code: 'ACTION_NOT_SUPPORTED', message: '该功能开关不存在', recoverable: true } }
    }
    try {
      const nextActive = await withTimeout(
        (signal) => entry.driver.invokeAction!(actionId, active, signal),
        entry.driver.manifest.timeouts?.actionMs ?? 15_000,
        `${entry.driver.manifest.displayName} ${definition.label}`,
      )
      const health = await withTimeout(
        (signal) => this.discoverHealth(entry, signal),
        entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
        `${entry.driver.manifest.displayName} 功能启动后检查`,
      )
      const nowRunning = health.runState === 'running' || health.runState === 'degraded'
      this.update(entry, {
        installState: health.installState,
        runState: health.runState,
        ownership: nowRunning ? (entry.snapshot.ownership === 'external' ? 'external' : 'hub') : 'none',
        lastError: null,
      })
      return { ok: true, moduleId, actionId, active: nextActive }
    } catch (error) {
      return { ok: false, moduleId, actionId, error: toModuleError(error, 'ACTION_FAILED') }
    }
  }

  async dispose(): Promise<void> {
    this.stopHealthMonitor()

    const ownedModules = [...this.entries.values()]
      .filter(({ snapshot, driver }) => snapshot.ownership === 'hub' && Boolean(driver.stop))
      .map(({ driver }) => driver.manifest.id)
    try {
      if (ownedModules.length > 0) await this.stopProfile(ownedModules)
    } finally {
      await Promise.all([...this.entries.values()].map(({ driver, unsubscribeLogs }) => {
        unsubscribeLogs?.()
        return driver.dispose?.()
      }))
      this.removeAllListeners()
    }
  }

  private requireEntry(moduleId: ModuleId): ModuleEntry {
    const entry = this.entries.get(moduleId)
    if (!entry) throw new Error(`Unknown module: ${moduleId}`)
    if (!this.isEnabled(moduleId)) throw new Error(`Module is disabled: ${moduleId}`)
    return entry
  }

  private startHealthMonitor(): void {
    if (this.monitorTimer || !this.monitoringActive) return
    this.monitorTimer = setInterval(() => { void this.refreshHealth() }, 3_000)
    this.monitorTimer.unref?.()
  }

  private stopHealthMonitor(): void {
    if (!this.monitorTimer) return
    clearInterval(this.monitorTimer)
    this.monitorTimer = null
  }

  private async refreshHealth(): Promise<void> {
    await Promise.all([...this.entries.values()].filter((entry) => this.isEnabled(entry.driver.manifest.id)).map(async (entry) => {
      if (entry.operation) return
      try {
        const health = await withTimeout(
          (signal) => this.discoverHealth(entry, signal),
          entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
          `${entry.driver.manifest.displayName} 后台健康检查`,
        )
        const wasHubRunning = entry.snapshot.ownership === 'hub'
          && (entry.snapshot.runState === 'running' || entry.snapshot.runState === 'degraded')
        const nowRunning = health.runState === 'running' || health.runState === 'degraded'
        const ownership = nowRunning
          ? entry.snapshot.ownership === 'hub' ? 'hub' : 'external'
          : 'none'
        const unexpectedExit = wasHubRunning && !nowRunning
        const latchedUnexpectedExit = entry.snapshot.lastError?.code === 'PROCESS_EXITED' && !nowRunning
        const nextError = unexpectedExit || latchedUnexpectedExit
          ? { code: 'PROCESS_EXITED', message: `${entry.driver.manifest.displayName} 运行进程已意外退出`, recoverable: true }
          : health.runState === 'failed'
            ? { code: 'HEALTH_CHECK_FAILED', message: health.details || '模块健康检查失败', recoverable: true }
            : null
        const nextRunState = unexpectedExit || latchedUnexpectedExit ? 'failed' : health.runState
        if (
          entry.snapshot.installState !== health.installState
          || entry.snapshot.runState !== nextRunState
          || entry.snapshot.ownership !== ownership
          || entry.snapshot.lastError?.code !== nextError?.code
        ) {
          this.update(entry, {
            installState: health.installState,
            runState: nextRunState,
            ownership,
            lastError: nextError,
          })
        }
      } catch (error) {
        if (entry.snapshot.runState !== 'failed' || entry.snapshot.lastError?.code !== 'HEALTH_CHECK_FAILED') {
          this.update(entry, { runState: 'failed', lastError: toModuleError(error, 'HEALTH_CHECK_FAILED') })
        }
      }
    }))
  }

  private async discoverHealth(entry: ModuleEntry, signal?: AbortSignal): Promise<ModuleHealth> {
    const executablePath = entry.driver.manifest.executablePath
    if (this.silentLaunchPreferences.get(entry.driver.manifest.id) === false && executablePath) {
      if (!fs.existsSync(executablePath)) return { installState: 'not-installed', runState: 'stopped', details: '软件路径已失效' }
      const running = await isImageRunning(path.basename(executablePath), signal)
      return { installState: 'installed', runState: running ? 'running' : 'stopped' }
    }
    return entry.driver.discover(signal)
  }

  private isEnabled(moduleId: ModuleId): boolean {
    return this.enabledIds === null || this.enabledIds.has(moduleId)
  }

  private async discoverEntry(entry: ModuleEntry): Promise<void> {
    try {
      const health = await withTimeout(
        (signal) => this.discoverHealth(entry, signal),
        entry.driver.manifest.timeouts?.discoverMs ?? 10_000,
        `${entry.driver.manifest.displayName} 检测`,
      )
      this.update(entry, {
        installState: health.installState,
        runState: health.runState,
        ownership: health.runState === 'running' || health.runState === 'degraded' ? 'external' : 'none',
        lastError: health.runState === 'failed'
          ? { code: 'HEALTH_CHECK_FAILED', message: health.details || '模块健康检查失败', recoverable: true }
          : null,
      })
    } catch (error) {
      this.update(entry, { installState: 'unknown', runState: 'failed', lastError: toModuleError(error, 'DISCOVERY_FAILED') })
    }
  }

  private runExclusive(moduleId: ModuleId, operation: (entry: ModuleEntry) => Promise<ModuleOperationResult>): Promise<ModuleOperationResult> {
    let entry: ModuleEntry
    try {
      entry = this.requireEntry(moduleId)
    } catch (error) {
      return Promise.resolve({ ok: false, moduleId, error: toModuleError(error, 'MODULE_NOT_FOUND') })
    }
    if (entry.operation) return entry.operation
    entry.operation = operation(entry).finally(() => { entry.operation = null })
    return entry.operation
  }

  private resolveDependencies(moduleIds: ModuleId[]): ModuleId[][] {
    const requested = new Set<ModuleId>()
    const visit = (id: ModuleId, trail: Set<ModuleId>) => {
      const entry = this.requireEntry(id)
      if (trail.has(id)) throw new Error(`Module dependency cycle: ${[...trail, id].join(' -> ')}`)
      if (requested.has(id)) return
      const nextTrail = new Set(trail).add(id)
      entry.driver.manifest.dependencies.forEach((dependency) => visit(dependency, nextTrail))
      requested.add(id)
    }
    ;[...new Set(moduleIds)].forEach((id) => visit(id, new Set()))

    const remaining = new Set(requested)
    const layers: ModuleId[][] = []
    while (remaining.size > 0) {
      const layer = [...remaining].filter((id) => this.requireEntry(id).driver.manifest.dependencies.every((dep) => !remaining.has(dep)))
      if (layer.length === 0) throw new Error('无法解析模块依赖关系')
      layers.push(layer)
      layer.forEach((id) => remaining.delete(id))
    }
    return layers
  }

  private validateSettings(manifest: ModuleManifest, patch: ModuleSettings): void {
    const schema = manifest.settingsSchema || []
    for (const [key, value] of Object.entries(patch)) {
      const field = schema.find((candidate) => candidate.key === key)
      if (!field) throw new Error(`未知设置项：${key}`)
      if (field.kind === 'boolean' && typeof value !== 'boolean') throw new Error(`${field.label} 必须是布尔值`)
      if (field.kind === 'number' || field.kind === 'slider') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field.label} 必须是有效数字`)
        if (field.min !== undefined && value < field.min) throw new Error(`${field.label} 不能小于 ${field.min}`)
        if (field.max !== undefined && value > field.max) throw new Error(`${field.label} 不能大于 ${field.max}`)
      }
      if ((field.kind === 'text' || field.kind === 'select') && typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(`${field.label} 的值类型无效`)
      }
      if (field.kind === 'select' && field.options && !field.options.some((option) => option.value === value)) {
        throw new Error(`${field.label} 的选项无效`)
      }
    }
  }

  private update(entry: ModuleEntry, patch: Partial<ModuleSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch, moduleId: entry.driver.manifest.id, updatedAt: Date.now() }
    const event: ModuleChangedEvent = { manifest: entry.driver.manifest, snapshot: { ...entry.snapshot } }
    this.emit('changed', event)
  }

  private readonly logs = new Map<ModuleId, ModuleLogEntry[]>()

  private captureLog(entry: ModuleLogEntry): void {
    if (!this.entries.has(entry.moduleId)) return
    const normalized: ModuleLogEntry = {
      moduleId: entry.moduleId,
      level: entry.level,
      message: String(entry.message).slice(0, 8_192),
      timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    }
    const current = [...(this.logs.get(entry.moduleId) || []), normalized]
    this.logs.set(entry.moduleId, current.length > 500 ? current.slice(-500) : current)
    this.emit('log', normalized)
  }

  private success(entry: ModuleEntry): ModuleOperationResult {
    return { ok: true, moduleId: entry.driver.manifest.id, snapshot: { ...entry.snapshot } }
  }

  private failure(entry: ModuleEntry, code: string, error: unknown, markFailed = true): ModuleOperationResult {
    const moduleError = typeof error === 'string'
      ? { code, message: error, recoverable: true }
      : toModuleError(error, code)
    if (markFailed) this.update(entry, { runState: 'failed', lastError: moduleError })
    else this.update(entry, { lastError: moduleError })
    return { ok: false, moduleId: entry.driver.manifest.id, snapshot: { ...entry.snapshot }, error: moduleError }
  }
}
