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
  const url = String(_input)
  if (url.startsWith('https://chucksguides.com/aircraft/dcs/')) {
    return new Response('<a href="https://assets.chucksguides.com/pdf/Test-Guide.pdf">Download</a>', { status: 200 })
  }
  if (url === 'https://assets.chucksguides.com/pdf/Test-Guide.pdf') {
    return new Response(fs.readFileSync(path.join(libraryPath, 'F16', 'Viper manual.pdf')), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    })
  }
  if (url === 'https://api.deepseek.com/anthropic/v1/messages') {
    const onlineBody = JSON.parse(String(init?.body || '{}')) as { model?: string; thinking?: { type?: string }; output_config?: { effort?: string }; tools?: Array<{ type?: string }> }
    assert.equal(onlineBody.model, 'deepseek-v4-pro')
    assert.equal(onlineBody.thinking?.type, 'enabled')
    assert.equal(onlineBody.output_config?.effort, 'max')
    assert.equal(onlineBody.tools?.some((tool) => tool.type === 'web_search_20250305'), true)
    return new Response(JSON.stringify({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'Eagle Dynamics F-16C Manual', url: 'https://www.digitalcombatsimulator.com/en/downloads/documentation/' }] },
        { type: 'text', text: '在线资料核对结果：[Eagle Dynamics 官方文档](https://www.digitalcombatsimulator.com/en/downloads/documentation/)' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const body = JSON.parse(String(init?.body || '{}')) as {
    response_format?: { type?: string }
    messages?: Array<{ role?: string; content?: string }>
  }
  const isConnectionTest = body.messages?.some((message) => message.content?.includes('只回复 OK'))
  const systemText = body.messages?.filter((message) => message.role === 'system').map((message) => message.content || '').join('\n') || ''
  const userText = body.messages?.filter((message) => message.role === 'user').map((message) => message.content || '').join('\n') || ''
  const isHmcsQuestion = /F[\s-]*16[^\n]*(?:头盔|HMCS|JHMCS)[^\n]*(?:标记|指定|designation)/i.test(userText)
  const isHornetHelmetQuestion = /F(?:\s*\/\s*A)?[\s-]*18[^\n]*(?:头盔|HMD|JHMCS)[^\n]*(?:标记|指定|designation|目标)/i.test(userText)
  const isEvidenceAuditor = /证据(?:账本生成器|审校员)/.test(systemText)
  const candidateBlocks = [...userText.matchAll(/\[C(\d+)\][\s\S]*?(?=\n\n\[C|$)/g)]
  const isAirdropQuestion = /(?:用户问题|问题)：[^\n]*(?:C[\s-]*130|空投)/i.test(userText)
  const preferredCandidateOrder = candidateBlocks
    .filter((match) => isHornetHelmetQuestion
      ? /UFC TIME|TIME options/i.test(match[0])
      : isHmcsQuestion
      ? /alignment/i.test(match[0])
      : isAirdropQuestion
      ? /Emergency Equipment|alarm bell/i.test(match[0])
      : userText.includes('航路点')
        ? /Fly-To|route point|AI Helper Controls/i.test(match[0])
        : /acquisition|line.of.sight|CPG|TADS|INS|GND/i.test(match[0]))
    .map((match) => `C${match[1]}`)
    .slice(0, 5)
  const sourceBlocks = [...userText.matchAll(/\[S(\d+)\][^\n]*\n[\s\S]*?(?=\n\n\[S|\n\n待审校草稿|$)/g)]
  const ledger = (pattern: RegExp, text: string, quote: string, explanation = '这一步的作用是完成当前任务的核心动作，照此操作后再观察手册描述的结果。') => {
    const source = sourceBlocks.find((match) => match[0].includes(quote))
      || sourceBlocks.find((match) => pattern.test(match[0]))
    const sourceNumber = Number(source?.[1] || 1)
    return JSON.stringify({ sections: [{ heading: '核心操作', entries: [{ kind: 'step', text, explanation, citations: [sourceNumber], evidence: [{ source: sourceNumber, quote }] }] }] })
  }
  const content = isConnectionTest
    ? 'OK'
    : body.response_format?.type === 'json_object'
      ? isEvidenceAuditor
        ? isHornetHelmetQuestion
          ? ledger(/JHMCS AIR-TO-GROUND MODE/i, '进入 A/G 主模式并使用 Sensor Control Switch Forward 将 TDC priority 交给 HMD，然后按 TDC Designate 完成目标指定。', 'Press Sensor Control Switch Forward to move TDC priority to the HMD. With the aiming reticle visible, press TDC Designate at pilot line-of-sight.')
          : isHmcsQuestion
            ? ledger(/HMCS Ground Target Designation/i, '让 HUD/HMCS 获得控制后，按住 TMS UP LONG 使目标指定框出现在 Dynamic Aiming Cross，再看向目标并按 TMS UP 完成指定。', 'DMS UP makes HUD and HMCS the sensor of interest. Hold TMS UP LONG until the target designation box appears at the Dynamic Aiming Cross. Look at the desired ground target and press TMS UP to designate.')
            : isAirdropQuestion
              ? ledger(/CARP Airdrop Procedure/i, '设置投放区、命中点和退出点，完成 CARP 空投规划。', 'DCS C-130J CARP Airdrop Procedure. Define the drop zone, point of impact, turn point, slowdown point and drop zone escape point.')
              : userText.includes('SOURCE_PRIORITY_CHECK')
                ? ledger(/current official procedure/i, '按照当前客户端官方手册选择 CURRENT MODE。', 'F-16C SOURCE_PRIORITY_CHECK current official procedure: select CURRENT MODE and confirm READY.')
              : userText.includes('航路点')
                ? ledger(/Navigation Fly-To Cue|Right Short/i, '使用 Right Short 命令 George 飞向当前 Navigation Fly-To Cue。', 'Right Short commands George to fly directly to the current Navigation Fly-To Cue and each route point in sequence.')
                : userText.includes('TACAN')
                  ? ledger(/TACAN setup procedure/i, '设置 TACAN 模式、频道以及 X/Y 波段。', 'F-16C TACAN setup procedure: set the mode selector, enter the TACAN channel, select X or Y band, and confirm the station identification.')
                  : ledger(/INS|GND/i, '将 INS selector 设置到 GND 并等待对准完成。', 'For a normal land-based alignment, set the INS selector to GND. Wait until the quality reaches the required value before selecting IFA.')
        : systemText.includes('结构化检索路由器')
        ? JSON.stringify(userText.includes('F-99')
          ? { aircraftCandidates: ['F-99'], aircraftMentioned: true, confidence: 0.99, canonicalTerms: ['radar'], intent: 'operate radar', queries: ['F-99 radar operation'] }
          : userText.includes('SOURCE_PRIORITY_CHECK')
            ? { aircraftCandidates: ['F-16C'], aircraftMentioned: true, confidence: 0.99, canonicalTerms: ['SOURCE_PRIORITY_CHECK'], intent: 'verify source priority', queries: ['F-16C SOURCE_PRIORITY_CHECK current official procedure'] }
          : isHornetHelmetQuestion
            ? { aircraftCandidates: ['F/A-18C'], aircraftMentioned: true, confidence: 0.99, canonicalTerms: ['JHMCS', 'target designation', 'TDC'], coreTaskTerms: ['JHMCS air-to-ground target designation', 'TDC priority HMD TDC Designate designation diamond'], intent: 'F/A-18C JHMCS ground target designation', queries: ['HMD alignment', 'JHMCS ground target designation', 'TDC Designate designation diamond'] }
          : isHmcsQuestion
            ? { aircraftCandidates: ['F-16C'], aircraftMentioned: true, confidence: 0.99, canonicalTerms: ['HMCS', 'target designation'], coreTaskTerms: ['HMCS Ground Target Designation', 'Dynamic Aiming Cross TMS UP LONG', 'HUD Designated Markpoint With HMCS'], intent: 'F-16C HMCS ground target designation', queries: ['HMCS alignment', 'HMCS target designation', 'Dynamic Aiming Cross TMS UP LONG'] }
          : isAirdropQuestion
            ? { aircraftCandidates: ['C-130J'], aircraftMentioned: true, confidence: 0.99, canonicalTerms: ['Airdrop', 'CARP', 'CDS'], intent: 'C-130J airdrop operation procedure', queries: ['C-130J airdrop procedure', 'C-130J CARP setup', 'C-130J cargo delivery system', 'C-130J aerial delivery panel'] }
          : { aircraftCandidates: [], aircraftMentioned: false, confidence: 0, canonicalTerms: [], intent: userText, queries: ['F/A-18C INS alignment GND CV'] })
        : JSON.stringify({ order: preferredCandidateOrder.length > 0 ? preferredCandidateOrder : ['C1', 'C2', 'C3'] })
      : userText.includes('SOURCE_PRIORITY_CHECK')
        ? '按照当前客户端官方手册选择 CURRENT MODE。[S1]'
      : isEvidenceAuditor && isHornetHelmetQuestion
        ? (() => {
            const source = [...userText.matchAll(/\[S(\d+)\][^\n]*\n[^]*?(?=\n\n\[S|\n\n待审校草稿|$)/g)]
              .find((match) => /JHMCS AIR-TO-GROUND|TDC Designate|designation diamond/i.test(match[0]))
            const citation = source ? `[S${source[1]}]` : '[S1]'
            return `这里按 F/A-18C 的 JHMCS 对地目标指定理解。TDC 是油门上的控制器，不是 SPI，也不是指定后的目标状态；Hornet 手册把结果称为目标指定。\n\n1. **指定目标**：\n   * 进入 A/G 主模式并开启 HMD。${citation}\n   * 用 Sensor Control Switch Forward 将 TDC priority 交给 HMD。${citation}\n   * 看向目标并按 TDC Designate；目标位置出现 designation diamond。${citation}`
          })()
        : isHornetHelmetQuestion
          ? '把 TDC 变成 SPI，然后使用 UFC TIME 页面完成目标标记。[S1]'
      : isEvidenceAuditor && isHmcsQuestion
        ? (() => {
            const source = [...userText.matchAll(/\[S(\d+)\][^\n]*\n[^]*?(?=\n\n\[S|\n\n待审校草稿|$)/g)]
              .find((match) => /HMCS Ground Target Designation|Dynamic Aiming Cross/i.test(match[0]))
            const citation = source ? `[S${source[1]}]` : '[S1]'
            return `这里的“标记目标”先按 HMCS 地面目标指定理解；创建 MARKPOINT 和空中雷达锁定是另外两套流程。\n\n1. **设置与操作**：\n   * 让 HUD/HMCS 获得 HOTAS 控制后，长按 TMS UP，使目标指定框出现在头盔的 Dynamic Aiming Cross 上。${citation}\n   * 看向目标区域并短按 TMS UP 完成指定；需要取消时使用手册所述的 TMS DOWN。${citation}`
          })()
        : isHmcsQuestion
          ? '第一步完成 HMCS 校准。[S1]\n\n第二步按下 Sensor Control Switch 锁定目标。'
      : isAirdropQuestion
        ? '先完成 CARP 规划，再设置 Aerial Delivery Panel 并按绿灯执行空投。[S1][S2]'
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

async function writeTextPdf(filePath: string, contents: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([612, 792])
  contents.split('\n').forEach((line, index) => {
    page.drawText(line, { x: 54, y: 730 - index * 20, size: 10, font, maxWidth: 504 })
  })
  const pdf = await document.save({ useObjectStreams: false })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pdf)
}

async function writeMinimalPdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const contents = [
    'F-16C HMCS Power-Up and Alignment. Complete coarse and fine alignment before normal use.',
    'F-16C HMCS Ground Target Designation. DMS UP makes HUD and HMCS the sensor of interest. Hold TMS UP LONG until the target designation box appears at the Dynamic Aiming Cross. Look at the desired ground target and press TMS UP to designate. Press TMS DOWN to undesignate.',
    'F-16C HUD Designated Markpoint With HMCS. Select the MARK page and HUD sensor option. TMS Forward-Long transfers SOI to HMCS. TMS Forward-Short ground stabilizes the Mark Cue, and a second TMS Forward-Short stores the markpoint.',
    'F-16C HMCS Air Target Radar Lock. In BORE submode, hold TMS UP LONG to slave the radar to the helmet line of sight and command STT when the target is detected.',
  ]
  for (const content of contents) {
    const page = document.addPage([612, 792])
    page.drawText(content, { x: 54, y: 720, size: 10, font, maxWidth: 510 })
  }
  const pdf = await document.save({ useObjectStreams: false })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pdf)
}

async function writeHornetHelmetPdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const contents = [
    'F/A-18C UFC TIME options. SET displays the date and time options on the upfront controller.',
    'F/A-18C HMD Alignment. Use the TDC to align the HMD crosses and save alignment.',
    'F/A-18C JHMCS AIR-TO-GROUND MODE. Select A/G Master Mode and power the HMD. Press Sensor Control Switch Forward to move TDC priority to the HMD. With the aiming reticle visible, press TDC Designate at pilot line-of-sight. A designation diamond appears at the designated target.',
    'F/A-18C JHMCS Ground Target Designation Controls. TDC is the Throttle Designator Controller input. TDC priority means which display receives TDC control. TDC Depress designates the target; the resulting state is a target designation, not a TDC or SPI. Undesignate clears the designation.',
  ]
  for (const content of contents) {
    const page = document.addPage([612, 792])
    page.drawText(content, { x: 54, y: 720, size: 10, font, maxWidth: 510 })
  }
  const pdf = await document.save({ useObjectStreams: false })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pdf)
}

async function writeGeorgePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const contents = [
    'TABLE OF CONTENTS\nPlayer-as-CPG AI Helper Controls ................................ 4',
    'AH-64D crew overview',
    'George AI interface modes',
    'Player-as-CPG AI Helper Controls\nFLIGHT AND NAVIGATION\nRight Short commands George to fly directly to the current Navigation Fly-To Cue and each route point in sequence.',
    'Upon reaching the final route point, George establishes a stationary hover.',
    'Additional George AI Features',
  ]
  for (const content of contents) {
    const page = document.addPage([612, 792])
    content.split('\n').forEach((line, index) => page.drawText(line, { x: 54, y: 730 - index * 24, size: 11, font }))
  }
  const pdf = await document.save({ useObjectStreams: false })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, pdf)
}

async function writeC130Pdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const contents = [
    'DCS C-130J route database and navigation overview.',
    'DCS C-130J radio configuration and communication controls.',
    'DCS C-130J Emergency Equipment. The Airdrop Control Panel alarm bell is emergency equipment only.',
    'TABLE OF CONTENTS\nCARP Airdrop Procedure ................................ 6\nAerial Delivery Panel ................................ 8',
    'DCS C-130J general aircraft description and mission history.',
    'DCS C-130J CARP Airdrop Procedure. Define the drop zone, point of impact, turn point, slowdown point and drop zone escape point.',
    'CARP INIT load setup. Select PER, CDS or HE load type, parachute, cargo weight, release system, airdrop speed and stages.',
    'Aerial Delivery Panel. Select COMPUTER DROP AUTO or MAN, prepare the ramp and door, monitor green JUMP and red CAUTION lights, then release cargo.',
    'CARP weather and safety. Enter drop altitude, surface and altitude winds, temperature, obstacle elevation and minimum drop height.',
    'CARP PROG. Confirm load dropped, update remaining cargo weight and enter drop results to correct the next pass.',
  ]
  for (const content of contents) {
    const page = document.addPage([612, 792])
    content.split('\n').forEach((line, index) => page.drawText(line, { x: 48, y: 730 - index * 24, size: 10, font, maxWidth: 520 }))
  }
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
  await writeHornetHelmetPdf(path.join(libraryPath, 'F18', 'Hornet JHMCS manual.pdf'))
  await writeMinimalPdf(path.join(libraryPath, 'F16', 'Viper manual.pdf'))
  write(path.join(libraryPath, 'F16', 'Viper TACAN.txt'), 'F-16C TACAN setup procedure: set the mode selector, enter the TACAN channel, select X or Y band, and confirm the station identification.')
  write(path.join(libraryPath, 'F16', 'Old community procedure.txt'), 'F-16C SOURCE_PRIORITY_CHECK old user procedure: select OLD MODE and confirm LEGACY.')
  write(path.join(libraryPath, 'P51', 'Mustang TACAN.txt'), 'P-51D airbase reference table containing TACAN channel listings only.')
  write(path.join(libraryPath, 'AH64', 'Apache crew sight.txt'), 'AH-64D Pilot rear crewstation can use the CPG front crewstation TADS line of sight as an acquisition source. Select the ACQ source and use SLAVE for cueing.')
  await writeGeorgePdf(path.join(libraryPath, 'AH64', 'DCS AH-64D George AI.pdf'))
  await writeC130Pdf(path.join(libraryPath, 'C130J', 'DCS C-130J User Manual.pdf'))
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.pdf'), 'F/A-18C quick start and cockpit procedures.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start_RU.pdf'), 'Russian language manual should not be copied by the English-only importer.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'Future-X', 'Doc', 'Future Manual.pdf'), 'Future-X radar startup and sensor operation procedure.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'F-16C', 'Doc', 'Priority Guide EN.pdf'), 'F-16C SOURCE_PRIORITY_CHECK current official procedure: select CURRENT MODE and confirm READY.')

  const progressEvents: string[] = []
  const service = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch, (progress) => progressEvents.push(`${progress.operation}:${progress.stage}:${progress.percent}`))
  assert.equal(service.chuckCatalog().length, 33)
  let overview = await service.setLibraryPath(libraryPath)
  assert.equal(overview.onboardingCompleted, false)
  assert.equal(overview.index.documentCount, 10)
  assert.equal(overview.index.state, 'ready')
  assert.ok(overview.index.chunkCount >= 2)
  assert.equal(service.search('Hornet INS alignment')[0]?.aircraft, 'F/A-18C')
  assert.equal(service.search('无线电')[0]?.language, 'zh')
  assert.equal(service.search('F-16C alignment').some((hit) => hit.documentName === 'Viper manual.pdf'), true)
  assert.equal(service.search('TACAN setup', 12, ['F-16C']).every((hit) => hit.aircraft === 'F-16C'), true)

  const firstIndexedAt = overview.index.lastIndexedAt
  const refreshResult = await service.rebuildIndex(false)
  assert.equal(refreshResult.ok, true)
  overview = refreshResult.overview!
  assert.equal(overview.documents.every((document) => document.indexedAt <= overview.index.lastIndexedAt!), true)
  assert.notEqual(overview.index.lastIndexedAt, null)
  assert.ok(firstIndexedAt)

  const duplicateContents = 'F/A-18C carrier landing procedures duplicated from the official manual.'
  const sourceLandingGuide = path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Landing Guide.pdf')
  await writeTextPdf(sourceLandingGuide, duplicateContents)
  const communityLandingGuide = path.join(libraryPath, 'Community', 'Hornet landing copy.pdf')
  const managedLandingGuide = path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Landing Guide.pdf')
  fs.mkdirSync(path.dirname(communityLandingGuide), { recursive: true })
  fs.mkdirSync(path.dirname(managedLandingGuide), { recursive: true })
  fs.copyFileSync(sourceLandingGuide, communityLandingGuide)
  fs.copyFileSync(sourceLandingGuide, managedLandingGuide)

  const imported = await service.importDcsManuals()
  assert.equal(imported.ok, true)
  assert.equal(imported.copied, 3)
  assert.equal(imported.duplicateSkipped, 1)
  assert.equal(imported.removableDuplicates, 1)
  assert.equal(service.overview().index.documentCount, 14)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.pdf')), true)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start_RU.pdf')), false)
  assert.equal(progressEvents.some((event) => event.startsWith('dcs-import:copying:')), true)
  assert.equal(progressEvents.some((event) => event === 'dcs-import:complete:100'), true)
  const cleaned = await service.removeDuplicateDcsManuals()
  assert.equal(cleaned.ok, true)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Landing Guide.pdf')), false)
  assert.equal(service.overview().index.documentCount, 13)
  assert.equal(service.overview().documents.find((document) => document.name === 'Future Manual.pdf')?.aircraft, 'Future-X')
  assert.equal(service.search('radar startup', 8, ['Future-X']).every((source) => source.aircraft === 'Future-X'), true)

  write(path.join(libraryPath, 'F18', 'Carrier landing.txt'), 'Carrier landing pattern and hook procedures.')
  const userRefresh = await service.rebuildIndex(false)
  assert.equal(userRefresh.ok, true)
  assert.ok(service.search('quick start').some((hit) => hit.sourceKind === 'dcs'))
  assert.ok(service.search('carrier landing').some((hit) => hit.sourceKind === 'user'))

  const downloaded = await service.downloadChuckGuide('a-10c')
  assert.equal(downloaded.ok, true)
  assert.ok(service.search('F-16C alignment', 50).some((hit) => hit.sourceKind === 'chuck'))
  assert.equal(progressEvents.some((event) => event.startsWith('chuck-download:downloading:')), true)

  const incomingManual = path.join(root, 'Incoming', 'TACAN notes.txt')
  write(incomingManual, 'TACAN channel selection and air-to-air mode procedures.')
  const added = await service.importManualFiles([incomingManual])
  assert.equal(added.ok, true)
  assert.match(added.message, /已添加 1 份/)
  const duplicateAdd = await service.importManualFiles([incomingManual])
  assert.match(duplicateAdd.message, /跳过 1 份重复内容/)
  assert.equal(service.search('TACAN channel').some((hit) => hit.documentName === 'TACAN notes.txt'), true)
  assert.equal(progressEvents.some((event) => event.startsWith('manual-import:copying:')), true)

  const pdfDocument = service.overview().documents.find((document) => document.name === 'Viper manual.pdf')
  assert.ok(pdfDocument)
  const preview = await service.pagePreview(pdfDocument.id, 1)
  assert.ok(preview?.imageDataUrl.startsWith('data:image/png;base64,'))

  overview = await service.configureDeepSeek('sk-test-deepseek-key')
  assert.equal(overview.deepSeek.configured, true)
  assert.equal(overview.deepSeek.model, 'deepseek-v4-flash')
  const priorityAnswer = await service.ask('F16 SOURCE_PRIORITY_CHECK 怎么设置？')
  assert.match(priorityAnswer.answer, /CURRENT MODE/)
  assert.doesNotMatch(priorityAnswer.answer, /OLD MODE/)
  assert.equal(priorityAnswer.sources[0]?.sourceKind, 'dcs')
  assert.equal(priorityAnswer.sources.some((source) => source.sourceKind === 'dcs'), true)
  const answer = await service.ask('大黄蜂的 INS 应该怎么对准？')
  assert.equal(answer.cached, false)
  assert.match(answer.answer, /GND/)
  assert.ok(answer.sources.length > 0)
  const repeatedAnswer = await service.ask('大黄蜂的 INS 应该怎么对准？')
  assert.equal(repeatedAnswer.cached, true)
  assert.deepEqual(repeatedAnswer.sources.map((source) => source.id), answer.sources.map((source) => source.id))
  assert.equal(repeatedAnswer.answer, answer.answer)

  const onlineAnswer = await service.askOnline('F16怎么用头盔标记一个目标')
  assert.equal(onlineAnswer.cached, false)
  assert.equal(onlineAnswer.model, 'deepseek-v4-pro')
  assert.match(onlineAnswer.answer, /Eagle Dynamics/)
  assert.equal(onlineAnswer.sources[0]?.url, 'https://www.digitalcombatsimulator.com/en/downloads/documentation/')
  const repeatedOnlineAnswer = await service.askOnline('F16怎么用头盔标记一个目标？')
  assert.equal(repeatedOnlineAnswer.cached, true)
  assert.equal(repeatedOnlineAnswer.answer, onlineAnswer.answer)
  assert.ok(service.overview().answerCache.localEntries >= 2)
  assert.equal(service.overview().answerCache.onlineEntries, 1)
  assert.ok(service.overview().answerCache.size > 0)

  const f16Answer = await service.ask('F16塔康怎么设置的？')
  assert.ok(f16Answer.sources.length > 0)
  assert.equal(f16Answer.sources.every((source) => source.aircraft === 'F-16C'), true)
  assert.equal(f16Answer.sources.some((source) => source.documentName === 'Mustang TACAN.txt'), false)

  const f16HelmetVariants = await Promise.all([
    service.ask('F16怎么用头盔标记'),
    service.ask('F16怎么用头盔标记目标'),
  ])
  for (const hmcsAnswer of f16HelmetVariants) {
    assert.equal(hmcsAnswer.sources.every((source) => source.aircraft === 'F-16C'), true)
    assert.equal(hmcsAnswer.sources.some((source) => source.documentName === 'Viper manual.pdf' && source.page === 3), true)
    assert.doesNotMatch(hmcsAnswer.answer, /Sensor Control Switch/i)
    assert.match(hmcsAnswer.answer, /Dynamic Aiming Cross/)
  }
  const f16BaseSources = new Set(f16HelmetVariants[0].sources.map((source) => source.id))
  assert.ok(f16HelmetVariants[1].sources.filter((source) => f16BaseSources.has(source.id)).length >= 1)

  const hornetHelmetVariants = await Promise.all([
    service.ask('F18怎么用头盔标记'),
    service.ask('F18怎么用头盔标记目标'),
    service.ask('F/A-18C如何使用JHMCS指定地面目标'),
  ])
  for (const hornetAnswer of hornetHelmetVariants) {
    assert.ok(hornetAnswer.sources.length > 0)
    assert.equal(hornetAnswer.sources.every((source) => source.aircraft === 'F/A-18C'), true)
    assert.equal(hornetAnswer.sources.some((source) => source.documentName === 'Hornet JHMCS manual.pdf' && source.page === 3), true)
    assert.equal(hornetAnswer.sources.some((source) => source.documentName === 'Hornet JHMCS manual.pdf' && source.page === 1), false)
    assert.doesNotMatch(hornetAnswer.answer, /没有通过来源核对|TDC\s*(?:变成|等于|就是)\s*SPI/i)
    assert.match(hornetAnswer.answer, /TDC/)
    assert.match(hornetAnswer.answer, /designation|目标指定/i)
  }
  const baseSourceIds = new Set(hornetHelmetVariants[0].sources.map((source) => source.id))
  for (const variant of hornetHelmetVariants.slice(1)) {
    const overlap = variant.sources.filter((source) => baseSourceIds.has(source.id)).length
    assert.ok(overlap >= Math.ceil(Math.min(baseSourceIds.size, variant.sources.length) * 0.5))
  }

  const apacheAnswer = await service.ask('阿帕奇后座怎么看前座瞄准的位置？')
  assert.ok(apacheAnswer.sources.length > 0)
  assert.equal(apacheAnswer.sources.every((source) => source.aircraft === 'AH-64D'), true)
  assert.equal(apacheAnswer.sources.some((source) => source.documentName === 'Apache crew sight.txt'), true)

  const georgeAnswer = await service.ask('阿帕奇的AI怎么让他飞向航路点？')
  assert.ok(georgeAnswer.sources.length > 0)
  assert.equal(georgeAnswer.sources.every((source) => source.aircraft === 'AH-64D'), true)
  assert.equal(georgeAnswer.sources.some((source) => source.documentName === 'DCS AH-64D George AI.pdf' && source.page === 4), true)

  const c130Answer = await service.ask('C130如何空投')
  assert.ok(c130Answer.sources.length >= 3)
  assert.equal(c130Answer.sources.every((source) => source.aircraft === 'C-130J'), true)
  assert.equal(c130Answer.sources.some((source) => source.page === 6), true)
  assert.equal(c130Answer.sources.some((source) => source.page === 7 || source.page === 8), true)
  assert.equal(c130Answer.sources.some((source) => source.page === 3), false)
  const repeatedC130Answer = await service.ask('C130如何空投')
  assert.deepEqual(repeatedC130Answer.sources.map((source) => source.id), c130Answer.sources.map((source) => source.id))
  const phrasedC130Answer = await service.ask('C130怎么进行空投操作？')
  assert.equal(phrasedC130Answer.sources.some((source) => source.page === 6), true)
  assert.equal(phrasedC130Answer.sources.some((source) => source.page === 3), false)

  const unavailableAnswer = await service.ask('F-99 的雷达怎么开？')
  assert.equal(unavailableAnswer.cached, false)
  assert.equal(unavailableAnswer.sources.length, 0)
  assert.match(unavailableAnswer.answer, /没有匹配的该机型资料/)
  const repeatedUnavailableAnswer = await service.ask('F-99 的雷达怎么开')
  assert.equal(repeatedUnavailableAnswer.cached, true)
  assert.equal(repeatedUnavailableAnswer.answer, unavailableAnswer.answer)

  overview = service.completeOnboarding()
  assert.equal(overview.onboardingCompleted, true)

  const reloaded = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch)
  assert.equal(reloaded.overview().deepSeek.configured, true)
  assert.equal(reloaded.overview().deepSeek.model, 'deepseek-v4-flash')
  assert.equal(reloaded.overview().onboardingCompleted, true)
  assert.equal(reloaded.overview().index.documentCount, 17)
  assert.ok(reloaded.search('quick start').length > 0)
  const persistedAnswer = await reloaded.ask('C130如何空投')
  assert.equal(persistedAnswer.cached, true)
  assert.equal(persistedAnswer.answer, c130Answer.answer)
  assert.deepEqual(persistedAnswer.sources.map((source) => source.id), c130Answer.sources.map((source) => source.id))
  assert.match(persistedAnswer.answer, /这一步的作用/)
  const persistedOnlineAnswer = await reloaded.askOnline('F16怎么用头盔标记一个目标')
  assert.equal(persistedOnlineAnswer.cached, true)

  console.log('manual-library integration: ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
