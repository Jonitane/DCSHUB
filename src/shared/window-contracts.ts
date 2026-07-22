export interface WindowControlsBridge {
  quit: () => void
  openUpdatePage: () => Promise<void>
  resetAllUserData: () => Promise<void>
}

export interface OverlaySettings {
  hotkey: string
  opacity: number
  width: number
  height: number
  enabled: boolean
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
}
