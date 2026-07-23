import type { ManualSearchHit } from '../../../src/shared/manual-library-contracts'
import { DeepSeekClient, type ManualAiConnection } from './deepseek-client'
import { LOCAL_MANUAL_ANSWER_STRUCTURE_GUIDE, MANUAL_ANSWER_STYLE_GUIDE, ensureManualAnswerStructure } from './answer-style'

interface EvidenceLedgerEntry {
  kind?: 'step' | 'prerequisite' | 'result' | 'warning' | 'note'
  text?: string
  explanation?: string
  citations?: number[]
}

interface EvidenceLedgerSection {
  heading?: string
  entries?: EvidenceLedgerEntry[]
}

export interface EvidenceLedgerResponse {
  title?: string
  overview?: {
    text?: string
    citations?: number[]
  }
  sections?: EvidenceLedgerSection[]
}

interface VerifiedEntry {
  heading: string
  kind: NonNullable<EvidenceLedgerEntry['kind']>
  text: string
  explanation: string
  citations: number[]
}

const GENERIC_LEDGER_HEADING = /^(?:完整)?(?:核心)?(?:操作|执行)?(?:说明|步骤|流程|操作流程)?$/i
const SINGLE_CONTROL_HEADING = /(?:panel|switch|button|knob|selector|display|page|面板|开关|按钮|旋钮|选择器|显示器|页面|设置|输入|释放)$/i
const ENTRY_KIND_PRIORITY: Record<VerifiedEntry['kind'], number> = {
  step: 5,
  prerequisite: 4,
  result: 3,
  warning: 2,
  note: 1,
}

function normalizeLedgerProse(value: string, maximum: number): string {
  return value
    .replace(/\[S\d+\]/gi, '')
    .replace(/^(?:\s*(?:[-*•]|\d+[.)、])\s*)+/g, '')
    .replace(/[ \t]*\r?\n[ \t]*(?:[-*•]|\d+[.)、])[ \t]*/g, '；')
    .replace(/^(?:完整操作流程|核心操作|操作说明|注意事项|成功判断)\s*[：:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
}

function visibleLedgerHeading(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return !normalized || GENERIC_LEDGER_HEADING.test(normalized) ? '' : normalized
}

function workflowHeading(value: string): string {
  const normalized = visibleLedgerHeading(value)
  if (!normalized || (normalized.length <= 80 && SINGLE_CONTROL_HEADING.test(normalized))) return '完整操作流程'
  return normalized
}

function entryIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '')
}

function citationSuffix(citations: number[]): string {
  // Keep the answer readable: one evidence marker is enough for each
  // rendered item. The source list remains available below the answer for
  // users who need to inspect additional corroborating pages.
  const citation = citations.find((candidate) => Number.isInteger(candidate))
  return citation ? `[S${citation}]` : ''
}

function firstValidCitation(value: unknown, sourceCount: number): number | undefined {
  const candidates = Array.isArray(value) ? value : [value]
  for (const candidate of candidates) {
    const raw = typeof candidate === 'object' && candidate !== null
      ? (candidate as { source?: unknown; citation?: unknown }).source ?? (candidate as { citation?: unknown }).citation
      : candidate
    const number = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^0-9]/g, ''))
    if (Number.isInteger(number) && number >= 1 && number <= sourceCount) return number
  }
  return undefined
}

function renderSupplementGroups(entries: VerifiedEntry[]): string[] {
  const groups = new Map<string, VerifiedEntry[]>()
  for (const entry of entries) {
    const heading = visibleLedgerHeading(entry.heading)
    const group = groups.get(heading) || []
    group.push(entry)
    groups.set(heading, group)
  }
  const blocks: string[] = []
  for (const [heading, group] of groups) {
    if (heading) blocks.push(`#### ${heading}`)
    blocks.push(group.map((entry) => `- ${entry.text} ${citationSuffix(entry.citations)}${entry.explanation ? `\n  > ${entry.explanation}` : ''}`).join('\n'))
  }
  return blocks
}

export function verifiedEvidenceLedger(payload: EvidenceLedgerResponse, sourceCount: number): string | null {
  const title = typeof payload.title === 'string'
    ? normalizeLedgerProse(payload.title, 120).replace(/^#+\s*/, '')
    : ''
  const overviewText = typeof payload.overview?.text === 'string'
    ? normalizeLedgerProse(payload.overview.text, 900)
    : ''
  const overviewCitation = firstValidCitation(payload.overview?.citations, sourceCount)
  const entriesByIdentity = new Map<string, VerifiedEntry>()
  for (const section of (payload.sections || []).slice(0, 12)) {
    const heading = typeof section.heading === 'string' ? section.heading.trim().slice(0, 120) : ''
    for (const entry of (section.entries || []).slice(0, 24)) {
      const text = typeof entry.text === 'string' ? normalizeLedgerProse(entry.text, 1_200) : ''
      const explanation = typeof entry.explanation === 'string' ? normalizeLedgerProse(entry.explanation, 900) : ''
      // Keep legacy `result` entries distinct. When real operation steps are
      // present, standalone success judgments are intentionally not rendered;
      // observable feedback belongs inside the corresponding step. If an old
      // cached answer contains only results/notes, the fallback below still
      // promotes them to steps instead of discarding the entire cited answer.
      const kind = entry.kind && ['step', 'prerequisite', 'result', 'warning', 'note'].includes(entry.kind)
        ? entry.kind
        : 'note'
      const citation = firstValidCitation(entry.citations, sourceCount)
      if (!text || citation === undefined) continue
      const identity = entryIdentity(text)
      const previous = entriesByIdentity.get(identity)
      const candidate = { heading, kind, text, explanation, citations: [citation] }
      if (!previous || ENTRY_KIND_PRIORITY[kind] > ENTRY_KIND_PRIORITY[previous.kind]) {
        entriesByIdentity.set(identity, candidate)
      } else if (previous) {
        if (!previous.explanation && explanation) previous.explanation = explanation
      }
    }
  }
  const entries = [...entriesByIdentity.values()]
  const verifiedSteps = entries.filter((entry) => entry.kind === 'step')
  // If the model returned only cited notes/results, do not replace a valid
  // grounded response with the generic validation error. Present those
  // entries as the operation list; their citations have already been checked.
  const steps = verifiedSteps.length > 0
    ? verifiedSteps
    : entries.map((entry) => ({ ...entry, kind: 'step' as const }))
  if (steps.length === 0 && !(overviewText && overviewCitation !== undefined)) return null
  if (steps.length === 0) {
    const overviewOnly = [title ? `## ${title}` : '', overviewText ? `${overviewText} ${citationSuffix([overviewCitation!])}` : '']
      .filter(Boolean)
      .join('\n\n')
    return overviewOnly ? ensureManualAnswerStructure(overviewOnly) : null
  }

  const blocks: string[] = []
  if (title) blocks.push(`## ${title}`)
  if (overviewText && overviewCitation !== undefined) blocks.push(`${overviewText} ${citationSuffix([overviewCitation])}`)
  const prerequisites = entries.filter((entry) => entry.kind === 'prerequisite')
  if (prerequisites.length > 0) {
    blocks.push('### 前提条件')
    blocks.push(...renderSupplementGroups(prerequisites))
  }

  blocks.push('### 操作说明')
  const rawStepGroups = new Map<string, VerifiedEntry[]>()
  for (const entry of steps) {
    const heading = workflowHeading(entry.heading)
    const group = rawStepGroups.get(heading) || []
    group.push(entry)
    rawStepGroups.set(heading, group)
  }
  // Some models incorrectly use a new heading for every individual switch or
  // action. Present those entries as one continuous numbered workflow while
  // retaining each original label in bold, otherwise the UI shows dozens of
  // unrelated lists all starting at “1”.
  const hasScenarioHeadings = [...rawStepGroups.keys()].some((heading) => /(?:情况|场景|方式|空对空|空对地|预规划|飞行中|重新瞄准|模式|任务)/i.test(heading))
  const fragmentedHeadings = !hasScenarioHeadings && rawStepGroups.size > 2
    && [...rawStepGroups.values()].filter((group) => group.length <= 2).length >= Math.ceil(rawStepGroups.size * 0.7)
  const stepGroups = fragmentedHeadings
    ? new Map<string, VerifiedEntry[]>([['完整操作流程', steps.map((entry) => ({
        ...entry,
        text: entry.heading ? `**${entry.heading}**：${entry.text}` : entry.text,
      }))]])
    : rawStepGroups
  for (const [heading, group] of stepGroups) {
    if (stepGroups.size > 1 || heading !== '完整操作流程') blocks.push(`#### ${heading}`)
    blocks.push(group.map((entry, index) => `${index + 1}. ${entry.text} ${citationSuffix(entry.citations)}${entry.explanation ? `\n   > ${entry.explanation}` : ''}`).join('\n'))
  }

  const notes = entries.filter((entry) => entry.kind === 'warning' || entry.kind === 'note')
  if (notes.length > 0) {
    blocks.push('### 注意事项')
    blocks.push(...renderSupplementGroups(notes))
  }
  const rendered = ensureManualAnswerStructure(blocks.join('\n\n'))
  if (/(?:TDC|TMS|DMS|Sensor Control Switch)\s*(?:就是|等于|变成|成为|改名为|is|becomes?|equals?)\s*(?:SPI|TGT|MARKPOINT)|SPI\s*(?:就是|等于|变成|成为|改名为|is|becomes?|equals?)\s*TDC/i.test(rendered)) return null
  return rendered
}

export interface EvidenceAuditRequest {
  connection: ManualAiConnection
  question: string
  context: string
  draft: string
  sources: ManualSearchHit[]
  languageInstruction: string
  evidenceBoundary?: string
  sourcePrecedenceGuide: string
  terminologyGuide: string
}

export class ManualEvidenceAuditor {
  constructor(private readonly client: DeepSeekClient) {}

  async audit(request: EvidenceAuditRequest): Promise<string> {
    const systemPrompt = `你是 DCS 技术手册的证据审校员和完整性编辑器。你的目标不是压缩答案，而是在删除无来源事实的同时，保留并补齐来源中所有与问题相关的内容。

${MANUAL_ANSWER_STYLE_GUIDE}

${LOCAL_MANUAL_ANSWER_STRUCTURE_GUIDE}

事实规则：
1. 只能使用“可用来源”中的手册内容，不得使用模型记忆或外部资料补充按钮、模式、参数、顺序或系统反应。
2. 对照来源核对草稿；草稿遗漏但来源明确提供的必要前提、完整步骤、限制、替代流程和故障信息必须补入；可观察反馈合并进对应步骤。
3. 模糊问题存在多个来源支持的合法含义时，必须按场景分别保留完整流程，不能只挑一个，也不能把不同场景拼成一套。
4. 允许用易懂语言解释专业内容，但解释中的事实仍必须由引用来源支持。
5. 每个条目必须填写真实支持它的来源编号；不得把无关来源挂在条目后充当依据。
6. ${request.sourcePrecedenceGuide}
7. ${request.terminologyGuide}

排版规则：
- heading 只写“完整操作流程”或真正独立的使用场景/子任务名称，同一流程的所有连续步骤必须复用完全相同的 heading。
- 不要把面板名、单个开关名、单个动作或每条来源各自作为 heading。
- text 和 explanation 必须是单行纯文本，不得包含 Markdown 列表、编号、标题或换行；连续动作应拆成多个 entry。
- prerequisite 只放开始操作前必须满足的条件；可观察反馈直接写进对应 step；warning/note 只放限制、风险或补充说明。不要把同一事实换一种说法重复塞进多个 kind。
- 合并重复表述；“速查总结”由程序生成，JSON 中不要重复输出一遍步骤。

只输出 JSON：{"title":"简短具体的技术标题","overview":{"text":"1—2 句功能说明和适用场景","citations":[1,2]},"sections":[{"heading":"场景或流程名称","entries":[{"kind":"prerequisite|step|warning|note","text":"完整、自然的说明","explanation":"必要作用或新手解释","citations":[1,2]}]}]}。
sections 应覆盖来源支持的全部相关场景；entries 不设固定数量，以完整覆盖手册内容为准。`
    let correction = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.client.chat(request.connection, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `用户问题：${request.question}\n${request.evidenceBoundary ? `\n任务说明：${request.evidenceBoundary}\n` : ''}\n可用来源：\n${request.context}\n\n待核对草稿：\n${request.draft}${correction}` },
      ], 6_000, true, false)
      const verified = verifiedEvidenceLedger(JSON.parse(raw) as EvidenceLedgerResponse, request.sources.length)
      if (verified) return verified
      correction = '\n\n上一次结果缺少可用步骤或引用编号。请重新阅读全部来源，完整输出来源明确支持的前提、操作和注意事项。'
    }
    throw new Error('手册证据整理未生成可用的完整答案')
  }
}
