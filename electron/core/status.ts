import {
  CORE_PROTOCOL_VERSION,
  type CoreServiceStatus,
  type CoreStatus,
} from '../../src/shared/core-contracts'

const ACTIVE_SERVICES: CoreServiceStatus['id'][] = [
  'modules',
  'software-catalog',
  'mod-manager',
  'manual-library',
  'dcs-launch',
  'vr-overlay',
  'updates',
]

const PLANNED_SERVICES: CoreServiceStatus['id'][] = [
  'dcs-telemetry',
  'dcs-command',
  'elevated-broker',
]

export function buildCoreStatus(initialized: boolean, startedAt: string | null, nativeCoreReady = false): CoreStatus {
  const activeState: CoreServiceStatus['state'] = initialized ? 'ready' : 'disabled'
  return {
    protocolVersion: CORE_PROTOCOL_VERSION,
    runtime: nativeCoreReady ? 'dotnet-native' : 'electron-fallback',
    startedAt,
    services: [
      ...ACTIVE_SERVICES.map((id): CoreServiceStatus => ({ id, state: activeState, version: 1 })),
      { id: 'windows-process-monitor', state: initialized ? 'ready' : 'disabled', version: 1 },
      { id: 'speech-recognition', state: nativeCoreReady ? 'ready' : 'disabled', version: 1 },
      ...PLANNED_SERVICES.map((id): CoreServiceStatus => ({ id, state: 'planned', version: 1 })),
    ],
  }
}
