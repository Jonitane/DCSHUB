import { DCS_WEAPON_ONTOLOGY } from './weapon-ontology'
import { DCS_ABBREVIATIONS, normalizeDcsTerminologyInput } from './terminology'

const STANDARD_TERMS = buildStandardTerms()

function buildStandardTerms(): string[] {
  const terms = new Set<string>(DCS_ABBREVIATIONS)
  for (const family of DCS_WEAPON_ONTOLOGY) {
    collectUppercaseTerms(family.canonical, terms)
    collectUppercaseTerms(family.searchTerms, terms)
    for (const variant of family.variants || []) {
      collectUppercaseTerms(variant.canonical, terms)
      collectUppercaseTerms(variant.searchTerms, terms)
    }
  }
  const seenCompactTerms = new Set<string>()
  return [...terms]
    .filter((term) => term.replace(/[^a-z0-9]/gi, '').length >= 3)
    .sort((left, right) => right.replace(/[^a-z0-9]/gi, '').length - left.replace(/[^a-z0-9]/gi, '').length)
    .filter((term) => {
      const compact = term.replace(/[^a-z0-9]/gi, '').toLocaleUpperCase()
      if (seenCompactTerms.has(compact)) return false
      seenCompactTerms.add(compact)
      return true
    })
}

function collectUppercaseTerms(value: string, target: Set<string>): void {
  for (const match of value.matchAll(/\b[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*\b/g)) {
    const term = match[0]
    if (term.length >= 3 && /[A-Z]{2}|\d/.test(term)) target.add(term)
  }
}

function flexibleSpellingPattern(term: string): RegExp | null {
  const compact = term.replace(/[^a-z0-9]/gi, '')
  if (compact.length < 3) return null
  const flexible = [...compact]
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s._/-]*')
  return new RegExp(`(^|[^a-z0-9])${flexible}(?=$|[^a-z0-9])`, 'giu')
}

export function normalizeDcsSpeechTranscript(value: string): string {
  let result = normalizeDcsTerminologyInput(value)
  for (const term of STANDARD_TERMS) {
    const pattern = flexibleSpellingPattern(term)
    if (!pattern) continue
    result = result.replace(pattern, (_match, prefix: string) => `${prefix}${term}`)
  }
  return result
    .replace(/\s+([，。！？,.!?])/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
