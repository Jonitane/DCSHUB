export interface HubWindowSettings {
  rememberWindowBounds: boolean
}

export interface WindowControlsBridge {
  quit: () => void
  openUpdatePage: () => Promise<void>
  openLogsDirectory: () => Promise<void>
  resetAllUserData: () => Promise<void>
  getHubSettings: () => Promise<HubWindowSettings>
  setRememberWindowBounds: (enabled: boolean) => Promise<HubWindowSettings>
}

export interface OverlaySettings {
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

export interface SpeechInputDevice {
  id: string
  name: string
  isDefault: boolean
}

export interface SpeechModelStatus {
  installed: boolean
  downloading: boolean
  progress: number
  modelDirectory: string
  error: string | null
}

export interface SpeechRecognitionState {
  state: 'idle' | 'recording' | 'recognizing' | 'reviewing' | 'error'
  message?: string
}

export type OverlayDisplayMode = 'desktop' | 'vr'

export interface VrOverlayStatus {
  mode: OverlayDisplayMode
  available: boolean
  bridgeRunning: boolean
  error: string | null
}

export interface OverlayBridge {
  hide: () => void
  getSettings: () => Promise<OverlaySettings>
  setHotkey: (hotkey: string) => Promise<OverlaySettings>
  setMicrophone: (microphoneId: string | null) => Promise<OverlaySettings>
  listMicrophones: () => Promise<SpeechInputDevice[]>
  speechModelStatus: () => Promise<SpeechModelStatus>
  setOpacity: (opacity: number) => Promise<OverlaySettings>
  setSize: (width: number, height: number) => Promise<OverlaySettings>
  setEnabled: (enabled: boolean) => Promise<OverlaySettings>
  getDisplayMode: () => Promise<VrOverlayStatus>
  setDisplayMode: (mode: OverlayDisplayMode) => Promise<VrOverlayStatus>
  moveVr: (normalizedDeltaX: number, normalizedDeltaY: number) => Promise<void>
  beginTextInput: () => Promise<void>
  endTextInput: () => Promise<void>
  onFocusInput: (callback: () => void) => () => void
  onDisplayModeChanged: (callback: (status: VrOverlayStatus) => void) => () => void
  onSpeechState: (callback: (state: SpeechRecognitionState) => void) => () => void
  onSpeechResult: (callback: (text: string) => void) => () => void
}
