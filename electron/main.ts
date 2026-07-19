import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModuleChangedEvent, ModuleLogEntry, ModuleSettings } from '../src/shared/module-contracts'
import { ModuleManager } from './modules/ModuleManager'
import { createEyeMouseDriver } from './integrations/eye-mouse/driver'
import { createMozaCockpitDriver } from './integrations/moza-cockpit/driver'
import { createPimaxVrDriver } from './integrations/pimax-vr/driver'
import { createAimxyZDriver } from './integrations/aimxyz/driver'
import { createVoxBindDriver } from './integrations/voxbind/driver'
import { createSrsDriver } from './integrations/srs/driver'
import { ModManagerService } from './builtins/mod-manager/service'
import { DcsLaunchService } from './builtins/dcs-launch/service'
import type { ModManagerSettings } from '../src/shared/mod-manager-contracts'
import { SoftwareCatalogService } from './builtins/software-catalog/service'
import { ManualLibraryService } from './builtins/manual-library/service'
import type { DeepSeekConfigurationStatus } from '../src/shared/manual-library-contracts'
import { UPDATE_DOWNLOAD_URL } from '../src/shared/app-meta'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST_ELECTRON = __dirname
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

let win: BrowserWindow | null = null
let modManager: ModManagerService | null = null
let dcsLaunch: DcsLaunchService | null = null
let softwareCatalog: SoftwareCatalogService | null = null
let manualLibrary: ManualLibraryService | null = null
const moduleManager = new ModuleManager()
let quitCleanupStarted = false

function restoreMainWindow(): void {
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function assertModuleId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) {
    throw new Error('Invalid module id')
  }
  return value
}

function assertModuleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid module id list')
  return value.map(assertModuleId)
}

function assertSettings(value: unknown): ModuleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings patch')
  const serialized = JSON.stringify(value)
  if (serialized.length > 128 * 1024) throw new Error('Settings patch is too large')
  return value as ModuleSettings
}

function assertActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) throw new Error('Invalid action id')
  return value
}

function assertText(value: unknown, label: string, maxLength = 4_096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw new Error(`Invalid ${label}`)
  return value
}

function assertDeepSeekModel(value: unknown): DeepSeekConfigurationStatus['model'] {
  if (value !== 'deepseek-v4-flash' && value !== 'deepseek-v4-pro') throw new Error('Invalid DeepSeek model')
  return value
}

function assertModManagerSettings(value: unknown): ModManagerSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mod manager settings')
  const settings = value as Record<string, unknown>
  if (!Array.isArray(settings.gameDirectories) || settings.gameDirectories.length === 0 || settings.gameDirectories.length > 16) {
    throw new Error('Invalid game directories')
  }
  const gameDirectories = settings.gameDirectories.map((directory) => {
    if (!directory || typeof directory !== 'object' || Array.isArray(directory)) throw new Error('Invalid game directory')
    const item = directory as Record<string, unknown>
    return {
      id: assertText(item.id, 'game directory id', 64),
      name: assertText(item.name, 'game directory name', 80),
      path: assertText(item.path, 'game directory path'),
      modsPath: assertText(item.modsPath, 'local mods path'),
    }
  })
  return {
    gameDirectories,
    activeGameDirectoryId: assertText(settings.activeGameDirectoryId, 'active game directory id', 64),
    backupPath: assertText(settings.backupPath, 'backup path'),
  }
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs')
  win = new BrowserWindow({
    title: 'DCSHUB',
    frame: false,
    autoHideMenuBar: true,
    width: 1512,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[DCS Hub] preload error:', preloadPath, error)
  })

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(process.env.DIST || '', 'index.html'))

  win.on('focus', () => moduleManager.setMonitoringActive(true))
  win.on('blur', () => moduleManager.setMonitoringActive(false))
  win.on('minimize', () => moduleManager.setMonitoringActive(false))
  win.on('hide', () => moduleManager.setMonitoringActive(false))
  win.on('closed', () => {
    moduleManager.setMonitoringActive(false)
    win = null
  })
}

function registerWindowIpc(): void {
  ipcMain.handle('window:open-update-page', () => shell.openExternal(UPDATE_DOWNLOAD_URL))
  ipcMain.on('window:quit', () => app.quit())
}

function registerModuleIpc(): void {
  ipcMain.handle('modules:list', () => moduleManager.list())
  ipcMain.handle('modules:snapshots', () => moduleManager.snapshots())
  ipcMain.handle('modules:start', (_event, moduleId: unknown) => moduleManager.start(assertModuleId(moduleId)))
  ipcMain.handle('modules:stop', (_event, moduleId: unknown) => moduleManager.stop(assertModuleId(moduleId)))
  ipcMain.handle('modules:start-profile', (_event, moduleIds: unknown, rollbackOnFailure: unknown) => (
    moduleManager.startProfile(assertModuleIds(moduleIds), rollbackOnFailure !== false)
  ))
  ipcMain.handle('modules:stop-profile', (_event, moduleIds: unknown) => moduleManager.stopProfile(assertModuleIds(moduleIds)))
  ipcMain.handle('modules:read-settings', (_event, moduleId: unknown) => moduleManager.readSettings(assertModuleId(moduleId)))
  ipcMain.handle('modules:apply-settings', (_event, moduleId: unknown, patch: unknown) => (
    moduleManager.applySettings(assertModuleId(moduleId), assertSettings(patch))
  ))
  ipcMain.handle('modules:show-window', (_event, moduleId: unknown) => moduleManager.showWindow(assertModuleId(moduleId)))
  ipcMain.handle('modules:read-actions', (_event, moduleId: unknown) => moduleManager.readActions(assertModuleId(moduleId)))
  ipcMain.handle('modules:invoke-action', (_event, moduleId: unknown, actionId: unknown, active: unknown) => {
    if (typeof active !== 'boolean') throw new Error('Invalid action state')
    return moduleManager.invokeAction(assertModuleId(moduleId), assertActionId(actionId), active)
  })
  ipcMain.handle('modules:recent-logs', (_event, moduleId: unknown, limit: unknown) => (
    moduleManager.recentLogs(assertModuleId(moduleId), typeof limit === 'number' ? limit : 200)
  ))

  moduleManager.on('changed', (event: ModuleChangedEvent) => {
    if (win && !win.isDestroyed()) win.webContents.send('modules:changed', event)
  })
  moduleManager.on('log', (entry: ModuleLogEntry) => {
    if (win && !win.isDestroyed()) win.webContents.send('modules:log', entry)
  })
  moduleManager.on('catalog-changed', () => {
    if (win && !win.isDestroyed()) win.webContents.send('modules:catalog-changed')
  })
}

function registerSoftwareCatalogIpc(): void {
  const service = () => {
    if (!softwareCatalog) throw new Error('软件目录服务尚未初始化')
    return softwareCatalog
  }
  ipcMain.handle('software-catalog:overview', () => service().overview())
  ipcMain.handle('software-catalog:choose-and-add', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '添加软件',
      filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
      properties: ['openFile'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const icon = await app.getFileIcon(result.filePaths[0], { size: 'large' }).catch(() => null)
    return service().addExecutable(result.filePaths[0], icon && !icon.isEmpty() ? icon.toDataURL() : null)
  })
  ipcMain.handle('software-catalog:use-automatic-detection', () => service().useAutomaticDetection())
  ipcMain.handle('software-catalog:choose-builtin-executable', async (_event, id: unknown) => {
    const moduleId = assertModuleId(id)
    const item = service().overview().items.find((candidate) => candidate.id === moduleId && candidate.kind === 'builtin')
    if (!item) throw new Error('未知内置模块')
    const options: Electron.OpenDialogOptions = {
      title: `选择 ${item.displayName} 主程序`,
      filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
      properties: ['openFile'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : service().setBuiltinExecutable(moduleId, result.filePaths[0])
  })
  ipcMain.handle('software-catalog:set-enabled', (_event, id: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state')
    return service().setEnabled(assertModuleId(id), enabled)
  })
  ipcMain.handle('software-catalog:set-silent-launch', (_event, id: unknown, silent: unknown) => {
    if (typeof silent !== 'boolean') throw new Error('Invalid silent launch state')
    return service().setSilentLaunch(assertModuleId(id), silent)
  })
  ipcMain.handle('software-catalog:remove', (_event, id: unknown) => service().remove(assertModuleId(id)))
  ipcMain.handle('software-catalog:complete-setup', (_event, enabledIds: unknown) => (
    service().completeInitialSetup(assertModuleIds(enabledIds))
  ))
}

function registerModManagerIpc(): void {
  const service = () => {
    if (!modManager) throw new Error('模组管理器尚未初始化')
    return modManager
  }
  ipcMain.handle('mod-manager:overview', () => service().overview())
  ipcMain.handle('mod-manager:choose-directory', async (_event, title: unknown) => {
    const options: Electron.OpenDialogOptions = {
      title: typeof title === 'string' ? title.slice(0, 120) : '选择目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('mod-manager:save-settings', (_event, settings: unknown) => service().saveSettings(assertModManagerSettings(settings)))
  ipcMain.handle('mod-manager:select-game-directory', (_event, gameDirectoryId: unknown) => (
    service().selectGameDirectory(assertText(gameDirectoryId, 'game directory id', 64))
  ))
  ipcMain.handle('mod-manager:import-archives', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '导入 ZIP 模组包',
      filters: [{ name: 'ZIP 模组包', extensions: ['zip'] }],
      properties: ['openFile', 'multiSelections'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? { ok: false, message: '已取消导入' } : service().importArchives(result.filePaths)
  })
  ipcMain.handle('mod-manager:reveal-mod', (_event, modId: unknown) => service().revealMod(assertText(modId, 'mod id', 64)))
  ipcMain.handle('mod-manager:set-enabled', (_event, modId: unknown, enabled: unknown, allowConflicts: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state')
    return service().setModEnabled(assertText(modId, 'mod id', 64), enabled, allowConflicts === true)
  })
  ipcMain.handle('mod-manager:set-directory-enabled', (_event, gameDirectoryId: unknown, modId: unknown, enabled: unknown, allowConflicts: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state')
    return service().setDirectoryModEnabled(
      assertText(gameDirectoryId, 'game directory id', 64),
      assertText(modId, 'mod id', 64),
      enabled,
      allowConflicts === true,
    )
  })
  ipcMain.handle('mod-manager:set-all-enabled', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state')
    return service().setAllModsEnabled(enabled)
  })
  ipcMain.handle('mod-manager:apply-preset', (_event, presetId: unknown) => service().applyPreset(assertText(presetId, 'preset id', 64)))
  ipcMain.handle('mod-manager:disable-all-mods', () => service().disableAllMods())
  ipcMain.handle('mod-manager:create-preset', (_event, name: unknown) => service().createPreset(assertText(name, 'preset name', 80)))
  ipcMain.handle('mod-manager:update-preset', (_event, presetId: unknown, name: unknown) => (
    service().updatePreset(assertText(presetId, 'preset id', 64), name === undefined ? undefined : assertText(name, 'preset name', 80))
  ))
  ipcMain.handle('mod-manager:delete-preset', (_event, presetId: unknown) => service().deletePreset(assertText(presetId, 'preset id', 64)))
  ipcMain.handle('mod-manager:backup-saved-games-config', (_event, backupPath: unknown) => (
    service().backupSavedGamesConfig(assertText(backupPath, 'backup path', 4096))
  ))
}

function registerDcsIpc(): void {
  const service = () => {
    if (!dcsLaunch) throw new Error('DCS 启动服务尚未初始化')
    return dcsLaunch
  }
  ipcMain.handle('dcs:status', () => service().status())
  ipcMain.handle('dcs:choose-install-directory', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择 DCS World 安装目录',
      properties: ['openDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : service().setInstallPath(result.filePaths[0])
  })
  ipcMain.handle('dcs:use-automatic-detection', () => service().useAutomaticDetection())
  ipcMain.handle('dcs:launch', (_event, mode: unknown) => {
    if (mode !== 'vr' && mode !== 'desktop') throw new Error('Invalid DCS launch mode')
    return service().launch(mode)
  })
  ipcMain.handle('dcs:launch-launcher', () => service().launchLauncher())
}

function registerManualLibraryIpc(): void {
  const service = () => {
    if (!manualLibrary) throw new Error('智能手册服务尚未初始化')
    return manualLibrary
  }
  ipcMain.handle('manual-library:overview', () => service().overview())
  ipcMain.handle('manual-library:choose-directory', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择 DCS 智能手册库目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : service().setLibraryPath(result.filePaths[0])
  })
  ipcMain.handle('manual-library:rebuild-index', (_event, force: unknown) => service().rebuildIndex(force === true))
  ipcMain.handle('manual-library:import-dcs-manuals', () => service().importDcsManuals())
  ipcMain.handle('manual-library:search', (_event, query: unknown, limit: unknown) => (
    service().search(assertText(query, 'manual search query', 500), typeof limit === 'number' ? limit : 8)
  ))
  ipcMain.handle('manual-library:ask', (_event, question: unknown) => service().ask(assertText(question, 'manual question', 2_000)))
  ipcMain.handle('manual-library:configure-deepseek', (_event, apiKey: unknown, model: unknown) => (
    service().configureDeepSeek(assertText(apiKey, 'DeepSeek API key', 512), assertDeepSeekModel(model))
  ))
  ipcMain.handle('manual-library:clear-deepseek', () => service().clearDeepSeek())
  ipcMain.handle('manual-library:test-deepseek', (_event, apiKey: unknown, model: unknown) => (
    service().testDeepSeek(
      apiKey === undefined ? undefined : assertText(apiKey, 'DeepSeek API key', 512),
      model === undefined ? undefined : assertDeepSeekModel(model),
    )
  ))
  ipcMain.handle('manual-library:chuck-catalog', () => service().chuckCatalog())
  ipcMain.handle('manual-library:download-chuck', (_event, guideId: unknown) => service().downloadChuckGuide(assertText(guideId, 'Chuck guide id', 64)))
  ipcMain.handle('manual-library:open-document', async (_event, documentId: unknown) => {
    const error = await shell.openPath(service().documentPath(assertText(documentId, 'manual document id', 64)))
    if (error) throw new Error(error)
  })
  ipcMain.handle('manual-library:ask-screenshot', (_event, question: unknown, imageDataUrl: unknown) => (
    service().askWithScreenshot(assertText(question, 'manual screenshot question', 2_000), assertText(imageDataUrl, 'screenshot data', 16 * 1024 * 1024))
  ))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  modManager = new ModManagerService(app.getPath('userData'))
  dcsLaunch = new DcsLaunchService(app.getPath('userData'))
  manualLibrary = new ManualLibraryService(
    app.getPath('userData'),
    {
      available: () => safeStorage.isEncryptionAvailable(),
      protect: (value) => safeStorage.encryptString(value).toString('base64'),
      unprotect: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    () => dcsLaunch?.status().installPath || null,
  )
  softwareCatalog = new SoftwareCatalogService(app.getPath('userData'), moduleManager, [
    { id: 'voxbind', createDriver: createVoxBindDriver },
    { id: 'srs', createDriver: createSrsDriver },
    { id: 'dcs-eye-mouse', createDriver: createEyeMouseDriver },
    { id: 'moza-cockpit', createDriver: createMozaCockpitDriver },
    { id: 'pimax-vr', createDriver: createPimaxVrDriver },
    { id: 'aimxyz', createDriver: createAimxyZDriver },
  ], app.isPackaged)
  registerModuleIpc()
  registerModManagerIpc()
  registerDcsIpc()
  registerManualLibraryIpc()
  registerSoftwareCatalogIpc()
  registerWindowIpc()
  moduleManager.setMonitoringActive(false)
  await moduleManager.initialize()
  createWindow()
})

app.on('before-quit', (event) => {
  if (quitCleanupStarted) return
  event.preventDefault()
  quitCleanupStarted = true
  void moduleManager.dispose().finally(() => app.quit())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', restoreMainWindow)
