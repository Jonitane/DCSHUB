import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { SoftwareCatalogItem, SoftwareCatalogOverview } from '../../../src/shared/software-catalog-contracts'
import type { ModuleDriver } from '../../modules/types'
import { ModuleManager } from '../../modules/ModuleManager'
import { createCustomSoftwareDriver, type CustomSoftwareDefinition } from '../../integrations/custom-software/driver'

interface StoredCatalog {
  version: 3
  setupCompleted: boolean
  enabledBuiltinIds: string[]
  builtinExecutableOverrides: Record<string, string>
  silentLaunchById: Record<string, boolean>
  launchDelaySecondsById: Record<string, number>
  customSoftware: Array<CustomSoftwareDefinition & { enabled: boolean }>
}

export interface BuiltinSoftwareDefinition {
  id: string
  createDriver: (executableOverride?: string | null) => ModuleDriver
}

function isCorruptedMetadata(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true
  if (/\?{2,}|\uFFFD/u.test(value)) return true
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 && code !== 9 && code !== 10 && code !== 13
  })
}

function cleanMetadata(value: unknown): string {
  return typeof value === 'string' && !isCorruptedMetadata(value) ? value.trim() : ''
}

function readExecutableMetadata(executablePath: string): { displayName: string; version: string } {
  const fallback = path.basename(executablePath, path.extname(executablePath))
  try {
    const script = "$v=(Get-Item -LiteralPath $env:DCSHUB_TARGET_EXE).VersionInfo; $json=([PSCustomObject]@{Name=($v.FileDescription);Product=($v.ProductName);Version=($v.FileVersion)} | ConvertTo-Json -Compress); [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))"
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      encoding: 'ascii',
      timeout: 5_000,
      env: { ...process.env, DCSHUB_TARGET_EXE: executablePath },
    }).trim()
    const data = JSON.parse(Buffer.from(output, 'base64').toString('utf8')) as { Name?: string; Product?: string; Version?: string }
    return {
      displayName: cleanMetadata(data.Name) || cleanMetadata(data.Product) || fallback,
      version: cleanMetadata(data.Version) || 'unknown',
    }
  } catch {
    return { displayName: fallback, version: 'unknown' }
  }
}

export class SoftwareCatalogService {
  private readonly filePath: string
  private readonly builtinIds: string[]
  private readonly builtinDefinitions: Map<string, BuiltinSoftwareDefinition>
  private data: StoredCatalog

  constructor(
    userDataDirectory: string,
    private readonly moduleManager: ModuleManager,
    builtinDefinitions: BuiltinSoftwareDefinition[],
    packaged: boolean,
  ) {
    void packaged
    this.filePath = path.join(userDataDirectory, 'software-catalog.json')
    this.builtinIds = builtinDefinitions.map((definition) => definition.id)
    this.builtinDefinitions = new Map(builtinDefinitions.map((definition) => [definition.id, definition]))
    this.data = this.load()
    builtinDefinitions.forEach((definition) => {
      const driver = definition.createDriver(this.data.builtinExecutableOverrides[definition.id])
      driver.manifest.integrationKind = 'builtin'
      this.moduleManager.register(driver)
    })
    this.data.customSoftware.forEach((item) => this.moduleManager.register(createCustomSoftwareDriver(item)))
    this.moduleManager.allManifests().forEach((manifest) => {
      this.moduleManager.setSilentLaunchPreference(manifest.id, this.data.silentLaunchById[manifest.id] !== false)
    })
    this.moduleManager.configureEnabled([
      ...this.data.enabledBuiltinIds,
      ...this.data.customSoftware.filter((item) => item.enabled).map((item) => item.id),
    ])
    this.persist()
  }

  overview(): SoftwareCatalogOverview {
    const snapshots = new Map(this.moduleManager.allSnapshots().map((snapshot) => [snapshot.moduleId, snapshot]))
    const items: SoftwareCatalogItem[] = this.moduleManager.allManifests().map((manifest) => ({
      id: manifest.id,
      displayName: manifest.displayName,
      kind: manifest.integrationKind === 'custom' ? 'custom' : 'builtin',
      enabled: this.moduleManager.isModuleEnabled(manifest.id),
      silentLaunch: this.data.silentLaunchById[manifest.id] !== false,
      launchDelaySeconds: this.data.launchDelaySecondsById[manifest.id] || 0,
      removable: manifest.integrationKind === 'custom',
      executablePath: manifest.executablePath || null,
      icon: manifest.brandLogo || null,
      installState: snapshots.get(manifest.id)?.installState || 'unknown',
    }))
    return { items, needsInitialSetup: !this.data.setupCompleted }
  }

  async addExecutable(executablePath: string, iconDataUrl: string | null): Promise<SoftwareCatalogOverview> {
    const resolved = path.resolve(executablePath)
    if (path.extname(resolved).toLowerCase() !== '.exe' || !fs.existsSync(resolved)) throw new Error('请选择有效的 Windows EXE 程序')
    const duplicate = this.data.customSoftware.find((item) => item.executablePath.toLowerCase() === resolved.toLowerCase())
    if (duplicate) {
      if (!duplicate.enabled) await this.setEnabled(duplicate.id, true)
      return this.overview()
    }
    const metadata = readExecutableMetadata(resolved)
    const definition: CustomSoftwareDefinition & { enabled: boolean } = {
      id: `custom-${createHash('sha256').update(resolved.toLowerCase()).digest('hex').slice(0, 16)}`,
      displayName: metadata.displayName.slice(0, 80),
      executablePath: resolved,
      iconDataUrl,
      version: metadata.version.slice(0, 40),
      enabled: true,
    }
    this.data.customSoftware.push(definition)
    this.moduleManager.register(createCustomSoftwareDriver(definition))
    this.data.silentLaunchById[definition.id] = true
    this.data.launchDelaySecondsById[definition.id] = 0
    this.moduleManager.setSilentLaunchPreference(definition.id, true)
    await this.moduleManager.setModuleEnabled(definition.id, true)
    this.persist()
    return this.overview()
  }

  async setEnabled(id: string, enabled: boolean): Promise<SoftwareCatalogOverview> {
    if (!this.builtinIds.includes(id) && !this.data.customSoftware.some((item) => item.id === id)) throw new Error('未知软件')
    await this.moduleManager.setModuleEnabled(id, enabled)
    if (this.builtinIds.includes(id)) {
      this.data.enabledBuiltinIds = enabled
        ? [...new Set([...this.data.enabledBuiltinIds, id])]
        : this.data.enabledBuiltinIds.filter((item) => item !== id)
    } else {
      const item = this.data.customSoftware.find((candidate) => candidate.id === id)
      if (item) item.enabled = enabled
    }
    this.persist()
    return this.overview()
  }

  setSilentLaunch(id: string, silent: boolean): SoftwareCatalogOverview {
    if (!this.builtinIds.includes(id) && !this.data.customSoftware.some((item) => item.id === id)) throw new Error('未知软件')
    this.data.silentLaunchById[id] = silent
    this.moduleManager.setSilentLaunchPreference(id, silent)
    this.persist()
    return this.overview()
  }

  setLaunchDelay(id: string, seconds: number): SoftwareCatalogOverview {
    if (!this.builtinIds.includes(id) && !this.data.customSoftware.some((item) => item.id === id)) throw new Error('未知软件')
    if (!Number.isFinite(seconds)) throw new Error('启动延迟必须是有效秒数')
    this.data.launchDelaySecondsById[id] = Math.max(0, Math.min(120, Math.round(seconds)))
    this.persist()
    return this.overview()
  }

  async useAutomaticDetection(): Promise<SoftwareCatalogOverview> {
    for (const id of this.builtinIds) {
      await this.replaceBuiltinDriver(id, null)
      delete this.data.builtinExecutableOverrides[id]
    }
    this.persist()
    return this.overview()
  }

  async setBuiltinExecutable(id: string, executablePath: string): Promise<SoftwareCatalogOverview> {
    if (!this.builtinDefinitions.has(id)) throw new Error('只能为内置模块选择程序路径')
    const resolved = path.resolve(executablePath)
    if (path.extname(resolved).toLowerCase() !== '.exe' || !fs.existsSync(resolved)) throw new Error('请选择有效的 Windows EXE 程序')
    await this.replaceBuiltinDriver(id, resolved)
    this.data.builtinExecutableOverrides[id] = resolved
    this.persist()
    return this.overview()
  }

  async remove(id: string): Promise<SoftwareCatalogOverview> {
    const item = this.data.customSoftware.find((candidate) => candidate.id === id)
    if (!item) throw new Error('只能移除用户添加的软件')
    await this.moduleManager.unregister(id)
    this.data.customSoftware = this.data.customSoftware.filter((candidate) => candidate.id !== id)
    delete this.data.silentLaunchById[id]
    delete this.data.launchDelaySecondsById[id]
    this.persist()
    return this.overview()
  }

  async completeInitialSetup(enabledIds: string[]): Promise<SoftwareCatalogOverview> {
    const selected = new Set(enabledIds.filter((id) => this.builtinIds.includes(id)))
    for (const id of this.builtinIds) await this.moduleManager.setModuleEnabled(id, selected.has(id))
    this.data.enabledBuiltinIds = [...selected]
    this.data.setupCompleted = true
    this.persist()
    return this.overview()
  }

  private load(): StoredCatalog {
    try {
      const stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<StoredCatalog>
      const enabledBuiltinIds = Array.isArray(stored.enabledBuiltinIds)
        ? stored.enabledBuiltinIds.filter((id): id is string => typeof id === 'string' && this.builtinIds.includes(id))
        : [...this.builtinIds]
      const storedVersion = Number(stored.version)
      if ((!Number.isFinite(storedVersion) || storedVersion < 2) && this.builtinIds.includes('srs') && !enabledBuiltinIds.includes('srs')) enabledBuiltinIds.push('srs')
      return {
        version: 3,
        setupCompleted: stored.setupCompleted === true,
        enabledBuiltinIds,
        builtinExecutableOverrides: stored.builtinExecutableOverrides && typeof stored.builtinExecutableOverrides === 'object'
          ? Object.fromEntries(Object.entries(stored.builtinExecutableOverrides).filter(([id, executablePath]) => this.builtinIds.includes(id) && typeof executablePath === 'string'))
          : {},
        silentLaunchById: stored.silentLaunchById && typeof stored.silentLaunchById === 'object'
          ? Object.fromEntries(Object.entries(stored.silentLaunchById).filter(([id, silent]) => typeof id === 'string' && typeof silent === 'boolean'))
          : {},
        launchDelaySecondsById: stored.launchDelaySecondsById && typeof stored.launchDelaySecondsById === 'object'
          ? Object.fromEntries(Object.entries(stored.launchDelaySecondsById).filter(([id, seconds]) => (
            typeof id === 'string' && typeof seconds === 'number' && Number.isFinite(seconds)
          )).map(([id, seconds]) => [id, Math.max(0, Math.min(120, Math.round(seconds)))]))
          : {},
        customSoftware: Array.isArray(stored.customSoftware)
          ? stored.customSoftware.filter((item): item is CustomSoftwareDefinition & { enabled: boolean } => (
            Boolean(item) && typeof item.id === 'string' && typeof item.displayName === 'string'
            && typeof item.executablePath === 'string' && typeof item.enabled === 'boolean'
          )).map((item) => {
            const nameCorrupted = isCorruptedMetadata(item.displayName)
            const versionCorrupted = isCorruptedMetadata(item.version)
            if (!nameCorrupted && !versionCorrupted) return item
            const metadata = readExecutableMetadata(item.executablePath)
            return {
              ...item,
              displayName: nameCorrupted ? metadata.displayName : item.displayName,
              version: versionCorrupted ? metadata.version : item.version,
            }
          })
          : [],
      }
    } catch {
      return { version: 3, setupCompleted: false, enabledBuiltinIds: [], builtinExecutableOverrides: {}, silentLaunchById: {}, launchDelaySecondsById: {}, customSoftware: [] }
    }
  }

  private async replaceBuiltinDriver(id: string, executableOverride: string | null): Promise<void> {
    const definition = this.builtinDefinitions.get(id)
    if (!definition) throw new Error('未知内置模块')
    const snapshot = this.moduleManager.allSnapshots().find((item) => item.moduleId === id)
    if (snapshot && snapshot.runState !== 'stopped' && snapshot.runState !== 'failed') {
      throw new Error(`请先停止 ${this.moduleManager.allManifests().find((item) => item.id === id)?.displayName || id}`)
    }
    const wasEnabled = this.moduleManager.isModuleEnabled(id)
    await this.moduleManager.unregister(id)
    const driver = definition.createDriver(executableOverride)
    driver.manifest.integrationKind = 'builtin'
    this.moduleManager.register(driver)
    if (wasEnabled) await this.moduleManager.setModuleEnabled(id, true)
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, this.filePath)
  }
}
