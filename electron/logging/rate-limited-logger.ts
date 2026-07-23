export class RateLimitedLogger {
  private readonly lastReportedAt = new Map<string, number>()

  constructor(
    private readonly namespace: string,
    private readonly intervalMs = 30_000,
    private readonly sink?: (key: string, message: string, error?: unknown, detail?: Record<string, unknown>) => void,
  ) {}

  warn(key: string, message: string, error?: unknown, detail?: Record<string, unknown>): void {
    const now = Date.now()
    if (now - (this.lastReportedAt.get(key) || 0) < this.intervalMs) return
    this.lastReportedAt.set(key, now)
    console.warn(`[${this.namespace}] ${message}`, {
      ...detail,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    })
    this.sink?.(key, message, error, detail)
  }
}
