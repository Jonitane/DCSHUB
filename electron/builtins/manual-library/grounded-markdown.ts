import type { ManualSearchHit } from '../../../src/shared/manual-library-contracts'
import { ensureManualAnswerStructure } from './answer-style'

interface GroundedMarkdownPayload {
  answer?: string
}

const CITATION = /\[S(\d+)\]/g
const MARKDOWN_LINK = /\[[^\]]+\]\(https?:\/\//i
const TECHNICAL_CONTRADICTION = /(?:TDC|TMS|DMS|Sensor Control Switch)\s*(?:就是|等于|变成|成为|改名为|is|becomes?|equals?)\s*(?:SPI|TGT|MARKPOINT)|SPI\s*(?:就是|等于|变成|成为|改名为|is|becomes?|equals?)\s*TDC/i

function substantiveBlock(block: string): boolean {
  const visible = block
    .replace(CITATION, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+] |\d+[.)、]\s+)/gm, '')
    .replace(/[|:`*_>#-]/g, '')
    .trim()
  return visible.length >= 8 && /[\p{L}\p{N}\u3400-\u9fff]/u.test(visible)
}

/**
 * Keep the fluent Markdown layout produced by the model, while enforcing the
 * same hard boundary as the previous ledger: local answers may only cite the
 * supplied handbook pages.  Headings are presentation; every substantive
 * paragraph/list block must carry at least one valid [S#] citation.
 */
export function verifiedGroundedMarkdown(payload: GroundedMarkdownPayload, sources: ManualSearchHit[]): string | null {
  if (typeof payload.answer !== 'string') return null
  const answer = ensureManualAnswerStructure(payload.answer)
  if (answer.length < 40 || MARKDOWN_LINK.test(answer) || TECHNICAL_CONTRADICTION.test(answer)) return null

  const citations = [...answer.matchAll(/\[S(\d+)\]/g)].map((match) => Number(match[1]))
  if (citations.length === 0 || citations.some((citation) => !Number.isInteger(citation) || citation < 1 || citation > sources.length)) return null

  const blocks = answer.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
  const groundedBlocks: string[] = []
  for (const block of blocks) {
    const pureHeading = /^#{1,6}\s+[^\n]+$/.test(block)
    const tableRule = /^\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(block)
    if (pureHeading || tableRule || !substantiveBlock(block)) {
      groundedBlocks.push(block)
      continue
    }
    CITATION.lastIndex = 0
    // A single uncited introduction or duplicated summary should not discard a
    // fully grounded answer.  Remove that block locally; never invent or attach
    // a citation on the model's behalf.  This preserves the one-call pipeline
    // while keeping every displayed technical statement traceable.
    if (CITATION.test(block)) groundedBlocks.push(block)
  }
  const grounded = groundedBlocks.join('\n\n').trim()
  const groundedCitations = [...grounded.matchAll(/\[S(\d+)\]/g)]
  if (grounded.length < 40 || groundedCitations.length === 0) return null
  return grounded
}
