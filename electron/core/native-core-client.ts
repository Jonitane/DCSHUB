import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import type { CoreStatus } from '../../src/shared/core-contracts'

export interface NativeDcsProcessStatus {
  running: boolean
  processId: number | null
  checkedAt: string
}

export interface NativeSpeechDevice {
  id: string
  name: string
  isDefault: boolean
}

export interface NativeSpeechResult {
  text: string
  audioDurationMs: number
  recognitionMs: number
}

interface NativeCoreErrorPayload {
  code: string
  message: string
  recoverable: boolean
}

interface NativeCoreResponse {
  kind: 'response'
  id: string
  ok: boolean
  result?: unknown
  error?: NativeCoreErrorPayload
}

interface NativeCoreEvent {
  kind: 'event'
  event: string
  payload?: unknown
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface NativeCoreClientOptions {
  executablePath: string
  logDirectory: string
  connectTimeoutMs?: number
  requestTimeoutMs?: number
}

export class NativeCoreClient extends EventEmitter {
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private socket: net.Socket | null = null
  private child: ChildProcess | null = null
  private buffer = ''
  private readonly pending = new Map<string, PendingRequest>()
  private stopping = false
  private connected = false
  private disconnectEmitted = false
  private token = ''
  private statusSnapshot: CoreStatus | null = null
  private dcsSnapshot: NativeDcsProcessStatus = { running: false, processId: null, checkedAt: new Date(0).toISOString() }

  constructor(private readonly options: NativeCoreClientOptions) {
    super()
    this.connectTimeoutMs = Math.max(1_000, options.connectTimeoutMs ?? 8_000)
    this.requestTimeoutMs = Math.max(500, options.requestTimeoutMs ?? 4_000)
  }

  get isConnected(): boolean {
    return this.connected
  }

  get status(): CoreStatus | null {
    return this.statusSnapshot
  }

  get currentDcsStatus(): NativeDcsProcessStatus {
    return { ...this.dcsSnapshot }
  }

  async start(): Promise<CoreStatus> {
    if (this.connected && this.statusSnapshot) return this.statusSnapshot
    await this.cleanup(true)
    this.stopping = false
    this.disconnectEmitted = false
    this.token = randomBytes(32).toString('hex')
    const pipeName = `dcshub-core-${process.pid}-${randomBytes(8).toString('hex')}`
    this.child = spawn(this.options.executablePath, [
      '--pipe', pipeName,
      '--token', this.token,
      '--parent-pid', String(process.pid),
      '--log-dir', this.options.logDirectory,
    ], {
      windowsHide: true,
      stdio: 'ignore',
    })
    this.child.once('exit', () => this.handleDisconnect(new Error('DCSHUB Core exited')))
    this.child.once('error', (error) => this.handleDisconnect(error))
    try {
      this.socket = await this.connectPipe(`\\\\.\\pipe\\${pipeName}`)
      this.socket.setEncoding('utf8')
      this.socket.on('data', (chunk: string) => this.handleData(chunk))
      this.socket.once('close', () => this.handleDisconnect(new Error('DCSHUB Core pipe disconnected')))
      this.socket.once('error', (error) => this.handleDisconnect(error))
      this.connected = true
      const status = await this.request<CoreStatus>('system.handshake', {
        protocolVersion: 1,
        parentPid: process.pid,
      }, this.token)
      if (status.protocolVersion !== 1 || status.runtime !== 'dotnet-native') {
        throw new Error(`Unsupported DCSHUB Core protocol: ${status.protocolVersion}/${status.runtime}`)
      }
      this.statusSnapshot = status
      this.dcsSnapshot = await this.request<NativeDcsProcessStatus>('dcs.process.status')
      return status
    } catch (error) {
      await this.cleanup(true)
      throw error
    }
  }

  async refreshDcsStatus(): Promise<NativeDcsProcessStatus> {
    const status = await this.request<NativeDcsProcessStatus>('dcs.process.status')
    this.dcsSnapshot = status
    return { ...status }
  }

  async ping(): Promise<void> {
    await this.request('system.ping')
  }

  async speechDevices(): Promise<NativeSpeechDevice[]> {
    return await this.request<NativeSpeechDevice[]>('speech.devices')
  }

  async startSpeech(deviceId: string | null): Promise<void> {
    await this.request('speech.start', { deviceId })
  }

  async stopSpeech(modelDirectory: string): Promise<NativeSpeechResult> {
    return await this.request<NativeSpeechResult>('speech.stop', { modelDirectory }, undefined, 120_000)
  }

  async cancelSpeech(): Promise<void> {
    await this.request('speech.cancel')
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (this.connected) {
      try { await this.request('system.shutdown', undefined, undefined, 2_000) }
      catch { /* The parent watcher still guarantees eventual cleanup. */ }
    }
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        timer.unref()
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    await this.cleanup(!!child && child.exitCode === null)
  }

  private async request<T = unknown>(method: string, params?: unknown, token?: string, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (!this.socket || !this.connected || this.socket.destroyed) throw new Error('DCSHUB Core is not connected')
    const id = randomUUID()
    const payload = JSON.stringify({ kind: 'request', id, method, token, params }) + '\n'
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`DCSHUB Core request timed out: ${method}`))
      }, timeoutMs)
      timer.unref()
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.socket?.write(payload, 'utf8', (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  private connectPipe(pipePath: string): Promise<net.Socket> {
    const deadline = Date.now() + this.connectTimeoutMs
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out connecting to DCSHUB Core: ${pipePath}`))
          return
        }
        if (this.child?.exitCode !== null) {
          reject(new Error(`DCSHUB Core exited before connecting: ${this.child?.exitCode}`))
          return
        }
        const socket = net.createConnection(pipePath)
        socket.once('connect', () => resolve(socket))
        socket.once('error', () => {
          socket.destroy()
          const timer = setTimeout(attempt, 80)
          timer.unref()
        })
      }
      attempt()
    })
  }

  private handleData(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 2 * 1024 * 1024) {
      this.handleDisconnect(new Error('DCSHUB Core message buffer exceeded the safety limit'))
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleMessage(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(line: string): void {
    let message: NativeCoreResponse | NativeCoreEvent
    try { message = JSON.parse(line) as NativeCoreResponse | NativeCoreEvent }
    catch { return }
    if (message.kind === 'response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(`${message.error?.code || 'CORE_ERROR'}: ${message.error?.message || 'Unknown core error'}`))
      return
    }
    if (message.kind === 'event' && message.event === 'dcs-process-changed') {
      const status = message.payload as NativeDcsProcessStatus
      if (typeof status?.running !== 'boolean') return
      this.dcsSnapshot = status
      this.emit('dcs-process-changed', { ...status })
    }
  }

  private handleDisconnect(error: Error): void {
    const wasConnected = this.connected
    this.connected = false
    this.statusSnapshot = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    if (!this.stopping && wasConnected && !this.disconnectEmitted) {
      this.disconnectEmitted = true
      this.emit('disconnected', error)
    }
  }

  private async cleanup(terminateChild: boolean): Promise<void> {
    this.connected = false
    this.socket?.removeAllListeners()
    this.socket?.destroy()
    this.socket = null
    this.buffer = ''
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('DCSHUB Core stopped'))
    }
    this.pending.clear()
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    if (terminateChild) child.kill()
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      const timer = setTimeout(resolve, 2_000)
      timer.unref()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
