import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { APP_VERSION, UPDATE_DOWNLOAD_URL } from '../src/shared/app-meta'
import type { HubWindowSettings, OverlayDisplayMode, SpeechModelStatus, SpeechRecognitionState, VrOverlayStatus } from '../src/shared/window-contracts'
import { parseJoystickHotkey, parseWindowsHotkeyAccelerator } from '../src/shared/overlay-hotkey'
import { RateLimitedLogger } from './logging/rate-limited-logger'
import { DiagnosticLogger } from './logging/diagnostic-logger'
import { AppCore } from './core/app-core'
import focusDcsScript from './native/windows/focus-dcs.ps1?raw'
import keyboardHookSource from './native/windows/keyboard-hook.cs?raw'
import { assertModManagerSettings, assertModuleId, assertModuleIds, assertText } from './ipc/validation'
import { registerModuleIpc } from './ipc/modules'
import { registerDcsIpc } from './ipc/dcs'
import { registerManualLibraryIpc } from './ipc/manual-library'
import { normalizeDcsSpeechTranscript } from './builtins/manual-library/speech-normalizer'
import { migrateLegacyApplicationData, resolveApplicationDataDirectories } from './app-data'

interface OverlaySettings {
  schemaVersion: number
  hotkey: string
  microphoneId: string | null
  opacity: number
  width: number
  height: number
  vrWidth: number
  vrHeight: number
  enabled: boolean
}

interface MainWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

interface StoredHubSettings extends HubWindowSettings {
  windowBounds: MainWindowBounds | null
}

const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  schemaVersion: 2,
  hotkey: 'Ctrl+Alt+M',
  microphoneId: null,
  opacity: 0.92,
  width: 680,
  height: 780,
  vrWidth: 1200,
  vrHeight: 750,
  enabled: true,
}

const DEFAULT_HUB_SETTINGS: StoredHubSettings = {
  rememberWindowBounds: false,
  windowBounds: null,
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RESET_USER_DATA_ARG = '--dcshub-reset-user-data'
const PRESERVE_DIRS_ON_RESET = new Set(['Crashpad', 'Temp', 'Fonts'])
const PRESERVE_FILES_ON_RESET = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])
const applicationDataDirectories = resolveApplicationDataDirectories({
  isPackaged: app.isPackaged,
  executablePath: process.execPath,
  applicationPath: app.getAppPath(),
  legacyDirectory: app.getPath('userData'),
})

fs.mkdirSync(applicationDataDirectories.targetDirectory, { recursive: true })
if (app.isPackaged) migrateLegacyApplicationData(applicationDataDirectories)
app.setPath('userData', applicationDataDirectories.targetDirectory)
app.setPath('sessionData', path.join(applicationDataDirectories.targetDirectory, 'Session Data'))

function resetAppDataIfRequested(): void {
  if (!process.argv.includes(RESET_USER_DATA_ARG)) return
  const userDataPath = path.resolve(app.getPath('userData'))
  if (userDataPath.toLocaleLowerCase() !== applicationDataDirectories.targetDirectory.toLocaleLowerCase()) {
    throw new Error('拒绝清除非 DCSHUB 用户数据目录')
  }
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
let overlayWin: BrowserWindow | null = null
let core: AppCore | null = null
let overlaySettings: OverlaySettings = { ...DEFAULT_OVERLAY_SETTINGS }
let hubSettings: StoredHubSettings = { ...DEFAULT_HUB_SETTINGS }
let windowBoundsSaveTimer: ReturnType<typeof setTimeout> | null = null
let overlaySizeSaveTimer: ReturnType<typeof setTimeout> | null = null
let overlayDisplayMode: OverlayDisplayMode = 'desktop'
let overlayUserVisible = false
let vrCaptureTimer: ReturnType<typeof setInterval> | null = null
let vrCaptureInFlight = false
let vrCaptureEpoch = 0
const VR_CAPTURE_INTERVAL_MS = 16
const manualViewerWindows = new Set<BrowserWindow>()
const diagnosticLogDirectory = path.join(app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(), 'logs')
const diagnosticLogger = new DiagnosticLogger(diagnosticLogDirectory)
const mainLogger = new RateLimitedLogger('DCSHUB/main', 30_000, (key, message, error, detail) => diagnosticLogger.warn('main', key, error, { message, ...detail }))
let quitCleanupStarted = false
let speechRecording = false
let speechStarting: Promise<void> | null = null
let speechFinishing = false
let hotkeyPressTimer: ReturnType<typeof setTimeout> | null = null
let hotkeyLongPress = false
let hotkeyPressedAt = 0
const SPEECH_HOLD_THRESHOLD_MS = 320
const SPEECH_HOLD_RELEASE_GRACE_MS = 45
const SPEECH_RELEASE_AUDIO_TAIL_MS = 240
const SHUTDOWN_CLEANUP_TIMEOUT_MS = 15_000

function senseVoiceModelDirectory(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'speech-models', 'sensevoice')
  const preparedDirectory = path.join(app.getAppPath(), 'build', 'native', 'speech-models', 'sensevoice')
  if (fs.existsSync(path.join(preparedDirectory, 'model.int8.onnx'))) return preparedDirectory
  return path.join(applicationDataDirectories.legacyDirectory, 'speech-models', 'sensevoice')
}

function speechModelStatus(): SpeechModelStatus {
  const directory = senseVoiceModelDirectory()
  const installed = fs.existsSync(path.join(directory, 'model.int8.onnx'))
    && fs.existsSync(path.join(directory, 'tokens.txt'))
  return {
    installed,
    downloading: false,
    progress: installed ? 100 : 0,
    modelDirectory: directory,
    error: installed ? null : '安装包中的 SenseVoice 语音模型缺失，请重新安装 DCSHUB',
  }
}

function sendSpeechState(state: SpeechRecognitionState): void {
  win?.webContents.send('overlay:speech-state', state)
  overlayWin?.webContents.send('overlay:speech-state', state)
}

function requireCore(): AppCore {
  if (!core) throw new Error('DCSHUB Core 尚未初始化')
  return core
}

process.on('uncaughtExceptionMonitor', (error, origin) => diagnosticLogger.emergency('process', 'uncaught-exception', error, { origin }))
process.on('unhandledRejection', (reason) => diagnosticLogger.error('process', 'unhandled-rejection', reason))

function getOverlaySettingsPath(): string {
  return path.join(app.getPath('userData'), 'overlay-settings.json')
}

function loadOverlaySettings(): void {
  try {
    const raw = fs.readFileSync(getOverlaySettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OverlaySettings>
    const storedHotkey = typeof parsed.hotkey === 'string' && parsed.hotkey ? parsed.hotkey : DEFAULT_OVERLAY_SETTINGS.hotkey
    const legacyDefaultHotkey = parsed.schemaVersion !== DEFAULT_OVERLAY_SETTINGS.schemaVersion
      && storedHotkey.trim().toLocaleUpperCase() === 'F9'
    overlaySettings = {
      schemaVersion: DEFAULT_OVERLAY_SETTINGS.schemaVersion,
      hotkey: legacyDefaultHotkey ? DEFAULT_OVERLAY_SETTINGS.hotkey : storedHotkey,
      microphoneId: typeof parsed.microphoneId === 'string' && parsed.microphoneId ? parsed.microphoneId : null,
      opacity: typeof parsed.opacity === 'number' && parsed.opacity >= 0.3 && parsed.opacity <= 1 ? parsed.opacity : DEFAULT_OVERLAY_SETTINGS.opacity,
      width: typeof parsed.width === 'number' && parsed.width >= 400 && parsed.width <= 2000 ? parsed.width : DEFAULT_OVERLAY_SETTINGS.width,
      height: typeof parsed.height === 'number' && parsed.height >= 300 && parsed.height <= 1600 ? parsed.height : DEFAULT_OVERLAY_SETTINGS.height,
      vrWidth: typeof parsed.vrWidth === 'number' && parsed.vrWidth >= 400 && parsed.vrWidth <= 2000 ? parsed.vrWidth : DEFAULT_OVERLAY_SETTINGS.vrWidth,
      vrHeight: typeof parsed.vrHeight === 'number' && parsed.vrHeight >= 300 && parsed.vrHeight <= 1600 ? parsed.vrHeight : DEFAULT_OVERLAY_SETTINGS.vrHeight,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_OVERLAY_SETTINGS.enabled,
    }
    if (parsed.schemaVersion !== DEFAULT_OVERLAY_SETTINGS.schemaVersion) saveOverlaySettings()
  } catch (error) {
    mainLogger.warn('load-overlay-settings', '悬浮窗设置读取失败，已使用默认值', error)
    overlaySettings = { ...DEFAULT_OVERLAY_SETTINGS }
  }
}

function saveOverlaySettings(): void {
  try {
    fs.writeFileSync(getOverlaySettingsPath(), JSON.stringify(overlaySettings, null, 2), 'utf8')
  } catch (error) {
    mainLogger.warn('save-overlay-settings', '悬浮窗设置保存失败', error)
  }
}

function rememberCurrentOverlaySize(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  const [width, height] = overlayWin.getSize()
  if (overlayDisplayMode === 'vr') {
    overlaySettings.vrWidth = width
    overlaySettings.vrHeight = height
  } else {
    overlaySettings.width = width
    overlaySettings.height = height
  }
  saveOverlaySettings()
}

function scheduleOverlaySizeSave(): void {
  if (overlaySizeSaveTimer) clearTimeout(overlaySizeSaveTimer)
  overlaySizeSaveTimer = setTimeout(() => {
    overlaySizeSaveTimer = null
    rememberCurrentOverlaySize()
  }, 250)
}

function getHubSettingsPath(): string {
  return path.join(app.getPath('userData'), 'hub-settings.json')
}

function isMainWindowBounds(value: unknown): value is MainWindowBounds {
  if (!value || typeof value !== 'object') return false
  const bounds = value as Partial<MainWindowBounds>
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((part) => typeof part === 'number' && Number.isFinite(part))
    && (bounds.width ?? 0) >= 960
    && (bounds.height ?? 0) >= 640
}

function loadHubSettings(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(getHubSettingsPath(), 'utf8')) as Partial<StoredHubSettings>
    hubSettings = {
      rememberWindowBounds: parsed.rememberWindowBounds === true,
      windowBounds: isMainWindowBounds(parsed.windowBounds) ? parsed.windowBounds : null,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') mainLogger.warn('load-hub-settings', 'HUB 设置读取失败，已使用默认值', error)
    hubSettings = { ...DEFAULT_HUB_SETTINGS }
  }
}

function saveHubSettings(): void {
  try {
    fs.mkdirSync(path.dirname(getHubSettingsPath()), { recursive: true })
    fs.writeFileSync(getHubSettingsPath(), JSON.stringify(hubSettings, null, 2), 'utf8')
  } catch (error) {
    mainLogger.warn('save-hub-settings', 'HUB 设置保存失败', error)
  }
}

function visibleMainWindowBounds(): MainWindowBounds | null {
  const saved = hubSettings.windowBounds
  if (!hubSettings.rememberWindowBounds || !saved) return null
  const displays = screen.getAllDisplays()
  const isVisible = displays.some(({ workArea }) => {
    const overlapWidth = Math.min(saved.x + saved.width, workArea.x + workArea.width) - Math.max(saved.x, workArea.x)
    const overlapHeight = Math.min(saved.y + saved.height, workArea.y + workArea.height) - Math.max(saved.y, workArea.y)
    return overlapWidth >= 120 && overlapHeight >= 80
  })
  if (!isVisible) return null
  const workArea = screen.getDisplayMatching(saved).workArea
  const width = Math.min(Math.max(saved.width, 960), workArea.width)
  const height = Math.min(Math.max(saved.height, 640), workArea.height)
  return {
    width,
    height,
    x: Math.min(Math.max(saved.x, workArea.x - width + 120), workArea.x + workArea.width - 120),
    y: Math.min(Math.max(saved.y, workArea.y), workArea.y + workArea.height - 80),
  }
}

function rememberCurrentWindowBounds(): void {
  if (!hubSettings.rememberWindowBounds || !win || win.isDestroyed() || win.isMinimized()) return
  hubSettings.windowBounds = win.getNormalBounds()
  saveHubSettings()
}

function scheduleWindowBoundsSave(): void {
  if (!hubSettings.rememberWindowBounds) return
  if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer)
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null
    rememberCurrentWindowBounds()
  }, 250)
}

let lastOverlayToggleAt = 0
const OVERLAY_TOGGLE_DEBOUNCE_MS = 250
async function toggleOverlay(): Promise<void> {
  if (!overlaySettings.enabled) return
  const now = Date.now()
  if (now - lastOverlayToggleAt < OVERLAY_TOGGLE_DEBOUNCE_MS) return
  lastOverlayToggleAt = now
  if (overlayUserVisible) {
    setOverlayVisibility(false)
  } else {
    const currentCore = core
    if (!currentCore) return
    if (!await currentCore.isDcsRunning(true)) return
    setOverlayVisibility(true)
  }
}

function setOverlayVisibility(visible: boolean): void {
  if (visible) showOverlay()
  else hideOverlay()
}

function showOverlay(): void {
  ensureOverlayWindow()
  if (!overlayWin || overlayWin.isDestroyed()) return
  overlayUserVisible = true
  overlayWin.setAlwaysOnTop(true, 'screen-saver')
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWin.setIgnoreMouseEvents(false)
  overlayWin.setOpacity(overlayDisplayMode === 'vr' ? 0.01 : overlaySettings.opacity)
  if (overlayDisplayMode === 'vr') {
    // showInactive preserves DCS focus on invocation, while keeping the host
    // window focusable so mouse dragging, controls and explicit text input work.
    overlayWin.setFocusable(true)
    overlayWin.showInactive()
    core?.vrOverlay.beginFrames()
    core?.vrOverlay.requestRecenter()
    startVrFrameCapture()
  } else {
    overlayWin.setFocusable(true)
    overlayWin.show()
    overlayWin.focus()
    overlayWin.webContents.focus()
    overlayWin.webContents.send('overlay:focus-input')
  }
}

function hideOverlay(): void {
  overlayUserVisible = false
  stopVrFrameCapture()
  core?.vrOverlay.publishInactive()
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(true, { forward: true })
    overlayWin.blur()
    overlayWin.hide()
  }
  focusDcsWindow()
}

function stopVrFrameCapture(): void {
  vrCaptureEpoch += 1
  if (vrCaptureTimer) {
    clearInterval(vrCaptureTimer)
    vrCaptureTimer = null
  }
  vrCaptureInFlight = false
}

async function captureVrOverlayFrame(): Promise<void> {
  if (vrCaptureInFlight || overlayDisplayMode !== 'vr' || !overlayUserVisible || !overlayWin || overlayWin.isDestroyed()) return
  const captureEpoch = vrCaptureEpoch
  vrCaptureInFlight = true
  try {
    const source = await overlayWin.webContents.capturePage()
    if (captureEpoch !== vrCaptureEpoch || overlayDisplayMode !== 'vr' || !overlayUserVisible || !overlayWin || overlayWin.isDestroyed()) return
    if (source.isEmpty()) return
    const sourceSize = source.getSize()
    const scale = Math.min(1, 1280 / sourceSize.width, 900 / sourceSize.height)
    const width = Math.max(1, Math.round(sourceSize.width * scale))
    const height = Math.max(1, Math.round(sourceSize.height * scale))
    const frame = scale < 1 ? source.resize({ width, height, quality: 'best' }) : source
    if (captureEpoch !== vrCaptureEpoch || !overlayUserVisible) return
    core?.vrOverlay.publishFrame(frame.toBitmap(), width, height)
  } catch (error) {
    mainLogger.warn('vr-frame-capture', 'VR 手册画面捕获失败，将自动重试', error)
  }
  finally {
    // A stale capture must not reset the in-flight state of a newer session.
    if (captureEpoch === vrCaptureEpoch) vrCaptureInFlight = false
  }
}

function startVrFrameCapture(): void {
  if (vrCaptureTimer || overlayDisplayMode !== 'vr' || !overlayUserVisible) return
  void captureVrOverlayFrame()
  // Capture as quickly as Chromium can supply frames. The in-flight guard keeps
  // slower machines from queueing work while allowing capable systems to reach 60 FPS.
  vrCaptureTimer = setInterval(() => { void captureVrOverlayFrame() }, VR_CAPTURE_INTERVAL_MS)
  vrCaptureTimer.unref()
}

function configureOverlayWindowForMode(mode: OverlayDisplayMode): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  overlayWin.setFocusable(true)
  overlayWin.setOpacity(mode === 'vr' && overlayUserVisible ? 0.01 : overlaySettings.opacity)
  const display = screen.getPrimaryDisplay()
  if (mode === 'desktop') {
    const width = Math.min(display.workArea.width, overlaySettings.width)
    const height = Math.min(display.workArea.height, overlaySettings.height)
    overlayWin.setBounds({
      x: display.workArea.x + Math.round((display.workArea.width - width) / 2),
      y: display.workArea.y + Math.round((display.workArea.height - height) / 2),
      width,
      height,
    })
    return
  }
  const width = Math.min(display.workArea.width, overlaySettings.vrWidth)
  const height = Math.min(display.workArea.height, overlaySettings.vrHeight)
  overlayWin.setBounds({
    x: display.workArea.x + Math.round((display.workArea.width - width) / 2),
    y: display.workArea.y + Math.round((display.workArea.height - height) / 2),
    width,
    height,
  })
}

function focusDcsWindow(): void {
  if (process.platform !== 'win32') return
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', focusDcsScript], {
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    })
    child.unref()
  } catch { /* focus restoration is best effort */ }
}

function beginVrOverlayTextInput(): void {
  if (overlayDisplayMode !== 'vr' || !overlayUserVisible || !overlayWin || overlayWin.isDestroyed()) return
  overlayWin.setFocusable(true)
  overlayWin.focus()
  overlayWin.webContents.focus()
}

function endVrOverlayTextInput(): void {
  if (overlayDisplayMode !== 'vr' || !overlayWin || overlayWin.isDestroyed()) return
  // Keep the window focusable for the next interaction. Blurring here avoids
  // breaking subsequent pointer events, then explicitly returns focus to DCS.
  overlayWin.blur()
  focusDcsWindow()
}

function applyOverlayDisplayMode(mode: OverlayDisplayMode): VrOverlayStatus {
  overlayDisplayMode = mode
  const status = core?.vrOverlay.setDisplayMode(mode) || { mode, available: false, bridgeRunning: false, error: 'VR overlay service is unavailable' }
  configureOverlayWindowForMode(mode)
  if (mode === 'vr' && overlayUserVisible) startVrFrameCapture()
  else {
    stopVrFrameCapture()
    core?.vrOverlay.publishInactive()
  }
  win?.webContents.send('overlay:display-mode-changed', status)
  overlayWin?.webContents.send('overlay:display-mode-changed', status)
  return status
}

let hotkeyHookProcess: ChildProcess | null = null
let requestedHotkey: string | null = null
let hotkeyRestartTimer: ReturnType<typeof setTimeout> | null = null
let hotkeyRestartAttempts = 0

function overlayHotkeyDown(): void {
  if (hotkeyPressTimer || hotkeyLongPress) return
  hotkeyLongPress = false
  hotkeyPressedAt = Date.now()
  hotkeyPressTimer = setTimeout(() => {
    hotkeyPressTimer = null
    activateSpeechLongPress()
  }, SPEECH_HOLD_THRESHOLD_MS)
}

function activateSpeechLongPress(): void {
  if (hotkeyLongPress) return
  hotkeyLongPress = true
  void beginSpeechQuestion()
}

function overlayHotkeyUp(): void {
  const heldForMs = hotkeyPressedAt > 0 ? Date.now() - hotkeyPressedAt : 0
  hotkeyPressedAt = 0
  if (hotkeyPressTimer) {
    clearTimeout(hotkeyPressTimer)
    hotkeyPressTimer = null
    if (heldForMs >= SPEECH_HOLD_THRESHOLD_MS - SPEECH_HOLD_RELEASE_GRACE_MS) {
      activateSpeechLongPress()
      hotkeyLongPress = false
      void finishSpeechQuestion()
      return
    }
    void toggleOverlay()
    return
  }
  if (!hotkeyLongPress) return
  hotkeyLongPress = false
  void finishSpeechQuestion()
}

function beginSpeechQuestion(): Promise<void> {
  if (speechStarting) return speechStarting
  speechStarting = startSpeechQuestion().finally(() => {
    speechStarting = null
  })
  return speechStarting
}

async function startSpeechQuestion(): Promise<void> {
  try {
    if (!speechModelStatus().installed) {
      showOverlay()
      sendSpeechState({ state: 'error', message: '安装包中的 SenseVoice 语音模型缺失，请重新安装 DCSHUB' })
      return
    }
    showOverlay()
    await requireCore().startSpeech(overlaySettings.microphoneId)
    speechRecording = true
    sendSpeechState({ state: 'recording', message: '正在录音，松开按键后提问' })
  } catch (reason) {
    speechRecording = false
    sendSpeechState({ state: 'error', message: reason instanceof Error ? reason.message : String(reason) })
  }
}

async function finishSpeechQuestion(): Promise<void> {
  if (speechFinishing) return
  speechFinishing = true
  try {
    if (speechStarting) await speechStarting
    if (!speechRecording) return
    sendSpeechState({ state: 'recording', message: '正在收尾录音，请稍候…' })
    await new Promise((resolve) => setTimeout(resolve, SPEECH_RELEASE_AUDIO_TAIL_MS))
    speechRecording = false
    sendSpeechState({ state: 'recognizing', message: '正在识别语音' })
    const result = await requireCore().stopSpeech(senseVoiceModelDirectory())
    const normalizedText = normalizeDcsSpeechTranscript(result.text)
    if (!normalizedText) {
      sendSpeechState({ state: 'error', message: '没有识别到有效语音，请重新长按说话' })
      return
    }
    overlayWin?.webContents.send('overlay:speech-result', normalizedText)
    win?.webContents.send('overlay:speech-result', normalizedText)
  } catch (reason) {
    sendSpeechState({ state: 'error', message: reason instanceof Error ? reason.message : String(reason) })
  } finally {
    speechFinishing = false
  }
}

function startKeyboardHook(hotkey: string): void {
  stopKeyboardHook()
  requestedHotkey = hotkey
  hotkeyRestartAttempts = 0
  launchKeyboardHook(hotkey)
}

function scheduleKeyboardHookRestart(hotkey: string): void {
  if (requestedHotkey !== hotkey || hotkeyRestartTimer) return
  const delay = Math.min(10_000, 500 * 2 ** Math.min(hotkeyRestartAttempts, 5))
  hotkeyRestartAttempts += 1
  hotkeyRestartTimer = setTimeout(() => {
    hotkeyRestartTimer = null
    if (requestedHotkey === hotkey) launchKeyboardHook(hotkey)
  }, delay)
}

function launchKeyboardHook(hotkey: string): void {
  if (process.platform !== 'win32') {
    mainLogger.warn('hotkey-platform-unsupported', '当前平台不支持非独占式全局按键监听')
    return
  }
  const joystick = parseJoystickHotkey(hotkey)
  const parsed = joystick ? null : parseWindowsHotkeyAccelerator(hotkey)
  if (!parsed && !joystick) {
    mainLogger.warn('hotkey-invalid', '无法启动内置手册按键监听：按键格式无效', undefined, { hotkey })
    return
  }

  const psScript = `
Add-Type -TypeDefinition @'
${keyboardHookSource}
'@
[DcsHubKbdHook]::Start(@(${joystick ? `'JOY','${joystick.deviceIndex}','${joystick.buttonIndex}','${process.pid}'` : `'${parsed!.vkCode}','${parsed!.mods}','${process.pid}'`}))
`
  try {
    hotkeyHookProcess = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-STA',
      '-ExecutionPolicy', 'Bypass', '-Command', psScript,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: false,
    })
    const proc = hotkeyHookProcess
    let stdoutBuf = ''
    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString('utf8')
      const lines = stdoutBuf.split(/\r?\n/)
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'DOWN') {
          overlayHotkeyDown()
        } else if (trimmed === 'UP') {
          overlayHotkeyUp()
        } else if (trimmed === 'HOOK_READY') {
          hotkeyRestartAttempts = 0
        } else if (trimmed === 'HOOK_FAILED') {
          mainLogger.warn('hotkey-hook-failed', '非独占式全局按键监听启动失败', undefined, { hotkey })
        }
      }
    })
    proc.on('exit', () => {
      if (hotkeyHookProcess === proc) {
        hotkeyHookProcess = null
        scheduleKeyboardHookRestart(hotkey)
      }
    })
    proc.on('error', () => {
      if (hotkeyHookProcess === proc) {
        hotkeyHookProcess = null
        scheduleKeyboardHookRestart(hotkey)
      }
    })
  } catch (error) {
    mainLogger.warn('hotkey-hook-start', '非独占式全局按键监听启动失败', error, { hotkey })
    scheduleKeyboardHookRestart(hotkey)
  }
}

function stopKeyboardHook(): void {
  requestedHotkey = null
  if (hotkeyRestartTimer) clearTimeout(hotkeyRestartTimer)
  hotkeyRestartTimer = null
  hotkeyRestartAttempts = 0
  if (hotkeyPressTimer) clearTimeout(hotkeyPressTimer)
  hotkeyPressTimer = null
  hotkeyLongPress = false
  hotkeyPressedAt = 0
  if (speechRecording) void core?.cancelSpeech()
  speechRecording = false
  if (hotkeyHookProcess) {
    const proc = hotkeyHookProcess
    hotkeyHookProcess = null
    const pid = proc.pid
    try { proc.stdin?.end() } catch { /* ignore */ }
    try { proc.stdout?.destroy() } catch { /* ignore */ }
    try { proc.stderr?.destroy() } catch { /* ignore */ }
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
    if (pid) {
      try {
        require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore', timeout: 2000 })
      } catch { /* ignore */ }
    }
  }
}

function registerOverlayHotkey(): void {
  startKeyboardHook(overlaySettings.hotkey)
}

function ensureOverlayWindow(): void {
  if (overlayWin && !overlayWin.isDestroyed()) return
  const preloadPath = path.join(__dirname, 'preload.cjs')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds

  overlayWin = new BrowserWindow({
    title: '超级手册',
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    focusable: true,
    width: screenWidth,
    height: screenHeight,
    x: 0,
    y: 0,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      offscreen: false,
      backgroundThrottling: false,
    },
  })

  configureOverlayWindowForMode(overlayDisplayMode)
  overlayWin.setOpacity(overlaySettings.opacity)
  overlayWin.setIgnoreMouseEvents(true, { forward: true })

  const overlayUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}?overlay=1`
    : `file://${path.join(process.env.DIST || '', 'index.html')}?overlay=1`

  overlayWin.loadURL(overlayUrl)

  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin?.setOpacity(overlayDisplayMode === 'vr' && overlayUserVisible ? 0.01 : overlaySettings.opacity)
    configureOverlayWindowForMode(overlayDisplayMode)
  })

  overlayWin.on('resize', scheduleOverlaySizeSave)
  overlayWin.on('closed', () => {
    if (overlaySizeSaveTimer) clearTimeout(overlaySizeSaveTimer)
    overlaySizeSaveTimer = null
    stopVrFrameCapture()
    core?.vrOverlay.publishInactive()
    overlayWin = null
    overlayUserVisible = false
  })
}

function restoreMainWindow(): void {
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs')
  const restoredBounds = visibleMainWindowBounds()
  win = new BrowserWindow({
    title: 'DCSHUB',
    icon: path.join(process.env.VITE_PUBLIC || process.env.DIST || '', 'images', 'dcshub-app-icon.png'),
    frame: false,
    autoHideMenuBar: true,
    width: restoredBounds?.width ?? 1512,
    height: restoredBounds?.height ?? 720,
    ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y } : {}),
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
    diagnosticLogger.error('renderer', 'preload-error', error, { preloadPath })
  })
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'info' || level === 'debug') return
    const detail = { level, line: lineNumber, sourceId }
    if (level === 'error') diagnosticLogger.error('renderer-console', message, undefined, detail)
    else diagnosticLogger.warn('renderer-console', message, undefined, detail)
  })

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(process.env.DIST || '', 'index.html'))

  win.on('focus', () => core?.setMonitoringActive(true))
  win.on('blur', () => core?.setMonitoringActive(false))
  win.on('minimize', () => core?.setMonitoringActive(false))
  win.on('hide', () => core?.setMonitoringActive(false))
  win.on('move', scheduleWindowBoundsSave)
  win.on('resize', scheduleWindowBoundsSave)
  win.on('close', rememberCurrentWindowBounds)
  win.on('closed', () => {
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer)
    windowBoundsSaveTimer = null
    core?.setMonitoringActive(false)
    win = null
    // The hidden overlay is also a BrowserWindow, so window-all-closed will
    // not fire after the main window is closed with Alt+F4 / WM_CLOSE.
    // Explicitly enter the normal application shutdown path in that case.
    if (!quitCleanupStarted) app.quit()
  })
}

function registerWindowIpc(): void {
  ipcMain.handle('window:open-update-page', () => shell.openExternal(UPDATE_DOWNLOAD_URL))
  ipcMain.handle('window:open-logs-directory', async () => {
    fs.mkdirSync(diagnosticLogger.directory, { recursive: true })
    const error = await shell.openPath(diagnosticLogger.directory)
    if (error) throw new Error(error)
  })
  ipcMain.handle('window:get-hub-settings', (): HubWindowSettings => ({
    rememberWindowBounds: hubSettings.rememberWindowBounds,
  }))
  ipcMain.handle('window:set-remember-bounds', (_event, enabled: unknown): HubWindowSettings => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid remember window bounds setting')
    hubSettings.rememberWindowBounds = enabled
    if (enabled && win && !win.isDestroyed()) hubSettings.windowBounds = win.getNormalBounds()
    if (!enabled) hubSettings.windowBounds = null
    saveHubSettings()
    return { rememberWindowBounds: enabled }
  })
  ipcMain.handle('updates:settings', () => {
    return requireCore().updates.settings()
  })
  ipcMain.handle('updates:set-automatic-checks', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid automatic update setting')
    return requireCore().updates.setAutomaticChecks(enabled)
  })
  ipcMain.handle('updates:check', (_event, force: unknown) => {
    return requireCore().updates.check(force === true)
  })
  ipcMain.handle('updates:open-download', async (_event, rawUrl: unknown) => {
    const url = new URL(assertText(rawUrl, 'update download URL', 2_048))
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/Jonitane/DCSHUB/releases/tag/')) {
      throw new Error('拒绝打开非 DCSHUB 官方更新地址')
    }
    await shell.openExternal(url.toString())
  })
  ipcMain.handle('window:reset-all-user-data', async () => {
    // 同步清理：停止 hook 和快捷键（app.exit 会强制终止进程，子进程也会被清理）
    try { core?.setMonitoringActive(false) } catch { /* Best-effort cleanup before relaunch. */ }
    try { stopKeyboardHook() } catch { /* Best-effort cleanup before relaunch. */ }
    // 清除 session 缓存
    try { await session.defaultSession.clearCache() } catch { /* Relaunch must continue if cache cleanup fails. */ }
    try { await session.defaultSession.clearStorageData() } catch { /* Relaunch must continue if storage cleanup fails. */ }
    try { await core?.dispose() } catch { /* Best-effort Core and OpenXR cleanup before forced relaunch. */ }
    diagnosticLogger.info('application', 'reset-user-data')
    await diagnosticLogger.flush()
    // relaunch + exit(0) 直接强制退出，不触发 before-quit / window-all-closed
    const relaunchArgs = process.argv.slice(1).filter((argument) => argument !== RESET_USER_DATA_ARG)
    app.relaunch({ args: [...relaunchArgs, RESET_USER_DATA_ARG] })
    app.exit(0)
  })
  ipcMain.on('window:quit', () => app.quit())
  ipcMain.on('overlay:hide', () => setOverlayVisibility(false))
  ipcMain.handle('overlay:is-active', () => overlayUserVisible)
  ipcMain.handle('overlay:get-settings', () => overlaySettings)
  ipcMain.handle('overlay:set-hotkey', (_event, hotkey: unknown) => {
    if (typeof hotkey !== 'string' || !hotkey.trim()) throw new Error('Invalid hotkey')
    const newHotkey = hotkey.trim()
    const parsed = parseWindowsHotkeyAccelerator(newHotkey)
    const joystick = parseJoystickHotkey(newHotkey)
    if (!parsed && !joystick) throw new Error('不支持的热键或外设按钮')
    overlaySettings.hotkey = newHotkey
    saveOverlaySettings()
    if (overlaySettings.enabled) startKeyboardHook(newHotkey)
    else stopKeyboardHook()
    return overlaySettings
  })
  ipcMain.handle('overlay:set-opacity', (_event, opacity: unknown) => {
    if (typeof opacity !== 'number' || opacity < 0.3 || opacity > 1) throw new Error('Invalid opacity')
    overlaySettings.opacity = opacity
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setOpacity(overlayDisplayMode === 'vr' && overlayUserVisible ? 0.01 : opacity)
    saveOverlaySettings()
    return overlaySettings
  })
  ipcMain.handle('overlay:set-size', (_event, width: unknown, height: unknown) => {
    if (typeof width !== 'number' || width < 400 || width > 2000) throw new Error('Invalid width')
    if (typeof height !== 'number' || height < 300 || height > 1600) throw new Error('Invalid height')
    const nextWidth = Math.round(width)
    const nextHeight = Math.round(height)
    if (overlayDisplayMode === 'vr') {
      overlaySettings.vrWidth = nextWidth
      overlaySettings.vrHeight = nextHeight
    } else {
      overlaySettings.width = nextWidth
      overlaySettings.height = nextHeight
    }
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setSize(nextWidth, nextHeight)
    saveOverlaySettings()
    return overlaySettings
  })
  ipcMain.handle('overlay:set-enabled', (_event, enabled: unknown) => {
    overlaySettings.enabled = !!enabled
    if (!overlaySettings.enabled && overlayUserVisible) setOverlayVisibility(false)
    if (overlaySettings.enabled) startKeyboardHook(overlaySettings.hotkey)
    else stopKeyboardHook()
    saveOverlaySettings()
    return overlaySettings
  })
  ipcMain.handle('overlay:get-display-mode', () => core?.vrOverlay.status() || {
    mode: overlayDisplayMode,
    available: false,
    bridgeRunning: false,
    error: 'VR overlay service is unavailable',
  })
  ipcMain.handle('overlay:set-display-mode', (_event, mode: unknown) => {
    if (mode !== 'desktop' && mode !== 'vr') throw new Error('Invalid overlay display mode')
    return applyOverlayDisplayMode(mode)
  })
  ipcMain.handle('overlay:move-vr', (_event, normalizedDeltaX: unknown, normalizedDeltaY: unknown) => {
    if (typeof normalizedDeltaX !== 'number' || !Number.isFinite(normalizedDeltaX) || Math.abs(normalizedDeltaX) > 0.25) throw new Error('Invalid VR X movement')
    if (typeof normalizedDeltaY !== 'number' || !Number.isFinite(normalizedDeltaY) || Math.abs(normalizedDeltaY) > 0.25) throw new Error('Invalid VR Y movement')
    core?.vrOverlay.moveBy(normalizedDeltaX, normalizedDeltaY)
  })
  ipcMain.handle('overlay:begin-text-input', () => beginVrOverlayTextInput())
  ipcMain.handle('overlay:end-text-input', () => endVrOverlayTextInput())
}

function registerSoftwareCatalogIpc(): void {
  const service = () => {
    return requireCore().softwareCatalog
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
  ipcMain.handle('software-catalog:set-launch-delay', (_event, id: unknown, seconds: unknown) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new Error('Invalid launch delay')
    return service().setLaunchDelay(assertModuleId(id), seconds)
  })
  ipcMain.handle('software-catalog:remove', (_event, id: unknown) => service().remove(assertModuleId(id)))
  ipcMain.handle('software-catalog:complete-setup', (_event, enabledIds: unknown) => (
    service().completeInitialSetup(assertModuleIds(enabledIds))
  ))
}

function registerModManagerIpc(): void {
  const service = () => {
    return requireCore().modManager
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

app.whenReady().then(async () => {
  diagnosticLogger.info('application', 'started', { version: APP_VERSION, packaged: app.isPackaged, platform: process.platform, arch: process.arch })
  Menu.setApplicationMenu(null)
  loadOverlaySettings()
  loadHubSettings()
  if (overlaySettings.enabled) registerOverlayHotkey()
  const vrResources = app.isPackaged
    ? path.join(process.resourcesPath, 'vr-overlay')
    : path.join(app.getAppPath(), 'build', 'native', 'vr-overlay')
  const nativeCoreExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'core', 'DcsHub.Core.Host.exe')
    : path.join(app.getAppPath(), 'build', 'native', 'core', 'DcsHub.Core.Host.exe')
  core = new AppCore({
    userDataDirectory: app.getPath('userData'),
    packaged: app.isPackaged,
    vrResourcesDirectory: vrResources,
    nativeCoreExecutable,
    diagnosticLogDirectory,
    appVersion: APP_VERSION,
    encryption: {
      available: () => safeStorage.isEncryptionAvailable(),
      protect: (value) => safeStorage.encryptString(value).toString('base64'),
      unprotect: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    fetchImpl: fetch,
    onDcsMonitorError: (error) => mainLogger.warn('dcs-process-monitor', 'DCS 进程检测失败', error),
    onModuleChanged: (event) => diagnosticLogger.info('module', 'state-changed', {
      moduleId: event.snapshot.moduleId,
      runState: event.snapshot.runState,
      installState: event.snapshot.installState,
      ownership: event.snapshot.ownership,
      lastError: event.snapshot.lastError,
    }),
    onModuleLog: (entry) => {
      if (entry.level === 'error') diagnosticLogger.error('module', entry.message, undefined, { moduleId: entry.moduleId })
      else if (entry.level === 'warn') diagnosticLogger.warn('module', entry.message, undefined, { moduleId: entry.moduleId })
    },
  })
  ipcMain.handle('overlay:set-microphone', (_event, microphoneId: unknown) => {
    if (microphoneId !== null && typeof microphoneId !== 'string') throw new Error('麦克风标识无效')
    overlaySettings.microphoneId = typeof microphoneId === 'string' && microphoneId ? microphoneId : null
    saveOverlaySettings()
    return overlaySettings
  })
  ipcMain.handle('overlay:list-microphones', () => requireCore().speechDevices())
  ipcMain.handle('overlay:speech-model-status', () => speechModelStatus())
  core.events.on('dcs-process-changed', (running) => {
    if (!running && overlayUserVisible) setOverlayVisibility(false)
  })
  core.events.on('manual-progress', (progress) => win?.webContents.send('manual-library:progress', progress))
  registerModuleIpc(core.modules, () => win)
  registerModManagerIpc()
  registerDcsIpc({ getService: () => core?.dcsLaunch || null, getWindow: () => win, setOverlayDisplayMode: (mode) => { applyOverlayDisplayMode(mode) } })
  registerManualLibraryIpc({ getService: () => core?.manualLibrary || null, getWindow: () => win, viewerWindows: manualViewerWindows })
  registerSoftwareCatalogIpc()
  registerWindowIpc()
  await core.initialize()
  createWindow()
  win?.webContents.once('did-finish-load', () => { void core?.manualLibrary.ensureCurrentSearchIndexes() })
})

app.on('before-quit', (event) => {
  if (quitCleanupStarted) return
  diagnosticLogger.info('application', 'before-quit')
  event.preventDefault()
  quitCleanupStarted = true
  stopVrFrameCapture()
  stopKeyboardHook()
  try { overlayWin?.destroy() } catch { /* The overlay may already be destroyed. */ }
  overlayWin = null
  void (async () => {
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        core?.dispose(),
        new Promise<never>((_resolve, reject) => {
          cleanupTimer = setTimeout(
            () => reject(new Error(`DCSHUB shutdown cleanup exceeded ${SHUTDOWN_CLEANUP_TIMEOUT_MS}ms`)),
            SHUTDOWN_CLEANUP_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      diagnosticLogger.error('application', 'module-cleanup-failed', error)
    } finally {
      if (cleanupTimer) clearTimeout(cleanupTimer)
      try {
        await Promise.race([
          diagnosticLogger.flush(),
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ])
      } finally {
        // The second app.quit() used to rely on Electron re-entering
        // before-quit. app.exit is deterministic after cleanup (or timeout)
        // and closes inherited handles so Core/VR child watchers can exit.
        app.exit(0)
      }
    }
  })()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', restoreMainWindow)
app.on('render-process-gone', (_event, webContents, details) => diagnosticLogger.error('renderer', 'process-gone', undefined, { reason: details.reason, exitCode: details.exitCode, url: webContents.getURL() }))
