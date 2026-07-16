import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DcsLaunchService } from '../electron/builtins/dcs-launch/service'

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dcshub-dcs-launch-'))

try {
  const userDataPath = path.join(temporaryRoot, 'user-data')
  const installPath = path.join(temporaryRoot, 'DCS World')
  const binPath = path.join(installPath, 'bin')
  const executablePath = path.join(binPath, 'DCS.exe')
  fs.mkdirSync(binPath, { recursive: true })
  fs.writeFileSync(executablePath, '')

  const service = new DcsLaunchService(userDataPath)
  const selected = service.setInstallPath(installPath)
  assert.equal(selected.source, 'manual')
  assert.equal(selected.installPath, installPath)
  assert.equal(selected.executablePath, executablePath)

  const restored = new DcsLaunchService(userDataPath).status()
  assert.equal(restored.source, 'manual')
  assert.equal(restored.executablePath, executablePath)

  const selectedFromBin = service.setInstallPath(binPath)
  assert.equal(selectedFromBin.installPath, installPath)
  assert.equal(selectedFromBin.executablePath, executablePath)
  assert.throws(() => service.setInstallPath(temporaryRoot), /没有找到/)

  console.log('dcs-launch integration: ok')
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
