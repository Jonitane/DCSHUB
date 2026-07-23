import path from 'node:path'
import type { ModuleSettings } from '../../src/shared/module-contracts'
import type { ModManagerSettings } from '../../src/shared/mod-manager-contracts'

export function assertModuleId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) throw new Error('Invalid module id')
  return value
}

export function assertModuleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid module id list')
  return value.map(assertModuleId)
}

export function assertSettings(value: unknown): ModuleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings patch')
  if (JSON.stringify(value).length > 128 * 1024) throw new Error('Settings patch is too large')
  return value as ModuleSettings
}

export function assertActionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) throw new Error('Invalid action id')
  return value
}

export function assertText(value: unknown, label: string, maxLength = 4_096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw new Error(`Invalid ${label}`)
  return value
}

export function assertFilePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Error('Invalid manual file list')
  return value.map((filePath) => {
    const checked = assertText(filePath, 'manual file path', 32_768)
    if (!path.isAbsolute(checked)) throw new Error('Manual file path must be absolute')
    return checked
  })
}

export function assertModManagerSettings(value: unknown): ModManagerSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mod manager settings')
  const settings = value as Record<string, unknown>
  if (!Array.isArray(settings.gameDirectories) || settings.gameDirectories.length === 0 || settings.gameDirectories.length > 16) throw new Error('Invalid game directories')
  const gameDirectories = settings.gameDirectories.map((directory) => {
    if (!directory || typeof directory !== 'object' || Array.isArray(directory)) throw new Error('Invalid game directory')
    const item = directory as Record<string, unknown>
    return {
      id: assertText(item.id, 'game directory id', 64),
      name: assertText(item.name, 'game directory name', 80),
      path: assertText(item.path, 'game directory path'),
      modsPath: assertText(item.modsPath, 'local mods path'),
    }
  })
  return {
    gameDirectories,
    activeGameDirectoryId: assertText(settings.activeGameDirectoryId, 'active game directory id', 64),
    backupPath: assertText(settings.backupPath, 'backup path'),
  }
}
