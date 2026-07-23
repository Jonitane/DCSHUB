import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DiagnosticLogger } from '../electron/logging/diagnostic-logger'

async function main(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dcshub-logging-'))
  try {
    const logger = new DiagnosticLogger(directory)
    const secret = 'sk-this-must-never-be-written'
    logger.info('test', 'started', {
      apiKey: secret,
      nested: { password: 'private-password' },
      executable: path.join(os.homedir(), 'Games', 'tool.exe'),
      authorization: 'Bearer private-token',
    })
    logger.error('test', 'failed', new Error(`Failure at ${os.homedir()} using ${secret}`))
    logger.emergency('test', 'crashed', new Error(`Crash at ${os.homedir()} using ${secret}`))
    await logger.flush()

    const output = fs.readFileSync(path.join(directory, 'dcshub.log'), 'utf8')
    const lines = output.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.equal(lines.length, 2)
    assert.equal(lines[0].level, 'info')
    assert.equal(lines[1].level, 'error')
    assert.match(output, /%USERPROFILE%/)
    assert.match(output, /\[REDACTED\]/)
    assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(output, /private-password|private-token/)
    assert.doesNotMatch(output, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    const crashOutput = fs.readFileSync(path.join(directory, 'dcshub-crash.log'), 'utf8')
    assert.match(crashOutput, /uncaught|crashed|Crash/)
    assert.match(crashOutput, /%USERPROFILE%/)
    assert.doesNotMatch(crashOutput, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    console.log('Diagnostic logging integration checks passed.')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
