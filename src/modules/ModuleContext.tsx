import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  ModuleBatchResult,
  ModuleActionResult,
  ModuleActionState,
  ModuleId,
  ModuleManifest,
  ModuleOperationResult,
  ModuleSettings,
  ModuleSnapshot,
} from '@/shared/module-contracts'

interface ModuleContextValue {
  modules: ModuleManifest[]
  snapshots: Record<ModuleId, ModuleSnapshot>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  startModule: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  stopModule: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  startProfile: (moduleIds: ModuleId[], rollbackOnFailure?: boolean) => Promise<ModuleBatchResult>
  stopProfile: (moduleIds: ModuleId[]) => Promise<ModuleBatchResult>
  readSettings: (moduleId: ModuleId) => Promise<ModuleSettings>
  applySettings: (moduleId: ModuleId, patch: ModuleSettings) => Promise<ModuleOperationResult>
  showWindow: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  readActions: (moduleId: ModuleId) => Promise<ModuleActionState[]>
  invokeAction: (moduleId: ModuleId, actionId: string, active: boolean) => Promise<ModuleActionResult>
}

const ModuleCtx = createContext<ModuleContextValue | null>(null)

const unavailable = (moduleId: ModuleId): ModuleOperationResult => ({
  ok: false,
  moduleId,
  error: { code: 'BRIDGE_UNAVAILABLE', message: '模块服务不可用', recoverable: true },
})

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModuleManifest[]>([])
  const [snapshots, setSnapshots] = useState<Record<ModuleId, ModuleSnapshot>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = window.electronAPI?.modules
    if (!bridge) {
      setModules([])
      setSnapshots({})
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [nextModules, nextSnapshots] = await Promise.all([bridge.list(), bridge.snapshots()])
      setModules(nextModules)
      setSnapshots(Object.fromEntries(nextSnapshots.map((snapshot) => [snapshot.moduleId, snapshot])))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const bridge = window.electronAPI?.modules
    if (!bridge) return
    const unsubscribeChanged = bridge.onChanged(({ manifest, snapshot }) => {
      setModules((current) => current.some((module) => module.id === manifest.id)
        ? current.map((module) => module.id === manifest.id ? manifest : module)
        : [...current, manifest])
      setSnapshots((current) => ({ ...current, [snapshot.moduleId]: snapshot }))
    })
    const unsubscribeCatalog = bridge.onCatalogChanged(() => { void refresh() })
    return () => {
      unsubscribeChanged()
      unsubscribeCatalog()
    }
  }, [refresh])

  const runOperation = useCallback(async (
    moduleId: ModuleId,
    operation: 'start' | 'stop' | 'showWindow',
  ): Promise<ModuleOperationResult> => {
    const bridge = window.electronAPI?.modules
    if (!bridge) return unavailable(moduleId)
    const result = await bridge[operation](moduleId)
    if (result.snapshot) setSnapshots((current) => ({ ...current, [moduleId]: result.snapshot! }))
    return result
  }, [])

  const startModule = useCallback((moduleId: ModuleId) => runOperation(moduleId, 'start'), [runOperation])
  const stopModule = useCallback((moduleId: ModuleId) => runOperation(moduleId, 'stop'), [runOperation])
  const showWindow = useCallback((moduleId: ModuleId) => runOperation(moduleId, 'showWindow'), [runOperation])

  const startProfile = useCallback(async (moduleIds: ModuleId[], rollbackOnFailure = true): Promise<ModuleBatchResult> => {
    const bridge = window.electronAPI?.modules
    if (!bridge) return { ok: false, results: moduleIds.map(unavailable), rolledBack: [] }
    const result = await bridge.startProfile(moduleIds, rollbackOnFailure)
    result.results.forEach((item) => {
      if (item.snapshot) setSnapshots((current) => ({ ...current, [item.moduleId]: item.snapshot! }))
    })
    return result
  }, [])

  const stopProfile = useCallback(async (moduleIds: ModuleId[]): Promise<ModuleBatchResult> => {
    const bridge = window.electronAPI?.modules
    if (!bridge) return { ok: false, results: moduleIds.map(unavailable), rolledBack: [] }
    const result = await bridge.stopProfile(moduleIds)
    result.results.forEach((item) => {
      if (item.snapshot) setSnapshots((current) => ({ ...current, [item.moduleId]: item.snapshot! }))
    })
    return result
  }, [])

  const readSettings = useCallback(async (moduleId: ModuleId) => {
    const bridge = window.electronAPI?.modules
    if (!bridge) throw new Error('模块服务不可用')
    return bridge.readSettings(moduleId)
  }, [])

  const applySettings = useCallback(async (moduleId: ModuleId, patch: ModuleSettings) => {
    const bridge = window.electronAPI?.modules
    if (!bridge) return unavailable(moduleId)
    return bridge.applySettings(moduleId, patch)
  }, [])

  const readActions = useCallback(async (moduleId: ModuleId) => {
    const bridge = window.electronAPI?.modules
    if (!bridge) throw new Error('模块服务不可用')
    return bridge.readActions(moduleId)
  }, [])

  const invokeAction = useCallback(async (moduleId: ModuleId, actionId: string, active: boolean) => {
    const bridge = window.electronAPI?.modules
    if (!bridge) return { ok: false, moduleId, actionId, error: { code: 'BRIDGE_UNAVAILABLE', message: '模块服务不可用', recoverable: true } }
    return bridge.invokeAction(moduleId, actionId, active)
  }, [])

  const value = useMemo<ModuleContextValue>(() => ({
    modules,
    snapshots,
    loading,
    error,
    refresh,
    startModule,
    stopModule,
    startProfile,
    stopProfile,
    readSettings,
    applySettings,
    showWindow,
    readActions,
    invokeAction,
  }), [modules, snapshots, loading, error, refresh, startModule, stopModule, startProfile, stopProfile, readSettings, applySettings, showWindow, readActions, invokeAction])

  return <ModuleCtx.Provider value={value}>{children}</ModuleCtx.Provider>
}

export function useModuleContext(): ModuleContextValue {
  const context = useContext(ModuleCtx)
  if (!context) throw new Error('useModuleContext must be used within ModuleProvider')
  return context
}
