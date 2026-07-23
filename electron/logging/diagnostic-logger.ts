import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_ARCHIVES = 5

function redactString(value: string): string {
  const home = os.homedir()
  return value
    .replaceAll(home, '%USERPROFILE%')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|password|passwd|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 16_384)
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]'
  if (value instanceof Error) return { name: value.name, message: redactString(value.message), stack: redactString(value.stack || '') }
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => (
      [key, /api.?key|password|passwd|token|secret|authorization/i.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)]
    )))
  }
  return redactString(String(value))
}

export class DiagnosticLogger {
  readonly directory: string
  private readonly filePath: string
  private readonly crashFilePath: string
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.directory = directory
    this.filePath = path.join(directory, 'dcshub.log')
    this.crashFilePath = path.join(directory, 'dcshub-crash.log')
  }

  debug(scope: string, event: string, detail?: unknown): void { this.write('debug', scope, event, detail) }
  info(scope: string, event: string, detail?: unknown): void { this.write('info', scope, event, detail) }
  warn(scope: string, event: string, error?: unknown, detail?: unknown): void { this.write('warn', scope, event, { error, detail }) }
  error(scope: string, event: string, error?: unknown, detail?: unknown): void { this.write('error', scope, event, { error, detail }) }

  emergency(scope: string, event: string, error?: unknown, detail?: unknown): void {
    const line = this.formatLine('error', scope, event, { error, detail })
    try {
      fs.mkdirSync(this.directory, { recursive: true })
      fs.appendFileSync(this.crashFilePath, line, 'utf8')
    } catch (writeError) {
      console.warn('[DCSHUB/logging] failed to write emergency diagnostic log', writeError)
    }
  }

  async flush(): Promise<void> {
    await this.queue
  }

  private write(level: LogLevel, scope: string, event: string, detail?: unknown): void {
    const line = this.formatLine(level, scope, event, detail)
    this.queue = this.queue.then(async () => {
      await fs.promises.mkdir(this.directory, { recursive: true })
      await this.rotateIfNeeded(Buffer.byteLength(line))
      await fs.promises.appendFile(this.filePath, line, 'utf8')
    }).catch((error) => console.warn('[DCSHUB/logging] failed to write diagnostic log', error))
  }

  private formatLine(level: LogLevel, scope: string, event: string, detail?: unknown): string {
    return `${JSON.stringify({ time: new Date().toISOString(), level, scope, event, detail: sanitize(detail) })}\n`
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    const size = await fs.promises.stat(this.filePath).then((stat) => stat.size).catch(() => 0)
    if (size + incomingBytes <= MAX_LOG_BYTES) return
    await fs.promises.rm(`${this.filePath}.${MAX_ARCHIVES}`, { force: true })
    for (let index = MAX_ARCHIVES - 1; index >= 1; index -= 1) {
      await fs.promises.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`).catch(() => undefined)
    }
    await fs.promises.rename(this.filePath, `${this.filePath}.1`).catch(() => undefined)
  }
}
