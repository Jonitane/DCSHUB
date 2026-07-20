import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import { UPDATE_DOWNLOAD_URL } from '../src/shared/app-meta'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESET_USER_DATA_ARG = '--dcshub-reset-user-data'
const PRESERVE_DIRS_ON_RESET = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnWebGPUCache', 'Local Storage', 'Session Storage', 'Partitions', 'Network', 'blob_storage', 'Service Worker', 'webrtc_event_logs', 'extensions', 'Extension State', 'Extension Rules', 'IndexedDB', 'Shared Dictionary', 'Temp', 'Fonts', 'Default', 'Preferences', 'Last Version run.flag', 'lockfile'])
const PRESERVE_FILES_ON_RESET = new Set(['Preferences', 'Local State', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])

function resetAppDataIfRequested(): void {
  if (!process.argv.includes(RESET_USER_DATA_ARG)) return
  const userDataPath = path.resolve(app.getPath('userData'))
  const appDataPath = path.resolve(app.getPath('appData'))
  if (path.dirname(userDataPath).toLocaleLowerCase() !== appDataPath.toLocaleLowerCase()) throw new Error('拒绝清除非 DCSHUB 用户数据目录')
  for (const entry of fs.readdirSync(userDataPath, { withFileTypes: true })) {
    if (PRESERVE_DIRS_ON_RESET.has(entry.name)) continue
    if (PRESERVE_FILES_ON_RESET.has(entry.name)) continue
    if (entry.isDirectory() && entry.name.startsWith('Crashpad')) continue
    const fullPath = path.join(userDataPath, entry.name)
    fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

resetAppDataIfRequested()

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
const manualViewerWindows = new Set<BrowserWindow>()
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

function assertFilePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Error('Invalid manual file list')
  return value.map((filePath) => {
    const checked = assertText(filePath, 'manual file path', 32_768)
    if (!path.isAbsolute(checked)) throw new Error('Manual file path must be absolute')
    return checked
  })
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
  ipcMain.handle('window:reset-all-user-data', async () => {
    try { moduleManager?.setMonitoringActive(false) } catch {}
    try { await moduleManager?.dispose() } catch {}
    try { dcsLaunch?.dispose?.() } catch {}
    try { modManager?.dispose?.() } catch {}
    for (const viewer of [...manualViewerWindows]) { try { viewer.destroy() } catch {} }
    manualViewerWindows.clear()
    try { win?.close() } catch {}
    try { await session.defaultSession.clearCache() } catch {}
    try { await session.defaultSession.clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'] }) } catch {}
    const relaunchArgs = process.argv.slice(1).filter((argument) => argument !== RESET_USER_DATA_ARG)
    app.relaunch({ args: [...relaunchArgs, RESET_USER_DATA_ARG] })
    setTimeout(() => app.exit(0), 200)
  })
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
    if (!manualLibrary) throw new Error('超级手册服务尚未初始化')
    return manualLibrary
  }
  ipcMain.handle('manual-library:overview', () => service().overview())
  ipcMain.handle('manual-library:current-progress', () => service().currentOperationProgress())
  ipcMain.handle('manual-library:choose-directory', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择超级手册库目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : service().setLibraryPath(result.filePaths[0], true)
  })
  ipcMain.handle('manual-library:choose-files', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '添加手册',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '手册文件', extensions: ['pdf', 'docx', 'epub', 'html', 'htm', 'md', 'markdown', 'txt', 'rtf'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : service().importManualFiles(result.filePaths)
  })
  ipcMain.handle('manual-library:import-files', (_event, filePaths: unknown) => service().importManualFiles(assertFilePaths(filePaths)))
  ipcMain.handle('manual-library:rebuild-index', (_event, force: unknown) => service().rebuildIndex(force === true))
  ipcMain.handle('manual-library:import-dcs-manuals', () => service().importDcsManuals())
  ipcMain.handle('manual-library:search', (_event, query: unknown, limit: unknown) => (
    service().search(assertText(query, 'manual search query', 500), typeof limit === 'number' ? limit : 8)
  ))
  ipcMain.handle('manual-library:ask', (_event, question: unknown) => service().ask(assertText(question, 'manual question', 2_000)))
  ipcMain.handle('manual-library:ask-online', (_event, question: unknown) => service().askOnline(assertText(question, 'manual online question', 2_000)))
  ipcMain.handle('manual-library:configure-deepseek', (_event, apiKey: unknown) => (
    service().configureDeepSeek(assertText(apiKey, 'DeepSeek API key', 512))
  ))
  ipcMain.handle('manual-library:clear-deepseek', () => service().clearDeepSeek())
  ipcMain.handle('manual-library:test-deepseek', (_event, apiKey: unknown) => (
    service().testDeepSeek(apiKey === undefined ? undefined : assertText(apiKey, 'DeepSeek API key', 512))
  ))
  ipcMain.handle('manual-library:chuck-catalog', () => service().chuckCatalog())
  ipcMain.handle('manual-library:download-chuck', (_event, guideId: unknown) => service().downloadChuckGuide(assertText(guideId, 'Chuck guide id', 64)))
  ipcMain.handle('manual-library:download-selected-chuck', (_event, guideIds: unknown) => {
    if (!Array.isArray(guideIds)) throw new Error('guideIds must be an array')
    return service().downloadSelectedChuckGuides(guideIds.map((id) => assertText(id, 'Chuck guide id', 64)))
  })
  ipcMain.handle('manual-library:download-all-chuck', () => service().downloadAllChuckGuides())
  ipcMain.handle('manual-library:remove-dcs-duplicates', () => service().removeDuplicateDcsManuals())
  ipcMain.handle('manual-library:complete-onboarding', () => service().completeOnboarding())
  ipcMain.handle('manual-library:open-document', async (_event, documentId: unknown, pageNumber: unknown) => {
    const documentPath = service().documentPath(assertText(documentId, 'manual document id', 64))
    const page = typeof pageNumber === 'number' && Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined
    if (page && path.extname(documentPath).toLocaleLowerCase() === '.pdf') {
      const viewer = new BrowserWindow({
        title: `${path.basename(documentPath)} · 第 ${page} 页`,
        width: 1280,
        height: 900,
        minWidth: 760,
        minHeight: 560,
        autoHideMenuBar: true,
        backgroundColor: '#202124',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          plugins: true,
        },
      })
      viewer.setMenu(null)
      manualViewerWindows.add(viewer)
      viewer.on('closed', () => manualViewerWindows.delete(viewer))
      try {
        await viewer.loadURL(`${pathToFileURL(documentPath).href}#page=${page}&zoom=page-width`)
        viewer.show()
        return
      } catch {
        viewer.destroy()
      }
    }
    const error = await shell.openPath(documentPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('manual-library:open-online-source', async (_event, rawUrl: unknown) => {
    const url = new URL(assertText(rawUrl, 'online source URL', 4_096))
    if (url.protocol !== 'https:') throw new Error('只允许打开 HTTPS 在线来源')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle('manual-library:page-preview', (_event, documentId: unknown, pageNumber: unknown) => (
    service().pagePreview(assertText(documentId, 'manual document id', 64), typeof pageNumber === 'number' ? pageNumber : 0)
  ))
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
    fetch,
    (progress) => win?.webContents.send('manual-library:progress', progress),
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
  win?.webContents.once('did-finish-load', () => { void manualLibrary?.ensureCurrentSearchIndexes() })
})

app.on('before-quit', (event) => {
  if (quitCleanupStarted) return
  event.preventDefault()
  quitCleanupStarted = true
  void moduleManager.dispose().finally(() => app.quit())
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', restoreMainWindow)
