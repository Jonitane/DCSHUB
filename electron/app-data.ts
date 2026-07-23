import fs from 'node:fs'
import path from 'node:path'

export const APP_DATA_MIGRATION_MARKER = '.migrated-from-appdata-v1.json'

const LEGACY_APPLICATION_DIRECTORIES = new Set([
  'local storage',
  'manual-library',
])

export interface ApplicationDataDirectories {
  targetDirectory: string
  legacyDirectory: string
}

export interface ResolveApplicationDataOptions {
  isPackaged: boolean
  executablePath: string
  applicationPath: string
  legacyDirectory: string
}

export function resolveApplicationDataDirectories(options: ResolveApplicationDataOptions): ApplicationDataDirectories {
  const targetDirectory = options.isPackaged
    ? path.join(path.dirname(options.executablePath), 'data')
    : path.join(options.applicationPath, '.tmp', 'dev-user-data')
  return {
    targetDirectory: path.resolve(targetDirectory),
    legacyDirectory: path.resolve(options.legacyDirectory),
  }
}

function copyEntryWithoutOverwrite(source: string, target: string): void {
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyEntryWithoutOverwrite(path.join(source, entry.name), path.join(target, entry.name))
    }
    return
  }
  if (!stat.isFile()) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export function migrateLegacyApplicationData(directories: ApplicationDataDirectories): boolean {
  const { legacyDirectory, targetDirectory } = directories
  fs.mkdirSync(targetDirectory, { recursive: true })
  const markerPath = path.join(targetDirectory, APP_DATA_MIGRATION_MARKER)
  if (fs.existsSync(markerPath)) return false

  if (
    legacyDirectory.toLocaleLowerCase() !== targetDirectory.toLocaleLowerCase()
    && fs.existsSync(legacyDirectory)
  ) {
    for (const entry of fs.readdirSync(legacyDirectory, { withFileTypes: true })) {
      const normalizedName = entry.name.toLocaleLowerCase()
      const isApplicationDirectory = entry.isDirectory() && LEGACY_APPLICATION_DIRECTORIES.has(normalizedName)
      const isApplicationFile = entry.isFile() && normalizedName.endsWith('.json')
      if (!isApplicationDirectory && !isApplicationFile) continue
      copyEntryWithoutOverwrite(
        path.join(legacyDirectory, entry.name),
        path.join(targetDirectory, entry.name),
      )
    }
  }

  fs.writeFileSync(markerPath, JSON.stringify({
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    legacyDirectory,
  }, null, 2), 'utf8')
  return true
}
