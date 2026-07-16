import assert from 'node:assert/strict'
import { createSrsDriver, parseSrsFavouriteServers } from '../electron/integrations/srs/driver'

async function main() {
  assert.deepEqual(parseSrsFavouriteServers([
    'Training,127.0.0.1:5002,True,',
    'Public,example.org:5002,False,',
    'Duplicate,EXAMPLE.ORG:5002,False,',
    'invalid',
  ].join('\n')), [
    { name: 'Training', address: '127.0.0.1:5002' },
    { name: 'Public', address: 'example.org:5002' },
    { name: 'Duplicate', address: 'EXAMPLE.ORG:5002' },
  ])

  const driver = createSrsDriver()
  assert.equal(driver.manifest.id, 'srs')
  assert.equal(driver.manifest.capabilities.settings, true)
  assert.deepEqual(driver.manifest.actions?.map((action) => action.id), ['server-connection', 'awacs-overlay'])
  const settings = await driver.readSettings?.()
  assert.equal(typeof settings?.server, 'string')

  const health = await driver.discover()
  if (health.installState === 'installed' && health.runState === 'running') {
    const actions = await driver.readActions?.()
    assert.deepEqual(actions?.map((action) => action.actionId), ['server-connection', 'awacs-overlay'])
  }
  if (process.env.DCSHUB_SRS_LIVE_TEST === '1' && health.installState === 'installed') {
    const wasRunning = health.runState === 'running'
    console.log('srs live: start')
    if (!wasRunning) await driver.start?.()
    console.log('srs live: read actions')
    const before = await driver.readActions?.()
    const originalAwacsState = before?.find((action) => action.actionId === 'awacs-overlay')?.active ?? false
    console.log(`srs live: toggle awacs ${!originalAwacsState}`)
    assert.equal(await driver.invokeAction?.('awacs-overlay', !originalAwacsState), !originalAwacsState)
    console.log(`srs live: restore awacs ${originalAwacsState}`)
    assert.equal(await driver.invokeAction?.('awacs-overlay', originalAwacsState), originalAwacsState)
    console.log('srs live: stop')
    if (!wasRunning) await driver.stop?.()
    console.log('srs live: complete')
  }
  await driver.dispose?.()
  console.log('srs integration: ok')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
