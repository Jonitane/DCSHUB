export type ModuleId = string

export type ModuleInstallState = 'unknown' | 'not-installed' | 'installed' | 'incompatible'
export type ModuleRunState = 'stopped' | 'starting' | 'running' | 'degraded' | 'stopping' | 'failed'
export type ModuleOwnership = 'none' | 'external' | 'hub'

export interface ModuleCapabilities {
  lifecycle: boolean
  settings: boolean
  showWindow: boolean
  logs: boolean
}

export type ModuleStopPolicy = 'owned-only' | 'always' | 'never'

export interface ModuleOperationTimeouts {
  discoverMs?: number
  startMs?: number
  stopMs?: number
  settingsMs?: number
  showWindowMs?: number
  actionMs?: number
}

export interface ModuleActionDefinition {
  id: string
  label: string
  kind: 'toggle'
  activeLabel?: string
  inactiveLabel?: string
}

export interface ModuleActionState {
  actionId: string
  active: boolean
}

export interface ModuleActionResult {
  ok: boolean
  moduleId: ModuleId
  actionId: string
  active?: boolean
  error?: ModuleError
}

export interface ModuleSettingOption {
  label: string
  value: string | number
}

export interface ModuleSettingField {
  key: string
  label: string
  description?: string
  kind: 'boolean' | 'number' | 'select' | 'slider' | 'text'
  required?: boolean
  min?: number
  max?: number
  step?: number
  suffix?: string
  options?: ModuleSettingOption[]
  autoApply?: boolean
  quickAccess?: boolean
}

export interface ModuleCardPresentation {
  title?: string
  description?: string
  backgroundImage?: string
  actionLabel?: string
}

export interface ModuleManifest {
  id: ModuleId
  displayName: string
  description: string
  version: string
  icon?: string
  brandLogo?: string
  backgroundImage?: string
  executablePath?: string
  integrationKind?: 'builtin' | 'custom'
  dependencies: ModuleId[]
  capabilities: ModuleCapabilities
  stopPolicy: ModuleStopPolicy
  timeouts?: ModuleOperationTimeouts
  settingsSchema?: ModuleSettingField[]
  settingsSyncIntervalMs?: number
  actions?: ModuleActionDefinition[]
  ui?: {
    lifecycleCard?: ModuleCardPresentation
    settingsCard?: ModuleCardPresentation
  }
  actionLabels?: {
    start?: string
    stop?: string
  }
}

export interface ModuleError {
  code: string
  message: string
  recoverable: boolean
  details?: string
}

export interface ModuleSnapshot {
  moduleId: ModuleId
  installState: ModuleInstallState
  runState: ModuleRunState
  ownership: ModuleOwnership
  lastError: ModuleError | null
  updatedAt: number
}

export type ModuleSettings = Record<string, unknown>

export interface ModuleOperationResult {
  ok: boolean
  moduleId: ModuleId
  snapshot?: ModuleSnapshot
  error?: ModuleError
}

export interface ModuleBatchResult {
  ok: boolean
  results: ModuleOperationResult[]
  rolledBack: ModuleId[]
}

export interface ModuleChangedEvent {
  manifest: ModuleManifest
  snapshot: ModuleSnapshot
}

export type ModuleLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ModuleLogEntry {
  moduleId: ModuleId
  level: ModuleLogLevel
  message: string
  timestamp: number
}

export interface ModuleBridge {
  list: () => Promise<ModuleManifest[]>
  snapshots: () => Promise<ModuleSnapshot[]>
  start: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  stop: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  startProfile: (moduleIds: ModuleId[], rollbackOnFailure?: boolean) => Promise<ModuleBatchResult>
  stopProfile: (moduleIds: ModuleId[]) => Promise<ModuleBatchResult>
  readSettings: (moduleId: ModuleId) => Promise<ModuleSettings>
  applySettings: (moduleId: ModuleId, patch: ModuleSettings) => Promise<ModuleOperationResult>
  showWindow: (moduleId: ModuleId) => Promise<ModuleOperationResult>
  readActions: (moduleId: ModuleId) => Promise<ModuleActionState[]>
  invokeAction: (moduleId: ModuleId, actionId: string, active: boolean) => Promise<ModuleActionResult>
  recentLogs: (moduleId: ModuleId, limit?: number) => Promise<ModuleLogEntry[]>
  onChanged: (callback: (event: ModuleChangedEvent) => void) => () => void
  onCatalogChanged: (callback: () => void) => () => void
  onLog: (callback: (entry: ModuleLogEntry) => void) => () => void
}
