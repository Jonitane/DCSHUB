import { EventEmitter } from 'node:events'
import type { ManualLibraryProgress } from '../../src/shared/manual-library-contracts'
import type { CoreStatus, DcsTelemetrySnapshot, VoiceIntent } from '../../src/shared/core-contracts'

export interface CoreEventMap {
  ready: CoreStatus
  stopping: undefined
  'dcs-process-changed': boolean
  'dcs-telemetry': DcsTelemetrySnapshot
  'manual-progress': ManualLibraryProgress
  'voice-intent': VoiceIntent
}

export class CoreEventBus {
  private readonly emitter = new EventEmitter()

  on<K extends keyof CoreEventMap>(event: K, listener: (payload: CoreEventMap[K]) => void): () => void {
    this.emitter.on(event, listener)
    return () => this.emitter.off(event, listener)
  }

  emit<K extends keyof CoreEventMap>(event: K, payload: CoreEventMap[K]): void {
    this.emitter.emit(event, payload)
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners()
  }
}
