import type {
  ManualClassificationConfidence,
  ManualOfficialModuleType,
  ManualSourceKind,
} from '../../../src/shared/manual-library-contracts'

export interface ManualSourceClassification {
  sourceKind: ManualSourceKind
  sourceVersion: string | null
  officialModuleType: ManualOfficialModuleType | null
  isTranslation: boolean
  translatedFrom: Exclude<ManualSourceKind, 'user'> | null
  classificationConfidence: ManualClassificationConfidence
}

const NON_FULL_CLICK_AIRCRAFT = new Set([
  'A-10A', 'F-15C', 'J-11A', 'MIG-29', 'MIG-29A', 'MIG-29G', 'MIG-29S',
  'SU-25', 'SU-25T', 'SU-27', 'SU-33',
])

function extractVersion(text: string): string | null {
  const candidates = [
    /\b(?:document|manual)?\s*(?:version|revision|rev\.?|edition|update)\s*[:#-]?\s*([a-z]?\d{1,4}(?:\.\d{1,4}){0,3}(?:[- ]?[a-z0-9]+)?)/i,
    /\b(20\d{2}[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?)\b/,
    /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2})\b/i,
  ]
  for (const pattern of candidates) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim().slice(0, 80)
  }
  return null
}

function normalizedAircraft(aircraft: string | null): string {
  return (aircraft || '').normalize('NFKC').toLocaleUpperCase().replace(/[^A-Z0-9-]/g, '')
}

export function classifyManualSource(input: {
  relativePath: string
  contentSample: string
  language: string
  aircraft: string | null
  storageKind: ManualSourceKind
}): ManualSourceClassification {
  const content = input.contentSample.normalize('NFKC').slice(0, 80_000)
  const identity = `${content}\n${input.relativePath}`
  // Chuck's PDFs commonly identify themselves as "By Chuck" while also
  // mentioning Eagle Dynamics in a disclaimer. Detect the author/guide mark
  // first so that disclaimer text cannot turn a Chuck guide into an official
  // DCS manual.
  const chuckContent = /Chuck(?:['’]?s)?\s+Guides?|\bby\s+chuck\b|chucksguides\.com|Mudspike/i.test(content)
  const chuckAuthorship = /^\s*Chuck(?:['’]?s)?\s+Guides?\b|\bby\s+chuck\b|chucksguides\.com|Mudspike/i.test(content)
  const officialContent = /EAGLE\s+DYNAMICS|DIGITAL\s+COMBAT\s+SIMULATOR|DCS\s+WORLD|©\s*(?:Eagle Dynamics|The Fighter Collection)/i.test(content)
  const thirdPartyOfficialContent = /\b(?:Heatblur(?:\s+Simulations)?|RAZBAM(?:\s+Simulations)?|Deka\s+Ironwork|Aerges|Polychop(?:\s+Simulations)?|IndiaFoxtEcho|Aviodev|Magnitude\s+3|OctopusG|FlyingIron\s+Simulations)\b/i.test(content)
    && /\b(?:flight|aircraft|module|pilot|operations?|technical|user)?\s*manual\b|\b(?:guide|documentation)\b/i.test(content)
  const explicitTranslation = /(?:汉化|中文化|翻译(?:者|组|版)?|译者|简体中文|繁體中文|中文翻译|中文翻譯)/i.test(identity)
  const chineseLanguage = /^(?:zh|chinese)/i.test(input.language) || /[\u3400-\u9fff]/.test(content.slice(0, 12_000))
  const isTranslation = chineseLanguage && (explicitTranslation || (input.storageKind === 'user' && (chuckContent || officialContent || thirdPartyOfficialContent)))
  const translatedFrom = isTranslation ? (chuckContent ? 'chuck' : officialContent || thirdPartyOfficialContent ? 'dcs' : null) : null

  let sourceKind: ManualSourceKind = 'user'
  let classificationConfidence: ManualClassificationConfidence = 'medium'
  if (!isTranslation && thirdPartyOfficialContent && !chuckAuthorship) {
    // Third-party module manuals often recommend Chuck's Guide in their own
    // introduction. A recommendation is not authorship and must not promote an
    // official Heatblur/RAZBAM/etc. manual into the Chuck authority tier.
    sourceKind = 'dcs'
    classificationConfidence = 'high'
  } else if (!isTranslation && chuckContent) {
    sourceKind = 'chuck'
    classificationConfidence = 'high'
  } else if (!isTranslation && (officialContent || thirdPartyOfficialContent)) {
    sourceKind = 'dcs'
    classificationConfidence = 'high'
  } else if (!isTranslation && input.storageKind !== 'user') {
    // A managed import/download directory is supporting evidence, never the sole
    // high-confidence signal. This keeps scans useful when a cover page has no text.
    sourceKind = input.storageKind
    classificationConfidence = 'low'
  } else {
    sourceKind = 'user'
    classificationConfidence = explicitTranslation ? 'high' : 'medium'
  }

  let officialModuleType: ManualOfficialModuleType | null = null
  if (sourceKind === 'dcs') {
    const aircraft = normalizedAircraft(input.aircraft)
    const explicitlyNonFullClick = /Flaming\s+Cliffs|\bFC3\b|non[- ]clickable|simplified\s+avionics/i.test(content)
    officialModuleType = explicitlyNonFullClick || NON_FULL_CLICK_AIRCRAFT.has(aircraft)
      ? 'non-full-click'
      : aircraft ? 'full-fidelity' : 'unknown'
  }

  return {
    sourceKind,
    sourceVersion: extractVersion(content),
    officialModuleType,
    isTranslation,
    translatedFrom,
    classificationConfidence,
  }
}

export function manualAuthority(classification: Pick<ManualSourceClassification, 'sourceKind' | 'officialModuleType'>): number {
  if (classification.sourceKind === 'chuck') return 400
  if (classification.sourceKind === 'dcs' && classification.officialModuleType === 'full-fidelity') return 300
  if (classification.sourceKind === 'dcs' && classification.officialModuleType === 'unknown') return 250
  if (classification.sourceKind === 'user') return 200
  return 100
}
