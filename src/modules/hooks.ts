import { useCallback, useMemo } from 'react'
import { useModuleContext } from '@/modules/ModuleContext'
import { getRunStatePresentation } from '@/modules/run-state'
import type { ModuleId, ModuleSettings } from '@/shared/module-contracts'

export function useModule(moduleId: ModuleId) {
  const { modules, snapshots } = useModuleContext()
  return {
    manifest: modules.find((module) => module.id === moduleId),
    snapshot: snapshots[moduleId],
  }
}

export function useAllModules() {
  const { modules, snapshots } = useModuleContext()
  return useMemo(() => modules.map((manifest) => ({ manifest, snapshot: snapshots[manifest.id] })), [modules, snapshots])
}

export function useModuleActions(moduleId: ModuleId) {
  const { startModule, stopModule, readSettings, applySettings, showWindow, readActions, invokeAction } = useModuleContext()
  const start = useCallback(() => startModule(moduleId), [moduleId, startModule])
  const stop = useCallback(() => stopModule(moduleId), [moduleId, stopModule])
  const read = useCallback(() => readSettings(moduleId), [moduleId, readSettings])
  const apply = useCallback((patch: ModuleSettings) => applySettings(moduleId, patch), [moduleId, applySettings])
  const show = useCallback(() => showWindow(moduleId), [moduleId, showWindow])
  const readModuleActions = useCallback(() => readActions(moduleId), [moduleId, readActions])
  const invokeModuleAction = useCallback((actionId: string, active: boolean) => invokeAction(moduleId, actionId, active), [moduleId, invokeAction])
  return useMemo(() => ({
    start,
    stop,
    readSettings: read,
    applySettings: apply,
    showWindow: show,
    readActions: readModuleActions,
    invokeAction: invokeModuleAction,
  }), [start, stop, read, apply, show, readModuleActions, invokeModuleAction])
}

export function useModuleStatus() {
  const modules = useAllModules()
  return useMemo(() => modules.map(({ manifest, snapshot }) => ({
    moduleId: manifest.id,
    running: snapshot?.runState === 'running' || snapshot?.runState === 'degraded',
    label: getRunStatePresentation(snapshot?.runState).label,
  })), [modules])
}
