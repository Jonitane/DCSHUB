import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UpdateService } from '../electron/builtins/update/service'

function release(tag: string, body: string, options: { draft?: boolean; prerelease?: boolean } = {}) {
  return {
    tag_name: tag,
    name: `DCSHUB ${tag}`,
    body,
    html_url: `https://github.com/Jonitane/DCSHUB/releases/tag/${tag}`,
    published_at: '2026-07-22T00:00:00Z',
    draft: options.draft || false,
    prerelease: options.prerelease || false,
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcshub-update-'))
  try {
    let calls = 0
    let payload: unknown[] = [release('V2.1.7', 'patch only')]
    const fetcher: typeof fetch = async () => {
      calls += 1
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const service = new UpdateService(root, 'V2.1.6', fetcher)
    assert.equal(service.settings().automaticChecks, true)
    assert.deepEqual(await service.check(), { status: 'no-push-update', update: null })
    assert.equal(calls, 1)
    assert.deepEqual(await service.check(), { status: 'no-push-update', update: null })
    assert.equal(calls, 1)

    payload = [
      release('V2.2.2', 'latest patch notes'),
      release('V2.2.0', '<!-- dcshub-push-update -->\nmajor release notes'),
      release('V2.1.9', 'silent patch notes'),
      release('V3.0.0', 'unapproved feature line'),
      release('V3.1.0-beta.1', 'prerelease', { prerelease: true }),
    ]
    const available = await service.check(true)
    assert.equal(available.status, 'available')
    if (available.status !== 'available') throw new Error('Expected an available update')
    assert.equal(available.update.currentVersion, 'V2.1.6')
    assert.equal(available.update.latestVersion, 'V2.2.0')
    assert.equal(available.update.releaseNotes, 'major release notes')
    assert.equal(available.update.downloadUrl, 'https://github.com/Jonitane/DCSHUB/releases/tag/V2.2.0')

    assert.deepEqual(service.setAutomaticChecks(false), { automaticChecks: false })
    assert.deepEqual(await service.check(), { status: 'disabled', update: null })
    const reloaded = new UpdateService(root, 'V2.1.6', fetcher)
    assert.equal(reloaded.settings().automaticChecks, false)
    assert.equal((await reloaded.check()).status, 'disabled')
    console.log('update integration: ok')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
