import assert from 'node:assert/strict'
import path from 'node:path'
import { NativeCoreClient } from '../electron/core/native-core-client'

async function main(): Promise<void> {
  const executablePath = path.resolve('build/native/core/DcsHub.Core.Host.exe')
  const logDirectory = path.resolve('.tmp/native-core-logs')
  const client = new NativeCoreClient({ executablePath, logDirectory, connectTimeoutMs: 8_000 })

  try {
    const status = await client.start()
    assert.equal(status.protocolVersion, 1)
    assert.equal(status.runtime, 'dotnet-native')
    assert.equal(client.isConnected, true)
    assert.equal(status.services.some((service) => service.id === 'windows-process-monitor' && service.state === 'ready'), true)
    assert.equal(status.services.some((service) => service.id === 'speech-recognition' && service.state === 'ready'), true)
    const dcs = await client.refreshDcsStatus()
    assert.equal(typeof dcs.running, 'boolean')
    assert.equal(typeof dcs.checkedAt, 'string')
    const microphones = await client.speechDevices()
    assert.equal(Array.isArray(microphones), true)
    assert.equal(microphones.every((device) => device.id.startsWith('wavein:') && device.name.length > 0), true)
    await client.ping()
  } finally {
    await client.stop()
  }

  assert.equal(client.isConnected, false)
  console.log('native core integration tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
