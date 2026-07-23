import { spawn, type ChildProcess } from 'node:child_process'

export interface DcsProcessMonitorOptions {
  intervalMs?: number
  timeoutMs?: number
  onChanged?: (running: boolean) => void
  onError?: (error: Error) => void
}

/**
 * Non-blocking DCS process monitor.
 *
 * tasklist.exe is a native Windows utility and is invoked asynchronously. The
 * in-flight promise prevents overlapping probes on slow systems, so Electron's
 * main thread is never blocked by process detection.
 */
export class DcsProcessMonitor {
  private readonly intervalMs: number
  private readonly timeoutMs: number
  private readonly onChanged?: (running: boolean) => void
  private readonly onError?: (error: Error) => void
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<boolean> | null = null
  private child: ChildProcess | null = null
  private running = false
  private consecutiveErrors = 0

  constructor(options: DcsProcessMonitorOptions = {}) {
    this.intervalMs = Math.max(1_000, options.intervalMs ?? 5_000)
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 2_000)
    this.onChanged = options.onChanged
    this.onError = options.onError
  }

  current(): boolean {
    return this.running
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.child?.kill()
    this.child = null
    this.inFlight = null
  }

  refresh(): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.probe()
      .then((running) => {
        this.consecutiveErrors = 0
        if (running !== this.running) {
          this.running = running
          this.onChanged?.(running)
        }
        return running
      })
      .catch((reason: unknown) => {
        this.consecutiveErrors += 1
        // Process detection is best effort, but repeated failures are useful
        // diagnostics. Rate-limit them to avoid a log line every poll.
        if (this.consecutiveErrors === 1 || this.consecutiveErrors % 12 === 0) {
          this.onError?.(reason instanceof Error ? reason : new Error(String(reason)))
        }
        return this.running
      })
      .finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private probe(): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(false)
    return new Promise<boolean>((resolve, reject) => {
      const child = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq DCS.exe', '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.child = child
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`DCS process probe timed out after ${this.timeoutMs} ms`))
      }, this.timeoutMs)
      timeout.unref()
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { stdout += chunk })
      child.stderr?.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', (error) => {
        clearTimeout(timeout)
        if (this.child === child) this.child = null
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        if (this.child === child) this.child = null
        if (code !== 0) {
          reject(new Error(`tasklist exited with ${code}: ${stderr.trim()}`))
          return
        }
        resolve(/"DCS\.exe"/i.test(stdout))
      })
    })
  }
}
