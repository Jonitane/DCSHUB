import assert from 'node:assert/strict'
import { CORE_PROTOCOL_VERSION } from '../src/shared/core-contracts'
import { CoreEventBus } from '../electron/core/event-bus'
import { buildCoreStatus } from '../electron/core/status'

const stopped = buildCoreStatus(false, null)
assert.equal(stopped.protocolVersion, CORE_PROTOCOL_VERSION)
assert.equal(stopped.runtime, 'electron-fallback')
assert.equal(stopped.services.find((service) => service.id === 'modules')?.state, 'disabled')
assert.equal(stopped.services.find((service) => service.id === 'speech-recognition')?.state, 'disabled')
assert.equal(new Set(stopped.services.map((service) => service.id)).size, stopped.services.length)

const startedAt = new Date().toISOString()
const ready = buildCoreStatus(true, startedAt)
assert.equal(ready.startedAt, startedAt)
assert.equal(ready.services.find((service) => service.id === 'manual-library')?.state, 'ready')
assert.equal(ready.services.find((service) => service.id === 'dcs-command')?.state, 'planned')

const native = buildCoreStatus(true, startedAt, true)
assert.equal(native.runtime, 'dotnet-native')
assert.equal(native.services.find((service) => service.id === 'windows-process-monitor')?.state, 'ready')
assert.equal(native.services.find((service) => service.id === 'speech-recognition')?.state, 'ready')

const bus = new CoreEventBus()
const values: boolean[] = []
const unsubscribe = bus.on('dcs-process-changed', (running) => values.push(running))
bus.emit('dcs-process-changed', true)
unsubscribe()
bus.emit('dcs-process-changed', false)
assert.deepEqual(values, [true])

console.log('core architecture integration tests passed')
