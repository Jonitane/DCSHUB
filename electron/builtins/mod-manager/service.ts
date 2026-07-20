import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import AdmZip from 'adm-zip'
import type { ConfigBackupResult, ModManagerOverview, ModManagerSettings, ModOperationResult, ModPackage, ModPreset } from '../../../src/shared/mod-manager-contracts'

interface InstalledFileRecord {
  relativePath: string
  existed: boolean
}

interface EnabledModRecord {
  id: string
  gameDirectoryId: string
  name: string
  sourcePath: string
  enabledAt: number
  order: number
  files: InstalledFileRecord[]
}

interface StoredState {
  version: 4
  settings: ModManagerSettings | null
  enabled: EnabledModRecord[]
  presets: ModPreset[]
  activePresetId: string | null
  lastConfigBackupAt: string | null
}

interface SourceFile {
  relativePath: string
  size: number
  writeTo(destination: string): void
}

interface ScannedSource {
  files: SourceFile[]
  description: string
  version: string
  size: number
}

const METADATA_FILES = new Set(['description.txt', 'readme.txt', 'version.txt'])
const DEFAULT_PRESET: ModPreset = { id: 'default', name: '默认预设', entries: [] }

function isMetadataFile(relativePath: string): boolean {
  return METADATA_FILES.has(relativePath.replace(/\\/g, '/').toLowerCase())
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error(`非法模组路径：${value}`)
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..')) throw new Error(`模组包含越界路径：${value}`)
  return segments.join(path.sep)
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`目标路径越界：${relativePath}`)
  return resolved
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function directorySize(directory: string): number {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) total += directorySize(fullPath)
    else if (entry.isFile()) total += fs.statSync(fullPath).size
  }
  return total
}

function readTextFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim() } catch { return '' }
}

function scanFolder(folderPath: string): ScannedSource {
  const files: SourceFile[] = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile()) {
        const relativePath = normalizeRelativePath(path.relative(folderPath, fullPath))
        if (isMetadataFile(relativePath)) continue
        const size = fs.statSync(fullPath).size
        files.push({ relativePath, size, writeTo: (destination) => fs.copyFileSync(fullPath, destination) })
      }
    }
  }
  visit(folderPath)
  const description = readTextFile(path.join(folderPath, 'description.txt')) || readTextFile(path.join(folderPath, 'readme.txt'))
  const version = readTextFile(path.join(folderPath, 'version.txt')).split(/\r?\n/)[0] || ''
  return { files, description, version, size: files.reduce((sum, file) => sum + file.size, 0) }
}

function scanArchive(archivePath: string): ScannedSource {
  const archive = new AdmZip(archivePath)
  const rawEntries = archive.getEntries().filter((entry) => !entry.isDirectory)
  if (rawEntries.length === 0) throw new Error('ZIP 模组包为空')
  const normalizedNames = rawEntries.map((entry) => entry.entryName.replace(/\\/g, '/').replace(/^\.\//, ''))
  const firstSegments = new Set(normalizedNames.map((name) => name.split('/')[0]))
  const stripRoot = firstSegments.size === 1 && normalizedNames.every((name) => name.includes('/'))
  const stripPrefix = stripRoot ? `${normalizedNames[0].split('/')[0]}/` : ''
  const scannedEntries = rawEntries.map((entry) => {
    const name = entry.entryName.replace(/\\/g, '/').replace(/^\.\//, '')
    const relativePath = normalizeRelativePath(stripPrefix && name.startsWith(stripPrefix) ? name.slice(stripPrefix.length) : name)
    return { entry, relativePath }
  })
  const files: SourceFile[] = scannedEntries.filter(({ relativePath }) => !isMetadataFile(relativePath)).map(({ entry, relativePath }) => {
    return {
      relativePath,
      size: entry.header.size,
      writeTo: (destination) => fs.writeFileSync(destination, entry.getData()),
    }
  })
  const readMeta = (...names: string[]) => {
    const found = scannedEntries.find(({ relativePath }) => names.includes(relativePath.replace(/\\/g, '/').toLowerCase()))
    return found ? found.entry.getData().toString('utf8').replace(/^\uFEFF/, '').trim() : ''
  }
  const description = readMeta('description.txt', 'readme.txt')
  const version = readMeta('version.txt').split(/\r?\n/)[0] || ''
  return { files, description, version, size: files.reduce((sum, file) => sum + file.size, 0) }
}

function createModId(sourcePath: string): string {
  return crypto.createHash('sha256').update(path.resolve(sourcePath).toLowerCase()).digest('hex').slice(0, 20)
}

function removeEmptyParents(startDirectory: string, stopDirectory: string): void {
  let current = startDirectory
  const stop = path.resolve(stopDirectory)
  while (path.resolve(current).startsWith(`${stop}${path.sep}`)) {
    try {
      if (fs.readdirSync(current).length > 0) break
      fs.rmdirSync(current)
    } catch { break }
    current = path.dirname(current)
  }
}

export class ModManagerService {
  private readonly statePath: string
  private readonly savedGamesDcsPath: string
  private state: StoredState

  constructor(userDataPath: string, savedGamesDcsPath = path.join(process.env.USERPROFILE || os.homedir(), 'Saved Games', 'DCS')) {
    this.statePath = path.join(userDataPath, 'dcs-mod-manager.json')
    this.savedGamesDcsPath = path.resolve(savedGamesDcsPath)
    this.state = this.loadState()
  }

  overview(): ModManagerOverview {
    if (!this.state.settings) return {
      configured: false, settings: null, mods: [], enabledCount: 0, totalModCount: 0, totalEnabledCount: 0,
      enabledModKeys: [],
      activeGameDirectory: null, presets: this.state.presets, activePresetId: this.state.activePresetId,
      lastConfigBackupAt: this.state.lastConfigBackupAt,
    }
    const mods = this.scanMods()
    const activeGameDirectory = this.requireActiveGameDirectory()
    const allMods = this.scanAllDirectories()
    return {
      configured: true,
      settings: { ...this.state.settings },
      enabledCount: mods.filter((mod) => mod.enabled).length,
      totalModCount: allMods.reduce((sum, item) => sum + item.mods.length, 0),
      totalEnabledCount: this.state.enabled.length,
      enabledModKeys: this.state.enabled.map((record) => `${record.gameDirectoryId}:${record.id}`),
      activeGameDirectory,
      presets: this.state.presets.map((preset) => ({ ...preset, entries: preset.entries.map((entry) => ({ ...entry })) })),
      activePresetId: this.state.activePresetId,
      lastConfigBackupAt: this.state.lastConfigBackupAt,
      mods,
    }
  }

  saveSettings(settings: ModManagerSettings): ModManagerOverview {
    if (this.state.enabled.length > 0) throw new Error('请先停用全部模组，再修改目录设置')
    const gameDirectories = settings.gameDirectories.map((directory) => ({
      id: directory.id.trim(),
      name: directory.name.trim(),
      path: path.resolve(directory.path.trim()),
      modsPath: path.resolve(directory.modsPath.trim()),
    }))
    if (new Set(gameDirectories.map((directory) => directory.id)).size !== gameDirectories.length) throw new Error('游戏目录标识不能重复')
    if (new Set(gameDirectories.map((directory) => directory.path.toLowerCase())).size !== gameDirectories.length) throw new Error('游戏目录路径不能重复')
    for (const directory of gameDirectories) {
      if (!directory.id || !directory.name) throw new Error('游戏目录名称不能为空')
      if (!fs.existsSync(directory.path) || !fs.statSync(directory.path).isDirectory()) throw new Error(`游戏目录不存在：${directory.name}`)
      fs.mkdirSync(directory.modsPath, { recursive: true })
    }
    const activeGameDirectoryId = gameDirectories.some((directory) => directory.id === settings.activeGameDirectoryId)
      ? settings.activeGameDirectoryId
      : gameDirectories[0]?.id
    if (!activeGameDirectoryId) throw new Error('请至少配置一个游戏目录')
    const normalized = {
      gameDirectories,
      activeGameDirectoryId,
      backupPath: path.resolve(settings.backupPath.trim()),
    }
    fs.mkdirSync(normalized.backupPath, { recursive: true })
    this.state.settings = normalized
    this.saveState()
    return this.overview()
  }

  backupSavedGamesConfig(backupPath: string): ConfigBackupResult {
    const source = path.join(this.savedGamesDcsPath, 'Config')
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`未找到 DCS 配置目录：${source}`)
    }

    const trimmedBackupPath = backupPath.trim()
    if (!trimmedBackupPath) throw new Error('请先设置备份目录')
    const backupRoot = path.resolve(trimmedBackupPath)
    const snapshotsRoot = path.join(backupRoot, 'DCS-Hub-Config-Backups')
    if (isInside(source, snapshotsRoot)) throw new Error('备份目录不能放在 Saved Games\\DCS\\Config 内部')

    const backedUpAt = new Date().toISOString()
    const snapshotName = backedUpAt.replace('T', '_').replace(/[:.]/g, '-').replace('Z', '')
    const destination = path.join(snapshotsRoot, snapshotName)
    const temporary = `${destination}.tmp`
    fs.mkdirSync(snapshotsRoot, { recursive: true })
    fs.rmSync(temporary, { recursive: true, force: true })
    try {
      fs.mkdirSync(temporary, { recursive: true })
      fs.cpSync(source, path.join(temporary, 'Config'), { recursive: true, errorOnExist: true, force: false })
      fs.renameSync(temporary, destination)
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true })
      throw error
    }

    this.state.lastConfigBackupAt = backedUpAt
    this.saveState()
    return {
      ok: true,
      message: 'DCS Config 已完成备份',
      backedUpAt,
      destinationPath: destination,
    }
  }

  selectGameDirectory(gameDirectoryId: string): ModManagerOverview {
    const settings = this.requireSettings()
    if (!settings.gameDirectories.some((directory) => directory.id === gameDirectoryId)) throw new Error('游戏目录不存在')
    settings.activeGameDirectoryId = gameDirectoryId
    this.saveState()
    return this.overview()
  }

  importArchives(filePaths: string[]): ModOperationResult {
    const activeGameDirectory = this.requireActiveGameDirectory()
    if (filePaths.length === 0) return { ok: false, message: '未选择模组包' }
    let imported = 0
    for (const filePath of filePaths) {
      if (path.extname(filePath).toLowerCase() !== '.zip') continue
      scanArchive(filePath)
      let destination = path.join(activeGameDirectory.modsPath, path.basename(filePath))
      if (fs.existsSync(destination)) {
        const ext = path.extname(destination)
        const base = path.basename(destination, ext)
        destination = path.join(activeGameDirectory.modsPath, `${base}-${Date.now()}${ext}`)
      }
      fs.copyFileSync(filePath, destination)
      imported += 1
    }
    return { ok: imported > 0, message: imported > 0 ? `已导入 ${imported} 个模组包` : '没有可导入的 ZIP 模组包' }
  }

  async revealMod(modId: string): Promise<ModOperationResult> {
    const mod = this.requireMod(modId)
    if (mod.kind === 'folder') await shell.openPath(mod.sourcePath)
    else shell.showItemInFolder(mod.sourcePath)
    return { ok: true }
  }

  setModEnabled(modId: string, enabled: boolean, allowConflicts = false): ModOperationResult {
    const mod = this.requireMod(modId)
    if (enabled === mod.enabled) return { ok: true }
    return enabled ? this.enableMod(mod, allowConflicts) : this.disableMod(mod)
  }

  setDirectoryModEnabled(gameDirectoryId: string, modId: string, enabled: boolean, allowConflicts = false): ModOperationResult {
    const settings = this.requireSettings()
    if (!settings.gameDirectories.some((directory) => directory.id === gameDirectoryId)) throw new Error('游戏目录不存在')
    const previousDirectoryId = settings.activeGameDirectoryId
    try {
      settings.activeGameDirectoryId = gameDirectoryId
      return this.setModEnabled(modId, enabled, allowConflicts)
    } finally {
      settings.activeGameDirectoryId = previousDirectoryId
      this.saveState()
    }
  }

  setAllModsEnabled(enabled: boolean): ModOperationResult {
    const mods = this.scanMods()
    if (enabled) {
      for (const mod of mods.filter((item) => !item.enabled)) {
        const result = this.enableMod(mod, true)
        if (!result.ok) return result
      }
    } else {
      const ordered = mods.filter((item) => item.enabled).sort((a, b) => (b.enabledOrder || 0) - (a.enabledOrder || 0))
      for (const mod of ordered) {
        const result = this.disableMod(mod)
        if (!result.ok) return result
      }
    }
    return { ok: true, message: enabled ? '全部模组已启用' : '全部模组已停用' }
  }

  applyPreset(presetId: string): ModManagerOverview {
    const preset = this.state.presets.find((item) => item.id === presetId)
    if (!preset) throw new Error('全局预设不存在')
    const settings = this.requireSettings()
    const previousDirectoryId = settings.activeGameDirectoryId
    try {
      for (const directory of settings.gameDirectories) {
        settings.activeGameDirectoryId = directory.id
        let mods = this.scanMods()
        const desiredIds = new Set(preset.entries.filter((entry) => entry.gameDirectoryId === directory.id).map((entry) => entry.modId))
        const toDisable = mods.filter((mod) => mod.enabled && !desiredIds.has(mod.id)).sort((a, b) => (b.enabledOrder || 0) - (a.enabledOrder || 0))
        for (const mod of toDisable) {
          const result = this.disableMod(mod)
          if (!result.ok) throw new Error(result.message || `无法停用 ${mod.name}`)
        }
        mods = this.scanMods()
        const modsById = new Map(mods.map((mod) => [mod.id, mod]))
        for (const entry of preset.entries.filter((item) => item.gameDirectoryId === directory.id)) {
          const mod = modsById.get(entry.modId)
          if (!mod) throw new Error(`${directory.name} 的仓库中缺少 Mod：${entry.modName}`)
          if (!mod.enabled) this.enableMod(mod, true)
        }
      }
      this.state.activePresetId = preset.id
    } finally {
      settings.activeGameDirectoryId = previousDirectoryId
      this.saveState()
    }
    return this.overview()
  }

  disableAllMods(): ModManagerOverview {
    const settings = this.requireSettings()
    const previousDirectoryId = settings.activeGameDirectoryId
    try {
      for (const directory of settings.gameDirectories) {
        settings.activeGameDirectoryId = directory.id
        const enabledMods = this.scanMods().filter((mod) => mod.enabled).sort((a, b) => (b.enabledOrder || 0) - (a.enabledOrder || 0))
        for (const mod of enabledMods) {
          const result = this.disableMod(mod)
          if (!result.ok) throw new Error(result.message || `无法停用 ${mod.name}`)
        }
      }
      this.state.activePresetId = null
    } finally {
      settings.activeGameDirectoryId = previousDirectoryId
      this.saveState()
    }
    return this.overview()
  }

  createPreset(name: string): ModManagerOverview {
    const preset: ModPreset = {
      id: `preset-${crypto.randomUUID().slice(0, 12)}`,
      name: name.trim(),
      entries: this.currentPresetEntries(),
    }
    this.state.presets.push(preset)
    this.state.activePresetId = preset.id
    this.saveState()
    return this.overview()
  }

  updatePreset(presetId: string, name?: string): ModManagerOverview {
    const preset = this.state.presets.find((item) => item.id === presetId)
    if (!preset) throw new Error('全局预设不存在')
    preset.entries = this.currentPresetEntries()
    if (name?.trim()) preset.name = name.trim()
    this.state.activePresetId = preset.id
    this.saveState()
    return this.overview()
  }

  deletePreset(presetId: string): ModManagerOverview {
    if (this.state.presets.length === 1) throw new Error('至少保留一个全局预设')
    if (!this.state.presets.some((item) => item.id === presetId)) throw new Error('全局预设不存在')
    this.state.presets = this.state.presets.filter((item) => item.id !== presetId)
    if (this.state.activePresetId === presetId) this.state.activePresetId = null
    this.saveState()
    return this.overview()
  }

  private currentPresetEntries(): ModPreset['entries'] {
    return this.state.enabled.map((record) => ({ gameDirectoryId: record.gameDirectoryId, modId: record.id, modName: record.name }))
  }

  private scanAllDirectories(): Array<{ gameDirectoryId: string; mods: ModPackage[] }> {
    const settings = this.requireSettings()
    const previousDirectoryId = settings.activeGameDirectoryId
    try {
      return settings.gameDirectories.map((directory) => {
        settings.activeGameDirectoryId = directory.id
        return { gameDirectoryId: directory.id, mods: this.scanMods() }
      })
    } finally {
      settings.activeGameDirectoryId = previousDirectoryId
    }
  }

  private scanMods(): ModPackage[] {
    const activeGameDirectory = this.requireActiveGameDirectory()
    const activeRecords = this.state.enabled.filter((record) => record.gameDirectoryId === activeGameDirectory.id)
    fs.mkdirSync(activeGameDirectory.modsPath, { recursive: true })
    const enabledById = new Map(activeRecords.map((record) => [record.id, record]))
    const packages: ModPackage[] = []
    for (const entry of fs.readdirSync(activeGameDirectory.modsPath, { withFileTypes: true })) {
      if (!entry.isDirectory() && !(entry.isFile() && path.extname(entry.name).toLowerCase() === '.zip')) continue
      const sourcePath = path.join(activeGameDirectory.modsPath, entry.name)
      const id = createModId(sourcePath)
      try {
        const source = entry.isDirectory() ? scanFolder(sourcePath) : scanArchive(sourcePath)
        const installed = enabledById.get(id)
        const sourceFiles = new Set(source.files.map((file) => file.relativePath.toLowerCase()))
        const conflicts = activeRecords
          .filter((record) => record.id !== id && record.files.some((file) => sourceFiles.has(file.relativePath.toLowerCase())))
          .map((record) => record.name)
        packages.push({
          id,
          name: path.basename(entry.name, path.extname(entry.name)),
          fileName: entry.name,
          sourcePath,
          kind: entry.isDirectory() ? 'folder' : 'archive',
          enabled: Boolean(installed),
          enabledOrder: installed?.order,
          version: source.version,
          description: source.description,
          size: source.size || (entry.isDirectory() ? directorySize(sourcePath) : fs.statSync(sourcePath).size),
          conflicts,
        })
      } catch {
        // Invalid archives are ignored instead of making the entire manager unavailable.
      }
    }
    for (const record of activeRecords) {
      if (packages.some((item) => item.id === record.id)) continue
      const recordFiles = new Set(record.files.map((file) => file.relativePath.toLowerCase()))
      const conflicts = activeRecords
        .filter((item) => item.id !== record.id && item.files.some((file) => recordFiles.has(file.relativePath.toLowerCase())))
        .map((item) => item.name)
      packages.push({
        id: record.id,
        name: record.name,
        fileName: path.basename(record.sourcePath),
        sourcePath: record.sourcePath,
        kind: path.extname(record.sourcePath).toLowerCase() === '.zip' ? 'archive' : 'folder',
        enabled: true,
        enabledOrder: record.order,
        version: '',
        description: '源模组已从模组目录移除。仍可停用此记录，以恢复启用前的游戏文件。',
        size: 0,
        conflicts,
      })
    }
    return packages.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'zh-CN'))
  }

  private enableMod(mod: ModPackage, allowConflicts: boolean): ModOperationResult {
    const settings = this.requireSettings()
    const activeGameDirectory = this.requireActiveGameDirectory()
    const source = mod.kind === 'folder' ? scanFolder(mod.sourcePath) : scanArchive(mod.sourcePath)
    const conflicts = this.findEnabledConflicts(mod.id, source.files.map((file) => file.relativePath))
    if (conflicts.length > 0 && !allowConflicts) return { ok: false, message: `与已启用模组冲突：${conflicts.join('、')}` }

    const backupRoot = path.join(settings.backupPath, 'DCS-Hub-Backups', activeGameDirectory.id, mod.id)
    fs.rmSync(backupRoot, { recursive: true, force: true })
    const processed: InstalledFileRecord[] = []
    try {
      for (const sourceFile of source.files) {
        const destination = resolveInside(activeGameDirectory.path, sourceFile.relativePath)
        if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) throw new Error(`目标位置是目录：${sourceFile.relativePath}`)
        const existed = fs.existsSync(destination)
        if (existed) {
          const backupFile = resolveInside(backupRoot, sourceFile.relativePath)
          fs.mkdirSync(path.dirname(backupFile), { recursive: true })
          fs.copyFileSync(destination, backupFile)
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        sourceFile.writeTo(destination)
        processed.push({ relativePath: sourceFile.relativePath, existed })
      }
    } catch (error) {
      this.restoreFiles(processed, backupRoot, activeGameDirectory.path)
      fs.rmSync(backupRoot, { recursive: true, force: true })
      throw error
    }

    this.state.enabled.push({
      id: mod.id,
      gameDirectoryId: activeGameDirectory.id,
      name: mod.name,
      sourcePath: mod.sourcePath,
      enabledAt: Date.now(),
      order: Math.max(0, ...this.state.enabled.filter((record) => record.gameDirectoryId === activeGameDirectory.id).map((record) => record.order)) + 1,
      files: processed,
    })
    this.saveState()
    return { ok: true, message: conflicts.length > 0 ? `模组已启用，与 ${conflicts.join('、')} 存在覆盖关系` : '模组已启用' }
  }

  private disableMod(mod: ModPackage): ModOperationResult {
    const settings = this.requireSettings()
    const activeGameDirectory = this.requireActiveGameDirectory()
    const record = this.state.enabled.find((item) => item.id === mod.id && item.gameDirectoryId === activeGameDirectory.id)
    if (!record) return { ok: true }
    const fileSet = new Set(record.files.map((file) => file.relativePath.toLowerCase()))
    const dependents = this.state.enabled
      .filter((item) => item.gameDirectoryId === activeGameDirectory.id && item.order > record.order && item.files.some((file) => fileSet.has(file.relativePath.toLowerCase())))
      .map((item) => item.name)
    if (dependents.length > 0) return { ok: false, message: `请先停用后覆盖的模组：${dependents.join('、')}` }
    let backupRoot = path.join(settings.backupPath, 'DCS-Hub-Backups', activeGameDirectory.id, record.id)
    const legacyBackupRoot = path.join(settings.backupPath, 'DCS-Hub-Backups', record.id)
    if (!fs.existsSync(backupRoot) && fs.existsSync(legacyBackupRoot)) backupRoot = legacyBackupRoot
    this.restoreFiles(record.files, backupRoot, activeGameDirectory.path)
    fs.rmSync(backupRoot, { recursive: true, force: true })
    this.state.enabled = this.state.enabled.filter((item) => !(item.id === record.id && item.gameDirectoryId === activeGameDirectory.id))
    this.saveState()
    return { ok: true, message: '模组已停用，原文件已恢复' }
  }

  private restoreFiles(files: InstalledFileRecord[], backupRoot: string, gamePath: string): void {
    for (const file of [...files].reverse()) {
      const destination = resolveInside(gamePath, file.relativePath)
      if (file.existed) {
        const backupFile = resolveInside(backupRoot, file.relativePath)
        if (!fs.existsSync(backupFile)) throw new Error(`备份文件缺失：${file.relativePath}`)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.copyFileSync(backupFile, destination)
      } else {
        fs.rmSync(destination, { force: true })
        removeEmptyParents(path.dirname(destination), gamePath)
      }
    }
  }

  private findEnabledConflicts(modId: string, files: string[]): string[] {
    const activeGameDirectory = this.requireActiveGameDirectory()
    const paths = new Set(files.map((file) => file.toLowerCase()))
    return this.state.enabled
      .filter((record) => record.gameDirectoryId === activeGameDirectory.id && record.id !== modId && record.files.some((file) => paths.has(file.relativePath.toLowerCase())))
      .map((record) => record.name)
  }

  private requireSettings(): ModManagerSettings {
    if (!this.state.settings) throw new Error('请先配置 DCS、模组仓库和备份目录')
    return this.state.settings
  }

  private requireActiveGameDirectory(): ModManagerSettings['gameDirectories'][number] {
    const settings = this.requireSettings()
    const directory = settings.gameDirectories.find((item) => item.id === settings.activeGameDirectoryId)
    if (!directory) throw new Error('当前游戏目录不存在，请重新配置')
    return directory
  }

  private requireMod(modId: string): ModPackage {
    const mod = this.scanMods().find((item) => item.id === modId)
    if (!mod) throw new Error('模组不存在或模组包无效')
    return mod
  }

  private loadState(): StoredState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as StoredState | {
        version: 1
        settings: { gamePath: string; modsPath: string; backupPath: string } | null
        enabled: Array<Omit<EnabledModRecord, 'gameDirectoryId'>>
      } | {
        version: 2
        settings: {
          gameDirectories: Array<Omit<ModManagerSettings['gameDirectories'][number], 'modsPath'>>
          activeGameDirectoryId: string
          modsPath: string
          backupPath: string
        } | null
        enabled: EnabledModRecord[]
      } | {
        version: 3
        settings: ModManagerSettings | null
        enabled: EnabledModRecord[]
      }
      if (parsed.version === 4 && Array.isArray(parsed.enabled)) {
        if (!Array.isArray(parsed.presets) || parsed.presets.length === 0) parsed.presets = [{ ...DEFAULT_PRESET, entries: [] }]
        if (parsed.activePresetId !== null && !parsed.presets.some((preset) => preset.id === parsed.activePresetId)) parsed.activePresetId = null
        parsed.lastConfigBackupAt = typeof parsed.lastConfigBackupAt === 'string' ? parsed.lastConfigBackupAt : null
        return parsed
      }
      if (parsed.version === 3 && Array.isArray(parsed.enabled)) return {
        version: 4,
        settings: parsed.settings,
        enabled: parsed.enabled,
        presets: [{ ...DEFAULT_PRESET, entries: parsed.enabled.map((record) => ({ gameDirectoryId: record.gameDirectoryId, modId: record.id, modName: record.name })) }],
        activePresetId: DEFAULT_PRESET.id,
        lastConfigBackupAt: null,
      }
      if (parsed.version === 2 && Array.isArray(parsed.enabled)) {
        if (!parsed.settings) return { version: 4, settings: null, enabled: [], presets: [{ ...DEFAULT_PRESET, entries: [] }], activePresetId: DEFAULT_PRESET.id, lastConfigBackupAt: null }
        return {
          version: 4,
          settings: {
            gameDirectories: parsed.settings.gameDirectories.map((directory) => ({ ...directory, modsPath: parsed.settings!.modsPath })),
            activeGameDirectoryId: parsed.settings.activeGameDirectoryId,
            backupPath: parsed.settings.backupPath,
          },
          enabled: parsed.enabled,
          presets: [{ ...DEFAULT_PRESET, entries: parsed.enabled.map((record) => ({ gameDirectoryId: record.gameDirectoryId, modId: record.id, modName: record.name })) }],
          activePresetId: DEFAULT_PRESET.id,
          lastConfigBackupAt: null,
        }
      }
      if (parsed.version === 1 && Array.isArray(parsed.enabled)) {
        if (!parsed.settings) return { version: 4, settings: null, enabled: [], presets: [{ ...DEFAULT_PRESET, entries: [] }], activePresetId: DEFAULT_PRESET.id, lastConfigBackupAt: null }
        const directoryId = `game-${crypto.createHash('sha256').update(path.resolve(parsed.settings.gamePath).toLowerCase()).digest('hex').slice(0, 12)}`
        return {
          version: 4,
          settings: {
            gameDirectories: [{ id: directoryId, name: path.basename(parsed.settings.gamePath) || 'DCS World', path: parsed.settings.gamePath, modsPath: parsed.settings.modsPath }],
            activeGameDirectoryId: directoryId,
            backupPath: parsed.settings.backupPath,
          },
          enabled: parsed.enabled.map((record) => ({ ...record, gameDirectoryId: directoryId })),
          presets: [{ ...DEFAULT_PRESET, entries: parsed.enabled.map((record) => ({ gameDirectoryId: directoryId, modId: record.id, modName: record.name })) }],
          activePresetId: DEFAULT_PRESET.id,
          lastConfigBackupAt: null,
        }
      }
    } catch { /* First run. */ }
    return { version: 4, settings: null, enabled: [], presets: [{ ...DEFAULT_PRESET, entries: [] }], activePresetId: DEFAULT_PRESET.id, lastConfigBackupAt: null }
  }

  private saveState(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8')
    fs.rmSync(this.statePath, { force: true })
    fs.renameSync(temporary, this.statePath)
  }

  async dispose(): Promise<void> {}
}
