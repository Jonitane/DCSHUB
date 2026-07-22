import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { applyOrbitDrag, createFramePacket, VrOverlayService } from '../electron/builtins/vr-overlay/service'

const pixels = Buffer.from([
  1, 2, 3, 4,
  5, 6, 7, 8,
  9, 10, 11, 12,
  13, 14, 15, 16,
])
const packet = createFramePacket(pixels, 2, 2, true, 1.5, 1.1, 0.9, 0.2, -0.1, 7)
assert.equal(packet.readUInt32LE(0), 0x4D415246)
assert.equal(packet.readUInt32LE(4), 2)
assert.equal(packet.readUInt32LE(8), 2)
assert.equal(packet.readUInt32LE(12), 8)
assert.equal(packet.readUInt32LE(16), 16)
assert.equal(packet.readUInt32LE(20), 1)
assert.equal(packet.readFloatLE(24), 1.5)
assert.ok(Math.abs(packet.readFloatLE(28) - 1.1) < 0.0001)
assert.ok(Math.abs(packet.readFloatLE(32) - 0.9) < 0.0001)
assert.ok(Math.abs(packet.readFloatLE(36) - 0.2) < 0.0001)
assert.ok(Math.abs(packet.readFloatLE(40) + 0.1) < 0.0001)
assert.equal(packet.readUInt32LE(44), 7)
assert.deepEqual(packet.subarray(48), pixels)

const inactive = createFramePacket(Buffer.alloc(0), 0, 0, false)
assert.equal(inactive.length, 48)
assert.equal(inactive.readUInt32LE(20), 0)

assert.throws(() => createFramePacket(Buffer.alloc(3), 1, 1, true), /Invalid VR overlay frame/)

const halfViewportOrbit = applyOrbitDrag(0, 0, 0.5, 0.5)
assert.ok(Math.abs(halfViewportOrbit.yawRadians - 65 * Math.PI / 180) < 0.000001)
assert.ok(Math.abs(halfViewportOrbit.pitchRadians - 35 * Math.PI / 180) < 0.000001)
const clampedOrbit = applyOrbitDrag(halfViewportOrbit.yawRadians, halfViewportOrbit.pitchRadians, 1, 1)
assert.equal(clampedOrbit.yawRadians, halfViewportOrbit.yawRadians)
assert.equal(clampedOrbit.pitchRadians, halfViewportOrbit.pitchRadians)
const oppositeOrbit = applyOrbitDrag(0, 0, -0.5, -0.5)
assert.equal(oppositeOrbit.yawRadians, -halfViewportOrbit.yawRadians)
assert.equal(oppositeOrbit.pitchRadians, -halfViewportOrbit.pitchRadians)

async function verifyNativeBridge(): Promise<void> {
  const resources = path.resolve('build/native/vr-overlay')
  const manifestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcshub-vr-manifest-'))
  const registryCalls: string[][] = []
  const service = new VrOverlayService(resources, (_file, args) => { registryCalls.push(args) }, undefined, manifestDirectory)
  try {
    const manifestPath = path.join(manifestDirectory, 'DCSHUBManualOverlayLayer.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { api_layer: { library_path: string; implementation_version: string; functions?: Record<string, string> } }
    assert.equal(path.resolve(manifest.api_layer.library_path), path.join(resources, 'DcsHubOpenXrLayer.dll'))
    assert.equal(manifest.api_layer.implementation_version, '3')
    assert.equal(manifest.api_layer.functions?.xrNegotiateLoaderApiLayerInterface, 'xrNegotiateLoaderApiLayerInterface')
    const enabled = service.setDisplayMode('vr')
    assert.equal(enabled.available, true)
    assert.equal(enabled.bridgeRunning, true)
    assert.equal(registryCalls.length, 2)
    assert.match(registryCalls[0]?.[1] || '', /^HKLM\\/)
    assert.equal(registryCalls[0]?.at(-2), '0')
    assert.match(registryCalls[1]?.[1] || '', /^HKCU\\/)
    assert.equal(registryCalls[1]?.at(-2), '1')
    service.beginFrames()
    assert.equal(service.publishFrame(pixels, 2, 2), true)
    service.publishInactive()
    assert.equal(service.publishFrame(pixels, 2, 2), false)
    service.beginFrames()
    assert.equal(service.publishFrame(pixels, 2, 2), true)
    await delay(100)
    execFileSync(path.join(resources, 'DcsHubVrBridge.exe'), ['--probe'], { windowsHide: true, stdio: 'ignore' })
    service.setDisplayMode('desktop')
    assert.equal(registryCalls.at(-1)?.at(-2), '1')
  } finally {
    service.dispose()
    fs.rmSync(manifestDirectory, { recursive: true, force: true })
  }
}

void verifyNativeBridge().then(() => console.log('vr-overlay integration: ok'))
