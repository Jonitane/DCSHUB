export const CORE_PROTOCOL_VERSION = 1

export type CoreRuntimeKind = 'electron-fallback' | 'dotnet-native'

export type CoreServiceId =
  | 'modules'
  | 'software-catalog'
  | 'mod-manager'
  | 'manual-library'
  | 'dcs-launch'
  | 'dcs-telemetry'
  | 'dcs-command'
  | 'speech-recognition'
  | 'vr-overlay'
  | 'updates'
  | 'windows-process-monitor'
  | 'elevated-broker'

export type CoreServiceState = 'ready' | 'planned' | 'disabled' | 'degraded'

export interface CoreServiceStatus {
  id: CoreServiceId
  state: CoreServiceState
  version: number
  detail?: string
}

export interface CoreStatus {
  protocolVersion: number
  runtime: CoreRuntimeKind
  startedAt: string | null
  services: CoreServiceStatus[]
}

export type DcsConnectionState = 'not-running' | 'starting' | 'connected' | 'degraded'

export interface DcsTelemetrySnapshot {
  connection: DcsConnectionState
  aircraft: string | null
  mission: string | null
  timestamp: number
  values: Record<string, boolean | number | string | null>
}

export interface DcsCommandRequest {
  requestId: string
  aircraft: string | null
  action: string
  parameters: Record<string, boolean | number | string | null>
  source: 'ui' | 'voice' | 'preset' | 'plugin'
  requiresConfirmation: boolean
}

export interface DcsCommandResult {
  requestId: string
  ok: boolean
  verified: boolean
  message: string
  errorCode?: string
}

export interface VoiceIntent {
  transcript: string
  locale: string
  confidence: number
  action: string | null
  parameters: Record<string, boolean | number | string | null>
  requiresConfirmation: boolean
}
