import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { DcsLaunchService } from '../builtins/dcs-launch/service'
import type { OverlayDisplayMode } from '../../src/shared/window-contracts'

export function registerDcsIpc(options: {
  getService: () => DcsLaunchService | null
  getWindow: () => BrowserWindow | null
  setOverlayDisplayMode: (mode: OverlayDisplayMode) => void
}): void {
  const service = () => {
    const current = options.getService()
    if (!current) throw new Error('DCS 启动服务尚未初始化')
    return current
  }
  ipcMain.handle('dcs:status', () => service().status())
  ipcMain.handle('dcs:choose-install-directory', async () => {
    const dialogOptions: Electron.OpenDialogOptions = { title: '选择 DCS World 安装目录', properties: ['openDirectory'] }
    const window = options.getWindow()
    const result = window ? await dialog.showOpenDialog(window, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : service().setInstallPath(result.filePaths[0])
  })
  ipcMain.handle('dcs:use-automatic-detection', () => service().useAutomaticDetection())
  ipcMain.handle('dcs:launch', (_event, mode: unknown) => {
    if (mode !== 'vr' && mode !== 'desktop') throw new Error('Invalid DCS launch mode')
    options.setOverlayDisplayMode(mode)
    return service().launch(mode)
  })
  ipcMain.handle('dcs:launch-launcher', () => service().launchLauncher())
}
