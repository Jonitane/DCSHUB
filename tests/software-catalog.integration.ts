import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModuleManager } from '../electron/modules/ModuleManager'
import type { ModuleDriver } from '../electron/modules/types'
import { SoftwareCatalogService } from '../electron/builtins/software-catalog/service'
import { startProcessTreeMinimizeWatcher } from '../electron/integrations/windows-process'

function builtinDriver(executableOverride?: string | null): ModuleDriver {
  return {
    manifest: {
      id: 'builtin-test',
      displayName: 'Built-in Test',
      description: '',
      version: '1',
      executablePath: executableOverride || 'C:\\Tools\\BuiltIn.exe',
      dependencies: [],
      capabilities: { lifecycle: false, settings: false, showWindow: false, logs: false },
      stopPolicy: 'never',
    },
    async discover() { return { installState: 'installed', runState: 'stopped' } },
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-hub-software-catalog-'))
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())))
  try {
    const manager = new ModuleManager()
    const catalog = new SoftwareCatalogService(root, manager, [{ id: 'builtin-test', createDriver: builtinDriver }], false)
    await manager.initialize()

    assert.equal(catalog.overview().items[0].enabled, true)
    assert.equal(catalog.overview().items[0].silentLaunch, true)
    assert.equal(catalog.setSilentLaunch('builtin-test', false).items[0].silentLaunch, false)
    assert.equal(catalog.setSilentLaunch('builtin-test', true).items[0].silentLaunch, true)
    await catalog.setEnabled('builtin-test', false)
    assert.equal(manager.list().length, 0)
    await catalog.setEnabled('builtin-test', true)
    assert.equal(manager.list().length, 1)
    const selectedBuiltin = path.join(root, 'Selected BuiltIn.exe')
    fs.writeFileSync(selectedBuiltin, '')
    assert.equal((await catalog.setBuiltinExecutable('builtin-test', selectedBuiltin)).items[0].executablePath, selectedBuiltin)
    assert.equal((await catalog.useAutomaticDetection()).items[0].executablePath, 'C:\\Tools\\BuiltIn.exe')

    const customExecutable = path.join(root, '飞行工具.exe')
    fs.writeFileSync(customExecutable, '')
    const added = await catalog.addExecutable(customExecutable, null)
    const custom = added.items.find((item) => item.kind === 'custom')
    assert.ok(custom)
    assert.equal(custom.displayName, '飞行工具')
    assert.equal(custom.enabled, true)
    assert.equal(custom.executablePath, customExecutable)
    assert.equal((await catalog.remove(custom.id)).items.some((item) => item.id === custom.id), false)

    const watcher = startProcessTreeMinimizeWatcher(process.pid, 'dcs-hub-no-window.exe', 1_000)
    watcher.ref()
    const watcherExitCode = await new Promise<number | null>((resolve, reject) => {
      watcher.once('error', reject)
      watcher.once('exit', resolve)
    })
    assert.equal(watcherExitCode, 0)
    await manager.dispose()

    let directRunning = false
    let silentStartCalls = 0
    let directStartCalls = 0
    const directManager = new ModuleManager()
    directManager.register({
      manifest: {
        id: 'direct-test', displayName: 'Direct Test', description: '', version: '1', dependencies: [],
        capabilities: { lifecycle: true, settings: false, showWindow: true, logs: false }, stopPolicy: 'always',
      },
      async discover() { return { installState: 'installed', runState: directRunning ? 'running' : 'stopped' } },
      async start() { silentStartCalls += 1; directRunning = true },
      async stop() { directRunning = false },
      async showWindow() { directStartCalls += 1; directRunning = true },
    })
    directManager.setSilentLaunchPreference('direct-test', false)
    await directManager.initialize()
    assert.equal((await directManager.start('direct-test')).ok, true)
    assert.equal(directStartCalls, 1)
    assert.equal(silentStartCalls, 0)
    await directManager.dispose()

    const focusManager = new ModuleManager()
    focusManager.register({
      manifest: {
        id: 'focus-test', displayName: 'Focus Test', description: '', version: '1', dependencies: [],
        capabilities: { lifecycle: false, settings: false, showWindow: false, logs: false }, stopPolicy: 'never',
      },
      async discover() { return { installState: 'installed', runState: 'stopped' } },
    })
    focusManager.setMonitoringActive(false)
    await focusManager.initialize()
    assert.equal((focusManager as unknown as { monitorTimer: unknown }).monitorTimer, null)
    focusManager.setMonitoringActive(true)
    assert.notEqual((focusManager as unknown as { monitorTimer: unknown }).monitorTimer, null)
    focusManager.setMonitoringActive(false)
    assert.equal((focusManager as unknown as { monitorTimer: unknown }).monitorTimer, null)
    await focusManager.dispose()

    const packagedManager = new ModuleManager()
    const packagedCatalog = new SoftwareCatalogService(root, packagedManager, [{ id: 'builtin-test', createDriver: builtinDriver }], true)
    await packagedManager.initialize()
    assert.equal(packagedCatalog.overview().needsInitialSetup, true)
    await packagedCatalog.completeInitialSetup([])
    assert.equal(packagedCatalog.overview().needsInitialSetup, false)
    assert.equal(packagedManager.list().length, 0)
    await packagedManager.dispose()

    console.log('software-catalog integration: ok')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
