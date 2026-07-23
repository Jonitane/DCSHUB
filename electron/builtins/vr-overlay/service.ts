import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { OverlayDisplayMode, VrOverlayStatus } from '../../../src/shared/window-contracts'

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Khronos\\OpenXR\\1\\ApiLayers\\Implicit',
  'HKCU\\SOFTWARE\\Khronos\\OpenXR\\1\\ApiLayers\\Implicit',
] as const
const DCSHUB_REGISTRY_KEY = 'HKCU\\SOFTWARE\\DCSHUB'
const OPENXR_LOG_DIRECTORY_VALUE = 'OpenXrLogDirectory'
const LAYER_NAME = 'XR_APILAYER_DCSHUB_manual_overlay'
const PACKET_MAGIC = 0x4D415246
const HEADER_SIZE = 48
const VOXBIND_TEXEL_RADIANS = 0.001
const VOXBIND_RENDER_SCALE = 2
const VOXBIND_DISTANCE_METERS = 1
const MAX_ORBIT_YAW_RADIANS = 65 * Math.PI / 180
const MAX_ORBIT_PITCH_RADIANS = 35 * Math.PI / 180
const ORBIT_YAW_PER_NORMALIZED_DRAG = MAX_ORBIT_YAW_RADIANS * 2
const ORBIT_PITCH_PER_NORMALIZED_DRAG = MAX_ORBIT_PITCH_RADIANS * 2

export function applyOrbitDrag(
  yawRadians: number,
  pitchRadians: number,
  normalizedX: number,
  normalizedY: number,
): { yawRadians: number; pitchRadians: number } {
  return {
    yawRadians: Math.max(-MAX_ORBIT_YAW_RADIANS, Math.min(MAX_ORBIT_YAW_RADIANS, yawRadians + normalizedX * ORBIT_YAW_PER_NORMALIZED_DRAG)),
    pitchRadians: Math.max(-MAX_ORBIT_PITCH_RADIANS, Math.min(MAX_ORBIT_PITCH_RADIANS, pitchRadians + normalizedY * ORBIT_PITCH_PER_NORMALIZED_DRAG)),
  }
}

type CommandRunner = (file: string, args: string[]) => void

function defaultCommandRunner(file: string, args: string[]): void {
  execFileSync(file, args, { windowsHide: true, stdio: 'ignore' })
}

export function createLayerManifest(layerPath: string): string {
  return `${JSON.stringify({
    file_format_version: '1.0.0',
    api_layer: {
      name: LAYER_NAME,
      library_path: path.resolve(layerPath).replace(/\\/g, '/'),
      api_version: '1.0',
      implementation_version: '4',
      description: 'DCSHUB Super Manual OpenXR overlay',
      functions: { xrNegotiateLoaderApiLayerInterface: 'xrNegotiateLoaderApiLayerInterface' },
      disable_environment: 'DISABLE_DCSHUB_MANUAL_OVERLAY',
    },
  }, null, 2)}\n`
}

export function createFramePacket(
  pixels: Buffer,
  width: number,
  height: number,
  active: boolean,
  widthMeters = 1.2,
  heightMeters = 0.8,
  distanceMeters = VOXBIND_DISTANCE_METERS,
  orbitYawRadians = 0,
  orbitPitchRadians = 0,
  recenterSequence = 0,
): Buffer {
  const stride = width * 4
  const dataSize = active ? pixels.length : 0
  if (active && (width <= 0 || height <= 0 || dataSize !== stride * height)) throw new Error('Invalid VR overlay frame')
  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt32LE(PACKET_MAGIC, 0)
  header.writeUInt32LE(active ? width : 0, 4)
  header.writeUInt32LE(active ? height : 0, 8)
  header.writeUInt32LE(active ? stride : 0, 12)
  header.writeUInt32LE(dataSize, 16)
  header.writeUInt32LE(active ? 1 : 0, 20)
  header.writeFloatLE(widthMeters, 24)
  header.writeFloatLE(heightMeters, 28)
  header.writeFloatLE(distanceMeters, 32)
  header.writeFloatLE(orbitYawRadians, 36)
  header.writeFloatLE(orbitPitchRadians, 40)
  header.writeUInt32LE(recenterSequence, 44)
  return dataSize > 0 ? Buffer.concat([header, pixels]) : header
}

export class VrOverlayService {
  private readonly manifestPath: string
  private readonly layerPath: string
  private readonly bridgePath: string
  private bridge: ChildProcessWithoutNullStreams | null = null
  private framesActive = false
  private mode: OverlayDisplayMode = 'desktop'
  private lastError: string | null = null
  private orbitYawRadians = 0
  private orbitPitchRadians = 0
  private recenterSequence = 0

  constructor(
    resourcesDirectory: string,
    private readonly runCommand: CommandRunner = defaultCommandRunner,
    private readonly spawnBridge: typeof spawn = spawn,
    manifestDirectory: string = resourcesDirectory,
    private readonly logDirectory?: string,
  ) {
    this.layerPath = path.join(resourcesDirectory, 'DcsHubOpenXrLayer.dll')
    this.bridgePath = path.join(resourcesDirectory, 'DcsHubVrBridge.exe')
    this.manifestPath = path.join(manifestDirectory, 'DCSHUBManualOverlayLayer.json')
    if (path.resolve(manifestDirectory) !== path.resolve(resourcesDirectory)) this.writeManifest()
  }

  cleanupStaleRegistration(): void {
    try { this.setLayerRegistration(false) } catch { /* Best-effort cleanup for an interrupted previous run. */ }
  }

  status(): VrOverlayStatus {
    return {
      mode: this.mode,
      available: [this.manifestPath, this.layerPath, this.bridgePath].every((candidate) => fs.existsSync(candidate)),
      bridgeRunning: Boolean(this.bridge && this.bridge.exitCode === null),
      error: this.lastError,
    }
  }

  setDisplayMode(mode: OverlayDisplayMode): VrOverlayStatus {
    this.mode = mode
    this.lastError = null
    if (mode === 'vr') {
      try {
        this.assertAvailable()
        this.configureNativeLogDirectory()
        this.setLayerRegistration(true)
        this.ensureBridge()
      } catch (reason) {
        this.lastError = reason instanceof Error ? reason.message : String(reason)
      }
    } else {
      this.publishInactive()
      this.stopBridge()
      this.setLayerRegistration(false)
    }
    return this.status()
  }

  publishFrame(pixels: Buffer, width: number, height: number): boolean {
    if (this.mode !== 'vr' || !this.framesActive) return false
    this.ensureBridge()
    if (!this.bridge?.stdin.writable || this.bridge.stdin.writableNeedDrain) return false
    return this.bridge.stdin.write(createFramePacket(
      pixels,
      width,
      height,
      true,
      Math.min(2, Math.max(0.3, width * VOXBIND_TEXEL_RADIANS / VOXBIND_RENDER_SCALE)),
      Math.min(1.5, Math.max(0.3, height * VOXBIND_TEXEL_RADIANS / VOXBIND_RENDER_SCALE)),
      VOXBIND_DISTANCE_METERS,
      this.orbitYawRadians,
      this.orbitPitchRadians,
      this.recenterSequence,
    ))
  }

  beginFrames(): void {
    if (this.mode !== 'vr') return
    this.framesActive = true
    this.ensureBridge()
  }

  moveBy(normalizedX: number, normalizedY: number): void {
    const next = applyOrbitDrag(this.orbitYawRadians, this.orbitPitchRadians, normalizedX, normalizedY)
    this.orbitYawRadians = next.yawRadians
    this.orbitPitchRadians = next.pitchRadians
  }

  requestRecenter(): void {
    this.orbitYawRadians = 0
    this.orbitPitchRadians = 0
    this.recenterSequence = (this.recenterSequence + 1) >>> 0
  }

  publishInactive(): void {
    this.framesActive = false
    if (!this.bridge?.stdin.writable) return
    try {
      this.bridge.stdin.write(createFramePacket(
        Buffer.alloc(0), 0, 0, false, 1.2, 0.8, VOXBIND_DISTANCE_METERS,
        this.orbitYawRadians, this.orbitPitchRadians, this.recenterSequence,
      ))
    } catch { /* bridge is already stopping */ }
  }

  dispose(): void {
    this.publishInactive()
    this.stopBridge()
    try { this.setLayerRegistration(false) } catch { /* best-effort registry cleanup */ }
  }

  private assertAvailable(): void {
    const missing = [this.manifestPath, this.layerPath, this.bridgePath].filter((candidate) => !fs.existsSync(candidate))
    if (missing.length > 0) throw new Error(`VR overlay components are missing: ${missing.map((candidate) => path.basename(candidate)).join(', ')}`)
  }

  private writeManifest(): void {
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true })
    fs.writeFileSync(this.manifestPath, createLayerManifest(this.layerPath), 'utf8')
  }

  private ensureBridge(): void {
    if (this.bridge && this.bridge.exitCode === null) return
    this.assertAvailable()
    const child = this.spawnBridge(this.bridgePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.bridge = child
    child.stderr.on('data', (chunk) => { this.lastError = chunk.toString('utf8').trim() || this.lastError })
    child.once('error', (reason) => {
      this.lastError = reason.message
      if (this.bridge === child) this.bridge = null
    })
    child.once('exit', (code) => {
      if (code && code !== 0) this.lastError = `VR overlay bridge exited with code ${code}`
      if (this.bridge === child) this.bridge = null
    })
  }

  private stopBridge(): void {
    const child = this.bridge
    this.bridge = null
    if (!child || child.exitCode !== null) return
    try { child.stdin.end() } catch { /* ignore */ }
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill() } catch { /* ignore */ }
      }
    }, 1_000)
    timer.unref()
  }

  private setLayerRegistration(enabled: boolean): void {
    if (process.platform !== 'win32') return
    const setValue = (registryKey: string, value: '0' | '1') => this.runCommand('reg.exe', [
      'add', registryKey,
      '/v', this.manifestPath,
      '/t', 'REG_DWORD',
      '/d', value,
      '/f',
    ])
    if (enabled) {
      try {
        setValue(REGISTRY_KEYS[0], '0')
        try { setValue(REGISTRY_KEYS[1], '1') } catch { /* HKLM is authoritative when elevated. */ }
        return
      } catch (machineError) {
        try {
          setValue(REGISTRY_KEYS[1], '0')
          return
        } catch {
          throw machineError
        }
      }
    }
    let firstError: unknown = null
    let cleaned = false
    for (const registryKey of REGISTRY_KEYS) {
      try {
        this.runCommand('reg.exe', ['delete', registryKey, '/v', this.manifestPath, '/f'])
        cleaned = true
      } catch (reason) {
        firstError ||= reason
        try {
          setValue(registryKey, '1')
          cleaned = true
        } catch { /* Continue so the per-user registration still has a chance to be disabled. */ }
      }
    }
    if (!cleaned && firstError) throw firstError
  }

  private configureNativeLogDirectory(): void {
    if (process.platform !== 'win32' || !this.logDirectory) return
    this.runCommand('reg.exe', [
      'add', DCSHUB_REGISTRY_KEY,
      '/v', OPENXR_LOG_DIRECTORY_VALUE,
      '/t', 'REG_SZ',
      '/d', path.resolve(this.logDirectory),
      '/f',
    ])
  }
}
