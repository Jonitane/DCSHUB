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
}

export interface OverlaySettings {
  hotkey: string
  opacity: number
  width: number
  height: number
  enabled: boolean
}

export interface OverlayBridge {
  hide: () => void
  getSettings: () => Promise<OverlaySettings>
  setHotkey: (hotkey: string) => Promise<OverlaySettings>
  setOpacity: (opacity: number) => Promise<OverlaySettings>
  setSize: (width: number, height: number) => Promise<OverlaySettings>
  setEnabled: (enabled: boolean) => Promise<OverlaySettings>
  onFocusInput: (callback: () => void) => () => void
}
