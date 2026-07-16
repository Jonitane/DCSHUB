import type {
  ModuleInstallState,
  ModuleActionState,
  ModuleLogEntry,
  ModuleManifest,
  ModuleRunState,
  ModuleSettings,
} from '../../src/shared/module-contracts'

export interface ModuleHealth {
  installState: ModuleInstallState
  runState: Extract<ModuleRunState, 'stopped' | 'running' | 'degraded' | 'failed'>
  details?: string
}

export interface ModuleDriver {
  readonly manifest: ModuleManifest
  discover(signal?: AbortSignal): Promise<ModuleHealth>
  start?(signal?: AbortSignal): Promise<void>
  stop?(signal?: AbortSignal): Promise<void>
  readSettings?(signal?: AbortSignal): Promise<ModuleSettings>
  applySettings?(patch: ModuleSettings, signal?: AbortSignal): Promise<void>
  showWindow?(signal?: AbortSignal): Promise<void>
  readActions?(signal?: AbortSignal): Promise<ModuleActionState[]>
  invokeAction?(actionId: string, active: boolean, signal?: AbortSignal): Promise<boolean>
  subscribeLogs?(listener: (entry: ModuleLogEntry) => void): () => void
  dispose?(): Promise<void> | void
}
