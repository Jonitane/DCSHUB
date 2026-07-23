import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { deterministicFocusEvidenceScore, deterministicProcedureCompleteness, deterministicQuestionSemantics, localQuestionRequiresOnlineSearch, ManualLibraryService } from '../electron/builtins/manual-library/service'
import { verifiedEvidenceLedger } from '../electron/builtins/manual-library/evidence-auditor'
import { classifyManualSource, manualAuthority } from '../electron/builtins/manual-library/source-classifier'
import { normalizeDcsSpeechTranscript } from '../electron/builtins/manual-library/speech-normalizer'
import { resolveWeaponVariantQuestion, weaponVariantEvidenceScore } from '../electron/builtins/manual-library/weapon-ontology'

const chuckClassification = classifyManualSource({
  relativePath: 'misc/guide.pdf',
  contentSample: "Chuck's Guides DCS F-16C Viper — Version 2.1",
  language: 'en',
  aircraft: 'F-16C',
  storageKind: 'user',
})
assert.equal(chuckClassification.sourceKind, 'chuck')
assert.equal(manualAuthority(chuckClassification), 400)
const heatblurOfficialClassification = classifyManualSource({
  relativePath: "Chuck's Guides/F-14/F-14 Manual.pdf",
  contentSample: 'Heatblur Simulations F-14 Tomcat Flight Manual. Aircraft systems and operating procedures.',
  language: 'en',
  aircraft: 'F-14',
  storageKind: 'chuck',
})
assert.equal(heatblurOfficialClassification.sourceKind, 'dcs')
assert.equal(heatblurOfficialClassification.classificationConfidence, 'high')
assert.equal(manualAuthority(heatblurOfficialClassification), 300)
const heatblurRecommendationClassification = classifyManualSource({
  relativePath: 'DCS Manuals/F14/F-14 Manual.pdf',
  contentSample: "F-14 Tomcat Manual. Heatblur F-14 Tomcat. For a hands-on approach it is recommended to check out Chuck's Guide as well.",
  language: 'en',
  aircraft: 'F-14',
  storageKind: 'chuck',
})
assert.equal(heatblurRecommendationClassification.sourceKind, 'dcs')
assert.match(deterministicQuestionSemantics('F14 的不死鸟怎么用'), /F-14/)
assert.match(deterministicQuestionSemantics('F14 的不死鸟怎么用'), /AIM-54 Phoenix/)
assert.match(deterministicQuestionSemantics('F14CASE3'), /F-14/)
assert.match(deterministicQuestionSemantics('F14CASE3'), /Carrier operations/)
assert.match(deterministicQuestionSemantics('F18 case 1'), /Carrier operations/)
assert.match(deterministicQuestionSemantics('大黄蜂怎么投宝石路'), /Paveway LGB/)
assert.match(deterministicQuestionSemantics('大黄蜂怎么投宝石路'), /GBU-10\/12\/16\/24/)
assert.match(deterministicQuestionSemantics('用小牛和哈姆攻击目标'), /AGM-65 Maverick/)
assert.match(deterministicQuestionSemantics('用小牛和哈姆攻击目标'), /AGM-88 HARM/)
assert.match(deterministicQuestionSemantics('阿帕奇的地狱火怎么用'), /AGM-114 Hellfire/)
assert.match(deterministicQuestionSemantics('阿帕奇的地狱火怎么用'), /AGM-114K.*AGM-114L/)
assert.match(deterministicQuestionSemantics('阿帕奇的 AGM-114L 怎么用'), /AGM-114L.*不得混入同族其他型号/)
assert.match(deterministicQuestionSemantics('A10 的小牛怎么用'), /AGM-65A\/B.*AGM-65D\/G.*AGM-65H\/K.*AGM-65E\/E2\/L/)
assert.match(deterministicQuestionSemantics('F16 的 GBU 怎么用'), /Bombs\/GBU\/LGB\/JDAM/)
assert.equal(normalizeDcsSpeechTranscript('F18怎么丢节达姆'), 'F/A-18C怎么丢JDAM')
assert.equal(normalizeDcsSpeechTranscript('F18怎么丢激光杰达姆'), 'F/A-18C怎么丢LJDAM')
assert.equal(normalizeDcsSpeechTranscript('j d a m 怎么投放'), 'JDAM 怎么投放')
assert.equal(normalizeDcsSpeechTranscript('iPhone怎么用不死鸟'), 'F-14怎么用不死鸟')
assert.equal(normalizeDcsSpeechTranscript('F fourteen怎么冷启动'), 'F-14怎么冷启动')
assert.equal(normalizeDcsSpeechTranscript('F十六怎么设置塔康'), 'F-16C怎么设置TACAN')
assert.equal(normalizeDcsSpeechTranscript('F A eighteen怎么着舰'), 'F/A-18C怎么着舰')
assert.equal(normalizeDcsSpeechTranscript('A H sixty four怎么用地狱火'), 'AH-64D怎么用地狱火')
assert.equal(normalizeDcsSpeechTranscript('M I G twenty nine怎么锁定'), 'MiG-29怎么锁定')
assert.equal(normalizeDcsSpeechTranscript('S U twenty seven怎么发射导弹'), 'Su-27怎么发射导弹')
assert.match(deterministicQuestionSemantics(normalizeDcsSpeechTranscript('iPhone怎么用不死鸟')), /F-14/)
assert.match(deterministicQuestionSemantics('F18怎么丢节达姆'), /JDAM（GBU-31\/32\/38）/)
assert.doesNotMatch(deterministicQuestionSemantics('F18怎么丢节达姆'), /ATFLIR/)
assert.equal(localQuestionRequiresOnlineSearch('F18怎么用'), true)
assert.equal(localQuestionRequiresOnlineSearch('这个怎么弄'), true)
assert.equal(localQuestionRequiresOnlineSearch('啊啊啊'), true)
assert.equal(localQuestionRequiresOnlineSearch('F18怎么丢节达姆'), false)
assert.equal(localQuestionRequiresOnlineSearch('F18座舱盖怎么开'), false)
assert.equal(localQuestionRequiresOnlineSearch('F18冷启动'), false)
assert.ok(deterministicFocusEvidenceScore('F14 的不死鸟怎么用', 'AIM-54 Phoenix missile employment with the AWG-9 radar') > 0)
assert.equal(deterministicFocusEvidenceScore('F14 的不死鸟怎么用', 'F-14 acronyms and cockpit abbreviations'), 0)
assert.ok(deterministicFocusEvidenceScore('阿帕奇的地狱火怎么用', 'AGM-114 Hellfire SAL and RF missile operation') > 0)
assert.equal(deterministicFocusEvidenceScore('阿帕奇的地狱火怎么用', 'AGM-114K Hellfire Missile Operation by Multicrew'), 1)
assert.equal(deterministicFocusEvidenceScore('阿帕奇的地狱火怎么用', 'AH-64D Hydra rocket employment'), 0)
const vagueHellfire = resolveWeaponVariantQuestion('阿帕奇的地狱火怎么用')[0]
assert.equal(vagueHellfire.explicitVariants.length, 0)
assert.deepEqual(vagueHellfire.ambiguousVariants.map((variant) => variant.id), ['agm-114k', 'agm-114l'])
const explicitHellfireL = resolveWeaponVariantQuestion('阿帕奇 AGM-114L 怎么用')[0]
assert.deepEqual(explicitHellfireL.explicitVariants.map((variant) => variant.id), ['agm-114l'])
assert.ok(weaponVariantEvidenceScore(explicitHellfireL.explicitVariants[0], 'AGM-114L RF Missile Type and FCR target data') > 0)
const vagueMaverick = resolveWeaponVariantQuestion('F16 小牛怎么用')[0]
assert.equal(vagueMaverick.ambiguousVariants.length, 4)
assert.deepEqual(resolveWeaponVariantQuestion('F16 激光小牛怎么用')[0].explicitVariants.map((variant) => variant.id), ['agm-65-laser'])
assert.deepEqual(resolveWeaponVariantQuestion('F16 AGM-65D怎么用')[0].explicitVariants.map((variant) => variant.id), ['agm-65-ir'])
assert.deepEqual(resolveWeaponVariantQuestion('F14 不死鸟怎么选')[0].ambiguousVariants.map((variant) => variant.id), ['aim-54a-mk47', 'aim-54a-mk60', 'aim-54c-mk47', 'aim-54c-mk60'])
assert.deepEqual(resolveWeaponVariantQuestion('苏27的R-27ET怎么用')[0].explicitVariants.map((variant) => variant.id), ['r-27-ir'])
assert.deepEqual(resolveWeaponVariantQuestion('F18用鱼叉怎么打船')[0].explicitVariants.map((variant) => variant.id), ['agm-84d'])
assert.deepEqual(resolveWeaponVariantQuestion('F18 AGM-84怎么用')[0].ambiguousVariants.map((variant) => variant.id), ['agm-84d', 'agm-84e', 'agm-84hk'])
assert.deepEqual(resolveWeaponVariantQuestion('A10 GBU-12怎么投')[0].explicitVariants.map((variant) => variant.id), ['paveway-ii'])
assert.ok(deterministicFocusEvidenceScore('F16 的 GBU 怎么用', 'GBU-12 laser guided bomb delivery procedure') > 0)
assert.equal(deterministicFocusEvidenceScore('F16 的 GBU 怎么用', 'F-16C air-to-air TWS radar designation'), 0)
assert.deepEqual(
  deterministicProcedureCompleteness('F18冷启动', 'START-UP PROCEDURE\nCOCKPIT PREPARATION\nENGINE START\nINS ALIGNMENT\nPOST-START CHECKS READY TO TAXI'),
  ['preparation', 'power-engine', 'navigation-alignment', 'post-start'],
)
assert.deepEqual(
  deterministicProcedureCompleteness('F14BU冷启动', 'Jester Assisted Startup. Select INS alignment when requested.'),
  ['navigation-alignment'],
)
assert.deepEqual(
  deterministicProcedureCompleteness('F14的不死鸟怎么用', 'AIM-54 employment: verify loadout, select weapon and radar, acquire and lock the target, launch, then observe time to impact and breakaway limits.'),
  ['prerequisites-loadout', 'mode-sensor-setup', 'acquire-designate', 'release-launch', 'post-release-limits'],
)
assert.deepEqual(
  deterministicProcedureCompleteness('TACAN怎么设置', 'Power the UFC, enter the channel, confirm the selection, and check the displayed status and warning.'),
  ['power-entry', 'configure-input', 'execute-confirm', 'feedback-limits'],
)
assert.deepEqual(
  deterministicProcedureCompleteness('空中加油怎么做', 'Set the correct configuration and speed, enter pre-contact, maintain position to connect, observe the signal, then disconnect or breakaway.'),
  ['conditions-configuration', 'entry', 'execution', 'criteria-feedback', 'abort-exit'],
)

const chuckBylineClassification = classifyManualSource({
  relativePath: 'User Manuals/DCS F-16C Viper Guide.pdf',
  contentSample: 'DCS GUIDE F-16CM VIPER BLOCK 50 BY CHUCK\nLast Updated: 20 July 2026\nThis guide refers to Eagle Dynamics official manuals.',
  language: 'en',
  aircraft: 'F-16C',
  storageKind: 'user',
})
assert.equal(chuckBylineClassification.sourceKind, 'chuck')
assert.equal(chuckBylineClassification.classificationConfidence, 'high')
assert.equal(manualAuthority(chuckBylineClassification), 400)

const translatedOfficial = classifyManualSource({
  relativePath: 'uploads/F-16中文.pdf',
  contentSample: 'DCS F-16C Flight Manual EAGLE DYNAMICS 用户汉化版 译者：测试',
  language: 'zh',
  aircraft: 'F-16C',
  storageKind: 'user',
})
assert.equal(translatedOfficial.sourceKind, 'user')
assert.equal(translatedOfficial.isTranslation, true)
assert.equal(translatedOfficial.translatedFrom, 'dcs')

const nonFullClickOfficial = classifyManualSource({
  relativePath: 'DCS Manuals/F-15C.pdf',
  contentSample: 'DCS F-15C Flight Manual EAGLE DYNAMICS Flaming Cliffs',
  language: 'en',
  aircraft: 'F-15C',
  storageKind: 'dcs',
})
assert.equal(nonFullClickOfficial.officialModuleType, 'non-full-click')
assert.equal(manualAuthority(nonFullClickOfficial), 100)

const normalizedLedger = verifiedEvidenceLedger({
  title: 'F-14 JDAM 预规划投放',
  overview: { text: '该流程用于投放已经装载任务坐标的 JDAM。', citations: [1] },
  sections: [
  { heading: '完整操作流程', entries: [
    { kind: 'prerequisite', text: '- 完整操作流程：挂载 GBU-31\n并完成任务数据装载。', explanation: '开始投放前确认。', citations: [1] },
    { kind: 'step', text: '1. 打开 JMSN 页面\n- 查看任务数据。', explanation: '确认目标数据存在。', citations: [1] },
  ] },
  { heading: 'Weapon Control Panel', entries: [
    { kind: 'step', text: '2. 设置投放模式。', explanation: '', citations: [2] },
    { kind: 'result', text: '页面显示 READY。', explanation: '', citations: [2] },
    { kind: 'warning', text: '设置投放模式。', explanation: '重复事实不应再次显示。', citations: [2] },
  ] },
] }, 2)
assert.ok(normalizedLedger)
assert.match(normalizedLedger, /^## F-14 JDAM 预规划投放/m)
assert.match(normalizedLedger, /该流程用于投放已经装载任务坐标的 JDAM。 \[S1\]/)
assert.match(normalizedLedger, /### 前提条件/)
assert.match(normalizedLedger, /### 操作说明/)
assert.doesNotMatch(normalizedLedger, /\*\*完整操作流程\*\*/)
assert.equal((normalizedLedger.match(/^1\. /gm) || []).length, 1)
assert.match(normalizedLedger, /^1\. 打开 JMSN 页面；查看任务数据。/m)
assert.match(normalizedLedger, /^2\. 设置投放模式。/m)
assert.equal((normalizedLedger.match(/设置投放模式。/g) || []).length, 1)
assert.doesNotMatch(normalizedLedger, /成功判断|页面显示 READY/)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-hub-manual-library-'))
const userDataPath = path.join(root, 'UserData')
const libraryPath = path.join(root, 'Manuals')
const dcsPath = path.join(root, 'DCS World')

const protector = {
  available: () => true,
  protect: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  unprotect: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
}

let onlineRequestCount = 0
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
    onlineRequestCount += 1
    const onlineBody = JSON.parse(String(init?.body || '{}')) as { model?: string; thinking?: { type?: string }; output_config?: { effort?: string }; tools?: Array<{ type?: string }>; system?: string; messages?: Array<{ content?: Array<{ text?: string }> }> }
    assert.equal(onlineBody.model, 'deepseek-v4-pro')
    assert.equal(onlineBody.thinking?.type, 'enabled')
    assert.equal(onlineBody.output_config?.effort, 'max')
    assert.equal(onlineBody.tools?.some((tool) => tool.type === 'web_search_20250305'), true)
    assert.match(onlineBody.system || '', /同一次请求中完成联网检索、来源核对和最终答案生成/)
    assert.match(onlineBody.messages?.[0]?.content?.[0]?.text || '', /DCSHUB 本地确定性语义解析/)
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
  const askedQuestion = userText.match(/(?:用户问题|问题)：([^\n]+)/)?.[1] || ''
  const isAmbiguousHornetHelmetQuestion = isHornetHelmetQuestion
    && !/(?:空中目标|空对空|敌机|A\/A|地面目标|空对地|对地|A\/G|标记点|MARKPOINT)/i.test(askedQuestion)
  const isAmbiguousHmcsQuestion = isHmcsQuestion
    && !/(?:空中目标|空对空|敌机|A\/A|地面目标|空对地|对地|A\/G|标记点|MARKPOINT)/i.test(askedQuestion)
  const isEvidenceAuditor = /证据(?:账本生成器|审校员)/.test(systemText)
  const isOnePassAnswer = systemText.includes('结构化证据条目')
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
    const exactQuote = source?.[0].replace(/\s+/g, ' ').includes(quote.replace(/\s+/g, ' ')) ? quote : source?.[0].match(pattern)?.[0] || quote
    return JSON.stringify({ sections: [{ heading: '核心操作', entries: [{ kind: 'step', text, explanation, citations: [sourceNumber], evidence: [{ source: sourceNumber, quote: exactQuote }] }] }] })
  }
  const hornetAmbiguousLedger = () => {
    const entry = (heading: string, text: string, quote: string, fallbackPattern?: RegExp) => {
      const source = sourceBlocks.find((match) => match[0].includes(quote))
        || (fallbackPattern ? sourceBlocks.find((match) => fallbackPattern.test(match[0])) : undefined)
      const sourceNumber = Number(source?.[1] || 1)
      const exactQuote = source?.[0].replace(/\s+/g, ' ').includes(quote.replace(/\s+/g, ' ')) ? quote : source?.[0].match(fallbackPattern || /$^/)?.[0] || quote
      return { heading, entry: { kind: 'step', text, explanation: '', citations: [sourceNumber], evidence: [{ source: sourceNumber, quote: exactQuote }] } }
    }
    const entries = [
      entry('情况一：空对空目标获取/锁定', '选择 A/A Master Mode 和 AIM-9。', 'Select A/A Master Mode and AIM-9.'),
      entry('情况一：空对空目标获取/锁定', '看向空中目标并按住 Cage/Uncage，让 AIM-9 seeker 指向 HMD line of sight。', 'Press and hold Cage/Uncage to command the AIM-9 seeker to the HMD line of sight'),
      entry('情况二：空对地目标指定', '选择 A/G Master Mode 并开启 HMD。', 'Select A/G Master Mode and power the HMD.'),
      entry('情况二：空对地目标指定', '把 TDC priority 交给 HMD。', 'TDC priority to the HMD', /TDC\s+priority\s+to\s+the\s+HMD/i),
      entry('情况二：空对地目标指定', '按 TDC Designate 完成目标指定。', 'press TDC Designate', /press\s+TDC\s+Designate/i),
    ]
    return JSON.stringify({ sections: [...new Set(entries.map((item) => item.heading))].map((heading) => ({ heading, entries: entries.filter((item) => item.heading === heading).map((item) => item.entry) })) })
  }
  const hornetGroundLedger = () => {
    const source = sourceBlocks.find((match) => /JHMCS AIR-TO-GROUND MODE/i.test(match[0]))
    const sourceNumber = Number(source?.[1] || 1)
    const evidence = (quote: string) => [{ source: sourceNumber, quote }]
    return JSON.stringify({ sections: [{ heading: '空对地目标指定', entries: [
      { kind: 'step', text: '选择 A/G Master Mode 并开启 HMD。', explanation: '', citations: [sourceNumber], evidence: evidence('Select A/G Master Mode and power the HMD.') },
      { kind: 'step', text: '使用 Sensor Control Switch Forward 将 TDC priority 交给 HMD。', explanation: '', citations: [sourceNumber], evidence: evidence('Press Sensor Control Switch Forward to move TDC priority to the HMD.') },
      { kind: 'step', text: '看向目标并按 TDC Designate 完成目标指定。', explanation: '', citations: [sourceNumber], evidence: evidence('With the aiming reticle visible, press TDC Designate at pilot line-of-sight.') },
    ] }] })
  }
  const viperAmbiguousLedger = () => {
    const build = (heading: string, text: string, quote: string, fallbackPattern?: RegExp) => {
      const source = sourceBlocks.find((match) => match[0].includes(quote))
        || (fallbackPattern ? sourceBlocks.find((match) => fallbackPattern.test(match[0])) : undefined)
      const sourceNumber = Number(source?.[1] || 1)
      const exactQuote = source?.[0].includes(quote) ? quote : source?.[0].match(fallbackPattern || /$^/)?.[0] || quote
      return { heading, entry: { kind: 'step', text, explanation: '', citations: [sourceNumber], evidence: [{ source: sourceNumber, quote: exactQuote }] } }
    }
    const groundControlQuote = 'DMS UP makes HUD and HMCS'
    const groundDesignationQuote = 'TMS UP LONG until the target designation box'
    const entries = [
      build('情况一：空对空雷达锁定', '在 BORE submode 中长按 TMS UP，让雷达沿头盔视线搜索并在探测后进入 STT。', 'In BORE submode, hold TMS UP LONG to slave the radar to the helmet line of sight and command STT when the target is detected.'),
      build('情况二：空对地目标指定', '先按 DMS UP，让 HUD 和 HMCS 获得控制。', groundControlQuote, /DMS UP makes HUD and HMCS[^.\n]*/i),
      build('情况二：空对地目标指定', '长按 TMS UP 显示 Dynamic Aiming Cross，再看向地面目标并短按 TMS UP 完成指定。', groundDesignationQuote, /Hold TMS UP LONG[^.\n]*/i),
      build('情况三：保存头盔视线为 MARKPOINT', '打开 MARK 页面并选择 HUD sensor，再用 TMS Forward-Long 将 SOI 交给 HMCS。', 'Select the MARK page and HUD sensor option. TMS Forward-Long transfers SOI to HMCS.'),
      build('情况三：保存头盔视线为 MARKPOINT', '用 TMS Forward-Short 稳定 Mark Cue，再次短按保存 markpoint。', 'TMS Forward-Short ground stabilizes the Mark Cue, and a second TMS Forward-Short stores the markpoint.'),
    ]
    return JSON.stringify({ sections: [...new Set(entries.map((item) => item.heading))].map((heading) => ({ heading, entries: entries.filter((item) => item.heading === heading).map((item) => item.entry) })) })
  }
  const content = isConnectionTest
    ? 'OK'
    : body.response_format?.type === 'json_object'
        ? (isEvidenceAuditor || isOnePassAnswer)
        ? isHornetHelmetQuestion
          ? isAmbiguousHornetHelmetQuestion
            ? hornetAmbiguousLedger()
            : hornetGroundLedger()
          : isHmcsQuestion
            ? isAmbiguousHmcsQuestion
              ? viperAmbiguousLedger()
              : ledger(/HMCS Ground Target Designation/i, '让 HUD/HMCS 获得控制后，按住 TMS UP LONG 使目标指定框出现在 Dynamic Aiming Cross，再看向目标并按 TMS UP 完成指定。', 'DMS UP makes HUD and HMCS the sensor of interest. Hold TMS UP LONG until the target designation box appears at the Dynamic Aiming Cross. Look at the desired ground target and press TMS UP to designate.')
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
      : userText.includes('TACAN')
        ? '设置 TACAN 模式、频道以及 X/Y 波段，并确认台站识别。[S1]'
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
    'F/A-18C JHMCS AIR-TO-AIR MODE. Select A/A Master Mode and AIM-9. Look at the airborne target until the seeker FOV circle surrounds it. Press and hold Cage/Uncage to command the AIM-9 seeker to the HMD line of sight; release after lock tone.',
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

# CASE I Recovery
Enter the carrier pattern visually, fly the overhead break, lower hook and landing gear, establish on-speed angle of attack, follow the groove, trap or execute a waveoff.

# CASE II Recovery
Use instrument penetration to reach visual conditions, then transition to the CASE I pattern and complete the visual carrier landing.

# CASE III Recovery
Enter marshal, fly the assigned instrument approach using ICLS or ACLS indications, configure for landing, call the ball when visual, then trap or execute a bolter or waveoff.
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
  write(path.join(libraryPath, 'F14', 'F-14 Common Systems.txt'), `DCS F-14B Tomcat common systems manual. TOMCAT_COMMON_RADAR describes the radar and shared cockpit procedures.

CASE I RECOVERY PROCEDURE. Enter the visual carrier pattern, fly the break, configure the hook and landing gear, establish on-speed angle of attack, fly the groove, then trap or wave off.
CASE II RECOVERY PROCEDURE. Fly the instrument penetration until visual, transition to the CASE I pattern, and complete the carrier landing or waveoff.
CASE III RECOVERY PROCEDURE. Enter marshal, fly the assigned instrument approach using ACLS or ICLS, configure the aircraft, call the ball when visual, then trap, bolter, or wave off.`)
  write(path.join(libraryPath, 'F14BU', 'F-14BU Differences.txt'), 'DCS F-14B(U) upgrade module. VDIG-R and PTID are F-14B(U) specific systems and must remain isolated from the base F-14 catalog.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.pdf'), 'F/A-18C quick start and cockpit procedures.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start_RU.pdf'), 'Russian language manual should not be copied by the English-only importer.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'Future-X', 'Doc', 'Future Manual.pdf'), 'Future-X radar startup and sensor operation procedure.')
  await writeTextPdf(path.join(dcsPath, 'Mods', 'aircraft', 'F-16C', 'Doc', 'Priority Guide EN.pdf'), 'F-16C SOURCE_PRIORITY_CHECK current official procedure: select CURRENT MODE and confirm READY.')

  const progressEvents: string[] = []
  const service = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch, (progress) => progressEvents.push(`${progress.operation}:${progress.stage}:${progress.percent}`))
  assert.equal(service.chuckCatalog().length, 33)
  let overview = await service.setLibraryPath(libraryPath)
  assert.equal(overview.onboardingCompleted, false)
  assert.equal(overview.index.documentCount, 12)
  assert.equal(overview.index.state, 'ready')
  assert.ok(overview.index.chunkCount >= 2)
  assert.equal(service.search('Hornet INS alignment')[0]?.aircraft, 'F/A-18C')
  assert.equal(service.search('无线电')[0]?.language, 'zh')
  assert.equal(service.search('F-16C alignment').some((hit) => hit.documentName === 'Viper manual.pdf'), true)
  assert.equal(service.search('TACAN setup', 12, ['F-16C']).every((hit) => hit.aircraft === 'F-16C'), true)
  assert.ok(overview.documents.some((document) => document.aircraft === 'F-14'))
  assert.ok(overview.documents.some((document) => document.aircraft === 'F-14B(U)'))
  assert.equal(service.search('VDIG-R', 12, ['F-14B(U)']).every((hit) => hit.aircraft === 'F-14B(U)'), true)
  assert.equal(service.search('VDIG-R', 12, ['F-14']).some((hit) => hit.aircraft === 'F-14B(U)'), false)
  assert.equal(service.search('TOMCAT_COMMON_RADAR', 12, ['F-14B(U)', 'F-14']).some((hit) => hit.aircraft === 'F-14'), true)

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
  assert.equal(service.overview().index.documentCount, 16)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start.pdf')), true)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Quick Start_RU.pdf')), false)
  assert.equal(progressEvents.some((event) => event.startsWith('dcs-import:copying:')), true)
  assert.equal(progressEvents.some((event) => event === 'dcs-import:complete:100'), true)
  const cleaned = await service.removeDuplicateDcsManuals()
  assert.equal(cleaned.ok, true)
  assert.equal(fs.existsSync(path.join(libraryPath, 'DCS Manuals', 'Mods', 'aircraft', 'FA-18C', 'Doc', 'Landing Guide.pdf')), false)
  assert.equal(service.overview().index.documentCount, 15)
  assert.equal(service.overview().documents.find((document) => document.name === 'Future Manual.pdf')?.aircraft, 'Future-X')
  assert.equal(service.search('radar startup', 8, ['Future-X']).every((source) => source.aircraft === 'Future-X'), true)

  write(path.join(libraryPath, 'F18', 'Carrier landing.txt'), 'Carrier landing pattern and hook procedures.')
  const userRefresh = await service.rebuildIndex(false)
  assert.equal(userRefresh.ok, true)
  assert.ok(service.search('quick start').some((hit) => hit.sourceKind === 'dcs'))
  assert.ok(service.search('carrier landing').some((hit) => hit.sourceKind === 'user'))

  // A guide copied into the managed Chuck folder outside DCSHUB must be
  // discovered at startup even when the previous manifest did not know it.
  const externallyAddedChuckGuide = path.join(libraryPath, "Chuck's Guides", 'F-16C', 'Chuck F-16C Guide.pdf')
  await writeTextPdf(externallyAddedChuckGuide, "Chuck's Guides DCS F-16C Viper by Chuck. F-16C SOURCE_PRIORITY_CHECK current procedure: select CURRENT MODE and confirm READY.")
  const startupRefresh = service.ensureCurrentSearchIndexes()
  assert.ok(startupRefresh)
  assert.equal((await startupRefresh).ok, true)
  const prioritySearch = service.search('F-16C SOURCE_PRIORITY_CHECK current procedure', 12, ['F-16C'])
  assert.equal(prioritySearch[0]?.sourceKind, 'chuck')
  assert.equal(prioritySearch.some((hit) => hit.documentName === 'Chuck F-16C Guide.pdf'), true)

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
  assert.ok(overview.documents.some((document) => document.aircraft === 'F-16C'))
  const priorityAnswer = await service.ask('F16 SOURCE_PRIORITY_CHECK 怎么设置？')
  assert.match(priorityAnswer.answer, /CURRENT MODE/)
  assert.doesNotMatch(priorityAnswer.answer, /OLD MODE/)
  assert.equal(priorityAnswer.sources[0]?.sourceKind, 'chuck')
  assert.equal(priorityAnswer.sources.some((source) => source.sourceKind === 'chuck'), true)
  assert.equal(priorityAnswer.sources.some((source) => source.sourceKind === 'dcs'), true)
  const answer = await service.ask('大黄蜂的 INS 应该怎么对准？')
  assert.equal(answer.cached, false)
  assert.match(answer.answer, /GND/)
  assert.ok(answer.sources.length > 0)
  const repeatedAnswer = await service.ask('大黄蜂的 INS 应该怎么对准？')
  assert.equal(repeatedAnswer.cached, true)
  assert.deepEqual(repeatedAnswer.sources.map((source) => source.id), answer.sources.map((source) => source.id))
  assert.equal(repeatedAnswer.answer, answer.answer)

  const localBeforeOnline = await service.ask('F16怎么用头盔标记一个目标')
  assert.equal(localBeforeOnline.cached, false)
  assert.equal(service.preferredCachedAnswer('F16怎么用头盔标记一个目标')?.kind, 'local')
  const onlineAnswer = await service.askOnline('F16怎么用头盔标记一个目标')
  assert.equal(onlineAnswer.cached, false)
  assert.equal(onlineAnswer.model, 'deepseek-v4-pro')
  assert.match(onlineAnswer.answer, /Eagle Dynamics/)
  assert.equal(onlineAnswer.sources[0]?.url, 'https://www.digitalcombatsimulator.com/en/downloads/documentation/')
  const repeatedOnlineAnswer = await service.askOnline('F16怎么用头盔标记一个目标？')
  assert.equal(repeatedOnlineAnswer.cached, true)
  assert.equal(repeatedOnlineAnswer.answer, onlineAnswer.answer)
  assert.equal(onlineRequestCount, 1)
  const preferredCached = service.preferredCachedAnswer('F16怎么用头盔标记一个目标？')
  assert.equal(preferredCached?.kind, 'online')
  assert.equal(preferredCached?.answer.answer, onlineAnswer.answer)
  assert.ok(service.overview().answerCache.localEntries >= 1)
  assert.equal(service.overview().answerCache.onlineEntries, 1)
  assert.ok(service.overview().answerCache.size > 0)

  const f16Answer = await service.ask('F16塔康怎么设置的？')
  assert.ok(f16Answer.sources.length > 0)
  assert.equal(f16Answer.sources.every((source) => source.aircraft === 'F-16C'), true)
  assert.equal(f16Answer.sources.some((source) => source.documentName === 'Mustang TACAN.txt'), false)

  for (const carrierQuestion of ['F14CASE1', 'F14 case 2', 'F14CASE3', 'F18CASE1', 'F18 case 2', 'F18CASE3']) {
    const carrierAnswer = await service.ask(carrierQuestion)
    assert.ok(carrierAnswer.sources.length > 0, `${carrierQuestion} should retrieve carrier recovery evidence`)
    assert.equal(carrierAnswer.sources.every((source) => /F-14|F\/A-18C/.test(source.aircraft || '')), true)
    assert.match(carrierAnswer.answer, /### 操作说明/)
    assert.doesNotMatch(carrierAnswer.answer, /没有在当前手册库中找到/)
  }

  const f16HelmetVariants = await Promise.all([
    service.ask('F16怎么用头盔标记'),
    service.ask('F16怎么用头盔标记目标'),
  ])
  for (const hmcsAnswer of f16HelmetVariants) {
    assert.equal(hmcsAnswer.sources.every((source) => source.aircraft === 'F-16C'), true)
    assert.equal(hmcsAnswer.sources.some((source) => source.documentName === 'Viper manual.pdf' && source.page === 2), true)
    assert.equal(hmcsAnswer.sources.some((source) => source.documentName === 'Viper manual.pdf' && source.page === 3), true)
    assert.equal(hmcsAnswer.sources.some((source) => source.documentName === 'Viper manual.pdf' && source.page === 4), true)
    assert.doesNotMatch(hmcsAnswer.answer, /Sensor Control Switch/i)
    assert.doesNotMatch(hmcsAnswer.answer, /^(?:好了|咱们|今天就|老鸟|跟着我)/i)
    assert.match(hmcsAnswer.answer, /### 操作说明/)
    assert.match(hmcsAnswer.answer, /Dynamic Aiming Cross/)
    assert.match(hmcsAnswer.answer, /空对空|STT/i)
    assert.match(hmcsAnswer.answer, /空对地|目标指定/i)
    assert.match(hmcsAnswer.answer, /MARKPOINT|markpoint/i)
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
  for (const ambiguousAnswer of hornetHelmetVariants.slice(0, 2)) {
    assert.equal(ambiguousAnswer.sources.some((source) => source.documentName === 'Hornet JHMCS manual.pdf' && source.page === 5), true)
    assert.match(ambiguousAnswer.answer, /空对空|A\/A/i)
    assert.match(ambiguousAnswer.answer, /空对地|A\/G/i)
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
  assert.match(c130Answer.answer, /### 操作说明/)
  assert.doesNotMatch(c130Answer.answer, /^(?:好了|咱们|今天就|老鸟|跟着我)/i)
  const repeatedC130Answer = await service.ask('C130如何空投')
  assert.deepEqual(repeatedC130Answer.sources.map((source) => source.id), c130Answer.sources.map((source) => source.id))
  const phrasedC130Answer = await service.ask('C130怎么进行空投操作？')
  assert.equal(phrasedC130Answer.sources.some((source) => source.page === 6), true)
  assert.equal(phrasedC130Answer.sources.some((source) => source.page === 3), false)

  overview = service.completeOnboarding()
  assert.equal(overview.onboardingCompleted, true)

  const reloaded = new ManualLibraryService(userDataPath, protector, () => dcsPath, fakeFetch)
  assert.equal(reloaded.overview().deepSeek.configured, true)
  assert.equal(reloaded.overview().deepSeek.model, 'deepseek-v4-flash')
  assert.equal(reloaded.overview().onboardingCompleted, true)
  assert.equal(reloaded.overview().index.documentCount, 20)
  assert.ok(reloaded.search('quick start').length > 0)
  const persistedAnswer = await reloaded.ask('C130如何空投')
  assert.equal(persistedAnswer.cached, true)
  assert.equal(persistedAnswer.answer, c130Answer.answer)
  assert.deepEqual(persistedAnswer.sources.map((source) => source.id), c130Answer.sources.map((source) => source.id))
  assert.match(persistedAnswer.answer, /这一步的作用/)
  const persistedOnlineAnswer = await reloaded.askOnline('F16怎么用头盔标记一个目标')
  assert.equal(persistedOnlineAnswer.cached, true)

  let providerOverview = await reloaded.configureAiProvider('siliconflow', 'sk-test-siliconflow-key', 'https://api.siliconflow.cn/v1')
  assert.equal(providerOverview.ai.providers.find((provider) => provider.id === 'siliconflow')?.configured, true)
  providerOverview = reloaded.setAiStageSettings('local', { provider: 'siliconflow', model: 'Qwen/Qwen3-32B', thinkingLevel: 'high' })
  assert.deepEqual(providerOverview.ai.local, { provider: 'siliconflow', model: 'Qwen/Qwen3-32B', thinkingLevel: 'high' })
  await reloaded.configureAiProvider('qwen', 'sk-test-qwen-provider-key', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  providerOverview = reloaded.setAiStageSettings('online', { provider: 'qwen', model: 'qwen-plus', thinkingLevel: 'max' })
  assert.deepEqual(providerOverview.ai.online, { provider: 'qwen', model: 'qwen-plus', thinkingLevel: 'max' })
  assert.throws(() => reloaded.setAiStageSettings('online', { provider: 'siliconflow', model: 'Qwen/Qwen3-32B', thinkingLevel: 'high' }), /不支持原生联网搜索/)
  providerOverview = reloaded.setAiStageSettings('local', { provider: 'deepseek', model: 'custom-model-is-ignored', thinkingLevel: 'max' })
  assert.deepEqual(providerOverview.ai.local, { provider: 'deepseek', model: 'deepseek-v4-flash', thinkingLevel: 'off' })

  const clearedCacheOverview = reloaded.clearAnswerCaches()
  assert.equal(clearedCacheOverview.answerCache.totalEntries, 0)
  assert.equal(clearedCacheOverview.answerCache.size, 0)
  assert.equal(reloaded.preferredCachedAnswer('F16怎么用头盔标记一个目标？'), null)

  console.log('manual-library integration: ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
