import type { ModuleBridge, ModuleChangedEvent, ModuleId, ModuleLogEntry, ModuleSettings } from '../src/shared/module-contracts'
import type { ModManagerBridge, ModManagerSettings } from '../src/shared/mod-manager-contracts'
import type { DcsBridge } from '../src/shared/dcs-contracts'
import type { SoftwareCatalogBridge } from '../src/shared/software-catalog-contracts'
import type { WindowControlsBridge } from '../src/shared/window-contracts'
import type { DeepSeekConfigurationStatus, ManualLibraryBridge } from '../src/shared/manual-library-contracts'

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const modules: ModuleBridge = {
  list: () => ipcRenderer.invoke('modules:list'),
  snapshots: () => ipcRenderer.invoke('modules:snapshots'),
  start: (moduleId: ModuleId) => ipcRenderer.invoke('modules:start', moduleId),
  stop: (moduleId: ModuleId) => ipcRenderer.invoke('modules:stop', moduleId),
  startProfile: (moduleIds: ModuleId[], rollbackOnFailure = true) => (
    ipcRenderer.invoke('modules:start-profile', moduleIds, rollbackOnFailure)
  ),
  stopProfile: (moduleIds: ModuleId[]) => ipcRenderer.invoke('modules:stop-profile', moduleIds),
  readSettings: (moduleId: ModuleId) => ipcRenderer.invoke('modules:read-settings', moduleId),
  applySettings: (moduleId: ModuleId, patch: ModuleSettings) => (
    ipcRenderer.invoke('modules:apply-settings', moduleId, patch)
  ),
  showWindow: (moduleId: ModuleId) => ipcRenderer.invoke('modules:show-window', moduleId),
  readActions: (moduleId: ModuleId) => ipcRenderer.invoke('modules:read-actions', moduleId),
  invokeAction: (moduleId: ModuleId, actionId: string, active: boolean) => ipcRenderer.invoke('modules:invoke-action', moduleId, actionId, active),
  recentLogs: (moduleId: ModuleId, limit = 200) => ipcRenderer.invoke('modules:recent-logs', moduleId, limit),
  onChanged: (callback: (event: ModuleChangedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, changed: ModuleChangedEvent) => callback(changed)
    ipcRenderer.on('modules:changed', handler)
    return () => { ipcRenderer.removeListener('modules:changed', handler) }
  },
  onCatalogChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('modules:catalog-changed', handler)
    return () => { ipcRenderer.removeListener('modules:catalog-changed', handler) }
  },
  onLog: (callback: (entry: ModuleLogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: ModuleLogEntry) => callback(entry)
    ipcRenderer.on('modules:log', handler)
    return () => { ipcRenderer.removeListener('modules:log', handler) }
  },
}

const modManager: ModManagerBridge = {
  overview: () => ipcRenderer.invoke('mod-manager:overview'),
  chooseDirectory: (title: string) => ipcRenderer.invoke('mod-manager:choose-directory', title),
  saveSettings: (settings: ModManagerSettings) => ipcRenderer.invoke('mod-manager:save-settings', settings),
  selectGameDirectory: (gameDirectoryId: string) => ipcRenderer.invoke('mod-manager:select-game-directory', gameDirectoryId),
  importArchives: () => ipcRenderer.invoke('mod-manager:import-archives'),
  revealMod: (modId: string) => ipcRenderer.invoke('mod-manager:reveal-mod', modId),
  setModEnabled: (modId: string, enabled: boolean, allowConflicts = false) => ipcRenderer.invoke('mod-manager:set-enabled', modId, enabled, allowConflicts),
  setDirectoryModEnabled: (gameDirectoryId: string, modId: string, enabled: boolean, allowConflicts = false) => ipcRenderer.invoke('mod-manager:set-directory-enabled', gameDirectoryId, modId, enabled, allowConflicts),
  setAllModsEnabled: (enabled: boolean) => ipcRenderer.invoke('mod-manager:set-all-enabled', enabled),
  applyPreset: (presetId: string) => ipcRenderer.invoke('mod-manager:apply-preset', presetId),
  disableAllMods: () => ipcRenderer.invoke('mod-manager:disable-all-mods'),
  createPreset: (name: string) => ipcRenderer.invoke('mod-manager:create-preset', name),
  updatePreset: (presetId: string, name?: string) => ipcRenderer.invoke('mod-manager:update-preset', presetId, name),
  deletePreset: (presetId: string) => ipcRenderer.invoke('mod-manager:delete-preset', presetId),
  backupSavedGamesConfig: (backupPath: string) => ipcRenderer.invoke('mod-manager:backup-saved-games-config', backupPath),
}

const dcs: DcsBridge = {
  status: () => ipcRenderer.invoke('dcs:status'),
  chooseInstallDirectory: () => ipcRenderer.invoke('dcs:choose-install-directory'),
  useAutomaticDetection: () => ipcRenderer.invoke('dcs:use-automatic-detection'),
  launch: (mode: 'vr' | 'desktop') => ipcRenderer.invoke('dcs:launch', mode),
  launchLauncher: () => ipcRenderer.invoke('dcs:launch-launcher'),
}

const softwareCatalog: SoftwareCatalogBridge = {
  overview: () => ipcRenderer.invoke('software-catalog:overview'),
  chooseAndAdd: () => ipcRenderer.invoke('software-catalog:choose-and-add'),
  useAutomaticDetection: () => ipcRenderer.invoke('software-catalog:use-automatic-detection'),
  chooseBuiltinExecutable: (id: string) => ipcRenderer.invoke('software-catalog:choose-builtin-executable', id),
  setSilentLaunch: (id: string, silent: boolean) => ipcRenderer.invoke('software-catalog:set-silent-launch', id, silent),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('software-catalog:set-enabled', id, enabled),
  remove: (id: string) => ipcRenderer.invoke('software-catalog:remove', id),
  completeInitialSetup: (enabledIds: string[]) => ipcRenderer.invoke('software-catalog:complete-setup', enabledIds),
}

const manualLibrary: ManualLibraryBridge = {
  overview: () => ipcRenderer.invoke('manual-library:overview'),
  chooseLibraryDirectory: () => ipcRenderer.invoke('manual-library:choose-directory'),
  rebuildIndex: (force = false) => ipcRenderer.invoke('manual-library:rebuild-index', force),
  importDcsManuals: () => ipcRenderer.invoke('manual-library:import-dcs-manuals'),
  search: (query: string, limit = 8) => ipcRenderer.invoke('manual-library:search', query, limit),
  ask: (question: string) => ipcRenderer.invoke('manual-library:ask', question),
  configureDeepSeek: (apiKey: string, model: DeepSeekConfigurationStatus['model']) => ipcRenderer.invoke('manual-library:configure-deepseek', apiKey, model),
  clearDeepSeek: () => ipcRenderer.invoke('manual-library:clear-deepseek'),
  testDeepSeek: (apiKey?: string, model?: DeepSeekConfigurationStatus['model']) => ipcRenderer.invoke('manual-library:test-deepseek', apiKey, model),
  chuckCatalog: () => ipcRenderer.invoke('manual-library:chuck-catalog'),
  downloadChuckGuide: (guideId: string) => ipcRenderer.invoke('manual-library:download-chuck', guideId),
  openDocument: (documentId: string) => ipcRenderer.invoke('manual-library:open-document', documentId),
  askWithScreenshot: (question: string, imageDataUrl: string) => ipcRenderer.invoke('manual-library:ask-screenshot', question, imageDataUrl),
}

const windowControls: WindowControlsBridge = {
  quit: () => ipcRenderer.send('window:quit'),
  openUpdatePage: () => ipcRenderer.invoke('window:open-update-page'),
}

contextBridge.exposeInMainWorld('electronAPI', { modules, modManager, dcs, softwareCatalog, manualLibrary, windowControls })

export {}
