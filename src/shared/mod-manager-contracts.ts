export interface ModManagerGameDirectory {
  id: string
  name: string
  path: string
  modsPath: string
}

export interface ModManagerSettings {
  gameDirectories: ModManagerGameDirectory[]
  activeGameDirectoryId: string
  backupPath: string
}

export interface ModPackage {
  id: string
  name: string
  fileName: string
  sourcePath: string
  kind: 'folder' | 'archive'
  enabled: boolean
  version: string
  description: string
  size: number
  enabledOrder?: number
  conflicts: string[]
}

export interface ModPresetEntry {
  gameDirectoryId: string
  modId: string
  modName: string
}

export interface ModPreset {
  id: string
  name: string
  entries: ModPresetEntry[]
}

export interface ModManagerOverview {
  configured: boolean
  settings: ModManagerSettings | null
  mods: ModPackage[]
  enabledCount: number
  totalModCount: number
  totalEnabledCount: number
  enabledModKeys: string[]
  activeGameDirectory: ModManagerGameDirectory | null
  presets: ModPreset[]
  activePresetId: string | null
  lastConfigBackupAt: string | null
}

export interface ModOperationResult {
  ok: boolean
  message?: string
}

export interface ConfigBackupResult extends ModOperationResult {
  backedUpAt?: string
  destinationPath?: string
}

export interface ModManagerBridge {
  overview: () => Promise<ModManagerOverview>
  chooseDirectory: (title: string) => Promise<string | null>
  saveSettings: (settings: ModManagerSettings) => Promise<ModManagerOverview>
  selectGameDirectory: (gameDirectoryId: string) => Promise<ModManagerOverview>
  importArchives: () => Promise<ModOperationResult>
  revealMod: (modId: string) => Promise<ModOperationResult>
  setModEnabled: (modId: string, enabled: boolean, allowConflicts?: boolean) => Promise<ModOperationResult>
  setDirectoryModEnabled: (gameDirectoryId: string, modId: string, enabled: boolean, allowConflicts?: boolean) => Promise<ModOperationResult>
  setAllModsEnabled: (enabled: boolean) => Promise<ModOperationResult>
  applyPreset: (presetId: string) => Promise<ModManagerOverview>
  disableAllMods: () => Promise<ModManagerOverview>
  createPreset: (name: string) => Promise<ModManagerOverview>
  updatePreset: (presetId: string, name?: string) => Promise<ModManagerOverview>
  deletePreset: (presetId: string) => Promise<ModManagerOverview>
  backupSavedGamesConfig: (backupPath: string) => Promise<ConfigBackupResult>
}
