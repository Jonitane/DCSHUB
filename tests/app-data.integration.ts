import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  APP_DATA_MIGRATION_MARKER,
  migrateLegacyApplicationData,
  resolveApplicationDataDirectories,
} from '../electron/app-data'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcshub-app-data-'))

try {
  const resolved = resolveApplicationDataDirectories({
    isPackaged: true,
    executablePath: path.join(root, 'install', 'DCSHUB.exe'),
    applicationPath: path.join(root, 'source'),
    legacyDirectory: path.join(root, 'legacy'),
  })
  assert.equal(resolved.targetDirectory, path.join(root, 'install', 'data'))

  fs.mkdirSync(path.join(resolved.legacyDirectory, 'manual-library', 'indexes'), { recursive: true })
  fs.mkdirSync(path.join(resolved.legacyDirectory, 'Cache'), { recursive: true })
  fs.mkdirSync(path.join(resolved.legacyDirectory, 'Local Storage', 'leveldb'), { recursive: true })
  fs.mkdirSync(path.join(resolved.legacyDirectory, 'speech-models', 'sensevoice'), { recursive: true })
  fs.writeFileSync(path.join(resolved.legacyDirectory, 'overlay-settings.json'), '{"hotkey":"F10"}')
  fs.writeFileSync(path.join(resolved.legacyDirectory, 'manual-library', 'indexes', 'index.json'), '{"ok":true}')
  fs.writeFileSync(path.join(resolved.legacyDirectory, 'Cache', 'cache.bin'), 'transient')
  fs.writeFileSync(path.join(resolved.legacyDirectory, 'Local Storage', 'leveldb', '000001.log'), 'theme-and-language')
  fs.writeFileSync(path.join(resolved.legacyDirectory, 'speech-models', 'sensevoice', 'model.int8.onnx'), 'legacy-model')

  fs.mkdirSync(resolved.targetDirectory, { recursive: true })
  fs.writeFileSync(path.join(resolved.targetDirectory, 'overlay-settings.json'), '{"hotkey":"F11"}')

  assert.equal(migrateLegacyApplicationData(resolved), true)
  assert.equal(fs.readFileSync(path.join(resolved.targetDirectory, 'overlay-settings.json'), 'utf8'), '{"hotkey":"F11"}')
  assert.equal(fs.readFileSync(path.join(resolved.targetDirectory, 'manual-library', 'indexes', 'index.json'), 'utf8'), '{"ok":true}')
  assert.equal(fs.existsSync(path.join(resolved.targetDirectory, 'Cache')), false)
  assert.equal(fs.readFileSync(path.join(resolved.targetDirectory, 'Local Storage', 'leveldb', '000001.log'), 'utf8'), 'theme-and-language')
  assert.equal(fs.existsSync(path.join(resolved.targetDirectory, 'speech-models')), false)
  assert.equal(fs.existsSync(path.join(resolved.targetDirectory, APP_DATA_MIGRATION_MARKER)), true)
  assert.equal(fs.existsSync(path.join(resolved.legacyDirectory, 'overlay-settings.json')), true)
  assert.equal(migrateLegacyApplicationData(resolved), false)

  const development = resolveApplicationDataDirectories({
    isPackaged: false,
    executablePath: path.join(root, 'electron.exe'),
    applicationPath: path.join(root, 'source'),
    legacyDirectory: path.join(root, 'legacy'),
  })
  assert.equal(development.targetDirectory, path.join(root, 'source', '.tmp', 'dev-user-data'))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('application data integration checks passed')
