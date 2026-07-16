import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { ModManagerService } from '../electron/builtins/mod-manager/service'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-hub-mod-manager-'))
const gamePath = path.join(root, 'DCS')
const savedGamesPath = path.join(root, 'Saved Games', 'DCS')
const modsPath = path.join(root, 'Mods')
const savedGamesModsPath = path.join(root, 'Saved Games Mods')
const backupPath = path.join(root, 'Backups')
const userDataPath = path.join(root, 'UserData')

function write(relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

try {
  write('DCS/Config/shared.lua', 'original')
  write('Saved Games/DCS/Config/shared.lua', 'saved-original')
  write('Mods/Alpha/Config/shared.lua', 'alpha')
  write('Mods/Alpha/Scripts/alpha.lua', 'alpha-new')
  write('Mods/Alpha/description.txt', 'Alpha description')
  write('Mods/Alpha/version.txt', '1.2.3')
  write('Mods/Bravo/Config/shared.lua', 'bravo')
  write('Saved Games Mods/Alpha Saved/Config/shared.lua', 'saved-alpha')

  const zipSource = path.join(root, 'Charlie-source.zip')
  const zip = new AdmZip()
  zip.addFile('Charlie/Scripts/charlie.lua', Buffer.from('charlie'))
  zip.addFile('Charlie/description.txt', Buffer.from('Charlie description'))
  zip.addFile('Charlie/version.txt', Buffer.from('2.0'))
  zip.writeZip(zipSource)

  const service = new ModManagerService(userDataPath, savedGamesPath)
  service.saveSettings({
    gameDirectories: [
      { id: 'dcs-install', name: 'DCS 安装目录', path: gamePath, modsPath },
      { id: 'dcs-saved-games', name: 'DCS Saved Games', path: savedGamesPath, modsPath: savedGamesModsPath },
    ],
    activeGameDirectoryId: 'dcs-install',
    backupPath,
  })

  const configBackup = service.backupSavedGamesConfig(backupPath)
  assert.equal(configBackup.ok, true)
  assert.equal(typeof configBackup.backedUpAt, 'string')
  assert.ok(configBackup.destinationPath)
  assert.equal(
    fs.readFileSync(path.join(configBackup.destinationPath, 'Config', 'shared.lua'), 'utf8'),
    'saved-original',
  )
  assert.equal(service.overview().lastConfigBackupAt, configBackup.backedUpAt)
  const reloadedService = new ModManagerService(userDataPath, savedGamesPath)
  assert.equal(reloadedService.overview().lastConfigBackupAt, configBackup.backedUpAt)

  assert.equal(service.importArchives([zipSource]).ok, true)

  let overview = service.overview()
  assert.equal(overview.mods.length, 3)
  const alpha = overview.mods.find((mod) => mod.name === 'Alpha')!
  const bravo = overview.mods.find((mod) => mod.name === 'Bravo')!
  const charlie = overview.mods.find((mod) => mod.name === 'Charlie-source')!
  assert.equal(alpha.version, '1.2.3')
  assert.equal(charlie.version, '2.0')

  assert.equal(service.setModEnabled(alpha.id, true).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'alpha')
  assert.equal(fs.existsSync(path.join(gamePath, 'description.txt')), false)
  assert.equal(service.setModEnabled(bravo.id, true).ok, false)
  assert.equal(service.setModEnabled(bravo.id, true, true).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'bravo')
  assert.equal(service.setModEnabled(alpha.id, false).ok, false)
  assert.equal(service.setModEnabled(bravo.id, false).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'alpha')
  assert.equal(service.setModEnabled(alpha.id, false).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'original')
  assert.equal(fs.existsSync(path.join(gamePath, 'Scripts/alpha.lua')), false)

  overview = service.selectGameDirectory('dcs-saved-games')
  assert.equal(overview.activeGameDirectory?.id, 'dcs-saved-games')
  assert.equal(overview.enabledCount, 0)
  assert.equal(overview.mods.length, 1)
  assert.equal(overview.mods.some((mod) => mod.name === 'Bravo'), false)
  const savedAlpha = overview.mods.find((mod) => mod.name === 'Alpha Saved')!
  assert.equal(service.setModEnabled(savedAlpha.id, true).ok, true)
  assert.equal(fs.readFileSync(path.join(savedGamesPath, 'Config/shared.lua'), 'utf8'), 'saved-alpha')
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'original')
  overview = service.selectGameDirectory('dcs-install')
  assert.equal(overview.enabledCount, 0)
  assert.equal(service.setModEnabled(charlie.id, true).ok, true)
  overview = service.overview()
  assert.equal(overview.totalModCount, 4)
  assert.equal(overview.totalEnabledCount, 2)
  assert.equal(overview.enabledModKeys.length, 2)
  overview = service.createPreset('Global Flight')
  const globalPreset = overview.presets.find((preset) => preset.name === 'Global Flight')!
  assert.equal(globalPreset.entries.length, 2)
  assert.equal(service.setModEnabled(charlie.id, false).ok, true)
  overview = service.selectGameDirectory('dcs-saved-games')
  assert.equal(overview.enabledCount, 1)
  assert.equal(service.setModEnabled(savedAlpha.id, false).ok, true)
  overview = service.applyPreset(globalPreset.id)
  assert.equal(overview.totalEnabledCount, 2)
  assert.equal(fs.readFileSync(path.join(savedGamesPath, 'Config/shared.lua'), 'utf8'), 'saved-alpha')
  assert.equal(fs.readFileSync(path.join(gamePath, 'Scripts/charlie.lua'), 'utf8'), 'charlie')
  overview = service.disableAllMods()
  assert.equal(overview.totalEnabledCount, 0)
  assert.equal(overview.activePresetId, null)
  assert.equal(fs.readFileSync(path.join(savedGamesPath, 'Config/shared.lua'), 'utf8'), 'saved-original')
  assert.equal(fs.existsSync(path.join(gamePath, 'Scripts/charlie.lua')), false)

  assert.equal(service.setDirectoryModEnabled('dcs-saved-games', savedAlpha.id, true, true).ok, true)
  overview = service.overview()
  assert.equal(overview.activeGameDirectory?.id, 'dcs-saved-games')
  assert.equal(overview.enabledModKeys.includes(`dcs-saved-games:${savedAlpha.id}`), true)
  assert.equal(service.setDirectoryModEnabled('dcs-saved-games', savedAlpha.id, false).ok, true)

  service.selectGameDirectory('dcs-install')
  assert.equal(service.setModEnabled(charlie.id, true).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Scripts/charlie.lua'), 'utf8'), 'charlie')
  assert.equal(service.setModEnabled(charlie.id, false).ok, true)

  assert.equal(service.setModEnabled(alpha.id, true).ok, true)
  fs.rmSync(path.join(modsPath, 'Alpha'), { recursive: true })
  overview = service.overview()
  const missingAlpha = overview.mods.find((mod) => mod.id === alpha.id)!
  assert.equal(missingAlpha.enabled, true)
  assert.match(missingAlpha.description, /源模组已从模组目录移除/)
  assert.equal(service.setModEnabled(alpha.id, false).ok, true)
  assert.equal(fs.readFileSync(path.join(gamePath, 'Config/shared.lua'), 'utf8'), 'original')

  console.log('mod-manager integration: ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
