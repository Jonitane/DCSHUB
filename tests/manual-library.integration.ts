import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { ManualLibraryService } from '../electron/builtins/manual-library/service'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-hub-manual-library-'))
const userDataPath = path.join(root, 'UserData')
const libraryPath = path.join(root, 'Manuals')
const dcsPath = path.join(root, 'DCS World')

const protector = {
  available: () => true,
  protect: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  unprotect: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
}

const fakeFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || '{}')) as {
    response_format?: { type?: string }
    messages?: Array<{ content?: string }>
  }
  const isConnectionTest = body.messages?.some((message) => message.content?.includes('只回复 OK'))
  const content = isConnectionTest
    ? 'OK'
    : body.response_format?.type === 'json_object'
      ? JSON.stringify({ queries: ['F/A-18C INS alignment GND CV'] })
      : '将 INS 旋钮置于 GND，并按照手册等待对准完成。[S1]'
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function write(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents, 'utf8')
}

async function writeMinimalPdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([612, 792])
  page.drawText('F-16C INS alignment manual', { x: 72, y: 720, size: 12, font })
  const pdf = await document.save({ useObjectStreams: false })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pdf)
}

async function main(): Promise<void> {
try {
  write(path.join(libraryPath, 'F18', 'Hornet startup.md'), `
# F/A-18C INS Alignment

For a normal land-based alignment, set the INS selector to GND. Wait until the quality reaches the required value before selecting IFA.
`)
  write(path.join(libraryPath, '中文', '无线电.txt'), 'F/A-18C 无线电设置：选择 COMM 频道，然后输入预设频率。')
  await writeMinimalPdf(path.join(libraryPath, 'F16', 'Viper manual.pdf'))
  write(path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.txt'), 'F/A-18C quick start and cockpit procedures.')

  const service = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch)
  let overview = await service.setLibraryPath(libraryPath)
  assert.equal(overview.index.documentCount, 3)
  assert.equal(overview.index.state, 'ready')
  assert.ok(overview.index.chunkCount >= 2)
  assert.equal(service.search('Hornet INS alignment')[0]?.aircraft, 'F/A-18C')
  assert.equal(service.search('无线电')[0]?.language, 'zh')
  assert.equal(service.search('F-16C alignment').some((hit) => hit.documentName === 'Viper manual.pdf'), true)

  const firstIndexedAt = overview.index.lastIndexedAt
  const refreshResult = await service.rebuildIndex(false)
  assert.equal(refreshResult.ok, true)
  overview = refreshResult.overview!
  assert.equal(overview.documents.every((document) => document.indexedAt <= overview.index.lastIndexedAt!), true)
  assert.notEqual(overview.index.lastIndexedAt, null)
  assert.ok(firstIndexedAt)

  const imported = await service.importDcsManuals()
  assert.equal(imported.ok, true)
  assert.equal(imported.copied, 1)
  assert.equal(service.overview().index.documentCount, 4)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.txt')), true)

  overview = await service.configureDeepSeek('sk-test-deepseek-key', 'deepseek-v4-flash')
  assert.equal(overview.deepSeek.configured, true)
  const answer = await service.ask('大黄蜂的 INS 应该怎么对准？')
  assert.match(answer.answer, /GND/)
  assert.ok(answer.sources.length > 0)

  const reloaded = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch)
  assert.equal(reloaded.overview().deepSeek.configured, true)
  assert.equal(reloaded.overview().index.documentCount, 4)
  assert.ok(reloaded.search('quick start').length > 0)

  console.log('manual-library integration: ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
