import type { ModuleBridge, ModuleChangedEvent, ModuleId, ModuleLogEntry, ModuleSettings } from '../src/shared/module-contracts'
import type { ModManagerBridge, ModManagerSettings } from '../src/shared/mod-manager-contracts'
import type { DcsBridge } from '../src/shared/dcs-contracts'
import type { SoftwareCatalogBridge } from '../src/shared/software-catalog-contracts'
import type { WindowControlsBridge, OverlayBridge } from '../src/shared/window-contracts'
import type { ManualAnswerLanguage, ManualLibraryBridge, ManualLibraryProgress } from '../src/shared/manual-library-contracts'
import type { UpdateBridge } from '../src/shared/update-contracts'

const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron')
type DroppedFile = Parameters<typeof webUtils.getPathForFile>[0]

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
  setLaunchDelay: (id: string, seconds: number) => ipcRenderer.invoke('software-catalog:set-launch-delay', id, seconds),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('software-catalog:set-enabled', id, enabled),
  remove: (id: string) => ipcRenderer.invoke('software-catalog:remove', id),
  completeInitialSetup: (enabledIds: string[]) => ipcRenderer.invoke('software-catalog:complete-setup', enabledIds),
}

const manualLibrary: ManualLibraryBridge = {
  overview: () => ipcRenderer.invoke('manual-library:overview'),
  currentProgress: () => ipcRenderer.invoke('manual-library:current-progress'),
  chooseLibraryDirectory: () => ipcRenderer.invoke('manual-library:choose-directory'),
  chooseManualFiles: () => ipcRenderer.invoke('manual-library:choose-files'),
  importDroppedFiles: (files: ReadonlyArray<unknown>) => ipcRenderer.invoke('manual-library:import-files', files.map((file) => webUtils.getPathForFile(file as DroppedFile))),
  rebuildIndex: (force = false) => ipcRenderer.invoke('manual-library:rebuild-index', force),
  importDcsManuals: () => ipcRenderer.invoke('manual-library:import-dcs-manuals'),
  search: (query: string, limit = 8) => ipcRenderer.invoke('manual-library:search', query, limit),
  ask: (question: string, language?: ManualAnswerLanguage) => ipcRenderer.invoke('manual-library:ask', question, language),
  askOnline: (question: string, language?: ManualAnswerLanguage) => ipcRenderer.invoke('manual-library:ask-online', question, language),
  preferredCachedAnswer: (question: string, language?: ManualAnswerLanguage) => ipcRenderer.invoke('manual-library:preferred-cached-answer', question, language),
  clearAnswerCaches: () => ipcRenderer.invoke('manual-library:clear-answer-caches'),
  configureAiProvider: (provider, apiKey, baseUrl) => ipcRenderer.invoke('manual-library:configure-ai-provider', provider, apiKey, baseUrl),
  clearAiProvider: (provider) => ipcRenderer.invoke('manual-library:clear-ai-provider', provider),
  testAiProvider: (provider, apiKey, baseUrl) => ipcRenderer.invoke('manual-library:test-ai-provider', provider, apiKey, baseUrl),
  setAiStageSettings: (stage, settings) => ipcRenderer.invoke('manual-library:set-ai-stage', stage, settings),
  listAiProviderModels: (provider) => ipcRenderer.invoke('manual-library:list-ai-models', provider),
  configureDeepSeek: (apiKey: string) => ipcRenderer.invoke('manual-library:configure-deepseek', apiKey),
  clearDeepSeek: () => ipcRenderer.invoke('manual-library:clear-deepseek'),
  testDeepSeek: (apiKey?: string) => ipcRenderer.invoke('manual-library:test-deepseek', apiKey),
  chuckCatalog: () => ipcRenderer.invoke('manual-library:chuck-catalog'),
  downloadChuckGuide: (guideId: string) => ipcRenderer.invoke('manual-library:download-chuck', guideId),
  downloadSelectedChuckGuides: (guideIds: string[]) => ipcRenderer.invoke('manual-library:download-selected-chuck', guideIds),
  downloadAllChuckGuides: () => ipcRenderer.invoke('manual-library:download-all-chuck'),
  removeDuplicateDcsManuals: () => ipcRenderer.invoke('manual-library:remove-dcs-duplicates'),
  completeOnboarding: () => ipcRenderer.invoke('manual-library:complete-onboarding'),
  openDocument: (documentId: string, page?: number) => ipcRenderer.invoke('manual-library:open-document', documentId, page),
  openOnlineSource: (url: string) => ipcRenderer.invoke('manual-library:open-online-source', url),
  pagePreview: (documentId: string, page: number) => ipcRenderer.invoke('manual-library:page-preview', documentId, page),
  askWithScreenshot: (question: string, imageDataUrl: string) => ipcRenderer.invoke('manual-library:ask-screenshot', question, imageDataUrl),
  onProgress: (listener: (progress: ManualLibraryProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ManualLibraryProgress) => listener(progress)
    ipcRenderer.on('manual-library:progress', handler)
    return () => ipcRenderer.removeListener('manual-library:progress', handler)
  },
  onOverviewChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, overview: Parameters<typeof listener>[0]) => listener(overview)
    ipcRenderer.on('manual-library:overview-changed', handler)
    return () => ipcRenderer.removeListener('manual-library:overview-changed', handler)
  },
}

const windowControls: WindowControlsBridge = {
  quit: () => ipcRenderer.send('window:quit'),
  openUpdatePage: () => ipcRenderer.invoke('window:open-update-page'),
  openLogsDirectory: () => ipcRenderer.invoke('window:open-logs-directory'),
  resetAllUserData: () => ipcRenderer.invoke('window:reset-all-user-data'),
  getHubSettings: () => ipcRenderer.invoke('window:get-hub-settings'),
  setRememberWindowBounds: (enabled: boolean) => ipcRenderer.invoke('window:set-remember-bounds', enabled),
}

const updates: UpdateBridge = {
  settings: () => ipcRenderer.invoke('updates:settings'),
  setAutomaticChecks: (enabled: boolean) => ipcRenderer.invoke('updates:set-automatic-checks', enabled),
  check: (force = false) => ipcRenderer.invoke('updates:check', force),
  openDownload: (url: string) => ipcRenderer.invoke('updates:open-download', url),
}

const overlay: OverlayBridge = {
  hide: () => ipcRenderer.send('overlay:hide'),
  getSettings: () => ipcRenderer.invoke('overlay:get-settings'),
  setHotkey: (hotkey: string) => ipcRenderer.invoke('overlay:set-hotkey', hotkey),
  setMicrophone: (microphoneId: string | null) => ipcRenderer.invoke('overlay:set-microphone', microphoneId),
  listMicrophones: () => ipcRenderer.invoke('overlay:list-microphones'),
  speechModelStatus: () => ipcRenderer.invoke('overlay:speech-model-status'),
  setOpacity: (opacity: number) => ipcRenderer.invoke('overlay:set-opacity', opacity),
  setSize: (width: number, height: number) => ipcRenderer.invoke('overlay:set-size', width, height),
  setEnabled: (enabled: boolean) => ipcRenderer.invoke('overlay:set-enabled', enabled),
  getDisplayMode: () => ipcRenderer.invoke('overlay:get-display-mode'),
  setDisplayMode: (mode) => ipcRenderer.invoke('overlay:set-display-mode', mode),
  moveVr: (normalizedDeltaX, normalizedDeltaY) => ipcRenderer.invoke('overlay:move-vr', normalizedDeltaX, normalizedDeltaY),
  beginTextInput: () => ipcRenderer.invoke('overlay:begin-text-input'),
  endTextInput: () => ipcRenderer.invoke('overlay:end-text-input'),
  onFocusInput: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('overlay:focus-input', handler)
    return () => ipcRenderer.removeListener('overlay:focus-input', handler)
  },
  onDisplayModeChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status)
    ipcRenderer.on('overlay:display-mode-changed', handler)
    return () => ipcRenderer.removeListener('overlay:display-mode-changed', handler)
  },
  onSpeechState: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state)
    ipcRenderer.on('overlay:speech-state', handler)
    return () => ipcRenderer.removeListener('overlay:speech-state', handler)
  },
  onSpeechResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: string) => callback(value)
    ipcRenderer.on('overlay:speech-result', handler)
    return () => ipcRenderer.removeListener('overlay:speech-result', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', { modules, modManager, dcs, softwareCatalog, manualLibrary, windowControls, updates, overlay })

export {}
