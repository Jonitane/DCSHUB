import fs from 'node:fs'
import path from 'node:path'
import type { MajorUpdateInfo, UpdateCheckResult, UpdateSettings } from '../../../src/shared/update-contracts'

const RELEASES_URL = 'https://api.github.com/repos/Jonitane/DCSHUB/releases?per_page=30'
const PUSH_MARKER = '<!-- dcshub-push-update -->'
const CHECK_CACHE_MS = 5 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 8_000

interface Version {
  major: number
  minor: number
  patch: number
}

interface GitHubRelease {
  tag: string
  title: string
  body: string
  url: string
  publishedAt: string | null
  version: Version
  pushEnabled: boolean
}

function parseVersion(value: string): Version | null {
  const match = value.trim().match(/^[vV]?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

function isRelease(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseRelease(value: unknown): GitHubRelease | null {
  if (!isRelease(value) || value.draft === true || value.prerelease === true) return null
  const tag = typeof value.tag_name === 'string' ? value.tag_name.trim() : ''
  const version = parseVersion(tag)
  const url = typeof value.html_url === 'string' ? value.html_url : ''
  if (!version || !/^https:\/\/github\.com\/Jonitane\/DCSHUB\/releases\/tag\//i.test(url)) return null
  return {
    tag,
    title: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `DCSHUB ${tag}`,
    body: typeof value.body === 'string' ? value.body.replaceAll(PUSH_MARKER, '').trim() : '',
    url,
    publishedAt: typeof value.published_at === 'string' ? value.published_at : null,
    version,
    pushEnabled: typeof value.body === 'string' && value.body.includes(PUSH_MARKER),
  }
}

export class UpdateService {
  private readonly settingsPath: string
  private settingsValue: UpdateSettings
  private cachedResult: UpdateCheckResult | null = null
  private cachedAt = 0
  private inFlight: Promise<UpdateCheckResult> | null = null

  constructor(
    userDataPath: string,
    private readonly currentVersion: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.settingsPath = path.join(userDataPath, 'update-settings.json')
    this.settingsValue = this.loadSettings()
  }

  settings(): UpdateSettings {
    return { ...this.settingsValue }
  }

  setAutomaticChecks(enabled: boolean): UpdateSettings {
    this.settingsValue = { automaticChecks: enabled }
    this.saveSettings()
    if (!enabled) {
      this.cachedResult = null
      this.cachedAt = 0
    }
    return this.settings()
  }

  check(force = false): Promise<UpdateCheckResult> {
    if (!this.settingsValue.automaticChecks && !force) return Promise.resolve({ status: 'disabled', update: null })
    if (!force && this.cachedResult && Date.now() - this.cachedAt < CHECK_CACHE_MS) return Promise.resolve(this.cachedResult)
    if (this.inFlight) return this.inFlight
    this.inFlight = this.fetchUpdate().then((result) => {
      this.cachedResult = result
      this.cachedAt = Date.now()
      return result
    }).finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async fetchUpdate(): Promise<UpdateCheckResult> {
    const current = parseVersion(this.currentVersion)
    if (!current) throw new Error(`无法识别当前版本：${this.currentVersion}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `DCSHUB/${this.currentVersion}` },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`GitHub 更新服务返回 HTTP ${response.status}`)
      const payload = await response.json() as unknown
      if (!Array.isArray(payload)) throw new Error('GitHub 更新服务返回了无效数据')
      const releases = payload.map(parseRelease).filter((release): release is GitHubRelease => Boolean(release))
        .sort((left, right) => compareVersions(right.version, left.version))
      const latest = releases[0]
      if (!latest || compareVersions(latest.version, current) <= 0) return { status: 'no-push-update', update: null }
      const announcement = releases.find((release) => release.pushEnabled && compareVersions(release.version, current) > 0)
      if (!announcement) return { status: 'no-push-update', update: null }
      const update: MajorUpdateInfo = {
        currentVersion: this.currentVersion,
        latestVersion: announcement.tag,
        title: announcement.title,
        releaseNotes: announcement.body || '该版本已由发布者标记为建议更新版本。',
        publishedAt: announcement.publishedAt,
        downloadUrl: announcement.url,
      }
      return { status: 'available', update }
    } finally {
      clearTimeout(timeout)
    }
  }

  private loadSettings(): UpdateSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<UpdateSettings>
      return { automaticChecks: typeof parsed.automaticChecks === 'boolean' ? parsed.automaticChecks : true }
    } catch {
      return { automaticChecks: true }
    }
  }

  private saveSettings(): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(this.settingsValue, null, 2), 'utf8')
    fs.renameSync(temporaryPath, this.settingsPath)
  }
}
