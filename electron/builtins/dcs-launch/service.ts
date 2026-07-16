import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { DcsInstallationSource, DcsInstallationStatus, DcsOperationResult } from '../../../src/shared/dcs-contracts'
import { isImageRunning } from '../../integrations/windows-process'

interface StoredDcsLaunchSettings {
  version: 1
  installPath: string | null
}

interface InstallationCandidate {
  path: string
  source: Exclude<DcsInstallationSource, 'manual' | 'not-found'>
}

const EXECUTABLE_CANDIDATES = [
  path.join('bin', 'DCS.exe'),
  path.join('bin-mt', 'DCS.exe'),
  path.join('mt-bin', 'DCS.exe'),
  'DCS.exe',
]

function isFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function findExecutable(directory: string): string | null {
  const resolved = path.resolve(directory)
  for (const relativePath of EXECUTABLE_CANDIDATES) {
    const executable = path.join(resolved, relativePath)
    if (isFile(executable)) return executable
  }
  if (['bin', 'bin-mt', 'mt-bin'].includes(path.basename(resolved).toLowerCase())) {
    const executable = path.join(resolved, 'DCS.exe')
    if (isFile(executable)) return executable
  }
  return null
}

function installRootFor(directory: string, executable: string): string {
  const executableDirectory = path.dirname(executable)
  return ['bin', 'bin-mt', 'mt-bin'].includes(path.basename(executableDirectory).toLowerCase())
    ? path.dirname(executableDirectory)
    : path.resolve(directory)
}

function queryRegistryValue(key: string, valueName: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const output = execFileSync('reg.exe', ['query', key, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = output.split(/\r?\n/).find((item) => item.includes(valueName) && /REG_\w+/.test(item))
    return line?.replace(/^.*?REG_\w+\s+/i, '').trim() || null
  } catch {
    return null
  }
}

function steamLibraries(): string[] {
  const roots = new Set<string>()
  const registrySteamPath = queryRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  if (registrySteamPath) roots.add(registrySteamPath.replace(/\//g, path.sep))
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) roots.add(path.join(programFilesX86, 'Steam'))

  const libraries = new Set<string>(roots)
  for (const root of roots) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(match[1].replace(/\\\\/g, '\\'))
    } catch { /* Steam may not be installed or may not have a library file yet. */ }
  }
  return [...libraries]
}

function automaticCandidates(): InstallationCandidate[] {
  const candidates: InstallationCandidate[] = []
  for (const key of [
    'HKCU\\Software\\Eagle Dynamics\\DCS World',
    'HKCU\\Software\\Eagle Dynamics\\DCS World OpenBeta',
    'HKLM\\Software\\Eagle Dynamics\\DCS World',
    'HKLM\\Software\\Eagle Dynamics\\DCS World OpenBeta',
  ]) {
    const registryPath = queryRegistryValue(key, 'Path')
    if (registryPath) candidates.push({ path: registryPath, source: 'registry' })
  }

  for (const library of steamLibraries()) candidates.push({ path: path.join(library, 'steamapps', 'common', 'DCSWorld'), source: 'steam' })

  const programRoots = new Set([process.env.ProgramW6432, process.env.ProgramFiles].filter((value): value is string => Boolean(value)))
  for (const root of programRoots) {
    candidates.push({ path: path.join(root, 'Eagle Dynamics', 'DCS World'), source: 'default' })
    candidates.push({ path: path.join(root, 'Eagle Dynamics', 'DCS World OpenBeta'), source: 'default' })
  }
  return candidates
}

export class DcsLaunchService {
  private readonly settingsPath: string
  private settings: StoredDcsLaunchSettings

  constructor(userDataPath: string) {
    this.settingsPath = path.join(userDataPath, 'dcs-launch.json')
    this.settings = this.loadSettings()
  }

  status(): DcsInstallationStatus {
    if (this.settings.installPath) return this.statusFor(this.settings.installPath, 'manual', this.settings.installPath)

    const seen = new Set<string>()
    for (const candidate of automaticCandidates()) {
      const normalized = path.resolve(candidate.path).toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      const status = this.statusFor(candidate.path, candidate.source, null)
      if (status.executablePath) return status
    }
    return { configuredPath: null, installPath: null, executablePath: null, source: 'not-found' }
  }

  setInstallPath(directory: string): DcsInstallationStatus {
    const status = this.statusFor(directory, 'manual', path.resolve(directory))
    if (!status.executablePath) throw new Error('所选目录中没有找到 bin\\DCS.exe，请选择 DCS World 安装目录')
    this.settings.installPath = status.installPath
    this.saveSettings()
    return { ...status, configuredPath: status.installPath }
  }

  useAutomaticDetection(): DcsInstallationStatus {
    this.settings.installPath = null
    this.saveSettings()
    return this.status()
  }

  async launch(mode: 'vr' | 'desktop'): Promise<DcsOperationResult> {
    if (await isImageRunning('DCS.exe')) return { ok: true, message: 'DCS 已在运行，无需重复启动' }
    const executable = this.status().executablePath
    if (!executable) return { ok: false, message: '没有找到 DCS.exe，请前往设置选择 DCS World 安装目录' }
    const args = ['--no-launcher', mode === 'vr' ? '--force_enable_VR' : '--force_disable_VR']
    return this.spawnDcs(executable, args, mode === 'vr' ? 'DCS 已以 VR 模式启动' : 'DCS 已以桌面模式启动')
  }

  async launchLauncher(): Promise<DcsOperationResult> {
    const executable = this.status().executablePath
    if (!executable) return { ok: false, message: '没有找到 DCS.exe，请前往设置选择 DCS World 安装目录' }
    return this.spawnDcs(executable, [], 'DCS Launcher 已打开')
  }

  private statusFor(directory: string, source: DcsInstallationSource, configuredPath: string | null): DcsInstallationStatus {
    const executable = findExecutable(directory)
    return {
      configuredPath,
      installPath: executable ? installRootFor(directory, executable) : path.resolve(directory),
      executablePath: executable,
      source,
    }
  }

  private async spawnDcs(executable: string, args: string[], successMessage: string): Promise<DcsOperationResult> {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          cwd: path.dirname(executable),
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
      return { ok: true, message: successMessage }
    } catch (error) {
      return { ok: false, message: `DCS 启动失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private loadSettings(): StoredDcsLaunchSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<StoredDcsLaunchSettings>
      if (parsed.version === 1) return { version: 1, installPath: typeof parsed.installPath === 'string' ? parsed.installPath : null }
    } catch { /* First run or an invalid settings file falls back to automatic detection. */ }
    return { version: 1, installPath: null }
  }

  private saveSettings(): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(this.settings, null, 2), 'utf8')
    fs.rmSync(this.settingsPath, { force: true })
    fs.renameSync(temporaryPath, this.settingsPath)
  }
}
