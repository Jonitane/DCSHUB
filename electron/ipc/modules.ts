import { ipcMain, type BrowserWindow } from 'electron'
import type { ModuleChangedEvent, ModuleLogEntry } from '../../src/shared/module-contracts'
import type { ModuleManager } from '../modules/ModuleManager'
import { assertActionId, assertModuleId, assertModuleIds, assertSettings } from './validation'

export function registerModuleIpc(
  moduleManager: ModuleManager,
  getWindow: () => BrowserWindow | null,
  diagnostics?: { onChanged?: (event: ModuleChangedEvent) => void; onLog?: (entry: ModuleLogEntry) => void },
): void {
  ipcMain.handle('modules:list', () => moduleManager.list())
  ipcMain.handle('modules:snapshots', () => moduleManager.snapshots())
  ipcMain.handle('modules:start', (_event, moduleId: unknown) => moduleManager.start(assertModuleId(moduleId)))
  ipcMain.handle('modules:stop', (_event, moduleId: unknown) => moduleManager.stop(assertModuleId(moduleId)))
  ipcMain.handle('modules:start-profile', (_event, moduleIds: unknown, rollbackOnFailure: unknown) => moduleManager.startProfile(assertModuleIds(moduleIds), rollbackOnFailure !== false))
  ipcMain.handle('modules:stop-profile', (_event, moduleIds: unknown) => moduleManager.stopProfile(assertModuleIds(moduleIds)))
  ipcMain.handle('modules:read-settings', (_event, moduleId: unknown) => moduleManager.readSettings(assertModuleId(moduleId)))
  ipcMain.handle('modules:apply-settings', (_event, moduleId: unknown, patch: unknown) => moduleManager.applySettings(assertModuleId(moduleId), assertSettings(patch)))
  ipcMain.handle('modules:show-window', (_event, moduleId: unknown) => moduleManager.showWindow(assertModuleId(moduleId)))
  ipcMain.handle('modules:read-actions', (_event, moduleId: unknown) => moduleManager.readActions(assertModuleId(moduleId)))
  ipcMain.handle('modules:invoke-action', (_event, moduleId: unknown, actionId: unknown, active: unknown) => {
    if (typeof active !== 'boolean') throw new Error('Invalid action state')
    return moduleManager.invokeAction(assertModuleId(moduleId), assertActionId(actionId), active)
  })
  ipcMain.handle('modules:recent-logs', (_event, moduleId: unknown, limit: unknown) => moduleManager.recentLogs(assertModuleId(moduleId), typeof limit === 'number' ? limit : 200))

  moduleManager.on('changed', (event: ModuleChangedEvent) => {
    diagnostics?.onChanged?.(event)
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('modules:changed', event)
  })
  moduleManager.on('log', (entry: ModuleLogEntry) => {
    diagnostics?.onLog?.(entry)
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('modules:log', entry)
  })
  moduleManager.on('catalog-changed', () => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('modules:catalog-changed')
  })
}
