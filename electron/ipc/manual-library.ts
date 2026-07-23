import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ManualLibraryService } from '../builtins/manual-library/service'
import type { ManualAiProvider, ManualAiStage, ManualAiStageSettings, ManualAnswerLanguage } from '../../src/shared/manual-library-contracts'
import { assertFilePaths, assertText } from './validation'

export function registerManualLibraryIpc(options: {
  getService: () => ManualLibraryService | null
  getWindow: () => BrowserWindow | null
  viewerWindows: Set<BrowserWindow>
}): void {
  const service = () => {
    const current = options.getService()
    if (!current) throw new Error('超级手册服务尚未初始化')
    return current
  }
  const aiProvider = (value: unknown): ManualAiProvider => {
    const provider = assertText(value, 'AI provider', 32) as ManualAiProvider
    if (!['deepseek', 'siliconflow', 'qwen'].includes(provider)) throw new Error('unsupported AI provider')
    return provider
  }
  const aiStage = (value: unknown): ManualAiStage => {
    const stage = assertText(value, 'AI stage', 16) as ManualAiStage
    if (!['local', 'online'].includes(stage)) throw new Error('unsupported AI stage')
    return stage
  }
  const answerLanguage = (value: unknown): ManualAnswerLanguage => value === 'en' ? 'en' : 'zh'
  ipcMain.handle('manual-library:overview', () => service().overview())
  ipcMain.handle('manual-library:current-progress', () => service().currentOperationProgress())
  ipcMain.handle('manual-library:choose-directory', async () => {
    const dialogOptions: Electron.OpenDialogOptions = { title: '选择超级手册库目录', properties: ['openDirectory', 'createDirectory'] }
    const window = options.getWindow()
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled || !result.filePaths[0] ? null : service().setLibraryPath(result.filePaths[0], true)
  })
  ipcMain.handle('manual-library:choose-files', async () => {
    const dialogOptions: Electron.OpenDialogOptions = {
      title: '添加手册',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '手册文件', extensions: ['pdf', 'docx', 'epub', 'html', 'htm', 'md', 'markdown', 'txt', 'rtf'] }],
    }
    const window = options.getWindow()
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled || result.filePaths.length === 0 ? null : service().importManualFiles(result.filePaths)
  })
  ipcMain.handle('manual-library:import-files', (_event, filePaths: unknown) => service().importManualFiles(assertFilePaths(filePaths)))
  ipcMain.handle('manual-library:rebuild-index', (_event, force: unknown) => service().rebuildIndex(force === true))
  ipcMain.handle('manual-library:import-dcs-manuals', () => service().importDcsManuals())
  ipcMain.handle('manual-library:search', (_event, query: unknown, limit: unknown) => service().search(assertText(query, 'manual search query', 500), typeof limit === 'number' ? limit : 8))
  ipcMain.handle('manual-library:ask', (_event, question: unknown, language: unknown) => service().ask(assertText(question, 'manual question', 2_000), answerLanguage(language)))
  ipcMain.handle('manual-library:ask-online', (_event, question: unknown, language: unknown) => service().askOnline(assertText(question, 'manual online question', 2_000), answerLanguage(language)))
  ipcMain.handle('manual-library:preferred-cached-answer', (_event, question: unknown, language: unknown) => service().preferredCachedAnswer(assertText(question, 'manual cached question', 2_000), answerLanguage(language)))
  ipcMain.handle('manual-library:clear-answer-caches', () => service().clearAnswerCaches())
  ipcMain.handle('manual-library:configure-ai-provider', (_event, provider: unknown, apiKey: unknown, baseUrl: unknown) => service().configureAiProvider(aiProvider(provider), assertText(apiKey, 'AI API key', 512), baseUrl === undefined ? undefined : assertText(baseUrl, 'AI base URL', 2_048)))
  ipcMain.handle('manual-library:clear-ai-provider', (_event, provider: unknown) => service().clearAiProvider(aiProvider(provider)))
  ipcMain.handle('manual-library:test-ai-provider', (_event, provider: unknown, apiKey: unknown, baseUrl: unknown) => service().testAiProvider(aiProvider(provider), apiKey === undefined ? undefined : assertText(apiKey, 'AI API key', 512), baseUrl === undefined ? undefined : assertText(baseUrl, 'AI base URL', 2_048)))
  ipcMain.handle('manual-library:set-ai-stage', (_event, stageValue: unknown, settingsValue: unknown) => {
    if (!settingsValue || typeof settingsValue !== 'object') throw new Error('AI stage settings must be an object')
    const value = settingsValue as Record<string, unknown>
    const settings: ManualAiStageSettings = {
      provider: aiProvider(value.provider),
      model: assertText(value.model, 'AI model', 200),
      thinkingLevel: assertText(value.thinkingLevel, 'AI thinking level', 16) as ManualAiStageSettings['thinkingLevel'],
    }
    if (!['off', 'low', 'medium', 'high', 'max'].includes(settings.thinkingLevel)) throw new Error('unsupported AI thinking level')
    return service().setAiStageSettings(aiStage(stageValue), settings)
  })
  ipcMain.handle('manual-library:list-ai-models', (_event, provider: unknown) => service().listAiProviderModels(aiProvider(provider)))
  ipcMain.handle('manual-library:configure-deepseek', (_event, apiKey: unknown) => service().configureDeepSeek(assertText(apiKey, 'DeepSeek API key', 512)))
  ipcMain.handle('manual-library:clear-deepseek', () => service().clearDeepSeek())
  ipcMain.handle('manual-library:test-deepseek', (_event, apiKey: unknown) => service().testDeepSeek(apiKey === undefined ? undefined : assertText(apiKey, 'DeepSeek API key', 512)))
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
        title: `${path.basename(documentPath)} · 第 ${page} 页`, width: 1280, height: 900, minWidth: 760, minHeight: 560,
        autoHideMenuBar: true, backgroundColor: '#202124',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, plugins: true },
      })
      viewer.setMenu(null)
      options.viewerWindows.add(viewer)
      viewer.on('closed', () => options.viewerWindows.delete(viewer))
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
  ipcMain.handle('manual-library:page-preview', (_event, documentId: unknown, pageNumber: unknown) => service().pagePreview(assertText(documentId, 'manual document id', 64), typeof pageNumber === 'number' ? pageNumber : 0))
  ipcMain.handle('manual-library:ask-screenshot', (_event, question: unknown, imageDataUrl: unknown) => service().askWithScreenshot(assertText(question, 'manual screenshot question', 2_000), assertText(imageDataUrl, 'screenshot data', 16 * 1024 * 1024)))
}
