import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { create, insertMultiple, load, save, search as oramaSearch } from '@orama/orama'
import { createTokenizer as createMandarinTokenizer } from '@orama/tokenizers/mandarin'
import type {
  ChuckGuideCatalogItem,
  DcsManualImportResult,
  DeepSeekConfigurationStatus,
  ManualAiProvider,
  ManualAiStage,
  ManualAiStageSettings,
  ManualAnswerLanguage,
  ManualCachedAnswerMatch,
  ManualDocumentRecord,
  ManualLibraryOverview,
  ManualLibraryProgress,
  ManualLibraryProgressOperation,
  ManualOperationResult,
  ManualOfficialModuleType,
  ManualOnlineSearchAnswer,
  ManualPagePreview,
  ManualQuestionAnswer,
  ManualSearchHit,
  ManualSourceKind,
} from '../../../src/shared/manual-library-contracts'
import {
  DeepSeekClient,
  MANUAL_AI_DEFAULT_BASE_URLS,
  MANUAL_AI_DEFAULT_MODELS,
  MANUAL_AI_PROVIDER_NAMES,
  providerSupportsOnlineSearch,
  type ManualAiConnection,
} from './deepseek-client'
import { ManualDocumentParser, SUPPORTED_MANUAL_EXTENSIONS, type ExtractedOutlineEntry, type ExtractedPage } from './document-parser'
import { verifiedEvidenceLedger, type EvidenceLedgerResponse } from './evidence-auditor'
import { ManualPreviewCache } from './preview-cache'
import { ManualStorage } from './storage'
import { classifyManualSource, manualAuthority } from './source-classifier'
import { LOCAL_RESEARCH_PRESENTATION_GUIDE, MANUAL_ANSWER_STRUCTURE_GUIDE, MANUAL_ANSWER_STYLE_GUIDE, ensureManualAnswerStructure } from './answer-style'
import {
  DCS_WEAPON_ONTOLOGY,
  resolveWeaponVariantQuestion,
  weaponVariantEvidenceScore,
  type WeaponVariantSemantic,
} from './weapon-ontology'
import { DCS_ABBREVIATIONS, normalizeDcsTerminologyInput } from './terminology'

interface SecretProtector {
  available: () => boolean
  protect: (value: string) => string
  unprotect: (value: string) => string
}

interface StoredSettings {
  version: 1 | 2 | 3 | 4
  libraryPath: string | null
  deepSeekModel?: DeepSeekConfigurationStatus['model']
  deepSeekApiKey?: string | null
  providerCredentials: Partial<Record<ManualAiProvider, { apiKey: string; baseUrl: string }>>
  localAi: ManualAiStageSettings
  onlineAi: ManualAiStageSettings
  onboardingCompleted: boolean
}

interface FileFingerprint {
  relativePath: string
  size: number
  mtimeMs: number
  sha256: string
}

interface StoredManifest {
  version: 1 | 2
  lastIndexedAt: string | null
  files: Record<string, FileFingerprint>
  documents: ManualDocumentRecord[]
  sourceMetadataVersions?: Partial<Record<ManualSourceKind, number>>
}

interface SearchableChunk {
  id: string
  documentId: string
  documentName: string
  relativePath: string
  sourcePath: string
  sourceKind: ManualSourceKind
  sourceVersion: string | null
  officialModuleType: ManualOfficialModuleType | null
  isTranslation: boolean
  translatedFrom: Exclude<ManualSourceKind, 'user'> | null
  classificationConfidence: 'high' | 'medium' | 'low'
  language: string
  aircraft: string | null
  page: number | null
  sectionTitle: string
  sectionPath: string
  sectionLevel: number
  sectionStartPage: number
  sectionEndPage: number
  text: string
}

interface DomainSemanticTerm {
  canonical: string
  searchTerms: string
  patterns: RegExp[]
}

interface StoredAnswerCacheEntry {
  key: string
  savedAt: string
  answer: ManualQuestionAnswer
}

interface StoredOnlineAnswerCacheEntry {
  key: string
  savedAt: string
  answer: ManualOnlineSearchAnswer
}

type FetchLike = typeof fetch
type ProgressReporter = (progress: ManualLibraryProgress) => void

const SUPPORTED_EXTENSIONS = SUPPORTED_MANUAL_EXTENSIONS
const DEFAULT_MODEL: DeepSeekConfigurationStatus['model'] = 'deepseek-v4-flash'
const ONLINE_SEARCH_MODEL = 'deepseek-v4-pro' as const
const DEFAULT_LOCAL_AI: ManualAiStageSettings = { provider: 'deepseek', model: DEFAULT_MODEL, thinkingLevel: 'off' }
const DEFAULT_ONLINE_AI: ManualAiStageSettings = { provider: 'deepseek', model: ONLINE_SEARCH_MODEL, thinkingLevel: 'max' }
const PAGE_CHUNK_PREFER_LENGTH = 3_200
const CHUNK_LENGTH = 2_600
const CHUNK_OVERLAP = 350
const RETRIEVAL_CANDIDATES = 40
const ANSWER_SOURCES = 20
const RRF_K = 60
const PAGE_CONTEXT_LENGTH = 6_000
const RETRIEVAL_PIPELINE_VERSION = 'v40-speech-terminology-and-question-gate'
const MANIFEST_VERSION = 2 as const
const SOURCE_METADATA_VERSION = 6
const ANSWER_CACHE_VERSION = 18
const ONLINE_ANSWER_CACHE_VERSION = 4
const MAX_ANSWER_CACHE_ENTRIES = 500
const MAX_ONLINE_ANSWER_CACHE_ENTRIES = 200

const SEARCH_SCHEMA = {
  id: 'string',
  documentId: 'string',
  documentName: 'string',
  relativePath: 'string',
  sourcePath: 'string',
  sourceKind: 'enum',
  sourceVersion: 'string',
  officialModuleType: 'enum',
  isTranslation: 'enum',
  translatedFrom: 'enum',
  classificationConfidence: 'enum',
  language: 'string',
  aircraft: 'string',
  aircraftKey: 'enum',
  page: 'number',
  sectionTitle: 'string',
  sectionPath: 'string',
  sectionLevel: 'number',
  sectionStartPage: 'number',
  sectionEndPage: 'number',
  text: 'string',
} as const

function createSearchDatabase() {
  return create({
    schema: SEARCH_SCHEMA,
    components: { tokenizer: createMandarinTokenizer() },
  })
}

interface QueryInterpretation {
  queries: string[]
  coreTaskTerms: string[]
  subIntents: QuerySubIntent[]
  aircraftCandidates: string[]
  aircraftMentioned: boolean
  confidence: number
  canonicalTerms: string[]
  intent: string
}

interface QuerySubIntent {
  label: string
  intent: string
  queries: string[]
  coreTaskTerms: string[]
  weaponFamilyId?: string
  weaponVariantId?: string
  sectionDocumentId?: string
  sectionStartPage?: number
  sectionEndPage?: number
}

interface ManualOutlineSection {
  documentId: string
  documentName: string
  title: string
  path: string
  level: number
  startPage: number
  endPage: number
  authority: number
}

interface RetrievalResult {
  sources: ManualSearchHit[]
  fallbackSources: ManualSearchHit[][]
  aircraftScope: string[]
  unavailableAircraft: string[]
  subIntents: QuerySubIntent[]
  requiresAircraftClarification?: boolean
}

interface WeightedRetrievalQuery {
  text: string
  weight: number
}

type ManualTaskFamily = 'helmet-target-designation'

interface TaskSemanticProfile {
  family: ManualTaskFamily
  stableQueries: string[]
  evidenceBoundary: string
}

type ManualSearchDatabase = ReturnType<typeof createSearchDatabase>

const CHUCK_GUIDES: ReadonlyArray<Omit<ChuckGuideCatalogItem, 'installed'>> = [
  { id: 'a-10c', displayName: 'A-10C Warthog', pageUrl: 'https://chucksguides.com/aircraft/dcs/a-10c/' },
  { id: 'ah-64d', displayName: 'AH-64D Apache', pageUrl: 'https://chucksguides.com/aircraft/dcs/ah-64d/' },
  { id: 'ajs-37', displayName: 'AJS-37 Viggen', pageUrl: 'https://chucksguides.com/aircraft/dcs/ajs-37/' },
  { id: 'av-8b', displayName: 'AV-8B Harrier II', pageUrl: 'https://chucksguides.com/aircraft/dcs/av-8b/' },
  { id: 'f-4e', displayName: 'F-4E Phantom II', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-4e/' },
  { id: 'f-5e3', displayName: 'F-5E-3 Tiger II', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-5e3/' },
  { id: 'f-14b', displayName: 'F-14B Tomcat', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-14b/' },
  { id: 'f-15e', displayName: 'F-15E Strike Eagle', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-15e/' },
  { id: 'f-16cm', displayName: 'F-16C Viper', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-16cm/' },
  { id: 'fa-18c', displayName: 'F/A-18C Hornet', pageUrl: 'https://chucksguides.com/aircraft/dcs/fa-18c/' },
  { id: 'jf-17', displayName: 'JF-17 Thunder', pageUrl: 'https://chucksguides.com/aircraft/dcs/jf-17/' },
  { id: 'mirage-2000c', displayName: 'Mirage 2000C', pageUrl: 'https://chucksguides.com/aircraft/dcs/mirage-2000c/' },
  { id: 'mirage-f1', displayName: 'Mirage F1', pageUrl: 'https://chucksguides.com/aircraft/dcs/mirage-f1/' },
  { id: 'f-86f', displayName: 'F-86F Sabre', pageUrl: 'https://chucksguides.com/aircraft/dcs/f-86f/' },
  { id: 'mig-15bis', displayName: 'MiG-15bis', pageUrl: 'https://chucksguides.com/aircraft/dcs/mig-15bis/' },
  { id: 'mig-19p', displayName: 'MiG-19P', pageUrl: 'https://chucksguides.com/aircraft/dcs/mig-19p/' },
  { id: 'mig-21bis', displayName: 'MiG-21bis', pageUrl: 'https://chucksguides.com/aircraft/dcs/mig-21bis/' },
  { id: 'ka-50', displayName: 'Ka-50 Black Shark', pageUrl: 'https://chucksguides.com/aircraft/dcs/ka-50/' },
  { id: 'mi-8mtv2', displayName: 'Mi-8MTV2', pageUrl: 'https://chucksguides.com/aircraft/dcs/mi-8mtv2/' },
  { id: 'mi-24p', displayName: 'Mi-24P Hind', pageUrl: 'https://chucksguides.com/aircraft/dcs/mi-24p/' },
  { id: 'sa-342', displayName: 'SA-342 Gazelle', pageUrl: 'https://chucksguides.com/aircraft/dcs/sa-342/' },
  { id: 'uh-1h', displayName: 'UH-1H Huey', pageUrl: 'https://chucksguides.com/aircraft/dcs/uh-1h/' },
  { id: 'bf109k-4', displayName: 'Bf 109 K-4 Kurfürst', pageUrl: 'https://chucksguides.com/aircraft/dcs/bf109k-4/' },
  { id: 'fw190-a8', displayName: 'FW 190 A-8 Anton', pageUrl: 'https://chucksguides.com/aircraft/dcs/fw190-a8/' },
  { id: 'fw190-d9', displayName: 'FW 190 D-9 Dora', pageUrl: 'https://chucksguides.com/aircraft/dcs/fw190-d9/' },
  { id: 'dh98', displayName: 'DH.98 Mosquito FB Mk VI', pageUrl: 'https://chucksguides.com/aircraft/dcs/dh98/' },
  { id: 'p-47d', displayName: 'P-47D Thunderbolt', pageUrl: 'https://chucksguides.com/aircraft/dcs/p-47d/' },
  { id: 'p-51d', displayName: 'P-51D Mustang', pageUrl: 'https://chucksguides.com/aircraft/dcs/p-51d/' },
  { id: 'spitfire-lf-mk-ix', displayName: 'Spitfire LF Mk IX', pageUrl: 'https://chucksguides.com/aircraft/dcs/spitfire-lf-mk-ix/' },
  { id: 'i-16', displayName: 'I-16 Ishak', pageUrl: 'https://chucksguides.com/aircraft/dcs/i-16/' },
  { id: 'c-101cc', displayName: 'C-101CC Aviojet', pageUrl: 'https://chucksguides.com/aircraft/dcs/c-101cc/' },
  { id: 'l-39za', displayName: 'L-39ZA Albatros', pageUrl: 'https://chucksguides.com/aircraft/dcs/l-39za/' },
  { id: 'yak-52', displayName: 'Yak-52', pageUrl: 'https://chucksguides.com/aircraft/dcs/yak-52/' },
]

const AIRCRAFT_ALIASES: Array<[string, RegExp]> = [
  ['C-130J', /(?:c[\s/_-]*130j?|hercules|大力神)/i],
  ['F/A-18C', /(?:f[\s/_-]*(?:a[\s/_-]*)?18|fa[\s_-]*18|hornet|大黄蜂|超级大黄蜂)/i],
  ['F-16C', /(?:f[\s_-]*16|viper|蝰蛇|战隼)/i],
  ['F-15E', /(?:f[\s_-]*15e|strike[\s_-]*eagle|攻击鹰|打击鹰)/i],
  ['F-15C', /(?:f[\s_-]*15c|鹰式战斗机|f15c)/i],
  // F-14A/B/B(U) currently share the Tomcat family documentation. Keep the BU
  // alias first so a future BU-specific manual can override shared procedures,
  // while retrieval still falls back to the common F-14 corpus today.
  ['F-14B(U)', /(?:f[\s_-]*14[\s_-]*b?(?:[\s_-]*u|\s*\(\s*u\s*\))|f[\s_-]*14[\s_-]*b[\s_-]*upgrade|tomcat[\s_-]*(?:b[\s_-]*)?upgrade|雄猫.*升级|熊猫.*升级)/i],
  ['F-14', /(?:f[\s_-]*14|tomcat|雄猫|熊猫)/i],
  ['F-4E', /(?:f[\s_-]*4e|phantom|鬼怪|鬼怪式)/i],
  ['F-5E', /(?:f[\s_-]*5e|虎二|虎II|F5)/i],
  ['F-86F', /(?:f[\s_-]*86f|sabre|佩刀)/i],
  ['A-10C', /(?:a[\s_-]*10c|warthog|疣猪|雷电)/i],
  ['A-10A', /a[\s_-]*10a/i],
  ['AH-64D', /(?:ah[\s_-]*64|apache|阿帕奇|长弓阿帕奇)/i],
  ['JF-17', /(?:jf[\s_-]*17|thunder|枭龙|fc[\s_-]*1)/i],
  ['AV-8B', /(?:av[\s_-]*8b|harrier|海鹞|鹞式)/i],
  ['Ka-50', /(?:ka[\s_-]*50|black[\s_-]*shark|黑鲨|卡50)/i],
  ['Ka-52', /(?:ka[\s_-]*52|短吻鳄|卡52)/i],
  ['Mi-24P', /(?:mi[\s_-]*24|hind|雌鹿|米24)/i],
  ['Mi-8MTV2', /(?:mi[\s_-]*8(?:mtv2|mt)?|河马|米8)/i],
  ['MiG-29', /(?:mig[\s_-]*29|米格[\s_-]*29|fulcrum|支点)/i],
  ['MiG-21bis', /(?:mig[\s_-]*21|米格[\s_-]*21|fishbed|鱼床)/i],
  ['MiG-19P', /(?:mig[\s_-]*19|米格[\s_-]*19|farmer|农夫)/i],
  ['MiG-15bis', /(?:mig[\s_-]*15|米格[\s_-]*15|fagot|柴捆)/i],
  ['UH-1H', /(?:uh[\s_-]*1h|huey|休伊)/i],
  ['Su-25T', /(?:su[\s_-]*25|苏[\s_-]*25|frogfoot|蛙足)/i],
  ['Su-27', /(?:su[\s_-]*27|苏[\s_-]*27|flanker|侧卫)/i],
  ['Su-33', /(?:su[\s_-]*33|苏[\s_-]*33|海侧卫)/i],
  ['Su-30', /(?:su[\s_-]*30|苏[\s_-]*30)/i],
  ['P-51D', /(?:p[\s_-]*51d?|mustang|野马)/i],
  ['P-47D', /(?:p[\s_-]*47d?|thunderbolt|雷电式)/i],
  ['AJS-37', /(?:ajs[\s_-]*37|viggen|雷式|维根)/i],
  ['M-2000C', /(?:m[\s_-]*2000c|mirage[\s_-]*2000|幻影[\s_-]*2000|幻影2000)/i],
  ['Mirage F1', /(?:mirage[\s_-]*f1|幻影[\s_-]*f1)/i],
  ['SA-342', /(?:sa[\s_-]*342|gazelle|小羚羊)/i],
  ['CH-47F', /(?:ch[\s_-]*47f|chinook|支奴干)/i],
  ['OH-58D', /(?:oh[\s_-]*58d|kiowa|基奥瓦)/i],
  ['C-101CC', /(?:c[\s_-]*101|aviojet)/i],
  ['L-39ZA', /(?:l[\s_-]*39|albatros|信天翁)/i],
  ['Yak-52', /(?:yak[\s_-]*52|雅克[\s_-]*52)/i],
  ['MB-339', /mb[\s_-]*339/i],
  ['Mosquito FB VI', /(?:dh[.\s_-]*98|mosquito|蚊式)/i],
  ['Spitfire LF Mk IX', /(?:spitfire|喷火)/i],
  ['Bf 109 K-4', /(?:bf[\s_-]*109|梅塞施密特|一零九)/i],
  ['Fw 190 A-8', /(?:fw[\s_-]*190[\s_-]*a8|福克狼[\s_-]*a8)/i],
  ['Fw 190 D-9', /(?:fw[\s_-]*190[\s_-]*d9|多拉[\s_-]*9)/i],
  ['I-16', /(?:^|[^a-z0-9])i[\s_-]*16(?:[^a-z0-9]|$)|伊[\s_-]*16/i],
]

function normalizeQuestionInput(raw: string): string {
  let cleaned = normalizeDcsTerminologyInput(raw).trim()
  for (const abbr of [...DCS_ABBREVIATIONS].sort((a, b) => b.length - a.length)) {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Separate abbreviations from adjacent CJK text, but never split a longer
    // Latin identifier (for example PRI inside SOURCE_PRIORITY_CHECK).
    const beforeAbbr = new RegExp(`([\u4e00-\u9fff])${escaped}`, 'gi')
    cleaned = cleaned.replace(beforeAbbr, `$1 ${abbr}`)
    const afterAbbr = new RegExp(`${escaped}([\u4e00-\u9fff])`, 'gi')
    cleaned = cleaned.replace(afterAbbr, `${abbr} $1`)
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
}

function normalizeQuestionCacheIdentity(question: string): string {
  return question
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[?？!！。．,，;；:："“”'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const DCS_DOMAIN_ONTOLOGY: DomainSemanticTerm[] = [
  ...DCS_WEAPON_ONTOLOGY,
  { canonical: 'Airdrop/CARP', searchTerms: 'airdrop aerial delivery cargo drop CARP computed air release point drop zone load parachute extraction CDS', patterns: [/(?:空投|航空投送|货物投放|伞降|投放区|投放点|\bCARP\b)/i] },
  { canonical: 'Cargo/Aerial Delivery', searchTerms: 'cargo aerial delivery loadmaster ramp door extraction chute container delivery system CDS heavy equipment', patterns: [/(?:货舱|装载长|货物装载|货物投送|空运投送|\bcargo\b.*\bdelivery\b)/i] },
  { canonical: 'Sling Load', searchTerms: 'sling load external cargo hook cargo release helicopter', patterns: [/(?:吊挂|吊运|外部货物|货钩|\bsling\s*load\b)/i] },
  { canonical: 'TACAN', searchTerms: 'TACAN tactical air navigation channel band X Y station identification', patterns: [/(?:塔康|战术空中导航|\bTACAN\b)/i] },
  { canonical: 'ILS', searchTerms: 'ILS instrument landing system localizer glideslope approach', patterns: [/(?:仪表着陆|盲降|\bILS\b)/i] },
  { canonical: 'ADF/NDB', searchTerms: 'ADF automatic direction finder NDB non-directional beacon homing', patterns: [/(?:自动测向|无方向信标|归航台|\bADF\b|\bNDB\b)/i] },
  { canonical: 'INS/EGI', searchTerms: 'INS EGI inertial navigation alignment stored heading normal alignment fine alignment gyrocompass', patterns: [/(?:惯导|惯性导航|对准|校准导航|粗对准|精对准|陀螺对准|\bINS\b|\bEGI\b|inertial\s+nav|align)/i] },
  { canonical: 'Steerpoint/Waypoint', searchTerms: 'steerpoint waypoint navigation route coordinate entry direct to', patterns: [/(?:航路点|导航点|转向点|直飞|\bsteerpoint\b|\bwaypoint\b|\bdirect[\s-]*to\b)/i] },
  { canonical: 'George AI Commands', searchTerms: 'George AI helper interface commands player as CPG flight navigation', patterns: [/(?:乔治|george|AI).*(?:驾驶|飞行|飞向|航路点|导航|悬停|攻击|目标)/i] },
  { canonical: 'Player-as-CPG AI Helper Controls', searchTerms: 'Player as CPG AI helper controls flight navigation right short', patterns: [/(?:乔治|george|AI).*(?:怎么|如何|命令|控制|操作|按键)/i] },
  { canonical: 'Navigation Fly-To Cue', searchTerms: 'Navigation Fly-To Cue route point sequence Right Short George', patterns: [/(?:飞向|飞到|前往|依次飞过).*(?:航路点|导航点|路线|目标点)/i] },
  { canonical: 'Bullseye', searchTerms: 'bullseye reference point bearing range', patterns: [/(?:靶心点|牛眼|公牛眼|\bbullseye\b)/i] },
  { canonical: 'BRAA', searchTerms: 'BRAA bearing range altitude aspect AWACS call', patterns: [/(?:方位距离高度姿态|布拉|\bBRAA\b)/i] },
  { canonical: 'Bingo/Joker fuel', searchTerms: 'bingo joker fuel state fuel management return to base', patterns: [/(?:宾果油量|小丑油量|返航油量|最低油量|\bbingo\b.*\bfuel\b|\bjoker\b.*\bfuel\b)/i] },
  { canonical: 'ICP/DED/UFC', searchTerms: 'ICP integrated control panel DED data entry display UFC up front controller data entry keypad', patterns: [/(?:数据输入显示器|前置控制器|前面板输入|小键盘|键盘输入|\bICP\b|\bDED\b|\bUFC\b|up\s*front\s+control)/i] },
  { canonical: 'MFD/MPCD/AMPCD', searchTerms: 'MFD multifunction display MPCD multipurpose color display AMPCD advanced multipurpose color display page OSB option select button', patterns: [/(?:多功能显示器|多功能屏|彩色显示器|屏幕页面|选项按钮|\bMFD\b|\bMPCD\b|\bAMPCD\b|\bOSB\b|multifunction\s+display|option\s+select)/i] },
  { canonical: 'HUD/HMD/HMCS/IHADSS', searchTerms: 'HUD head up display HMD helmet mounted display HMCS JHMCS IHADSS integrated helmet display symbology aiming cross', patterns: [/(?:平显|抬头显示|头盔显示|头盔瞄准|头瞄|头盔瞄准具|\bHUD\b|\bHMD\b|\bHMCS\b|\bJHMCS\b|\bIHADSS\b|helmet[\s-]*mounted|head[\s-]*up\s+display)/i] },
  { canonical: 'Target Designation', searchTerms: 'target designation designate ground target designation diamond target designator aiming reticle line of sight TDC designate', patterns: [/(?:标记目标|指定目标|目标指定|标定目标|设为目标|目标点指定|锁定地面|\bdesignat\w+\b|\btarget\s+(?:designat|lock)|designation\s+diamond|aiming\s+reticle|\bTDC\s+Designate\b)/i] },
  { canonical: 'Sensor Of Interest (SOI)', searchTerms: 'SOI sensor of interest slew control TDC priority DMS AFT TDC depress', patterns: [/(?:兴趣传感器|当前传感器|传感器焦点|\bSOI\b|sensor\s+of\s+interest|\bTDC\s+priority\b|DMS\s+(?:AFT|down|aft))/i] },
  { canonical: 'SPI (Sensor Point of Interest)', searchTerms: 'SPI sensor point of interest target point SPI position hook', patterns: [/(?:传感器兴趣点|目标点|SPI位置|钩子点|\bSPI\b|sensor\s+point\s+of\s+interest)/i] },
  { canonical: 'TDC (Target Designator Controller)', searchTerms: 'TDC target designator controller slew depress designate cursor control radar cursor', patterns: [/(?:目标设计器控制器|光标控制器|雷达光标|油门光标|\bTDC\b|target\s+designator\s+control|radar\s+cursor)/i] },
  { canonical: 'TMS (Target Management Switch)', searchTerms: 'TMS target management switch TMS up TMS down TMS left TMS right long press short press', patterns: [/(?:目标管理开关|\bTMS\s+(?:Up|Down|Left|Right|up|down|left|right|forward|aft)\b|\bTMS\b)/i] },
  { canonical: 'DMS (Display Management Switch)', searchTerms: 'DMS display management switch DMS up DMS down DMS left DMS right TDC priority SOI', patterns: [/(?:显示管理开关|\bDMS\s+(?:Up|Down|Left|Right|up|down|left|right|aft|forward)\b|\bDMS\b)/i] },
  { canonical: 'CMS (Countermeasures Management Switch)', searchTerms: 'CMS countermeasures management switch chaff flare dispense program', patterns: [/(?:对抗管理开关|\bCMS\b|countermeasure\s+management)/i] },
  { canonical: 'Markpoint', searchTerms: 'markpoint MARK page HUD mark cue create markpoint M-SEL active steerpoint SPI mark target coordinate save', patterns: [/(?:标记点|标志点|创建标记点|保存标记|markpoint|MARK\s*页面|保存目标位置|\bmark\s*point\b|\bmarkpoint\b|\bM-SEL\b)/i] },
  { canonical: 'HMCS Air Target Radar Lock', searchTerms: 'HMCS air target radar lock helmet line of sight BORE TMS UP LONG STT unlock', patterns: [/(?:头盔|头瞄|HMD|HMCS|JHMCS).*(?:空中目标|敌机|雷达锁定|锁住飞机)|(?:HMD|HMCS|JHMCS).*(?:air[\s-]*to[\s-]*air|radar\s+lock|\bSTT\b|\bBORE\b)/i] },
  { canonical: 'HMCS Ground Target Designation', searchTerms: 'HMCS HMD JHMCS ground target designation TDC designate helmet sight aiming cross designation diamond TMS up', patterns: [/(?:头盔|头瞄|HMD|HMCS|JHMCS).*(?:地面目标|对地|标记|指定|瞄准)|(?:HMD|HMCS|JHMCS).*(?:ground\s+target|designat\w+|aiming\s+cross|designation\s+diamond)/i] },
  { canonical: 'Pilot/CPG crewstations', searchTerms: 'Pilot rear crewstation CPG copilot gunner front crewstation opposite crewmember', patterns: [/(?:前座|后座|前舱|后舱|驾驶员|炮手|武器操作员|另一名乘员|\bCPG\b|crewstation)/i] },
  { canonical: 'Sight LOS/Acquisition Source', searchTerms: 'sight line of sight LOS acquisition source ACQ cueing dots slave other crewmember HMD TADS IHADSS', patterns: [/(?:瞄准位置|瞄准方向|看向哪里|看哪里|视线位置|视线方向|指向位置|目标位置|\bLOS\b.*\bsight|\bACQ\b|line\s+of\s+sight|acquisition\s+source|\bIHADSS\b|\bTADS\b)/i] },
  { canonical: 'HOTAS', searchTerms: 'HOTAS hands on throttle and stick command switch control', patterns: [/(?:油门杆和驾驶杆|杆上操作|\bHOTAS\b|hands\s+on\s+throttle)/i] },
  { canonical: 'FCR A-A Modes', searchTerms: 'FCR fire control radar air to air RWS TWS STT ACM radar mode', patterns: [/(?:火控雷达.*(?:模式|空战)|空对空雷达|\bFCR\b.*(?:RWS|TWS|STT)|fire\s+control\s+radar.*air)/i] },
  { canonical: 'RWS/TWS/STT', searchTerms: 'RWS range while search TWS track while scan STT single target track radar mode', patterns: [/(?:边扫描边跟踪|单目标跟踪|搜索模式|跟踪模式|边搜边跟|\bRWS\b|\bTWS\b|\bSTT\b|single\s+target\s+track)/i] },
  { canonical: 'ACM (Air Combat Maneuvering)', searchTerms: 'ACM air combat maneuver radar boresight vertical scan slewable mode HUD ACM', patterns: [/(?:空战格斗模式|垂直扫描|雷达狗斗|近距雷达|\bACM\b|air\s+combat\s+maneuver|boresight)/i] },
  { canonical: 'TGP/FLIR/Targeting Pod', searchTerms: 'TGP targeting pod FLIR forward looking infrared sensor designation zoom SPI track point area track', patterns: [/(?:目标吊舱|瞄准吊舱|光电吊舱|红外画面|热成像|吊舱瞄准|\bTGP\b|\bFLIR\b|targeting\s+pod|forward\s+looking\s+infrared)/i] },
  { canonical: 'RWR (Radar Warning Receiver)', searchTerms: 'RWR radar warning receiver threat symbol emitter nails spike mud launch warning new spike', patterns: [/(?:雷达告警|威胁告警|被照射|被锁定告警|泥点|钉子|尖刺|新尖刺|\bRWR\b|radar\s+warning\s+receiver)/i] },
  { canonical: 'ECM/Jammer', searchTerms: 'ECM electronic countermeasures jammer electronic warfare self protection jamming', patterns: [/(?:电子对抗|电子干扰|干扰机|自卫干扰|噪声干扰|\bECM\b|electronic\s+counter|\bjammer\b|\bjamming\b)/i] },
  { canonical: 'Countermeasures (Chaff/Flare)', searchTerms: 'CMS countermeasure chaff flare dispense program manual dispense', patterns: [/(?:对抗措施|干扰弹|箔条|热焰弹|热诱弹|撒弹|放干扰弹|\bCMS\b|countermeasure|chaff|\bflare\b)/i] },
  { canonical: 'IFF', searchTerms: 'IFF identification friend or foe interrogate transponder mode code', patterns: [/(?:敌我识别|识别敌友|应答机|\bIFF\b|identification\s+friend)/i] },
  { canonical: 'Datalink/Link 16', searchTerms: 'datalink Link 16 tactical network track donor fighter AWACS', patterns: [/(?:数据链|战术数据链|友机目标共享|僚机目标|\bLink\s*16\b|\bdatalink\b)/i] },
  { canonical: 'AWACS/GCI', searchTerms: 'AWACS airborne warning and control GCI ground controlled interception picture declaration', patterns: [/(?:预警机|地面引导|空情通报|\bAWACS\b|\bGCI\b|airborne\s+warning)/i] },
  { canonical: 'BVR/WVR', searchTerms: 'BVR beyond visual range WVR within visual range air combat', patterns: [/(?:超视距|视距内|近距空战|远距空战|\bBVR\b|\bWVR\b|beyond\s+visual|within\s+visual)/i] },
  { canonical: 'Notch/Beam/Crank', searchTerms: 'notch beam crank radar missile defense geometry doppler', patterns: [/(?:侧飞脱锁|切线规避|压制角|曲柄机动|进凹口|\bnotch\b|\bbeam\b.*maneuver|\bcrank\b.*maneuver)/i] },
  { canonical: 'Fox/Pitbull', searchTerms: 'Fox one two three missile launch pitbull active radar seeker', patterns: [/(?:狐狸一|狐狸二|狐狸三|导弹自主|主动弹开机|\bfox\s*[123]\b|\bpitbull\b.*missile)/i] },
  { canonical: 'MAR/NEZ/WEZ/DLZ', searchTerms: 'MAR minimum abort range NEZ no escape zone WEZ weapon engagement zone DLZ dynamic launch zone', patterns: [/(?:最小脱离距离|不可逃逸区|武器交战区|动态发射区|\bMAR\b|\bNEZ\b|\bWEZ\b|\bDLZ\b|no\s+escape\s+zone|weapon\s+engagement|dynamic\s+launch\s+zone)/i] },
  { canonical: 'CCIP/CCRP/DTOS', searchTerms: 'CCIP continuously computed impact point CCRP continuously computed release point DTOS dive toss bombing mode', patterns: [/(?:连续计算命中点|连续计算投放点|俯冲投弹|俯冲抛射|水平轰炸|\bCCIP\b|\bCCRP\b|\bDTOS\b|computed\s+(?:impact|release|toss)\s+point)/i] },
  { canonical: 'A-G Master Mode/Armament', searchTerms: 'air to ground master mode A-G mode weapon release master arm consent pickle', patterns: [/(?:空对地模式|对地模式|主模式|武器投放|投弹按钮|\bA-?G\b.*mode|master\s+arm|weapon\s+release|\bpickle\b)/i] },
  { canonical: 'A-A Master Mode', searchTerms: 'air to air master mode A-A mode weapons dogfight', patterns: [/(?:空对空模式|空战模式|主模式空对空|\bA-?A\b.*mode)/i] },
  { canonical: 'Master Arm', searchTerms: 'master arm switch SAFE ARM READY consent to release', patterns: [/(?:保险开关|主武器开关|总开关|主保险|投弹许可|MASTER\s+ARM|\bARM\b|\bSAFE\b)/i] },
  { canonical: 'Laser designation', searchTerms: 'laser designation laser code latch buddy lase spot search laser trigger', patterns: [/(?:激光照射|激光编码|伙伴照射|激光点搜索|激光开火|\blaser\b.*\bdesignat|\blase\b|buddy\s+lase|laser\s+code)/i] },
  { canonical: 'HARM/HTS/HAD', searchTerms: 'AGM-88 HARM HTS HARM targeting system HAD HARM attack display suppression enemy air defense SEAD', patterns: [/(?:反辐射导弹|哈姆|反雷达|压制防空|HARM页面|\bHARM\b|\bHTS\b|\bHAD\b|\bAGM-88\b|suppression.*air\s+defense|\bSEAD\b)/i] },
  { canonical: 'Maverick (AGM-65)', searchTerms: 'AGM-65 Maverick seeker boresight handoff lock track stabilize Maverick page', patterns: [/(?:小牛导弹|小牛对准|电视制导导弹|小牛锁定|\bMaverick\b|\bAGM-65\b|\bAGM65\b)/i] },
  { canonical: 'AIM-120 AMRAAM', searchTerms: 'AIM-120 AMRAAM active radar missile employment launch pitbull maddog', patterns: [/(?:阿姆拉姆|主动雷达弹|一二零导弹|120导弹|\bAIM-120\b|\bAMRAAM\b|\bmaddog\b)/i] },
  { canonical: 'AIM-9 Sidewinder', searchTerms: 'AIM-9 Sidewinder infrared missile seeker uncage tone heat seeker', patterns: [/(?:响尾蛇|红外格斗弹|导弹音调|9导弹|热寻的|\bAIM-9\b|\bSidewinder\b|uncage\s+seeker)/i] },
  { canonical: 'Cold/Ramp Start', searchTerms: 'cold start start-up procedure startup procedure ramp start pre-start engine start post-start INS GPS alignment ready to taxi power engine avionics APU battery ground power', patterns: [/(?:冷启动|冷舱启动|从关机开始|启动发动机|开机步骤|\bcold\s+start\b|\bramp\s+start\b|\bstart[\s-]*up\s+procedure\b|\bpre[\s-]*start\b|\bpost[\s-]*start\b)/i] },
  { canonical: 'Hot/Taxi/Takeoff', searchTerms: 'hot start taxi takeoff runway ready for takeoff', patterns: [/(?:热启动|热舱启动|滑行|起飞|\bhot\s+start\b|\btaxi\b|\btakeoff\b)/i] },
  { canonical: 'Radio/COMM Presets', searchTerms: 'radio communication UHF VHF FM frequency preset channel guard', patterns: [/(?:无线电|电台|频率|预设频道|守听|甚高频|特高频|\bpreset\b.*\b(?:radio|channel|frequency|UHF|VHF|COMM)\b)/i] },
  { canonical: 'Autopilot/Auto-throttle', searchTerms: 'autopilot attitude altitude heading hold steering select auto throttle ATC', patterns: [/(?:自动驾驶|高度保持|航向保持|姿态保持|自动油门|\bautopilot\b|attitude\s+hold|altitude\s+hold|\bauto[\s-]*throttle\b)/i] },
  { canonical: 'Trim', searchTerms: 'trim pitch trim roll trim yaw trim takeoff trim hat switch', patterns: [/(?:配平|修正片|起飞配平|俯仰配平|横滚配平|\btrim\b|\bpitch\s+trim\b|\broll\s+trim\b|\byaw\s+trim\b)/i] },
  { canonical: 'Air-to-air refueling (AAR)', searchTerms: 'air to air refueling AAR tanker boom probe pre-contact contact position', patterns: [/(?:空中加油|加油机|受油|预接触|接触位置|\bAAR\b|air[\s-]*to[\s-]*air\s+refuel|\brefueling\b|\btanker\b|\bboom\b|\bprobe\b|\bpre[\s-]*contact\b)/i] },
  { canonical: 'Carrier operations', searchTerms: 'carrier launch catapult CASE I CASE II CASE III recovery landing pattern marshal holding approach arresting hook trap bolter', patterns: [/(?:航母起飞|弹射|阻拦着舰|航母降落|一类回收|二类回收|三类回收|尾钩|\bcatapult\b|\barresting\s+hook\b|CASE[\s._-]*(?:I{1,3}|[123])\b|\bcarrier\b.*\b(?:launch|recovery|landing|trap|bolter)\b)/i] },
  { canonical: 'JTAC/9-line CAS', searchTerms: 'JTAC joint terminal attack controller nine line close air support CAS brief', patterns: [/(?:联合终端攻击控制员|九行简报|近距空中支援引导|近距支援|\bJTAC\b|nine[\s-]*line|close\s+air\s+support|\bCAS\b)/i] },
  { canonical: 'ROE/VID', searchTerms: 'ROE rules of engagement VID visual identification declaration hostile', patterns: [/(?:交战规则|目视识别|确认敌机|\bROE\b|\bVID\b|rules\s+of\s+engagement|visual\s+identification)/i] },
  { canonical: 'RTB/Winchester/Bingo', searchTerms: 'RTB return to base Winchester no ordnance state bingo fuel', patterns: [/(?:返航|弹药耗尽|温彻斯特|\bRTB\b|\bWinchester\b.*\bordnance\b|return\s+to\s+base)/i] },
  { canonical: 'Setup procedure', searchTerms: 'setup configure configuration procedure controls steps how to operate', patterns: [/(?:怎么设置|如何设置|怎样设置|设定|怎么用|如何使用|怎么操作|\bsetup\b|\bconfigure\b.*procedure)/i] },
  { canonical: 'Engine Start', searchTerms: 'engine start APU battery ground power throttle idle cutoff fuel', patterns: [/(?:启动发动机|发动机启动|开车|点火|APU启动|engine\s+start|\bAPU\b|battery\s+on)/i] },
  { canonical: 'Landing Gear/Flaps/Speedbrake', searchTerms: 'landing gear gear down gear up flaps takeoff flaps landing flaps speedbrake airbrake', patterns: [/(?:起落架|放起落架|收起落架|襟翼|起飞襟翼|着陆襟翼|减速板|空气刹车|\blanding\s+gear\b|\bgear\s+(?:up|down)\b|\bflaps?\b|\bspeedbrake\b|\bairbrake\b)/i] },
  { canonical: 'Weapons/Stores Release', searchTerms: 'weapon release pickle button consent release weapon station store', patterns: [/(?:投弹|发射武器|武器投放|发射按钮|投弹按钮|\brelease\b.*\bweapon\b|\bpickle\b|\bweapon\s+release\b)/i] },
  { canonical: 'Lock Target / Track Target', searchTerms: 'lock target track target radar lock lock on bug target STT', patterns: [/(?:锁定目标|锁住目标|跟踪目标|锁定|锁住|\block\s+(?:on|target)|\btrack\s+target|\bSTT\b|\bbug\s+target\b)/i] },
  { canonical: 'Bombs/GBU/LGB/JDAM', searchTerms: 'bomb GBU LGB laser guided bomb JDAM GPS guided bomb precision guided munition', patterns: [/(?:炸弹|制导炸弹|激光制导炸弹|卫星制导炸弹|杰达姆|\bGBU(?:[\s-]?\d+)?\b|\bJDAM\b|\bLGB\b|laser\s+guided\s+bomb|precision\s+guided)/i] },
  { canonical: 'AGM Missiles', searchTerms: 'AGM air to ground missile Maverick HARM Hellfire Harpoon SLAM', patterns: [/(?:空对地导弹|对地导弹|小牛|哈姆|地狱火|鱼叉|\bAGM[\s-]?\d+\b)/i] },
  { canonical: 'Gun/Cannon', searchTerms: 'gun cannon machine gun rounds trigger gun pod', patterns: [/(?:机炮|机炮射击|航炮|开枪|开炮|射击按钮|\bgun\b|\bcannon\b|\btrigger\b.*press)/i] },
  { canonical: 'Rockets', searchTerms: 'rocket hydra FFAR unguided rocket rocket pod ripple', patterns: [/(?:火箭弹|九头蛇|无控火箭|火箭巢|齐射|\brocket\b|\bHydra\b)/i] },
]

function defaultSettings(): StoredSettings {
  return {
    version: 4,
    libraryPath: null,
    providerCredentials: {},
    localAi: { ...DEFAULT_LOCAL_AI },
    onlineAi: { ...DEFAULT_ONLINE_AI },
    onboardingCompleted: false,
  }
}

function emptyManifest(): StoredManifest {
  return { version: MANIFEST_VERSION, lastIndexedAt: null, files: {}, documents: [], sourceMetadataVersions: {} }
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/')
}

function safeFileName(value: string): string {
  const printable = [...value].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('')
  return printable.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'manual.pdf'
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath))
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function isEnglishDcsManual(filePath: string): boolean {
  const normalized = normalizeRelative(filePath).normalize('NFKC').toLocaleLowerCase()
  const segments = normalized.split('/')
  const nonEnglishDirectory = /^(?:ru|rus|russian|cn|zh|zh-cn|chinese|de|ger|german|fr|fre|french|es|spa|spanish|it|ita|italian|pl|polish|cz|cs|czech|ja|jp|japanese|ko|kr|korean|pt|portuguese|tr|turkish)$/i
  if (segments.some((segment) => nonEnglishDirectory.test(segment))) return false
  const fileName = path.basename(normalized, path.extname(normalized))
  const nonEnglishToken = /(?:^|[\s._()[\]-])(?:ru|rus|russian|cn|zh(?:-cn)?|chinese|de|ger|german|fr|fre|french|es|spa|spanish|it|ita|italian|pl|polish|cz|cs|czech|ja|jp|japanese|ko|kr|korean|pt|portuguese|tr|turkish)(?:$|[\s._()[\]-])/i
  return !nonEnglishToken.test(fileName)
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

function detectLanguage(text: string): string {
  const sample = text.slice(0, 20_000)
  const chinese = (sample.match(/[\u3400-\u9fff]/g) || []).length
  const cyrillic = (sample.match(/[\u0400-\u04ff]/g) || []).length
  const latin = (sample.match(/[A-Za-z]/g) || []).length
  if (chinese > Math.max(6, latin * 0.12)) return 'zh'
  if (cyrillic > Math.max(6, latin * 0.2)) return 'ru'
  return latin > 20 ? 'en' : 'unknown'
}

function languageInstruction(lang: 'zh' | 'en' | 'ru'): string {
  if (lang === 'en') return 'Respond entirely in clear, professional English. Keep panel and switch names in their original English terms.'
  if (lang === 'ru') return 'Отвечайте полностью на русском языке, ясно и профессионально. Названия панелей и переключателей оставляйте на языке оригинала.'
  return '使用清晰、专业、自然的中文回答。面板开关保留英文原名，首次出现括号附中文。'
}

function detectAircraft(identity: string, text = ''): string | null {
  const normalizedIdentity = normalizeRelative(identity).normalize('NFKC')
  const identityMatch = AIRCRAFT_ALIASES.find(([, pattern]) => pattern.test(normalizedIdentity))
  if (identityMatch) return identityMatch[0]

  const moduleMatch = normalizedIdentity.match(/(?:^|\/)(?:coremods|mods)\/aircraft\/([^/]+)/i)
  if (moduleMatch) return moduleMatch[1].replace(/_/g, '-').trim() || null

  // Only trust a model mentioned unambiguously near the document title. Searching
  // thousands of body characters caused cross-references to mislabel whole manuals.
  const heading = text.slice(0, 1_500)
  const headingMatches = AIRCRAFT_ALIASES.filter(([, pattern]) => pattern.test(heading))
  return headingMatches.length === 1 ? headingMatches[0][0] : null
}

function normalizeAircraftKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '')
}

function matchAircraftCandidates(candidates: string[], availableAircraft: string[]): { matched: string[]; unavailable: string[] } {
  const matched: string[] = []
  const unavailable: string[] = []
  for (const candidate of candidates) {
    const alias = AIRCRAFT_ALIASES.find(([, pattern]) => pattern.test(candidate))?.[0]
    const candidateKey = normalizeAircraftKey(alias || candidate)
    // Always prefer an exact normalized variant. A first-match fuzzy lookup
    // would otherwise resolve F14BU to the shorter F-14 entry because "f14bu"
    // contains "f14" and the catalog is alphabetically sorted.
    const match = availableAircraft.find((aircraft) => normalizeAircraftKey(aircraft) === candidateKey)
      || availableAircraft.find((aircraft) => {
        const availableKey = normalizeAircraftKey(aircraft)
        return candidateKey.length >= 4 && availableKey.length >= 4
          && (availableKey.includes(candidateKey) || candidateKey.includes(availableKey))
      })
    if (match) matched.push(match)
    else if (candidate.trim()) unavailable.push(alias || candidate.trim())
  }
  return { matched: [...new Set(matched)], unavailable: [...new Set(unavailable)] }
}

function stripAircraftMentions(query: string, aircraftTerms: string[]): string {
  let cleaned = query.normalize('NFKC')
  for (const aircraft of aircraftTerms) {
    const compact = aircraft.normalize('NFKC').replace(/[^a-z0-9]/gi, '')
    if (compact.length < 2) continue
    const flexible = compact.split('').map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s/_.-]*')
    cleaned = cleaned.replace(new RegExp(`(^|[^a-z0-9])${flexible}(?=$|[^a-z0-9])`, 'gi'), '$1')
  }
  return cleaned.replace(/^[\s:：,，/_.-]+|[\s:：,，/_.-]+$/g, '').replace(/\s{2,}/g, ' ').trim()
}

const DCS_TERMINOLOGY_ROLE_GUIDE = '术语角色必须保持：TDC、TMS、DMS、Sensor Control Switch、Radar Cursor 等是输入或控制器；SOI、TDC priority 等是控制权/显示焦点；SPI、TGT/target designation、L&S/STT 等是目标或指定状态；MARKPOINT/steerpoint 是可保存的导航点。它们不能因功能相关就互相改名。尤其“把 TDC priority 交给 HMD”只表示头盔获得 TDC 控制，不表示目标或 SPI 变成 TDC。最终形成何种状态必须沿用当前机型手册原词，手册只写 designation 时不得自行改称 SPI。'
const SOURCE_PRECEDENCE_GUIDE = '来源优先级必须严格保持：Chuck\'s Guides > DCS 官方全拟真/全点击模组手册 > 用户资料（包括用户汉化版） > DCS 官方非全点击模组手册。每份手册必须依据正文中的出版方、版本、机型和翻译标记分类，目录名或文件名只能作为辅助证据。优先级用于排序、冲突裁决和主流程选择，不代表禁止低优先级资料补充高优先级资料没有覆盖的前提、限制、替代流程或故障排查；所有补充仍必须来自当前选定机型的手册原文。不同版本或来源存在实质冲突时，以高优先级来源为准并明确说明差异，不能把不同流程拼成一套。'

const MANUAL_STRUCTURE_SCENARIO_GUIDE = `手册结构是场景划分的唯一主依据：
- 先按手册库的目录、已识别机型和来源锁定文档，再按 PDF 自带的目录/书签路径锁定章节及页码范围。文件名、玩家俗称和术语表只负责把问题导向手册已有结构，不得替手册创造型号或流程。
- 同一父章节下的同级章节视为真实分支。用户没说清时要按手册实际存在的分支分情况回答；用户明确了型号、模式、席位、传感器或任务场景时，只使用对应章节子树。
- 必须保持独立的常见边界包括：武器不同型号/导引方式，PP/TOO、SP/TOO/PB、LOBL/LOAL、VIS/BORE/PRE、RWS/TWS/STT 等工作模式，Pilot/CPG/RIO/Jester 等乘员职责，NORM/STOR HDG/航母对准等有前提的对准方式，实弹/训练弹，座舱操作/任务编辑器设置，单人/AI/多人协同，以及实战流程/故障排查。只有手册明确说明共用时才能合并。
- 长流程必须沿同一章节子树向后收集必要页，覆盖准备、设置、执行、可观察反馈、限制/退出；不能因某一页关键词密度高就只取中间一段。
- 如果手册没有可用书签，才允许使用正文标题和型号证据作降级检索；降级结果仍不得跨型号、跨机型或跨场景拼接。`

function detectTaskSemanticProfile(question: string): TaskSemanticProfile | null {
  const normalized = question.normalize('NFKC')
  const mentionsHelmet = /(?:头盔|头瞄|HMD|HMCS|JHMCS|helmet(?:-mounted)?)/i.test(normalized)
  const mentionsTargetAction = /(?:标记|指定|瞄准|锁定|目标|designat|mark(?:point)?|target|lock)/i.test(normalized)
  if (!mentionsHelmet || !mentionsTargetAction) return null
  return {
    family: 'helmet-target-designation',
    stableQueries: [
      'JHMCS air-to-ground target designation',
      'HMD ground target designation aiming reticle',
      'JHMCS air-to-air target acquisition radar lock',
      'HMD AIM-9 seeker uncage helmet line of sight',
      'helmet radar lock ACM air target',
      'helmet target designation controls',
      'TDC priority HMD TDC Designate designation diamond',
      'HMCS target designation TMS DMS Radar Cursor',
      'helmet markpoint creation',
    ],
    evidenceBoundary: `先从当前机型手册判断问题可能对应地面目标指定、可保存的 MARKPOINT、空中目标获取/锁定或其他独立功能。${DCS_TERMINOLOGY_ROLE_GUIDE} 用户没有说明具体结果时，只要手册对某种合理含义提供了直接操作依据，就应把它作为独立场景完整回答；不得静默只选一个场景，也不得把不同场景的按键和结果拼成一套流程。`,
  }
}

function deterministicSubIntents(question: string): QuerySubIntent[] {
  const normalized = question.normalize('NFKC')
  const weaponBranches = resolveWeaponVariantQuestion(normalized).flatMap((resolution) => {
    const variants = resolution.explicitVariants.length >= 2
      ? resolution.explicitVariants
      : resolution.explicitVariants.length === 0 ? resolution.ambiguousVariants : []
    return variants.map((variant) => ({
      label: variant.label,
      intent: `${variant.canonical} 独立型号的完整使用流程、制导方式、适用条件与限制`,
      coreTaskTerms: [variant.canonical, variant.searchTerms],
      queries: [
        `${variant.canonical} employment procedure`,
        `${variant.searchTerms} controls launch release limitations`,
      ],
      weaponFamilyId: resolution.family.id,
      weaponVariantId: variant.id,
    }))
  })
  if (weaponBranches.length >= 2) return weaponBranches.slice(0, 4)
  if (detectTaskSemanticProfile(normalized)?.family !== 'helmet-target-designation') return []
  const explicitlyAir = /(?:空中目标|空对空|敌机|飞机目标|雷达锁定|导弹锁定|A\/A|air(?:-to-|\s+)air|air\s+target|radar\s+lock|\bSTT\b|\bACM\b)/i.test(normalized)
  const explicitlyGround = /(?:地面目标|空对地|对地|地面指定|A\/G|air(?:-to-|\s+)ground|ground\s+target)/i.test(normalized)
  const explicitlyMarkpoint = /(?:标记点|标志点|MARKPOINT|MARK\s*页面|保存(?:目标|坐标|位置)|活动航路点)/i.test(normalized)
  if (explicitlyAir || explicitlyGround || explicitlyMarkpoint) return []
  return [
    {
      label: '空对空：用头盔获取或锁定空中目标',
      intent: 'JHMCS/HMD air-to-air target acquisition or radar/missile seeker lock',
      coreTaskTerms: ['JHMCS air-to-air target acquisition', 'helmet radar lock', 'AIM-9 seeker uncage HMD line of sight'],
      queries: ['JHMCS air-to-air mode target acquisition', 'HMD radar lock air target ACM', 'AIM-9 seeker FOV helmet uncage lock'],
    },
    {
      label: '空对地：用头盔建立地面目标指定',
      intent: 'JHMCS/HMD air-to-ground target designation at helmet line of sight',
      coreTaskTerms: ['JHMCS air-to-ground target designation', 'TDC priority HMD TDC Designate', 'ground designation diamond'],
      queries: ['JHMCS air-to-ground mode', 'HMD ground target designation', 'helmet aiming reticle TDC Designate'],
    },
    {
      label: '导航标记：保存头盔指向位置为 MARKPOINT',
      intent: 'JHMCS/HMCS create and store a markpoint from helmet line of sight',
      coreTaskTerms: ['HUD Designated Markpoint With HMCS', 'Storing a Markpoint using HMCS', 'MARK page Mark Cue store markpoint'],
      queries: ['HMCS markpoint creation', 'helmet line of sight store markpoint', 'MARK page HUD sensor Mark Cue'],
    },
  ]
}

function weaponVariantAnswerInstruction(question: string): string {
  const resolutions = resolveWeaponVariantQuestion(question)
  if (resolutions.length === 0) return ''
  return resolutions.map((resolution) => {
    if (resolution.explicitVariants.length === 1) {
      const selected = resolution.explicitVariants[0]
      const excluded = (resolution.family.variants || []).filter((variant) => variant.id !== selected.id).map((variant) => variant.label)
      return `用户明确询问 ${selected.label}。主流程只能使用该型号的制导方式和操作步骤；${excluded.length > 0 ? `不得混入 ${excluded.join('、')} 的专属设置、锁定方式或发射后制导要求。` : ''}`
    }
    const variants = resolution.explicitVariants.length >= 2 ? resolution.explicitVariants : resolution.ambiguousVariants
    if (variants.length < 2) return ''
    return `用户只给出了 ${resolution.family.canonical} 武器家族或同时提到多个型号。必须先说明各型号差异，再按 ${variants.map((variant) => variant.label).join('、')} 分成互相独立的场景；每个场景都要有自己的前提、操作和限制，禁止把不同导引头、目标获取方式或制导要求串成一套步骤。只保留当前载机手册实际支持的型号。`
  }).filter(Boolean).join('\n')
}

function taskEvidenceScore(profile: TaskSemanticProfile | null, text: string): number {
  if (!profile) return 0
  const normalized = text.normalize('NFKC')
  const subject = /(?:JHMCS|HMCS|HMD|helmet(?:-mounted)?)/i.test(normalized)
  const directTask = /(?:ground target designation|air(?:-to-|-to-|\s+)air|air target|radar lock|HMCS Lock|AIM-9|seeker|uncage|\bSTT\b|\bACM\b|designat(?:e|ed|ion)|markpoint|mark cue|designation diamond|TDC Designate|目标指定|标记点|空中目标|雷达锁定)/i.test(normalized)
  const controls = /(?:TDC|TMS|DMS|Sensor Control Switch|Radar Cursor|aiming reticle|Cage\/Uncage|瞄准十字)/i.test(normalized)
  const alignmentOnly = /(?:alignment|aligning|校准|对准)/i.test(normalized) && !directTask
  return (subject ? 2 : 0) + (directTask ? 4 : 0) + (controls ? 1 : 0) - (alignmentOnly ? 4 : 0)
}

function weaponVariantAnchorQueries(variant: WeaponVariantSemantic): string[] {
  const designations = variant.canonical.match(/\b(?:AIM|AGM|GBU|CBU|R)[\s-]*\d+[A-Z0-9-]*\b/gi) || []
  const motor = variant.canonical.match(/\bMk[.\s-]*(?:47|60)\b/gi) || []
  return [...new Set([...designations, ...motor].map((value) => value.replace(/\s+/g, '-')))]
}

function compactDesignation(value: string): string {
  return value.normalize('NFKC').toLocaleUpperCase().replace(/[^A-Z0-9]/g, '')
}

function designationKeys(value: string): string[] {
  return [...value.normalize('NFKC').matchAll(/\b(?:AIM|AGM|GBU|CBU|R)[\s-]*\d+[A-Z0-9-]*\b/gi)]
    .map((match) => compactDesignation(match[0]))
}

function designationIdentityIncludes(identity: string, designation: string): boolean {
  const compactIdentity = compactDesignation(identity)
  if (compactIdentity.includes(designation)) return true
  const match = designation.match(/^((?:AIM|AGM|GBU|CBU|R)\d+)([A-Z][A-Z0-9]*)$/)
  if (!match) return false
  const familyIndex = compactIdentity.indexOf(match[1])
  if (familyIndex < 0) return false
  // Manuals commonly abbreviate a shared heading as "AGM-154A/C" or
  // "GBU-10/12/16". After punctuation is compacted this becomes AGM154AC.
  // Limit shorthand matching to the short suffix immediately following the
  // common designation so an unrelated letter elsewhere in the path cannot
  // satisfy the requested model.
  const suffixWindow = compactIdentity.slice(familyIndex + match[1].length, familyIndex + match[1].length + 8)
  return suffixWindow.includes(match[2])
}

function cleanOutlineLabel(value: string): string {
  return value.replace(/^\s*\d+(?:\.\d+)*\s*[-–—.)]?\s*/, '').trim()
}

function proceduralOutlineTitle(title: string): boolean {
  return /(?:operation|employment|procedure|startup|start-up|guided|guidance|sensor|targeting|designation|launch|weapon|missile|bomb|rocket|航电|武器|启动|制导|操作|发射)/i.test(title)
}

function alternativeOutlineTitle(title: string): boolean {
  return /(?:\bmode\b|method|option|variant|alignment|\bwith(?:out)?\b|assisted|unassisted|automatic|manual|pilot|CPG|RIO|Jester|George|\bAI\b|single|multi|air[- ]to[- ]air|air[- ]to[- ]ground|carrier|land based|normal|stored heading|fast align|precise|coarse|fine|visual|boresight|pre[- ]planned|target of opportunity|sensor only|targeting pod|\bFCR\b|radar|laser|infrared|optical|\bLOBL\b|\bLOAL\b|\bBOL\b|\bR\/BL\b|\bPP\b|\bTOO\b|\bSP\b|\bPB\b|\bTWS\b|\bSTT\b|模式|方式|对准|前座|后座|驾驶员|炮手|人工|自动|借助|单人|多人)/i.test(title)
}

function structuralQualifierTerms(question: string): string[] {
  const aliases: Array<[RegExp, string[]]> = [
    [/(?:激光|laser|SAL|LMAV)/i, ['laser', 'SAL', 'LMAV']],
    [/(?:红外|热成像|infrared|IRMV|IRMAV)/i, ['infrared', 'IRMV', 'IRMAV', 'thermal']],
    [/(?:电视|可见光|CCD|television|visual)/i, ['CCD', 'television', 'visual']],
    [/(?:雷达|射频|长弓|radar|radio frequency|\bRF\b)/i, ['radar', 'radio frequency', 'RF']],
    [/(?:反舰|anti[- ]ship|Harpoon)/i, ['anti-ship', 'Harpoon']],
    [/(?:对陆|陆攻|land[- ]attack|SLAM)/i, ['land attack', 'SLAM']],
    [/(?:增程|extended[- ]range|SLAM[- ]ER)/i, ['extended range', 'SLAM-ER']],
    [/(?:子母|集束|submunition|cluster)/i, ['submunition', 'cluster']],
    [/(?:单体|穿透|unitary|penetrator|BROACH)/i, ['unitary', 'penetrator', 'BROACH']],
    [/(?:训练弹|惰性弹|training|inert|CATM|TGM|BDU)/i, ['training', 'inert', 'CATM', 'TGM', 'BDU']],
  ]
  return aliases.flatMap(([pattern, terms]) => pattern.test(question) ? terms : [])
}

function buildWeightedQueries(question: string, interpretation: QueryInterpretation, aircraftTerms: string[], taskProfile: TaskSemanticProfile | null): WeightedRetrievalQuery[] {
  const detectedTerms = detectDomainTerms(question)
  const weaponVariantResolutions = resolveWeaponVariantQuestion(question)
  const longProcedure = detectLongProcedureProfile(question)
  const candidates: WeightedRetrievalQuery[] = [
    { text: question, weight: 0.72 },
    { text: interpretation.intent, weight: 0.78 },
    ...(taskProfile?.stableQueries || []).map((text) => ({ text, weight: 1.95 })),
    ...(longProcedure?.searchQueries || []).map((text) => ({ text, weight: 1.92 })),
    ...interpretation.subIntents.flatMap((subIntent) => [
      { text: subIntent.intent, weight: 1.9 },
      ...subIntent.coreTaskTerms.map((text) => ({ text, weight: 1.88 })),
      ...subIntent.queries.map((text) => ({ text, weight: 1.7 })),
    ]),
    ...interpretation.coreTaskTerms.map((text) => ({ text, weight: 1.82 })),
    ...weaponVariantResolutions.flatMap((resolution) => {
      const variants = resolution.explicitVariants.length > 0 ? resolution.explicitVariants : resolution.ambiguousVariants
      return variants.flatMap((variant) => weaponVariantAnchorQueries(variant).map((text) => ({ text, weight: 2.35 })))
    }),
    ...detectedTerms.flatMap((term) => [
      { text: term.canonical, weight: 1.5 },
      { text: term.searchTerms, weight: 1.15 },
    ]),
    ...interpretation.canonicalTerms.map((text) => ({ text, weight: 1.32 })),
    ...interpretation.queries.map((text) => ({ text, weight: 1 })),
  ]
  if (/如何|怎么|怎样|步骤|流程|操作/i.test(question)) {
    const actionTerms = detectedTerms.map((t) => t.canonical)
    for (const term of actionTerms) {
      candidates.push({ text: `${term} procedure step by step`, weight: 1.6 })
      candidates.push({ text: `${term} how to operation controls`, weight: 1.45 })
    }
  }
  const deduplicated = new Map<string, WeightedRetrievalQuery>()
  for (const candidate of candidates) {
    const text = aircraftTerms.length > 0 ? stripAircraftMentions(candidate.text, aircraftTerms) : candidate.text.trim()
    if (text.length < 2) continue
    const key = text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ')
    const existing = deduplicated.get(key)
    if (!existing || existing.weight < candidate.weight) deduplicated.set(key, { text, weight: candidate.weight })
  }
  return [...deduplicated.values()].slice(0, 22)
}

function detectDomainTerms(question: string): DomainSemanticTerm[] {
  return DCS_DOMAIN_ONTOLOGY.filter((term) => term.patterns.some((pattern) => pattern.test(question)))
}

const QUERY_SUPPORT_ONLY_TERMS = new Set([
  'Setup procedure',
  'Weapons/Stores Release',
  'Master Arm',
  'A-G Master Mode/Armament',
  'A-A Master Mode',
  'Lock Target / Track Target',
])

/**
 * Local retrieval no longer asks an LLM to rewrite every question.  Keep the
 * concrete object of the question (weapon, sensor, navigation system, flight
 * function, etc.) as a deterministic evidence boundary instead.  Aircraft
 * scope answers "which manual"; this profile answers "which pages inside that
 * manual".  The two constraints must not be treated as interchangeable.
 */
function directQueryFocusTerms(question: string): DomainSemanticTerm[] {
  const detected = detectDomainTerms(question)
  const weapons = detected.filter((term) => DCS_WEAPON_ONTOLOGY.some((weapon) => weapon.canonical === term.canonical))
  if (weapons.length > 0) return weapons
  return detected.filter((term) => !QUERY_SUPPORT_ONLY_TERMS.has(term.canonical)).slice(0, 6)
}

/**
 * The local manual should only answer questions with a concrete, verifiable
 * DCS subject. A bare aircraft name plus "how do I use this", or unrelated /
 * meaningless speech, must not be allowed to fall through to weak lexical
 * retrieval and produce a confident answer from an unrelated chapter.
 */
export function localQuestionRequiresOnlineSearch(question: string): boolean {
  const normalized = normalizeQuestionInput(question)
  const content = normalized.replace(/[^\p{L}\p{N}]+/gu, '')
  if (!content || /^(.)(?:\1){2,}$/u.test(content)) return true
  if (directQueryFocusTerms(normalized).length > 0 || resolveWeaponVariantQuestion(normalized).length > 0) return false

  let residue = normalized
  let hasAircraft = false
  for (const [, pattern] of AIRCRAFT_ALIASES) {
    pattern.lastIndex = 0
    if (!pattern.test(residue)) continue
    hasAircraft = true
    pattern.lastIndex = 0
    residue = residue.replace(pattern, ' ')
  }
  residue = residue
    .replace(/(?:DCS|这个|那个|它|东西|问题|请问|麻烦|帮我|告诉我|介绍一下|说一下|讲一下)/giu, ' ')
    .replace(/(?:怎么用|如何用|怎么弄|如何弄|怎么玩|如何玩|怎么样|好不好|是什么|干什么|能干嘛|怎么办|怎么开|怎么关)/gu, ' ')
    .replace(/(?:怎么|如何|为啥|为什么|吗|呢|啊|呀|吧|请|帮|用|弄|玩|说|讲|介绍)/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')

  if (!hasAircraft) return true
  return residue.length < 2 || /^(.)(?:\1)+$/u.test(residue)
}

function directQueryFocusScore(terms: DomainSemanticTerm[], text: string): number {
  if (terms.length === 0) return 0
  return terms.reduce((score, term) => (
    score + (term.patterns.some((pattern) => {
      pattern.lastIndex = 0
      return pattern.test(text)
    }) ? 1 : 0)
  ), 0)
}

export function deterministicFocusEvidenceScore(question: string, manualText: string): number {
  return directQueryFocusScore(directQueryFocusTerms(normalizeQuestionInput(question)), manualText)
}

interface LongProcedureProfile {
  id: 'cold-start' | 'weapon-employment' | 'avionics-operation' | 'flight-procedure'
  questionPattern: RegExp
  chapterPatterns: RegExp[]
  phases: Array<{ id: string; patterns: RegExp[] }>
  searchQueries: string[]
  optionalOnlyPattern: RegExp
  maximumSpan: number
}

const LONG_PROCEDURE_PROFILES: LongProcedureProfile[] = [{
  id: 'cold-start',
  questionPattern: /(?:冷启动|冷舱启动|从关机开始|启动发动机|开机步骤|\bcold\s+start\b|\bramp\s+start\b)/i,
  chapterPatterns: [
    /\b(?:cold|ramp)\s+start\b/i,
    /\bstart[\s-]*up\s+(?:procedure|checklist|sequence)\b/i,
    /\b(?:pilot|aircraft)\s+start[\s-]*up\b/i,
  ],
  phases: [
    { id: 'preparation', patterns: [/\bpre[\s-]*start\b/i, /\bcockpit\s+preparation\b/i, /\bbefore\s+(?:engine\s+)?start/i, /(?:启动前|座舱准备|接通地面电源|外接电源)/i] },
    { id: 'power-engine', patterns: [/\bengine\s+start\b/i, /\bAPU\b/i, /\bengine\s+crank\b/i, /\bground\s+(?:air|power)\b/i, /(?:发动机启动|启动发动机|启动APU|发动机起动|地面气源)/i] },
    { id: 'navigation-alignment', patterns: [/\b(?:INS|GPS|EGI)\b.{0,80}\b(?:alignment|align)\b/i, /\bstored\s+heading\b/i, /\bgyrocompass\b/i, /\bnavigation\s+alignment\b/i, /(?:惯导|GPS|导航).{0,20}(?:对准|校准)/i] },
    { id: 'post-start', patterns: [/\bpost[\s-]*(?:start|alignment)\b/i, /\bafter\s+start(?:ing)?\b/i, /\bfollowing\s+(?:the\s+)?(?:first|second|both)?\s*engine\s+start\b/i, /\bready\s+to\s+taxi\b/i, /\bflight\s+controls?\s+check\b/i, /\b(?:FCS\s+BIT|OBOGS|IFF|Link[\s-]*16|Data\s+Transfer\s+Cartridge)\b/i, /(?:启动后|对准后|滑行前|准备滑行|飞控检查)/i] },
  ],
  searchQueries: [
    'start-up procedure pre-start engine start post-start',
    'cold start checklist complete sequence',
    'INS GPS navigation alignment startup',
    'post-start checks ready to taxi',
  ],
  optionalOnlyPattern: /\b(?:assisted|automatic|auto)\s+start(?:up)?\b|\bJester\b.{0,80}\bstart(?:up)?\b/i,
  maximumSpan: 24,
}, {
  id: 'weapon-employment',
  questionPattern: /(?:怎么用|如何用|怎么发射|如何发射|怎么投放|如何投放|武器怎么|弹药怎么|\bemploy(?:ment)?\b|\bweapon\s+(?:delivery|release|employment)\b)/i,
  chapterPatterns: [
    /\b(?:weapon|missile|bomb|rocket)\s+(?:employment|delivery|release|operation)\b/i,
    /\bair[\s-]*to[\s-]*(?:air|ground)\s+(?:employment|weapons?)\b/i,
    /\b(?:employment|delivery)\s+procedure\b/i,
  ],
  phases: [
    { id: 'prerequisites-loadout', patterns: [/\b(?:prerequisites?|conditions?|loadout|stores?|inventory|master\s+arm|arming)\b/i, /(?:前提|挂载|装载|武器保险|主武器|主军械)/i] },
    { id: 'mode-sensor-setup', patterns: [/\b(?:master\s+mode|weapon\s+select|sensor|radar|targeting\s+pod|seeker|SMS|stores\s+page)\b/i, /(?:主模式|武器选择|传感器|雷达|吊舱|导引头|武器页面)/i] },
    { id: 'acquire-designate', patterns: [/\b(?:acquire|lock|track|designat|target\s+point|SPI|SOI)\w*\b/i, /(?:获取|锁定|跟踪|指定目标|目标点)/i] },
    { id: 'release-launch', patterns: [/\b(?:release|launch|fire|pickle|trigger|weapon\s+release)\w*\b/i, /(?:发射|投放|释放|按下发射|按下投弹)/i] },
    { id: 'post-release-limits', patterns: [/\b(?:post[\s-]*release|after\s+(?:launch|release)|breakaway|time\s+to\s+impact|limitations?|constraints?|minimum\s+range)\b/i, /(?:发射后|投放后|脱离|命中时间|限制|最小距离)/i] },
  ],
  searchQueries: [
    'weapon employment complete procedure prerequisites sensor target release',
    'weapon mode target acquisition designation launch release',
    'post release guidance limitations breakaway',
  ],
  optionalOnlyPattern: /\b(?:automatic|auto)\s+(?:acquisition|release|delivery)\b|\bAI\b.{0,80}\b(?:fire|release|attack)\b/i,
  maximumSpan: 22,
}, {
  id: 'avionics-operation',
  questionPattern: /(?:怎么设置|如何设置|怎么操作|如何操作|怎么输入|如何输入|怎么校准|如何校准|怎么对准|如何对准|\b(?:configure|operate|program|enter|align|calibrate)\b)/i,
  chapterPatterns: [
    /\b(?:operation|operating|configuration|programming|alignment)\s+(?:procedure|instructions?)\b/i,
    /\b(?:avionics|navigation|radar|sensor|display)\s+(?:operation|setup|configuration)\b/i,
  ],
  phases: [
    { id: 'power-entry', patterns: [/\b(?:power|on|mode|page|menu|select)\b/i, /(?:供电|开机|进入|页面|菜单|选择模式)/i] },
    { id: 'configure-input', patterns: [/\b(?:configure|enter|input|set|program|option|parameter|channel|frequency)\w*\b/i, /(?:配置|输入|设置|编程|参数|频道|频率)/i] },
    { id: 'execute-confirm', patterns: [/\b(?:execute|apply|confirm|accept|save|update|enable|activate)\w*\b/i, /(?:执行|应用|确认|保存|更新|启用|激活)/i] },
    { id: 'feedback-limits', patterns: [/\b(?:indication|display|status|complete|ready|warning|limitations?|constraints?|invalid)\b/i, /(?:显示|状态|完成|就绪|警告|限制|无效)/i] },
  ],
  searchQueries: [
    'system operation complete procedure setup input confirm indication',
    'avionics configuration controls parameters status limitations',
  ],
  optionalOnlyPattern: /\b(?:automatic|auto)\s+(?:setup|alignment|configuration)\b|\bAI\b.{0,80}\b(?:configure|operate)\b/i,
  maximumSpan: 18,
}, {
  id: 'flight-procedure',
  questionPattern: /(?:起飞|降落|着陆|着舰|航母降落|航母回收|一类回收|二类回收|三类回收|进近|复飞|空中加油|空投|空降|编队|悬停|滑行|怎么飞|如何飞|CASE[\s._-]*(?:I{1,3}|[123])\b|\b(?:takeoff|landing|carrier\s+(?:landing|recovery)|approach|go[\s-]*around|air\s+refuel|AAR|air[\s-]*drop|airdrop|aerial\s+delivery|formation|hover|taxi)\b)/i,
  chapterPatterns: [
    /\b(?:takeoff|landing|approach|air\s+refueling|AAR|air[\s-]*drop|airdrop|aerial\s+delivery|CARP|formation|hover|taxi)\s*(?:procedure|procedures|operation|panel)?\b/i,
    /\bCASE\s*(?:I{1,3}|[123])(?:\s+(?:carrier\s+)?(?:recovery|approach|landing))?\b/i,
    /\bflight\s+procedure\b/i,
  ],
  phases: [
    { id: 'conditions-configuration', patterns: [/\b(?:conditions?|configuration|weight|fuel|flaps?|gear|trim|speed)\b/i, /(?:条件|构型|重量|油量|襟翼|起落架|配平|速度)/i] },
    { id: 'entry', patterns: [/\b(?:entry|initial|pre[\s-]*contact|pattern|intercept|lineup)\b/i, /(?:进入|初始|预接触|航线|截获|对正)/i] },
    { id: 'execution', patterns: [/\b(?:execute|maintain|hold|descend|climb|turn|contact|connect)\w*\b/i, /(?:执行|保持|下降|爬升|转弯|接触|连接)/i] },
    { id: 'criteria-feedback', patterns: [/\b(?:criteria|indication|stable|on[\s-]*speed|glideslope|signal|cue)\b/i, /(?:判据|指示|稳定|迎角|下滑|信号|提示)/i] },
    { id: 'abort-exit', patterns: [/\b(?:abort|waveoff|go[\s-]*around|disconnect|breakaway|exit|missed\s+approach)\b/i, /(?:中止|复飞|脱离|断开|退出|拉起)/i] },
  ],
  searchQueries: [
    'flight procedure configuration entry execution criteria abort',
    'normal procedure indications limitations emergency exit',
    'airdrop aerial delivery panel CARP payload drop zone release cue cargo ramp door jump light',
  ],
  optionalOnlyPattern: /\b(?:automatic|auto)\s+(?:landing|takeoff|approach|refuel)\b|\bAI\b.{0,80}\b(?:fly|land|takeoff)\b/i,
  maximumSpan: 22,
}]

function detectLongProcedureProfile(question: string): LongProcedureProfile | null {
  const normalized = normalizeQuestionInput(question)
  const coldStart = LONG_PROCEDURE_PROFILES[0]
  if (coldStart.questionPattern.test(normalized)) return coldStart
  const weaponProfile = LONG_PROCEDURE_PROFILES.find((profile) => profile.id === 'weapon-employment')!
  if (DCS_WEAPON_ONTOLOGY.some((term) => term.patterns.some((pattern) => pattern.test(normalized))) && isProceduralQuestion(normalized)) return weaponProfile
  const flightProfile = LONG_PROCEDURE_PROFILES.find((profile) => profile.id === 'flight-procedure')!
  if (flightProfile.questionPattern.test(normalized)) return flightProfile
  const avionicsProfile = LONG_PROCEDURE_PROFILES.find((profile) => profile.id === 'avionics-operation')!
  const substantiveSystem = detectDomainTerms(normalized).some((term) => !QUERY_SUPPORT_ONLY_TERMS.has(term.canonical))
  return substantiveSystem && avionicsProfile.questionPattern.test(normalized) ? avionicsProfile : null
}

interface CarrierCaseRequest {
  number: '1' | '2' | '3'
  roman: 'I' | 'II' | 'III'
}

function requestedCarrierCase(question: string): CarrierCaseRequest | null {
  const match = normalizeQuestionInput(question).match(/CASE[\s._-]*(I{1,3}|[123])\b/i)
  if (!match) return null
  const number = ({ I: '1', II: '2', III: '3', '1': '1', '2': '2', '3': '3' } as const)[match[1].toLocaleUpperCase() as 'I' | 'II' | 'III' | '1' | '2' | '3']
  return {
    number,
    roman: ({ '1': 'I', '2': 'II', '3': 'III' } as const)[number],
  }
}

function carrierCaseTitlePattern(request: CarrierCaseRequest): RegExp {
  return new RegExp(`\\bCASE\\s*(?:${request.roman}|${request.number})\\b`, 'i')
}

function longProcedureOutlineFocusPatterns(profile: LongProcedureProfile, question: string): RegExp[] {
  if (profile.id !== 'flight-procedure') return []
  const normalized = normalizeQuestionInput(question)
  const carrierCase = requestedCarrierCase(normalized)
  if (carrierCase) return [carrierCaseTitlePattern(carrierCase)]
  const categories: Array<[RegExp, RegExp[]]> = [
    [/(?:空中加油|空中受油|加油机|\b(?:air[-\s]*to[-\s]*air|aerial|air)\s+refuel(?:ing)?\b|\bAAR\b)/i, [/\b(?:air[-\s]*to[-\s]*air|aerial|air)\s+refuel(?:ing)?\b|\bAAR\b/i]],
    [/(?:空投|空降|\bair[\s-]*drop\b|\bairdrop\b|\baerial\s+delivery\b)/i, [/\bair[\s-]*drop\b|\bairdrop\b|\baerial\s+delivery\b|\bCARP\b/i]],
    [/(?:起飞|\btake[\s-]*off\b)/i, [/\btake[\s-]*off\b/i]],
    [/(?:着舰|航母降落|航母回收|一类回收|二类回收|三类回收|\bcarrier\s+(?:landing|recovery)\b)/i, [/\bcarrier\s+landing\b|\bcase\s+(?:I|II|III|1|2|3)\s+recovery\b|\bICLS\b|\bACLS\b/i]],
    [/(?:降落|着陆|着舰|航母降落|航母回收|进近|复飞|\b(?:landing|carrier\s+(?:landing|recovery)|approach|go[\s-]*around|waveoff|missed\s+approach)\b)/i, [/\b(?:landing|carrier\s+(?:landing|recovery)|approach|go[\s-]*around|waveoff|missed\s+approach)\b/i]],
    [/(?:悬停|\bhover\b)/i, [/\bhover\b/i]],
    [/(?:滑行|\btaxi\b)/i, [/\btaxi\b/i]],
    [/(?:编队|\bformation\b)/i, [/\bformation\b/i]],
  ]
  return categories.find(([questionPattern]) => questionPattern.test(normalized))?.[1] || []
}

function procedurePhaseIds(profile: LongProcedureProfile, text: string): Set<string> {
  const phases = new Set<string>()
  for (const phase of profile.phases) {
    if (phase.patterns.some((pattern) => pattern.test(text))) phases.add(phase.id)
  }
  return phases
}

function procedureChapterSignal(profile: LongProcedureProfile, text: string): number {
  return profile.chapterPatterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}

export function deterministicProcedureCompleteness(question: string, manualText: string): string[] {
  const profile = detectLongProcedureProfile(normalizeQuestionInput(question))
  return profile ? [...procedurePhaseIds(profile, manualText)] : []
}

function focusBoundedCandidates(candidates: ManualSearchHit[], focusTerms: DomainSemanticTerm[], question: string): ManualSearchHit[] {
  if (focusTerms.length === 0 || candidates.length === 0) return candidates
  const direct = candidates.filter((candidate) => directQueryFocusScore(focusTerms, candidate.excerpt) > 0)
  if (direct.length === 0) return candidates

  const longProcedure = detectLongProcedureProfile(question)

  const directPagesByDocument = new Map<string, number[]>()
  for (const candidate of direct) {
    if (!candidate.page) continue
    const pages = directPagesByDocument.get(candidate.documentId) || []
    pages.push(candidate.page)
    directPagesByDocument.set(candidate.documentId, pages)
  }
  const bounded = candidates.filter((candidate) => {
    if (directQueryFocusScore(focusTerms, candidate.excerpt) > 0) return true
    if (!candidate.page) return false
    const pages = directPagesByDocument.get(candidate.documentId)
    const radius = longProcedure ? 12 : 4
    return Boolean(pages?.some((page) => Math.abs(page - candidate.page!) <= radius))
  })
  return bounded.length > 0 ? bounded : direct
}

/**
 * A family name is deliberately broad, but an explicit model is a hard
 * evidence boundary.  Assign neighbouring pages to the nearest model heading
 * so a K/SAL procedure cannot silently absorb the adjacent L/RF procedure (or
 * IR/CCD/laser Maverick chapters).  Common introduction pages that explicitly
 * mention the selected model remain available for comparison and prerequisites.
 */
function weaponVariantBoundedCandidates(candidates: ManualSearchHit[], question: string): ManualSearchHit[] {
  const resolutions = resolveWeaponVariantQuestion(question)
    .filter((resolution) => resolution.explicitVariants.length === 1)
  if (resolutions.length === 0 || candidates.length === 0) return candidates

  let bounded = candidates
  for (const resolution of resolutions) {
    const selected = resolution.explicitVariants[0]
    const variants = resolution.family.variants || []
    const anchors = bounded.flatMap((source) => {
      if (!source.page) return []
      return variants
        .filter((variant) => weaponVariantEvidenceScore(variant, source.excerpt) > 0)
        .map((variant) => ({ documentId: source.documentId, page: source.page!, variantId: variant.id }))
    })
    const selectedAnchors = anchors.filter((anchor) => anchor.variantId === selected.id)
    // An explicit model without an exact model anchor is unsupported in the
    // current aircraft/manual scope. Falling back to the family would silently
    // answer with a sibling model, which is more dangerous than no answer.
    if (selectedAnchors.length === 0) return []

    const next = bounded.filter((source) => {
      const selectedEvidence = weaponVariantEvidenceScore(selected, source.excerpt)
      if (selectedEvidence > 0) return true
      if (!source.page) return false
      const documentAnchors = anchors.filter((anchor) => anchor.documentId === source.documentId)
      if (documentAnchors.length === 0) return false
      const nearest = [...documentAnchors].sort((left, right) => (
        Math.abs(left.page - source.page!) - Math.abs(right.page - source.page!)
        || (left.variantId === selected.id ? -1 : 1)
      ))[0]
      return nearest.variantId === selected.id && Math.abs(nearest.page - source.page) <= 12
    })
    if (next.length > 0) bounded = next
  }
  return bounded
}

export function deterministicQuestionSemantics(question: string): string {
  question = normalizeQuestionInput(question)
  const aircraft = [...new Set(AIRCRAFT_ALIASES
    .filter(([, pattern]) => pattern.test(question))
    .map(([name]) => name))]
  if (aircraft.includes('F-14B(U)')) {
    const genericIndex = aircraft.indexOf('F-14')
    if (genericIndex >= 0) aircraft.splice(genericIndex, 1)
  }
  const terms = detectDomainTerms(question).slice(0, 12)
  const weaponVariants = resolveWeaponVariantQuestion(question)
  if (aircraft.length === 0 && terms.length === 0) return ''
  const lines = [
    aircraft.length > 0 ? `机型：${aircraft.join('、')}` : '',
    terms.length > 0 ? `规范术语：${terms.map((term) => term.canonical).join('；')}` : '',
    terms.length > 0 ? `检索同义词：${terms.map((term) => term.searchTerms).join('；')}` : '',
    ...weaponVariants.map((resolution) => resolution.explicitVariants.length > 0
      ? `武器型号边界：${resolution.explicitVariants.map((variant) => variant.label).join('、')}（不得混入同族其他型号）`
      : `武器家族存在分支：${resolution.ambiguousVariants.map((variant) => variant.label).join('、')}（按型号分场景）`),
  ].filter(Boolean)
  return `DCSHUB 本地确定性语义解析：\n${lines.map((line) => `- ${line}`).join('\n')}`
}

function deterministicCoreTaskTerms(question: string): string[] {
  const detected = detectDomainTerms(question).filter((term) => term.canonical !== 'Setup procedure')
  const terms = detected.flatMap((term) => [term.canonical, term.searchTerms])
  const carrierCase = question.normalize('NFKC').match(/CASE[\s._-]*(I{1,3}|[123])\b/i)
  if (carrierCase) {
    const caseNumber = ({ I: '1', II: '2', III: '3', '1': '1', '2': '2', '3': '3' } as Record<string, string>)[carrierCase[1].toLocaleUpperCase()]
    const roman = ({ '1': 'I', '2': 'II', '3': 'III' } as Record<string, string>)[caseNumber]
    terms.push(
      `CASE ${roman} carrier recovery`,
      `CASE ${roman} recovery procedure marshal approach pattern landing waveoff`,
    )
  }
  for (const resolution of resolveWeaponVariantQuestion(question)) {
    const variants = resolution.explicitVariants.length > 0 ? resolution.explicitVariants : resolution.ambiguousVariants
    for (const variant of variants) terms.push(variant.canonical, variant.searchTerms)
  }
  terms.push(...(detectTaskSemanticProfile(question)?.stableQueries || []))
  const actionVerbs = [
    { pattern: /(?:如何|怎么|怎样).*(?:标记|指定|标定)/, additions: ['target designation procedure steps', 'how to designate', 'designate target controls', 'ground target designation steps'] },
    { pattern: /(?:如何|怎么|怎样).*(?:锁定|跟踪)/, additions: ['radar lock track target', 'lock target steps', 'target lock procedure'] },
    { pattern: /(?:如何|怎么|怎样).*(?:启动|开车|冷启动)/, additions: ['cold start procedure steps', 'engine start sequence', 'ramp start checklist'] },
    { pattern: /(?:如何|怎么|怎样).*(?:投弹|投放|发射|射击)/, additions: ['weapon release procedure', 'bomb delivery steps', 'CCIP CCRP employment'] },
    { pattern: /(?:如何|怎么|怎样).*(?:降落|着陆|着舰|回收)/, additions: ['landing procedure approach', 'carrier recovery CASE', 'landing pattern steps'] },
    { pattern: /(?:如何|怎么|怎样).*(?:起飞|弹射)/, additions: ['takeoff procedure', 'catapult launch steps', 'taxi takeoff'] },
    { pattern: /(?:如何|怎么|怎样).*(?:导航|飞到|航路点)/, additions: ['navigation waypoint steerpoint', 'direct to steerpoint', 'route navigation'] },
    { pattern: /(?:如何|怎么|怎样).*(?:干扰弹|箔条|热焰弹)/, additions: ['countermeasure dispense chaff flare', 'CMS program countermeasures'] },
    { pattern: /(?:如何|怎么|怎样).*(?:雷达|FCR)/, additions: ['radar operation mode', 'FCR mode select', 'radar target acquisition'] },
    { pattern: /(?:如何|怎么|怎样).*(?:TGP|吊舱|瞄准吊舱)/, additions: ['TGP targeting pod operation', 'targeting pod designation SPI', 'TGP track target'] },
    { pattern: /(?:如何|怎么|怎样).*(?:加油|空中加油)/, additions: ['air refueling procedure AAR', 'pre-contact contact position tanker'] },
    { pattern: /(?:如何|怎么|怎样).*(?:小牛|Maverick|AGM-65)/, additions: ['Maverick AGM-65 employment', 'Maverick lock handoff boresight'] },
    { pattern: /(?:如何|怎么|怎样).*(?:哈姆|HARM|反辐射)/, additions: ['HARM employment AGM-88 SEAD', 'HARM TOO POS PB mode', 'HTS HAD HARM targeting'] },
    { pattern: /(?:如何|怎么|怎样).*(?:激光|照射|LGB|GBU)/, additions: ['laser designation LGB delivery', 'laser code buddy lase', 'laser guided bomb release'] },
    { pattern: /(?:如何|怎么|怎样).*(?:自动驾驶|配平)/, additions: ['autopilot modes use', 'trim procedure flight controls'] },
    { pattern: /(?:如何|怎么|怎样).*(?:无线电|电台|频率)/, additions: ['radio preset frequency tune', 'UHF VHF communication setup'] },
  ]
  for (const { pattern, additions } of actionVerbs) {
    if (pattern.test(question)) terms.push(...additions)
  }
  // Chinese users naturally put the object before the request verb (for
  // example "F-14 的不死鸟怎么用").  The old verb-first expressions missed
  // that entire class of questions after the LLM query-rewrite stage was
  // removed.  Object-specific procedure queries are order-independent here.
  if (isProceduralQuestion(question)) {
    for (const term of directQueryFocusTerms(question)) {
      terms.push(`${term.canonical} employment procedure`)
      terms.push(`${term.searchTerms} controls steps`)
    }
  }
  return [...new Set(terms)]
}

function buildDomainSearchQueries(question: string): string[] {
  const semanticTerms = detectDomainTerms(question)
  const queries: string[] = []
  const subjectTerms = semanticTerms.filter((term) => term.canonical !== 'Setup procedure')
  for (const term of subjectTerms) {
    queries.push(term.canonical)
    queries.push(term.searchTerms)
  }
  for (const resolution of resolveWeaponVariantQuestion(question)) {
    const variants = resolution.explicitVariants.length > 0 ? resolution.explicitVariants : resolution.ambiguousVariants
    for (const variant of variants) {
      queries.push(variant.canonical)
      queries.push(variant.searchTerms)
    }
  }
  const proceduralMatch = question.match(/(如何|怎么|怎样|步骤|流程|操作)\s*(.+)/)
  if (proceduralMatch && subjectTerms.length > 0) {
    for (const term of subjectTerms) {
      if (/标记|指定|designat/i.test(question)) queries.push(`${term.canonical} procedure steps how to`)
      if (/锁定|跟踪|lock|track/i.test(question)) queries.push(`${term.canonical} lock track steps`)
      if (/启动|启动|start/i.test(question)) queries.push(`${term.canonical} startup procedure sequence`)
    }
  }
  return [...new Set(queries)].slice(0, 12)
}

function retrievalKeywords(queries: string[]): string[] {
  const stopWords = new Set(['about', 'after', 'before', 'commands', 'controls', 'flight', 'from', 'how', 'into', 'manual', 'operation', 'procedure', 'procedures', 'setup', 'system', 'that', 'the', 'this', 'with'])
  return [...new Set(queries.flatMap((query) => query.normalize('NFKC').toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}|[\u3400-\u9fff]{2,}/g) || []))]
    .filter((word) => !stopWords.has(word))
}

function isReferenceOnlyPage(text: string): boolean {
  const heading = text.slice(0, 500)
  return /(?:table of contents|contents\s*$|glossary|acronyms?|abbreviations?|morse code alphabet|latest changes|revision history|change\s*log|release notes|document revisions|alphabetical index)/im.test(heading)
    || (text.match(/\.{5,}\s*\d{1,4}/g)?.length || 0) >= 3
}

function keywordEvidenceScore(text: string, keywords: string[]): number {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? (keyword.length >= 6 ? 1.25 : 1) : 0), 0)
}

function structuralKeywordEvidenceScore(text: string, keywords: string[]): number {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const latinTokens = new Set(normalized.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [])
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = keyword.normalize('NFKC').toLocaleLowerCase()
    const matched = /^[a-z0-9-]+$/.test(normalizedKeyword)
      ? latinTokens.has(normalizedKeyword)
      : normalized.includes(normalizedKeyword)
    return score + (matched ? (normalizedKeyword.length >= 6 ? 1.25 : 1) : 0)
  }, 0)
}

function focusedEvidence(text: string, keywords: string[], maximumLength: number): string {
  if (text.length <= maximumLength || keywords.length === 0) return text.slice(0, maximumLength)
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const radius = Math.floor(maximumLength / 2)
  const positions = keywords.flatMap((keyword) => {
    const matches: number[] = []
    let offset = normalized.indexOf(keyword)
    while (offset >= 0 && matches.length < 4) {
      matches.push(offset)
      offset = normalized.indexOf(keyword, offset + keyword.length)
    }
    return matches
  })
  if (positions.length === 0) return text.slice(0, maximumLength)
  let bestStart = 0
  let bestScore = -1
  for (const position of positions) {
    const start = Math.max(0, Math.min(text.length - maximumLength, position - radius))
    const window = normalized.slice(start, start + maximumLength)
    const score = keywords.reduce((total, keyword) => total + (window.includes(keyword) ? 1 : 0), 0)
    if (score > bestScore) {
      bestStart = start
      bestScore = score
    }
  }
  const excerpt = text.slice(bestStart, bestStart + maximumLength).trim()
  return `${bestStart > 0 ? '…\n' : ''}${excerpt}${bestStart + maximumLength < text.length ? '\n…' : ''}`
}

function isProceduralQuestion(question: string): boolean {
  return /(?:how|steps?|procedure|checklist|configure|setup|operate|employment|CASE[\s._-]*(?:I{1,3}|[123])\b|如何|怎么|怎样|步骤|流程|操作|设置|配置|使用|发射|投放|启动|起飞|着陆|降落|着舰|回收|加油|校准|对准)/i.test(question)
}

function proceduralActionScore(text: string): number {
  const actions = text.normalize('NFKC').toLocaleLowerCase().match(/\b(?:command|configure|define|designate|enter|execute|hold|look|monitor|open|press|release|select|set|slave|toggle|use|verify|switch|rotate|move|wait|check|confirm|start|align|activate)\w*\b|(?:选择|设置|输入|按下|按住|看向|指令|指定|打开|关闭|确认|执行|监控|释放|切换|旋转|移动|等待|检查|启动|对准|校准|激活)/g) || []
  return new Set(actions).size
}

function proceduralHeadingScore(text: string): number {
  return text.split(/\r?\n/).slice(0, 80).reduce((score, rawLine) => {
    const line = rawLine.trim()
    if (line.length < 4 || line.length > 110) return score
    if (/[.!?。！？]$/.test(line)) return score
    const hasHeadingTerm = /\b(?:procedure|procedures|operation|operations|employment|designation|commands?|controls?|setup|configuration)\b/i.test(line)
    const compactTitle = line.split(/\s+/).length <= 12
    const numberedTitle = /^\d+(?:\.\d+)+\s*[–—-]?\s*/.test(line)
    const looksLikeHeading = /^[A-Z][A-Z0-9 /&()-]{2,}$/.test(line) || (hasHeadingTerm && (compactTitle || numberedTitle))
    return score + (looksLikeHeading ? 1 : 0)
  }, 0)
}

function tocReferences(excerpt: string, queries: string[]): number[] {
  if (!/(?:\.{5,}|…{3,})\s*\d{1,4}/.test(excerpt)) return []
  const keywords = retrievalKeywords(queries)
  return excerpt.split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(.+?)(?:\.{5,}|…{3,})\s*(\d{1,4})\s*$/)
      if (!match) return null
      const title = match[1].normalize('NFKC').toLocaleLowerCase()
      const score = keywords.reduce((total, keyword) => total + (title.includes(keyword) ? 1 : 0), 0)
      return score > 0 ? { page: Number(match[2]), score } : null
    })
    .filter((item): item is { page: number; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.page)
    .slice(0, 4)
}

function mergeOverlappingTexts(texts: string[]): string {
  let merged = ''
  for (const text of texts) {
    if (!merged) {
      merged = text
      continue
    }
    let overlap = 0
    const maximum = Math.min(CHUNK_OVERLAP + 80, merged.length, text.length)
    for (let length = maximum; length >= 40; length -= 1) {
      if (merged.endsWith(text.slice(0, length))) {
        overlap = length
        break
      }
    }
    merged += `\n${text.slice(overlap)}`
  }
  return merged.slice(0, PAGE_CONTEXT_LENGTH)
}

interface ResolvedOutlineSection extends ExtractedOutlineEntry {
  endPage: number
}

function resolveOutlineSections(outline: ExtractedOutlineEntry[], pageCount: number): ResolvedOutlineSection[] {
  return outline.map((entry, index) => {
    const nextBoundary = outline.slice(index + 1).find((candidate) => candidate.page > entry.page && candidate.level <= entry.level)
    return { ...entry, endPage: Math.max(entry.page, (nextBoundary?.page || pageCount + 1) - 1) }
  })
}

function outlineSectionForPage(sections: ResolvedOutlineSection[], page: number | null): ResolvedOutlineSection | null {
  if (!page) return null
  return sections
    .filter((section) => section.page <= page && section.endPage >= page)
    .sort((left, right) => right.level - left.level || right.page - left.page)[0] || null
}

function chunkPages(
  documentId: string,
  metadata: Omit<SearchableChunk, 'id' | 'page' | 'text' | 'sectionTitle' | 'sectionPath' | 'sectionLevel' | 'sectionStartPage' | 'sectionEndPage'>,
  pages: ExtractedPage[],
  outline: ExtractedOutlineEntry[],
): SearchableChunk[] {
  const chunks: SearchableChunk[] = []
  const sections = resolveOutlineSections(outline, Math.max(1, ...pages.map((page) => page.page || 1)))
  for (const page of pages) {
    const normalized = page.text.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (!normalized) continue
    const section = outlineSectionForPage(sections, page.page)
    const sectionMetadata = {
      sectionTitle: section?.title || '',
      sectionPath: section?.path.join(' > ') || '',
      sectionLevel: section?.level ?? -1,
      sectionStartPage: section?.page || 0,
      sectionEndPage: section?.endPage || 0,
    }
    if (normalized.length <= PAGE_CHUNK_PREFER_LENGTH) {
      chunks.push({ ...metadata, ...sectionMetadata, id: `${documentId}:${page.page ?? 0}:0`, page: page.page, text: normalized })
      continue
    }
    let offset = 0
    let part = 0
    while (offset < normalized.length) {
      let end = Math.min(offset + CHUNK_LENGTH, normalized.length)
      if (end < normalized.length) {
        const stepBoundary = normalized.slice(offset, end + 200).search(/\n\s*\d+[.)]\s+[A-Za-z\u4e00-\u9fff]/)
        const headingBoundary = normalized.slice(offset, end + 300).search(/\n\s*(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z][A-Z0-9 /&()-]{4,}$/m)
        const paraBoundary = Math.max(normalized.lastIndexOf('\n\n', end), normalized.lastIndexOf('. ', end), normalized.lastIndexOf('。', end))
        let boundary = paraBoundary
        if (stepBoundary > 0 && offset + stepBoundary > offset + Math.floor(CHUNK_LENGTH * 0.35)) {
          boundary = Math.min(offset + stepBoundary, end + 150)
        } else if (headingBoundary > 0 && offset + headingBoundary > offset + Math.floor(CHUNK_LENGTH * 0.4)) {
          boundary = Math.min(offset + headingBoundary, end + 100)
        }
        if (boundary > offset + Math.floor(CHUNK_LENGTH * 0.45)) end = boundary + 1
      }
      const text = normalized.slice(offset, end).trim()
      if (text) chunks.push({ ...metadata, ...sectionMetadata, id: `${documentId}:${page.page ?? 0}:${part}`, page: page.page, text })
      if (end >= normalized.length) break
      offset = Math.max(offset + 1, end - CHUNK_OVERLAP)
      part += 1
    }
  }
  return chunks
}

export class ManualLibraryService {
  private readonly settingsPath: string
  private readonly manifestPath: string
  private readonly indexPaths: Record<ManualSourceKind, string>
  private readonly documentCachePath: string
  private readonly pagePreviewCachePath: string
  private readonly answerCachePath: string
  private readonly onlineAnswerCachePath: string
  private readonly protector: SecretProtector
  private readonly dcsRootProvider: () => string | null
  private readonly fetchImpl: FetchLike
  private readonly deepSeekClient: DeepSeekClient
  private readonly documentParser = new ManualDocumentParser()
  private readonly previewCache: ManualPreviewCache
  private readonly storage = new ManualStorage()
  private readonly progressReporter: ProgressReporter
  private readonly pendingDcsDuplicateCopies = new Set<string>()
  private settings: StoredSettings
  private manifest: StoredManifest
  private readonly searchIndexes = new Map<ManualSourceKind, ManualSearchDatabase>()
  private readonly expandedQueryCache = new Map<string, QueryInterpretation>()
  private readonly rerankCache = new Map<string, string[]>()
  private readonly documentChunksCache = new Map<string, SearchableChunk[]>()
  private readonly answerCache = new Map<string, StoredAnswerCacheEntry>()
  private readonly onlineAnswerCache = new Map<string, StoredOnlineAnswerCacheEntry>()
  private indexing: Promise<ManualOperationResult> | null = null
  private indexError: string | undefined
  private currentProgress: ManualLibraryProgress | null = null

  constructor(
    userDataPath: string,
    protector: SecretProtector,
    dcsRootProvider: () => string | null,
    fetchImpl: FetchLike = fetch,
    progressReporter: ProgressReporter = () => undefined,
  ) {
    const storagePath = path.join(userDataPath, 'manual-library')
    this.settingsPath = path.join(storagePath, 'settings.json')
    this.manifestPath = path.join(storagePath, 'manifest.json')
    this.indexPaths = {
      user: path.join(storagePath, 'orama-index-v6-user.json.gz'),
      dcs: path.join(storagePath, 'orama-index-v6-dcs.json.gz'),
      chuck: path.join(storagePath, 'orama-index-v6-chuck.json.gz'),
    }
    this.documentCachePath = path.join(storagePath, 'documents')
    this.pagePreviewCachePath = path.join(storagePath, 'page-previews')
    this.previewCache = new ManualPreviewCache(this.pagePreviewCachePath)
    this.answerCachePath = path.join(storagePath, 'verified-answer-cache-v1.json.gz')
    this.onlineAnswerCachePath = path.join(storagePath, 'online-answer-cache-v1.json.gz')
    this.protector = protector
    this.dcsRootProvider = dcsRootProvider
    this.fetchImpl = fetchImpl
    this.deepSeekClient = new DeepSeekClient(fetchImpl)
    this.progressReporter = progressReporter
    // Kept only to read legacy semantic-cache data during this migration; the
    // normal ask path no longer invokes the AI semantic interpreter.
    void this.interpretQuestion
    this.settings = this.loadSettings()
    this.manifest = this.loadManifest()
    this.loadAnswerCache()
    this.loadOnlineAnswerCache()
  }

  overview(): ManualLibraryOverview {
    const documents = [...this.manifest.documents].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    return {
      configured: Boolean(this.settings.libraryPath && this.isDirectory(this.settings.libraryPath)),
      onboardingCompleted: this.settings.onboardingCompleted,
      libraryPath: this.settings.libraryPath,
      documents,
      index: {
        state: this.indexing ? 'indexing' : this.indexError ? 'error' : Object.values(this.indexPaths).some((indexPath) => fs.existsSync(indexPath)) ? 'ready' : 'idle',
        documentCount: documents.length,
        pageCount: documents.reduce((total, document) => total + document.pageCount, 0),
        chunkCount: documents.reduce((total, document) => total + document.chunkCount, 0),
        cacheSize: this.cacheSize(),
        lastIndexedAt: this.manifest.lastIndexedAt,
        lastError: this.indexError,
      },
      answerCache: this.answerCacheStatus(),
      deepSeek: {
        configured: Boolean(this.settings.providerCredentials.deepseek?.apiKey),
        model: DEFAULT_MODEL,
        visionAvailable: false,
      },
      ai: {
        configured: Boolean(this.settings.providerCredentials[this.settings.localAi.provider]?.apiKey),
        providers: (['deepseek', 'siliconflow', 'qwen'] as ManualAiProvider[]).map((provider) => ({
          id: provider,
          name: MANUAL_AI_PROVIDER_NAMES[provider],
          configured: Boolean(this.settings.providerCredentials[provider]?.apiKey),
          supportsOnlineSearch: providerSupportsOnlineSearch(provider),
          baseUrl: this.settings.providerCredentials[provider]?.baseUrl || MANUAL_AI_DEFAULT_BASE_URLS[provider],
        })),
        local: { ...this.settings.localAi },
        online: { ...this.settings.onlineAi },
      },
    }
  }

  async setLibraryPath(directory: string, deferInitialIndex = false): Promise<ManualLibraryOverview> {
    const resolved = path.resolve(directory)
    fs.mkdirSync(resolved, { recursive: true })
    if (this.settings.libraryPath !== resolved) {
      this.manifest = emptyManifest()
      this.searchIndexes.clear()
      this.documentChunksCache.clear()
      this.clearAnswerCache()
      this.clearOnlineAnswerCache()
      for (const indexPath of Object.values(this.indexPaths)) fs.rmSync(indexPath, { force: true })
      this.saveManifest()
    }
    this.settings.libraryPath = resolved
    this.saveSettings()
    if (!deferInitialIndex || this.settings.onboardingCompleted) await this.rebuildIndex(false)
    return this.overview()
  }

  completeOnboarding(): ManualLibraryOverview {
    this.settings.onboardingCompleted = true
    this.saveSettings()
    return this.overview()
  }

  async importManualFiles(sourcePaths: string[]): Promise<ManualOperationResult> {
    const libraryPath = this.requireLibraryPath()
    const sources = [...new Set(sourcePaths.map((filePath) => path.resolve(filePath)))]
    if (sources.length === 0) throw new Error('没有选择手册文件')
    const invalid = sources.find((filePath) => {
      try { return !fs.statSync(filePath).isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase()) } catch { return true }
    })
    if (invalid) throw new Error(`不支持或无法读取该文件：${path.basename(invalid)}`)

    const destinationRoot = path.join(libraryPath, 'User Manuals')
    fs.mkdirSync(destinationRoot, { recursive: true })
    const sourceSizes = new Set(sources.map((filePath) => fs.statSync(filePath).size))
    const existingBySize = new Map<number, string[]>()
    for (const existingPath of this.walkSupportedFiles(libraryPath)) {
      const size = fs.statSync(existingPath).size
      if (!sourceSizes.has(size)) continue
      const entries = existingBySize.get(size) || []
      entries.push(existingPath)
      existingBySize.set(size, entries)
    }
    const hashes = new Map<string, string>()
    const getHash = async (filePath: string) => {
      const resolved = path.resolve(filePath)
      const cached = hashes.get(resolved)
      if (cached) return cached
      const value = await hashFile(resolved)
      hashes.set(resolved, value)
      return value
    }

    let copied = 0
    let duplicates = 0
    for (let index = 0; index < sources.length; index += 1) {
      const sourcePath = sources[index]
      this.reportProgress('manual-import', 'copying', index, sources.length, (index / sources.length) * 55, `正在添加手册 ${index + 1}/${sources.length}`, path.basename(sourcePath))
      const sourceStat = await fs.promises.stat(sourcePath)
      const sourceHash = await getHash(sourcePath)
      let duplicate = false
      for (const existingPath of existingBySize.get(sourceStat.size) || []) {
        if (path.resolve(existingPath) === sourcePath || await getHash(existingPath) === sourceHash) {
          duplicate = true
          break
        }
      }
      if (duplicate) {
        duplicates += 1
        continue
      }

      const extension = path.extname(sourcePath)
      const stem = safeFileName(path.basename(sourcePath, extension))
      let destinationPath = path.join(destinationRoot, `${stem}${extension}`)
      let suffix = 2
      while (fs.existsSync(destinationPath)) {
        destinationPath = path.join(destinationRoot, `${stem} (${suffix})${extension}`)
        suffix += 1
      }
      await fs.promises.copyFile(sourcePath, destinationPath)
      await fs.promises.utimes(destinationPath, sourceStat.atime, sourceStat.mtime)
      const entries = existingBySize.get(sourceStat.size) || []
      entries.push(destinationPath)
      existingBySize.set(sourceStat.size, entries)
      hashes.set(path.resolve(destinationPath), sourceHash)
      copied += 1
      await yieldToEventLoop()
    }
    const indexed = await this.startRebuild(false, 'manual-import', 55, 100)
    return {
      ok: indexed.ok,
      message: `已添加 ${copied} 份手册${duplicates > 0 ? `，跳过 ${duplicates} 份重复内容` : ''}`,
      overview: this.overview(),
    }
  }

  rebuildIndex(force = false): Promise<ManualOperationResult> {
    return this.startRebuild(force, 'index', 0, 100)
  }

  ensureCurrentSearchIndexes(): Promise<ManualOperationResult> | null {
    if (!this.settings.libraryPath || !this.isDirectory(this.settings.libraryPath) || this.indexing) return this.indexing
    const libraryPath = this.settings.libraryPath
    const diskFiles = this.walkSupportedFiles(libraryPath)
    const diskFilesBySource = new Map<ManualSourceKind, Array<{ relativePath: string; size: number; mtimeMs: number }>>()
    for (const sourceKind of ['user', 'dcs', 'chuck'] as ManualSourceKind[]) diskFilesBySource.set(sourceKind, [])
    for (const filePath of diskFiles) {
      const stat = fs.statSync(filePath)
      const relativePath = normalizeRelative(path.relative(libraryPath, filePath))
      diskFilesBySource.get(this.storageKindFor(relativePath))!.push({ relativePath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    const refreshSources = (['user', 'dcs', 'chuck'] as ManualSourceKind[]).filter((sourceKind) => (
      (() => {
        const currentFiles = diskFilesBySource.get(sourceKind) || []
        const manifestFiles = Object.values(this.manifest.files).filter((file) => this.storageKindFor(file.relativePath) === sourceKind)
        const manifestByPath = new Map(manifestFiles.map((file) => [file.relativePath, file]))
        const contentChanged = currentFiles.length !== manifestFiles.length || currentFiles.some((file) => {
          const previous = manifestByPath.get(file.relativePath)
          return !previous || previous.size !== file.size || Math.abs(previous.mtimeMs - file.mtimeMs) >= 1
        })
        const hasStoredState = currentFiles.length > 0 || manifestFiles.length > 0 || fs.existsSync(this.indexPaths[sourceKind])
        return hasStoredState && (contentChanged || !fs.existsSync(this.indexPaths[sourceKind]) || this.manifest.sourceMetadataVersions?.[sourceKind] !== SOURCE_METADATA_VERSION)
      })()
    ))
    if (refreshSources.length === 0) return null
    this.indexing = (async () => {
      let result: ManualOperationResult = { ok: true, message: '检索索引已经是最新状态', overview: this.overview() }
      for (let index = 0; index < refreshSources.length; index += 1) {
        result = await this.performRebuild(false, 'index', (index / refreshSources.length) * 100, ((index + 1) / refreshSources.length) * 100, refreshSources[index])
        if (!result.ok) break
      }
      return result
    })().finally(() => { this.indexing = null })
    return this.indexing
  }

  private startRebuild(force: boolean, operation: ManualLibraryProgressOperation, startPercent: number, endPercent: number): Promise<ManualOperationResult> {
    if (this.indexing) return this.indexing
    this.indexError = undefined
    const sourceKind: ManualSourceKind = operation === 'dcs-import' ? 'dcs' : operation === 'chuck-download' ? 'chuck' : 'user'
    this.indexing = this.performRebuild(force, operation, startPercent, endPercent, sourceKind).finally(() => { this.indexing = null })
    return this.indexing
  }

  async importDcsManuals(): Promise<DcsManualImportResult> {
    const libraryPath = this.requireLibraryPath()
    const dcsRoot = this.dcsRootProvider()
    if (!dcsRoot || !this.isDirectory(dcsRoot)) throw new Error('没有识别到 DCS World 安装目录，请先在设置中配置 DCS 路径')
    this.reportProgress('dcs-import', 'scanning', 0, 1, 1, '正在查找 DCS 英文手册…')
    const sourceFiles = this.findDcsManualFiles(dcsRoot).filter(isEnglishDcsManual)
    const destinationRoot = path.join(libraryPath, 'DCS Manuals')
    const sourceSizes = new Set(sourceFiles.map((sourcePath) => fs.statSync(sourcePath).size))
    const externalFilesBySize = new Map<number, string[]>()
    for (const existingPath of this.walkSupportedFiles(libraryPath)) {
      if (isPathInside(destinationRoot, existingPath) || path.resolve(existingPath) === path.resolve(destinationRoot)) continue
      const size = fs.statSync(existingPath).size
      if (!sourceSizes.has(size)) continue
      const matches = externalFilesBySize.get(size) || []
      matches.push(existingPath)
      externalFilesBySize.set(size, matches)
    }
    const contentHashes = new Map<string, string>()
    const contentHash = async (filePath: string) => {
      const resolved = path.resolve(filePath)
      const cached = contentHashes.get(resolved)
      if (cached) return cached
      const calculated = await hashFile(resolved)
      contentHashes.set(resolved, calculated)
      return calculated
    }
    this.pendingDcsDuplicateCopies.clear()
    let copied = 0
    let unchanged = 0
    let duplicateSkipped = 0
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourcePath = sourceFiles[index]
      this.reportProgress('dcs-import', 'copying', index, sourceFiles.length, 5 + (index / Math.max(1, sourceFiles.length)) * 45, `正在复制英文手册 ${index + 1}/${sourceFiles.length}`, path.basename(sourcePath))
      const relativePath = path.relative(dcsRoot, sourcePath)
      const destinationPath = path.join(destinationRoot, relativePath)
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
      const sourceStat = await fs.promises.stat(sourcePath)
      const sourceHash = await contentHash(sourcePath)
      let externalDuplicate: string | null = null
      for (const existingPath of externalFilesBySize.get(sourceStat.size) || []) {
        if (await contentHash(existingPath) === sourceHash) {
          externalDuplicate = existingPath
          break
        }
      }
      if (externalDuplicate) {
        duplicateSkipped += 1
        try {
          const destinationStat = await fs.promises.stat(destinationPath)
          if (destinationStat.size === sourceStat.size && await contentHash(destinationPath) === sourceHash) this.pendingDcsDuplicateCopies.add(destinationPath)
        } catch { /* There is no managed duplicate copy to remove. */ }
        await yieldToEventLoop()
        continue
      }
      let shouldCopy = true
      try {
        const destinationStat = await fs.promises.stat(destinationPath)
        shouldCopy = destinationStat.size !== sourceStat.size || await contentHash(destinationPath) !== sourceHash
      } catch { /* Missing destination is copied. */ }
      if (shouldCopy) {
        await fs.promises.copyFile(sourcePath, destinationPath)
        await fs.promises.utimes(destinationPath, sourceStat.atime, sourceStat.mtime)
        copied += 1
      } else unchanged += 1
      await yieldToEventLoop()
    }
    const indexed = await this.startRebuild(false, 'dcs-import', 50, 100)
    return {
      ok: indexed.ok,
      message: `已复制 ${copied} 份 DCS 手册，${unchanged} 份无需更新，${duplicateSkipped} 份因内容重复而跳过`,
      copied,
      unchanged,
      duplicateSkipped,
      removableDuplicates: this.pendingDcsDuplicateCopies.size,
      overview: this.overview(),
    }
  }

  async removeDuplicateDcsManuals(): Promise<ManualOperationResult> {
    const destinationRoot = path.join(this.requireLibraryPath(), 'DCS Manuals')
    let removed = 0
    for (const duplicatePath of this.pendingDcsDuplicateCopies) {
      if (!isPathInside(destinationRoot, duplicatePath)) continue
      try {
        await fs.promises.rm(duplicatePath, { force: true })
        removed += 1
      } catch { /* Keep processing other safe managed copies. */ }
    }
    this.pendingDcsDuplicateCopies.clear()
    const indexed = await this.startRebuild(false, 'dcs-import', 0, 100)
    return { ok: indexed.ok, message: `已移除 ${removed} 份 DCSHUB 管理的重复官方手册`, overview: this.overview() }
  }

  search(query: string, limit = 12, aircraftScope: string[] = []): ManualSearchHit[] {
    const cleaned = query.trim().slice(0, 500)
    if (!cleaned) return []
    const resultLimit = Math.max(1, Math.min(limit, 50))
    const candidates = (['user', 'dcs', 'chuck'] as ManualSourceKind[])
      .flatMap((sourceKind) => {
        const index = this.loadSearchIndex(sourceKind)
        if (!index) return []
        const searchResult = oramaSearch(index, {
          term: cleaned,
          properties: aircraftScope.length > 0
            ? ['text', 'sectionTitle', 'sectionPath']
            : ['text', 'sectionTitle', 'sectionPath', 'documentName', 'aircraft'],
          boost: aircraftScope.length > 0
            ? { sectionTitle: 4.5, sectionPath: 2.8 }
            : { sectionTitle: 4.5, sectionPath: 2.8, documentName: 2.2, aircraft: 2.8 },
          ...(aircraftScope.length > 0 ? { where: { aircraftKey: { in: aircraftScope } } } : {}),
          tolerance: cleaned.length >= 8 ? 1 : 0,
          threshold: 1,
          limit: resultLimit,
        })
        if (searchResult instanceof Promise) throw new Error('Orama 检索器意外进入异步模式')
        // Keep a second deterministic guard even though Orama already filters the
        // enum. An explicit aircraft question must never leak another module.
        return searchResult.hits.filter(({ document }) => (
          aircraftScope.length === 0 || aircraftScope.includes(String(document.aircraft))
        ))
      })
      .map(({ document, score }) => ({
      id: String(document.id),
      documentId: String(document.documentId),
      documentName: String(document.documentName),
      relativePath: String(document.relativePath),
      sourcePath: String(document.sourcePath),
      sourceKind: document.sourceKind as ManualSourceKind,
      sourceVersion: document.sourceVersion ? String(document.sourceVersion) : null,
      officialModuleType: ['full-fidelity', 'non-full-click', 'unknown'].includes(String(document.officialModuleType))
        ? document.officialModuleType as ManualOfficialModuleType
        : null,
      isTranslation: String(document.isTranslation) === 'true',
      translatedFrom: ['dcs', 'chuck'].includes(String(document.translatedFrom))
        ? document.translatedFrom as 'dcs' | 'chuck'
        : null,
      classificationConfidence: ['high', 'medium', 'low'].includes(String(document.classificationConfidence))
        ? document.classificationConfidence as 'high' | 'medium' | 'low'
        : 'low',
      language: String(document.language),
      aircraft: document.aircraft ? String(document.aircraft) : null,
      page: Number(document.page) > 0 ? Number(document.page) : null,
      sectionTitle: document.sectionTitle ? String(document.sectionTitle) : undefined,
      sectionPath: document.sectionPath ? String(document.sectionPath) : undefined,
      sectionStartPage: Number(document.sectionStartPage) > 0 ? Number(document.sectionStartPage) : undefined,
      sectionEndPage: Number(document.sectionEndPage) > 0 ? Number(document.sectionEndPage) : undefined,
      excerpt: String(document.text).slice(0, CHUNK_LENGTH),
      score: Number(score),
    }))
    const weighted = candidates
      .map((candidate) => ({ ...candidate, score: candidate.score * this.sourceSearchMultiplier(candidate) }))
      .sort((left, right) => right.score - left.score)
    const seedLimit = Math.min(6, Math.max(2, Math.floor(resultLimit / 6)))
    const authoritySeeds = [400, 300, 250, 200, 100]
      .flatMap((authority) => weighted.filter((candidate) => this.sourceAuthority(candidate) === authority).slice(0, seedLimit))
    return [...new Map([...authoritySeeds, ...weighted].map((candidate) => [candidate.id, candidate])).values()].slice(0, resultLimit)
  }

  async ask(question: string, answerLanguage: ManualAnswerLanguage = 'zh'): Promise<ManualQuestionAnswer> {
    const askStart = Date.now()
    const timings: Record<string, number> = {}
    const cleaned = normalizeQuestionInput(question).slice(0, 2_000)
    if (!cleaned) throw new Error('请输入问题')
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') console.log(`[manual-library] Q: ${cleaned}`)
    const taskProfile = detectTaskSemanticProfile(cleaned)
    const connection = this.readAiConnection('local')
    const answerCacheKey = this.answerCacheKey(cleaned, answerLanguage)
    if (localQuestionRequiresOnlineSearch(cleaned)) {
      const result: ManualQuestionAnswer = {
        answer: '这个问题过于抽象或缺少可核实的本地手册主题，请使用联网搜索。',
        sources: [],
        model: connection.model,
        cached: false,
      }
      this.cacheVerifiedAnswer(answerCacheKey, result)
      return result
    }
    const cachedAnswer = this.answerCache.get(answerCacheKey)
    if (cachedAnswer) {
      if (process.env.DCSHUB_DEBUG_MANUAL === '1') console.log('[manual-library] Cache hit in', Date.now() - askStart, 'ms')
      return { ...structuredClone(cachedAnswer.answer), cached: true }
    }
    const retrievalStart = Date.now()
    const retrieval = await this.retrieveSources(connection, cleaned)
    timings.retrieval = Date.now() - retrievalStart
    const sources = retrieval.sources
    const aircraftScope = retrieval.aircraftScope
    if (sources.length === 0) {
      if (retrieval.requiresAircraftClarification) {
        const result: ManualQuestionAnswer = {
          answer: '这个操作会随机型而变化，请在问题中补充机型名称或玩家常用别称，例如“F/A-18C 的 TACAN 怎么设置”。确认机型后，我会只检索对应手册，不会把不同飞机的按键和流程拼在一起。',
          sources: [],
          model: connection.model,
          cached: false,
        }
        this.cacheVerifiedAnswer(answerCacheKey, result)
        return result
      }
      if (retrieval.unavailableAircraft.length > 0) {
        const result: ManualQuestionAnswer = {
          answer: `我识别到您询问的是 ${retrieval.unavailableAircraft.join('、')}，但当前手册库中没有匹配的该机型资料。为避免给出错误操作，我没有使用其他机型的手册代替回答。请先添加对应手册后再提问。`,
          sources: [],
          model: connection.model,
          cached: false,
        }
        this.cacheVerifiedAnswer(answerCacheKey, result)
        return result
      }
      const result: ManualQuestionAnswer = { answer: '没有在当前手册库中找到足够相关的内容。请确认手册已完成索引，或换一种说法重新提问。', sources: [], model: connection.model, cached: false }
      this.cacheVerifiedAnswer(answerCacheKey, result)
      return result
    }
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') {
      console.log(`[manual-library] Retrieval: ${timings.retrieval}ms, ${retrieval.sources.length} primary + ${retrieval.fallbackSources.flat().length} fallback sources`)
    }
    console.info('[manual-library] retrieval sources', {
      aircraftScope,
      question: cleaned.slice(0, 160),
      sources: sources.slice(0, ANSWER_SOURCES).map((source) => ({
        document: source.documentName,
        page: source.page,
        sourceKind: source.sourceKind,
        authority: this.sourceAuthority(source),
        score: Number(source.score.toFixed(5)),
      })),
    })

    // Generate from one authority tier at a time. Lower-priority manuals are
    // fallbacks, never extra context that can silently contaminate the best tier.
    const allSources = retrieval.sources
    const dedupSources = allSources.filter((source, index) => {
      const key = source.page ? `${source.documentId}:${source.page}` : source.id
      return allSources.findIndex((s) => (s.page ? `${s.documentId}:${s.page}` : s.id) === key) === index
    }).slice(0, ANSWER_SOURCES)
    // The HUB language selector controls generated answers. Do not infer the
    // output language from the wording of the user's question.
    const qLang = answerLanguage
    const langInstr = languageInstruction(qLang)
    const semanticContext = deterministicQuestionSemantics(cleaned)
    const subIntentInstruction = retrieval.subIntents.length >= 2
      ? `用户的说法存在多个合法操作含义：${retrieval.subIntents.map((item) => item.label).join('；')}。先用一句话说明这些场景的区别，再按这些名称建立独立章节。每个章节只能使用与该场景匹配的来源和操作步骤；不得静默只选一个场景，也不得把不同场景的按键拼成一套流程。`
      : ''
    const weaponVariantInstruction = weaponVariantAnswerInstruction(cleaned)
    const aircraftVariantInstruction = aircraftScope.includes('F-14B(U)')
      ? '当前 F-14A、F-14B 与 F-14B(U) 使用同一套 Tomcat 共用手册作为共有系统和通用流程的主要依据。若资料库以后出现真正的 F-14B(U) 专属操作手册，则其中明确说明的升级型差异优先于共用手册；战役任务简报不能冒充操作手册。涉及 VDIG-R、PTID 或升级型差异时，必须由 F-14B(U) 专属资料或共用手册中明确写有该变体的段落支持。'
      : ''
    const procedureProfile = detectLongProcedureProfile(cleaned)
    const procedureCompletenessInstruction = procedureProfile
      ? `本题是一条 ${procedureProfile.id} 长流程。必须先覆盖当前资料明确提供的全部生命周期阶段（${procedureProfile.phases.map((phase) => phase.id).join(' → ')}），再组织答案。若某阶段在资料中不存在可以省略，但不得因为它位于后续页面而漏掉。AI、Jester、自动启动、快速启动或简化模式只能作为“可选替代方式”单独说明，不能替代人工主流程。`
      : ''
    const scopeInstruction = aircraftScope.length > 0
      ? `用户问题中明确识别到机型 ${aircraftScope.join('、')}。只能使用这些机型的手册，不得混入其他机型。`
      : '用户没有明确指出机型。只能依据检索到的同一套手册回答；如果不同机型做法不一致，必须按机型或场景分开，不能拼接流程。'
    const answerSystemPrompt = `你是 DCS World 技术资料研究助手。${scopeInstruction}

回答语言：${langInstr}

${MANUAL_ANSWER_STYLE_GUIDE}

${MANUAL_ANSWER_STRUCTURE_GUIDE}

${LOCAL_RESEARCH_PRESENTATION_GUIDE}

先理解用户真正想完成的任务。对不专业、简称或口语化的表达进行 DCS 语义归一；若问题存在多个合理含义，必须像联网研究答案一样先说明区别，再按不同场景分别完整回答，不能擅自只选其中一种。

内容与证据规则：
- 下面提供的本地手册页就是本次研究可使用的全部资料。只允许依据这些资料回答，不得使用模型记忆或外部资料补充按键、开关、模式、参数、顺序和系统反应。
- 先综合同一任务在多个手册页中的上下文，再生成一份自然、连贯的技术答案；不要逐页复读，也不要把检索片段按来源机械拼接。
- 回答的完整度、场景拆分、功能概述、前提条件、说明方式和 Markdown 排版应与高质量联网研究答案一致；可以用易懂中文解释专业原文，但不能改变原意或增加无证据事实。
- ${SOURCE_PRECEDENCE_GUIDE}
- ${MANUAL_STRUCTURE_SCENARIO_GUIDE}
- ${DCS_TERMINOLOGY_ROLE_GUIDE}
- ${aircraftVariantInstruction || '不得把近似型号或其他变体的专属操作混入当前答案。'}
- ${weaponVariantInstruction || '武器存在不同导引头、战斗部、发动机或制导模式时，只能在手册明确支持的型号边界内组织步骤。'}
- 来源中的“章节”路径来自 PDF 自带目录/书签，是当前手册的结构边界。同一父章节下的不同型号、制导方式、发射模式、乘员席位或传感器流程必须分别说明，不得把相邻章节的开关、条件和步骤拼成一套不存在的流程。
- 用户没有指定型号或模式时，应按手册实际存在的同级章节分情况回答；用户已经指定时，只回答该章节及其子章节。训练弹/惰性弹、任务编辑器设置、多人协同和实战操作不得与实弹单人流程混写。
- ${subIntentInstruction || '用户问题只有一个明确任务时，完整回答该任务；资料确实支持替代流程时可以单独补充。'}
- ${procedureCompletenessInstruction || '涉及跨页流程时，必须覆盖同一章节中从准备、执行到收尾和限制的完整过程，不能只回答命中率最高的局部页面。'}
- 每个事实、步骤、判断和注意事项都必须在同一段或同一条末尾标注真实来源编号，如 [S1] 或 [S2][S4]；不得用一个总引用掩盖多条无依据内容。
- 不要自行输出 Markdown。把答案拆成结构化证据条目，由本地程序统一渲染标题、功能概述、前提条件、分场景操作说明和注意事项，防止回答退化成没有层次的流水账。
- 合并重复事实；每个连续动作只出现一次。不要输出人格化开场、资料列表或外部链接。
- title 写简短具体的技术标题；overview 用 1—2 句说明功能、用途和用户需要区分的场景。
- sections 中，同一条连续流程必须复用完全相同的 heading；真正独立的模式、型号、CASE 回收类型或操作场景才建立新 heading。不要把单个按钮、页面、来源或步骤当成 heading。
- prerequisite 只放第一步之前必须满足的条件；step 按执行顺序；warning/note 只放限制、易错点、复飞/中止或取消方式。可观察反馈写进对应 step，不要建立“成功判断”章节。
- 每个 overview 和 entry 都必须填写真实支持它的来源编号。text 和 explanation 只写单行纯文本，不得包含 Markdown、编号、标题或换行。
- 只输出 JSON，不要输出 JSON 之外的文字：{"title":"简短技术标题","overview":{"text":"功能和适用场景概述","citations":[1,2]},"sections":[{"heading":"完整操作流程或真实独立场景","entries":[{"kind":"prerequisite|step|warning|note","text":"完整自然的说明","explanation":"必要的新手解释","citations":[1,2]}]}]}。`
    const relevantWeaponVariants = resolveWeaponVariantQuestion(cleaned).flatMap((resolution) => resolution.family.variants || [])
    const context = dedupSources.map((source, index) => {
      const variantLabels = relevantWeaponVariants
        .filter((variant) => weaponVariantEvidenceScore(variant, source.excerpt) > 0)
        .map((variant) => variant.label)
      return `[S${index + 1}] [${this.sourceAuthorityLabel(source)}]${variantLabels.length > 0 ? ` [型号证据：${variantLabels.join('、')}]` : ''} ${source.documentName}${source.page ? ` · 第 ${source.page} 页` : ''}${source.sectionPath ? ` · 章节：${source.sectionPath}` : ''}\n${source.excerpt}`
    }).join('\n\n')

    const answerModel = connection.model
    const genStart = Date.now()
    const evidenceBoundary = [semanticContext, taskProfile?.evidenceBoundary || DCS_TERMINOLOGY_ROLE_GUIDE, weaponVariantInstruction, subIntentInstruction].filter(Boolean).join('\n')
    const generated = await this.callAi(connection, [
      { role: 'system', content: answerSystemPrompt },
      { role: 'user', content: `问题：${cleaned}\n${evidenceBoundary ? `\n任务说明：${evidenceBoundary}\n` : ''}\n以下是从本地手册库检索到的资料（按权威性排序）：\n\n${context}\n\n请把这些本地手册页当作联网研究已经收集并核实过的资料，完成综合判断后按指定 JSON 结构返回。答案的任务理解、场景拆分、完整度和语言应与高质量联网搜索结果一致；本地程序会负责最终排版。` },
    ], 4_200, true, false)
    timings.gen = Date.now() - genStart
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') console.log(`[manual-library] Initial gen (${connection.provider}/${connection.model}): ${timings.gen}ms`)

    try {
      const answer = verifiedEvidenceLedger(JSON.parse(generated) as EvidenceLedgerResponse, dedupSources.length)
      if (!answer) throw new Error('结构化答案缺少有效步骤、场景或逐条引用')
      const result = { answer, sources: dedupSources, model: answerModel, cached: false }
      this.cacheVerifiedAnswer(answerCacheKey, result)
      if (process.env.DCSHUB_DEBUG_MANUAL === '1') console.log(`[manual-library] One-pass total: ${Date.now() - askStart}ms`, timings)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[manual-library] grounded Markdown validation failed', {
        question: cleaned,
        sourceIds: dedupSources.map((source) => source.id),
        reason: message,
      })
      return { answer: '已找到相关手册内容，但本次答案未通过本地引用校验。请重试一次；系统不会把未验证的操作步骤直接显示给您。', sources: dedupSources, model: answerModel, cached: false }
    }
  }

  preferredCachedAnswer(question: string, answerLanguage: ManualAnswerLanguage = 'zh'): ManualCachedAnswerMatch | null {
    const cleaned = normalizeQuestionInput(question).slice(0, 2_000)
    if (!cleaned) return null
    const online = this.onlineAnswerCache.get(this.onlineAnswerCacheKey(cleaned, answerLanguage))
    if (online) return { kind: 'online', answer: { ...structuredClone(online.answer), cached: true } }
    const local = this.answerCache.get(this.answerCacheKey(cleaned, answerLanguage))
    if (local) return { kind: 'local', answer: { ...structuredClone(local.answer), cached: true } }
    return null
  }

  clearAnswerCaches(): ManualLibraryOverview {
    this.clearAnswerCache()
    this.clearOnlineAnswerCache()
    return this.overview()
  }

  private loadDocumentChunks(documentId: string): SearchableChunk[] {
    const cached = this.documentChunksCache.get(documentId)
    if (cached) return cached
    const cachePath = path.join(this.documentCachePath, `${documentId}.json.gz`)
    if (!fs.existsSync(cachePath)) return []
    try {
      const chunks = this.storage.readCompressedJson<SearchableChunk[]>(cachePath)
      if (this.documentChunksCache.size >= 6) this.documentChunksCache.delete(this.documentChunksCache.keys().next().value as string)
      this.documentChunksCache.set(documentId, chunks)
      return chunks
    } catch {
      return []
    }
  }

  private manualOutlineSections(aircraftScope: string[]): ManualOutlineSection[] {
    const sections = new Map<string, ManualOutlineSection>()
    for (const document of this.manifest.documents) {
      if (aircraftScope.length > 0 && (!document.aircraft || !aircraftScope.includes(document.aircraft))) continue
      for (const chunk of this.loadDocumentChunks(document.id)) {
        if (!chunk.sectionTitle || !chunk.sectionPath || chunk.sectionStartPage <= 0 || chunk.sectionEndPage < chunk.sectionStartPage) continue
        const pathParts = chunk.sectionPath.split(' > ').map((part) => part.trim()).filter(Boolean)
        for (let level = 0; level < pathParts.length; level += 1) {
          const sectionPath = pathParts.slice(0, level + 1).join(' > ')
          const key = `${document.id}:${sectionPath}`
          const leaf = level === pathParts.length - 1
          const startPage = leaf ? chunk.sectionStartPage : (chunk.page || chunk.sectionStartPage)
          const endPage = leaf ? chunk.sectionEndPage : (chunk.page || chunk.sectionEndPage)
          const previous = sections.get(key)
          if (previous) {
            previous.startPage = Math.min(previous.startPage, startPage)
            previous.endPage = Math.max(previous.endPage, endPage)
            continue
          }
          sections.set(key, {
            documentId: document.id,
            documentName: document.name,
            title: pathParts[level],
            path: sectionPath,
            level,
            startPage,
            endPage,
            authority: manualAuthority(document),
          })
        }
      }
    }
    return [...sections.values()]
  }

  private manualOutlineRoutes(question: string, aircraftScope: string[]): { subIntents: QuerySubIntent[]; seedSections: ManualOutlineSection[]; weaponStructure: boolean; specificUnresolved: boolean } {
    const allSections = this.manualOutlineSections(aircraftScope)
    if (allSections.length === 0) return { subIntents: [], seedSections: [], weaponStructure: false, specificUnresolved: false }
    const family = DCS_WEAPON_ONTOLOGY.find((candidate) => candidate.patterns.some((pattern) => pattern.test(question)))
    const familyKey = family ? designationKeys(family.canonical)[0] : undefined
    if (family && familyKey) {
      const familyDesignationKeys = designationKeys([
        family.canonical,
        ...(family.variants || []).map((variant) => variant.canonical),
      ].join(' '))
      const aliasVariants = resolveWeaponVariantQuestion(question).flatMap((resolution) => resolution.explicitVariants)
      const questionDesignations = designationKeys(question)
      const explicitKey = questionDesignations.find((key) => (
        key !== familyKey
        && (familyDesignationKeys.includes(key) || aliasVariants.length === 1)
      ))
      const explicitVariant = aliasVariants.length === 1 ? aliasVariants[0] : undefined
      const explicitRouteKey = explicitKey || (explicitVariant
        ? designationKeys(explicitVariant.canonical).find((key) => key !== familyKey)
        : undefined)
      const matching = allSections.filter((section) => {
        const identity = `${section.title}\n${section.path}`
        const compactIdentity = compactDesignation(identity)
        return family.patterns.some((pattern) => {
          pattern.lastIndex = 0
          return pattern.test(identity)
        }) || familyDesignationKeys.some((key) => compactIdentity.includes(key))
      })
      const outlineBranchesBelow = (root: ManualOutlineSection): ManualOutlineSection[] => {
        let parents = [root]
        for (let depth = 0; depth < 3; depth += 1) {
          const children = allSections.filter((section) => parents.some((parent) => (
            section.documentId === parent.documentId
            && section.level === parent.level + 1
            && section.path.startsWith(`${parent.path} > `)
          )))
          const unique = [...new Map(children.map((section) => [`${section.documentId}:${section.path}`, section])).values()]
          const alternatives = unique.filter((section) => alternativeOutlineTitle(section.title))
          if (alternatives.length >= 2) return alternatives.slice(0, 6)
          if (unique.length !== 1) return [root]
          parents = unique
        }
        return [root]
      }
      if (explicitRouteKey) {
        let exactSections = matching
          .filter((section) => designationIdentityIncludes(section.path, explicitRouteKey))
          .sort((left, right) => right.authority - left.authority || right.level - left.level || left.startPage - right.startPage)
        // Some manuals name a structural branch by seeker family (for example
        // "IRMAV") and list the concrete D/G variants only in the branch body.
        // Keep the outline as the boundary, then use its own pages merely to
        // select the correct existing branch. Never fall back to an unrelated
        // global exact-key hit from elsewhere in the manual.
        if (exactSections.length === 0) {
          const explicitVariants = aliasVariants.length > 0
            ? aliasVariants
            : family.variants?.filter((variant) => designationKeys(variant.canonical).includes(explicitRouteKey)) || []
          const evidenced = matching
            .map((section) => {
              const sectionPages = this.loadDocumentChunks(section.documentId).filter((chunk) => (
                Boolean(chunk.page)
                && chunk.page! >= section.startPage
                && chunk.page! <= section.endPage
              ))
              const exactMentions = sectionPages.reduce((total, chunk) => (
                total + (designationIdentityIncludes(chunk.text, explicitRouteKey) ? 1 : 0)
              ), 0)
              const semanticEvidence = explicitVariants.reduce((best, variant) => Math.max(
                best,
                weaponVariantEvidenceScore(variant, `${section.title}\n${section.path}`),
                ...sectionPages.map((chunk) => weaponVariantEvidenceScore(variant, chunk.text)),
              ), 0)
              return { section, score: exactMentions * 20 + semanticEvidence * 5 }
            })
            .filter((entry) => entry.score >= 5)
          const bestAuthority = Math.max(0, ...evidenced.map((entry) => entry.section.authority))
          const bestLevel = Math.max(0, ...evidenced.filter((entry) => entry.section.authority === bestAuthority).map((entry) => entry.section.level))
          exactSections = evidenced
            .filter((entry) => entry.section.authority === bestAuthority && entry.section.level === bestLevel)
            .sort((left, right) => right.score - left.score || left.section.startPage - right.section.startPage)
            .map((entry) => entry.section)
        }
        if (exactSections.length === 0) return { subIntents: [], seedSections: [], weaponStructure: matching.length > 0, specificUnresolved: matching.length > 0 }
        const bestAuthority = Math.max(...exactSections.map((section) => section.authority))
        const authoritative = exactSections.filter((section) => section.authority === bestAuthority)
        const directTitleMatches = authoritative.filter((section) => designationIdentityIncludes(section.title, explicitRouteKey))
        const rootPool = directTitleMatches.length > 0 ? directTitleMatches : authoritative
        const bestRootLevel = Math.min(...rootPool.map((section) => section.level))
        const roots = [...new Map(rootPool
          .filter((section) => section.level === bestRootLevel)
          .map((section) => [`${section.documentId}:${section.path}`, section])).values()]
          .sort((left, right) => left.startPage - right.startPage)
        exactSections = roots.flatMap((root) => outlineBranchesBelow(root)).slice(0, 6)
        return {
          subIntents: exactSections.map((section) => ({
            label: cleanOutlineLabel(section.title),
            intent: section.path,
            coreTaskTerms: [section.title],
            queries: [section.title, section.path],
            sectionDocumentId: section.documentId,
            sectionStartPage: section.startPage,
            sectionEndPage: section.endPage,
          })),
          seedSections: exactSections,
          weaponStructure: true,
          specificUnresolved: false,
        }
      }

      // When a family name is ambiguous (for example AGM-84), the manual's
      // own variant chapters are the authoritative split. Do not choose an
      // arbitrary deeper sibling group merely because it has more bookmarks.
      const variantRoots = (family.variants || []).flatMap((variant) => {
        const keys = designationKeys(variant.canonical).filter((key) => key !== familyKey)
        if (keys.length === 0) return []
        const candidates = matching.filter((section) => {
          const titleKey = compactDesignation(section.title)
          return keys.some((key) => titleKey.includes(key))
        })
        if (candidates.length === 0) return []
        const bestAuthority = Math.max(...candidates.map((section) => section.authority))
        const authoritative = candidates.filter((section) => section.authority === bestAuthority)
        const shallowestLevel = Math.min(...authoritative.map((section) => section.level))
        return authoritative
          .filter((section) => section.level === shallowestLevel)
          .sort((left, right) => left.startPage - right.startPage)
          .slice(0, 1)
      })
      const uniqueVariantRoots = [...new Map(variantRoots.map((section) => [`${section.documentId}:${section.path}`, section])).values()]
      if (uniqueVariantRoots.length >= 2) {
        return {
          subIntents: uniqueVariantRoots.slice(0, 6).map((section) => ({
            label: cleanOutlineLabel(section.title),
            intent: section.path,
            coreTaskTerms: [section.title],
            queries: [section.title, section.path],
            sectionDocumentId: section.documentId,
            sectionStartPage: section.startPage,
            sectionEndPage: section.endPage,
          })),
          seedSections: uniqueVariantRoots.slice(0, 6),
          weaponStructure: true,
          specificUnresolved: false,
        }
      }

      const byDocument = new Map<string, ManualOutlineSection[]>()
      for (const section of matching) {
        const group = byDocument.get(section.documentId) || []
        group.push(section)
        byDocument.set(section.documentId, group)
      }
      const documentBranches = [...byDocument.values()].flatMap((sections) => {
        const siblingGroups = new Map<string, ManualOutlineSection[]>()
        for (const section of sections) {
          const parentPath = section.path.split(' > ').slice(0, -1).join(' > ')
          const group = siblingGroups.get(parentPath) || []
          group.push(section)
          siblingGroups.set(parentPath, group)
        }
        return [...siblingGroups.values()].map((siblings) => {
          const unique = [...new Map(siblings.map((section) => [cleanOutlineLabel(section.title).toLocaleLowerCase(), section])).values()]
          const structural = unique.filter((section) => alternativeOutlineTitle(section.title))
          return { sections, branches: structural.length >= 2 ? structural : unique }
        })
      }).filter((group) => group.branches.length >= 2)
        .sort((left, right) => (
          (right.sections[0]?.authority || 0) - (left.sections[0]?.authority || 0)
          || right.branches.length - left.branches.length
        ))
      let selected = documentBranches[0]?.branches.slice(0, 6) || []
      const qualifierTerms = structuralQualifierTerms(question)
      const aliasDesignationKeys = aliasVariants.flatMap((variant) => designationKeys(variant.canonical)).filter((key) => key !== familyKey)
      if ((qualifierTerms.length > 0 || aliasDesignationKeys.length > 0) && selected.length > 0) {
        const qualifierKeywords = retrievalKeywords(qualifierTerms)
        const qualified = selected
          .map((section) => {
            const sectionText = `${section.title}\n${section.path}`
            const sectionKey = compactDesignation(sectionText)
            return {
              section,
              score: keywordEvidenceScore(sectionText, qualifierKeywords)
                + (aliasDesignationKeys.some((key) => sectionKey.includes(key)) ? 10 : 0),
            }
          })
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score || right.section.authority - left.section.authority)
        if (qualified.length > 0) selected = [qualified[0].section]
        else if (aliasVariants.length > 0) selected = []
      }
      if (selected.length === 1) {
        const section = selected[0]
        return {
          subIntents: [{
            label: cleanOutlineLabel(section.title),
            intent: section.path,
            coreTaskTerms: [section.title],
            queries: [section.title, section.path],
            sectionDocumentId: section.documentId,
            sectionStartPage: section.startPage,
            sectionEndPage: section.endPage,
          }],
          seedSections: [section],
          weaponStructure: true,
          specificUnresolved: false,
        }
      }
      if (selected.length >= 2) {
        return {
          subIntents: selected.map((section) => ({
            label: cleanOutlineLabel(section.title),
            intent: section.path,
            coreTaskTerms: [section.title],
            queries: [section.title, section.path],
            sectionDocumentId: section.documentId,
            sectionStartPage: section.startPage,
            sectionEndPage: section.endPage,
          })),
          seedSections: selected,
          weaponStructure: true,
          specificUnresolved: false,
        }
      }
      if (matching.length > 0) {
        const familyRoot = matching.sort((left, right) => right.authority - left.authority || left.level - right.level)[0]
        return {
          subIntents: [],
          seedSections: familyRoot ? [familyRoot] : [],
          weaponStructure: true,
          specificUnresolved: qualifierTerms.length > 0 || aliasDesignationKeys.length > 0,
        }
      }
    }

    const carrierCase = requestedCarrierCase(question)
    if (carrierCase) {
      const exactPattern = carrierCaseTitlePattern(carrierCase)
      const procedureTitlePattern = /\b(?:carrier\s+landing|recovery|approach|landing|tutorial|ICLS|ACLS)\b/i
      const exactSections = allSections.filter((section) => (
        exactPattern.test(section.title)
        && procedureTitlePattern.test(section.title)
        && !/(?:weapons?|armament|offen[cs]e|combat employment)/i.test(section.path)
      ))

      if (exactSections.length > 0) {
        const bestAuthority = Math.max(...exactSections.map((section) => section.authority))
        const authoritative = exactSections.filter((section) => section.authority === bestAuthority)
        // CASE III manuals commonly use a broad parent chapter followed by
        // separate ICLS and ACLS tutorials. Route the concrete child chapters,
        // not the generic parent range, otherwise unrelated navigation pages
        // consume the evidence budget.
        const concrete = authoritative.filter((section) => !authoritative.some((candidate) => (
          candidate.documentId === section.documentId
          && candidate.path !== section.path
          && candidate.path.startsWith(`${section.path} > `)
        )))
        const selected = (concrete.length > 0 ? concrete : authoritative)
          .sort((left, right) => left.startPage - right.startPage)
          .slice(0, 4)
        return {
          subIntents: selected.map((section) => ({
            label: cleanOutlineLabel(section.title),
            intent: section.path,
            coreTaskTerms: [section.title, `CASE ${carrierCase.roman} carrier recovery`],
            queries: [section.title, section.path, `CASE ${carrierCase.roman} carrier recovery`],
            sectionDocumentId: section.documentId,
            sectionStartPage: section.startPage,
            sectionEndPage: section.endPage,
          })),
          seedSections: selected,
          weaponStructure: false,
          specificUnresolved: false,
        }
      }

      if (carrierCase.number === '2') {
        // Most DCS carrier manuals do not provide CASE II as an independent
        // checklist. They define its weather/transition conditions beside the
        // CASE I/III overview, then continue with the visual CASE I pattern.
        // Build that route from the manual's own pages instead of silently
        // borrowing a CASE III chapter.
        const documents = new Map(allSections.map((section) => [section.documentId, section]))
        const definitionCandidates = [...documents.values()].flatMap((document) => (
          this.loadDocumentChunks(document.documentId)
            .filter((chunk) => Boolean(chunk.page) && /\bCASE\s*II\b/i.test(chunk.text))
            .map((chunk) => ({
              document,
              chunk,
              score: document.authority * 100
                + (/\bCASE\s*I\b/i.test(chunk.text) ? 12 : 0)
                + (/\bCASE\s*III\b/i.test(chunk.text) ? 8 : 0)
                + keywordEvidenceScore(chunk.text, ['carrier', 'recovery', 'weather', 'visual', 'instrument', 'approach']),
            }))
        )).sort((left, right) => right.score - left.score || (left.chunk.page || 0) - (right.chunk.page || 0))
        const definition = definitionCandidates[0]
        if (definition?.chunk.page) {
          const definitionSection: ManualOutlineSection = {
            documentId: definition.document.documentId,
            documentName: definition.document.documentName,
            title: 'CASE II recovery conditions',
            path: `${definition.chunk.sectionPath || 'Carrier recovery'} > CASE II recovery conditions`,
            level: Math.max(0, definition.chunk.sectionLevel + 1),
            startPage: definition.chunk.page,
            endPage: definition.chunk.page,
            authority: definition.document.authority,
          }
          const caseOnePattern = carrierCaseTitlePattern({ number: '1', roman: 'I' })
          const caseOneSections = allSections.filter((section) => (
            section.documentId === definition.document.documentId
            && caseOnePattern.test(section.title)
            && procedureTitlePattern.test(section.title)
          ))
          const caseOneConcrete = caseOneSections.filter((section) => !caseOneSections.some((candidate) => (
            candidate.path !== section.path && candidate.path.startsWith(`${section.path} > `)
          )))
          const continuation = (caseOneConcrete.length > 0 ? caseOneConcrete : caseOneSections)
            .sort((left, right) => left.startPage - right.startPage)[0]
          const selected = continuation ? [definitionSection, continuation] : [definitionSection]
          return {
            subIntents: selected.map((section, index) => ({
              label: index === 0 ? 'CASE II 条件与转场' : '进入目视后的 CASE I 回收',
              intent: section.path,
              coreTaskTerms: [section.title, 'CASE II carrier recovery'],
              queries: [section.title, section.path, 'CASE II carrier recovery'],
              sectionDocumentId: section.documentId,
              sectionStartPage: section.startPage,
              sectionEndPage: section.endPage,
            })),
            seedSections: selected,
            weaponStructure: false,
            specificUnresolved: false,
          }
        }
      }
    }

    const outlineQueries = [
      question,
      ...buildDomainSearchQueries(question),
      ...(detectLongProcedureProfile(question)?.searchQueries || []),
    ]
    const keywords = retrievalKeywords(outlineQueries)
    const structuralFocusKeywords = retrievalKeywords([
      question,
      ...detectDomainTerms(question).map((term) => term.canonical),
    ])
    const longProcedure = detectLongProcedureProfile(question)
    if (longProcedure) {
      const focusPatterns = longProcedureOutlineFocusPatterns(longProcedure, question)
      const matchingProcedureSections = allSections.filter((section) => (
        longProcedure.chapterPatterns.some((pattern) => pattern.test(section.title))
        && (focusPatterns.length === 0 || focusPatterns.some((pattern) => pattern.test(section.title)))
        && (longProcedure.id !== 'flight-procedure' || !/(?:weapons?|armament|offen[cs]e|combat employment|武器|军械)/i.test(section.path))
      ))
      // Keep the highest matching ancestor in each branch. Otherwise each CARP
      // child bookmark becomes a competing "procedure" and the source budget
      // never reaches related chapters such as the Aerial Delivery Panel.
      const procedureRoots = matchingProcedureSections.filter((section) => !matchingProcedureSections.some((candidate) => (
        candidate.documentId === section.documentId
        && candidate.path !== section.path
        && section.path.startsWith(`${candidate.path} > `)
      )))
      const structuredProcedures = procedureRoots
        .map((root) => {
          const descendants = allSections.filter((section) => (
            section.documentId === root.documentId
            && (section.path === root.path || section.path.startsWith(`${root.path} > `))
          ))
          const phaseSections = longProcedure.phases.flatMap((phase) => {
            const candidates = descendants
              .filter((section) => phase.patterns.some((pattern) => pattern.test(`${section.title}\n${section.path}`)))
              .sort((left, right) => left.startPage - right.startPage || right.level - left.level)
            return candidates.slice(0, 2)
          })
          const rootText = this.loadDocumentChunks(root.documentId)
            .filter((chunk) => Boolean(chunk.page) && chunk.page! >= root.startPage && chunk.page! <= root.endPage)
            .map((chunk) => chunk.text)
            .join('\n')
          const phaseCoverage = procedurePhaseIds(longProcedure, `${root.title}\n${root.path}\n${rootText}`).size
          return { root, phaseSections, coverage: Math.max(phaseSections.length, phaseCoverage) }
        })
        .filter((candidate) => candidate.coverage >= 2)
        .sort((left, right) => right.root.authority - left.root.authority || right.coverage - left.coverage || left.root.startPage - right.root.startPage)
      const procedure = structuredProcedures[0]
      if (procedure) {
        const sameTierProcedures = structuredProcedures.filter((candidate) => candidate.root.authority === procedure.root.authority).slice(0, 4)
        const seeds = [...new Map(sameTierProcedures.flatMap((candidate) => [candidate.root, ...candidate.phaseSections])
          .map((section) => [`${section.documentId}:${section.path}`, section])).values()]
        // A complete cold-start chapter is a single ordered procedure. Route it
        // as a bounded section so the source budget is sampled across the whole
        // chapter rather than being consumed by its first pages. Other flight
        // procedures (notably airdrop) can span separate chapters and remain on
        // the multi-seed completion path below.
        if (longProcedure.id === 'cold-start') {
          return {
            subIntents: [{
              label: cleanOutlineLabel(procedure.root.title),
              intent: procedure.root.path,
              coreTaskTerms: [procedure.root.title, ...longProcedure.searchQueries],
              queries: [procedure.root.title, procedure.root.path, ...longProcedure.searchQueries],
              sectionDocumentId: procedure.root.documentId,
              sectionStartPage: procedure.root.startPage,
              sectionEndPage: procedure.root.endPage,
            }],
            seedSections: seeds,
            weaponStructure: false,
            specificUnresolved: false,
          }
        }
        return { subIntents: [], seedSections: seeds, weaponStructure: false, specificUnresolved: false }
      }
    }
    // Task-specific routing already defines stricter intent-compatible branches.
    // Do not let a generic outline phrase such as "Target Designation" inside a
    // weapon chapter override a helmet/HMCS task and pull in an unrelated SLAM
    // procedure.
    if (detectTaskSemanticProfile(question)) {
      return { subIntents: [], seedSections: [], weaponStructure: false, specificUnresolved: false }
    }
    const ranked = allSections
      .filter((section) => !/(?:glossary|acronyms?|index|contents|revision history)/i.test(section.title))
      .map((section) => ({
        section,
        score: keywordEvidenceScore(section.title, keywords) * 12
          + keywordEvidenceScore(section.path, keywords) * 3
          + (proceduralOutlineTitle(section.title) ? 2 : 0)
          + section.authority / 200,
      }))
      .filter((entry) => entry.score >= 8)
      .sort((left, right) => right.score - left.score || right.section.authority - left.section.authority)
    if (isProceduralQuestion(question) && !longProcedure) {
      const siblingGroups = new Map<string, ManualOutlineSection[]>()
      for (const section of allSections) {
        const parentPath = section.path.split(' > ').slice(0, -1).join(' > ')
        if (!parentPath) continue
        const key = `${section.documentId}:${parentPath}`
        const group = siblingGroups.get(key) || []
        group.push(section)
        siblingGroups.set(key, group)
      }
      const alternatives = [...siblingGroups.entries()]
        .map(([key, siblings]) => {
          const parentPath = key.slice(key.indexOf(':') + 1)
          const unique = [...new Map(siblings.map((section) => [cleanOutlineLabel(section.title).toLocaleLowerCase(), section])).values()]
          const structural = unique.filter((section) => alternativeOutlineTitle(section.title))
          const parentEvidence = structuralKeywordEvidenceScore(parentPath, structuralFocusKeywords)
          const childEvidence = unique.reduce((total, section) => total + keywordEvidenceScore(section.title, keywords), 0)
          return {
            branches: structural.length >= 2 ? structural : unique,
            score: parentEvidence * 12 + childEvidence * 4 + Math.max(...unique.map((section) => section.authority)) / 200,
            parentEvidence,
            structuralCount: structural.length,
          }
        })
        .filter((group) => group.branches.length >= 2 && group.branches.length <= 6 && group.structuralCount >= 2 && group.parentEvidence >= 1)
        .sort((left, right) => right.score - left.score)[0]
      if (alternatives) {
        const bestAuthority = Math.max(...alternatives.branches.map((section) => section.authority))
        const branches = alternatives.branches.filter((section) => section.authority === bestAuthority).slice(0, 6)
        if (branches.length >= 2) {
          return {
            subIntents: branches.map((section) => ({
              label: cleanOutlineLabel(section.title),
              intent: section.path,
              coreTaskTerms: [section.title],
              queries: [section.title, section.path],
              sectionDocumentId: section.documentId,
              sectionStartPage: section.startPage,
              sectionEndPage: section.endPage,
            })),
            seedSections: branches,
            weaponStructure: false,
            specificUnresolved: false,
          }
        }
      }
    }
    const structuralAnchor = ranked
      .filter((entry) => structuralKeywordEvidenceScore(`${entry.section.title}\n${entry.section.path}`, structuralFocusKeywords) > 0)
      .sort((left, right) => (
        structuralKeywordEvidenceScore(`${right.section.title}\n${right.section.path}`, structuralFocusKeywords)
        - structuralKeywordEvidenceScore(`${left.section.title}\n${left.section.path}`, structuralFocusKeywords)
        || right.section.authority - left.section.authority
        || right.score - left.score
      ))[0]?.section
    const seedSections = structuralAnchor
      ? ranked
        .map((entry) => entry.section)
        .filter((section) => {
          if (section.documentId !== structuralAnchor.documentId) return false
          const anchorParent = structuralAnchor.path.split(' > ').slice(0, -1).join(' > ')
          const sectionParent = section.path.split(' > ').slice(0, -1).join(' > ')
          return section.path === structuralAnchor.path
            || section.path.startsWith(`${structuralAnchor.path} > `)
            || (anchorParent && sectionParent === anchorParent && Math.abs(section.startPage - structuralAnchor.startPage) <= 8)
        })
        .slice(0, 6)
      : ranked.slice(0, 4).map((entry) => entry.section)
    return { subIntents: [], seedSections, weaponStructure: false, specificUnresolved: false }
  }

  private async retrieveSources(connection: ManualAiConnection, question: string): Promise<RetrievalResult> {
    const taskProfile = detectTaskSemanticProfile(question)
    const longProcedureProfile = detectLongProcedureProfile(question)
    const focusTerms = directQueryFocusTerms(question)
    const availableAircraft = [...new Set(this.manifest.documents
      .map((document) => document.aircraft)
      .filter((aircraft): aircraft is string => Boolean(aircraft)))]
    const deterministicCandidates = AIRCRAFT_ALIASES.filter(([, pattern]) => pattern.test(question)).map(([aircraft]) => aircraft)
    const localConfidenceHigh = true
    const matchedAircraft = matchAircraftCandidates(deterministicCandidates, availableAircraft)
    const interpretation: QueryInterpretation = {
      queries: buildDomainSearchQueries(question),
      coreTaskTerms: deterministicCoreTaskTerms(question),
      subIntents: deterministicSubIntents(question),
      aircraftCandidates: matchedAircraft.matched,
      aircraftMentioned: deterministicCandidates.length > 0,
      confidence: deterministicCandidates.length > 0 ? 1 : 0,
      canonicalTerms: detectDomainTerms(question).map((term) => term.canonical),
      intent: question,
    }
    // Operational procedures differ by cockpit and module. Without an aircraft
    // boundary, choosing the first high-authority manual is arbitrary and can
    // silently mix controls from multiple modules. Ask for the missing boundary
    // instead; colloquial aircraft hints can later be resolved by the optional
    // confidence-gated semantic router before reaching this guard.
    if (deterministicCandidates.length === 0 && isProceduralQuestion(question)) {
      return {
        sources: [],
        fallbackSources: [],
        aircraftScope: [],
        unavailableAircraft: [],
        subIntents: interpretation.subIntents,
        requiresAircraftClarification: true,
      }
    }
    // F-14B(U) is a distinct DCS module, but its documentation deliberately
    // reuses the base Tomcat manual. Inheritance is one-way: BU may retrieve
    // common F-14 pages, while an F-14 query never sees BU-only documents.
    const selectedAircraft = matchedAircraft.matched[0] || ''
    const aircraftScope = selectedAircraft === 'F-14B(U)'
      ? ['F-14B(U)', 'F-14']
      : matchedAircraft.matched
    const outlineRoutes = this.manualOutlineRoutes(question, aircraftScope)
    if (outlineRoutes.subIntents.length > 0) interpretation.subIntents = outlineRoutes.subIntents
    if (outlineRoutes.specificUnresolved) {
      return { sources: [], fallbackSources: [], aircraftScope, unavailableAircraft: matchedAircraft.unavailable, subIntents: [] }
    }
    const applyVariantBoundary = (candidates: ManualSearchHit[]) => outlineRoutes.weaponStructure
      ? candidates
      : weaponVariantBoundedCandidates(candidates, question)
    const flightFocusPatterns = longProcedureProfile?.id === 'flight-procedure'
      ? longProcedureOutlineFocusPatterns(longProcedureProfile, question)
      : []
    const applyProcedureBoundary = (candidates: ManualSearchHit[]) => {
      if (longProcedureProfile?.id !== 'flight-procedure') return candidates
      return candidates.filter((hit) => {
        const sectionIdentity = hit.sectionPath || hit.sectionTitle || ''
        if (/(?:weapons?|armament|offen[cs]e|combat employment|target designation|weapon control|武器|军械)/i.test(sectionIdentity)) return false
        if (flightFocusPatterns.length === 0) return true
        const insideStructuralRoute = Boolean(hit.page && outlineRoutes.seedSections.some((section) => (
          section.documentId === hit.documentId
          && hit.page! >= section.startPage
          && hit.page! <= section.endPage
        )))
        if (
          outlineRoutes.seedSections.length === 0
          && /\bemergency equipment\b/i.test(hit.excerpt)
          && !/(?:procedure|checklist|select|set|press|release|configure|enter|maintain|abort|disconnect)/i.test(hit.excerpt)
        ) return false
        const focusText = outlineRoutes.seedSections.length > 0 ? sectionIdentity : `${sectionIdentity}\n${hit.excerpt}`
        return insideStructuralRoute || flightFocusPatterns.some((pattern) => pattern.test(focusText))
      })
    }
    const applyRetrievalBoundaries = (candidates: ManualSearchHit[]) => applyProcedureBoundary(applyVariantBoundary(candidates))

    const aircraftTerms = matchedAircraft.matched
    const weightedQueries = buildWeightedQueries(question, interpretation, aircraftTerms, taskProfile)
    const queries = weightedQueries.map((query) => query.text)
    const evidenceKeywords = retrievalKeywords(queries)
    const coreTaskKeywords = retrievalKeywords(interpretation.coreTaskTerms)
    const fused = new Map<string, { hit: ManualSearchHit; score: number; queryHits: number }>()
    for (const query of weightedQueries) {
      const hits = this.search(query.text, RETRIEVAL_CANDIDATES, aircraftScope)
      hits.forEach((hit, rank) => {
        const current = fused.get(hit.id)
        const score = query.weight / (RRF_K + rank + 1)
        if (current) {
          current.score += score
          current.queryHits += 1
        } else fused.set(hit.id, { hit, score, queryHits: 1 })
      })
    }

    let ranked = [...fused.values()]
      .sort((left, right) => right.score - left.score)
      .map(({ hit, score, queryHits }) => {
        const evidence = keywordEvidenceScore(hit.excerpt, evidenceKeywords)
        const coverageBoost = 1 + Math.min(0.4, queryHits * 0.025)
        const evidenceBoost = 1 + Math.min(0.9, evidence * 0.07)
        const coreTaskBoost = 1 + Math.min(1.25, keywordEvidenceScore(hit.excerpt, coreTaskKeywords) * 0.15)
        const headingBoost = 1 + Math.min(0.35, proceduralHeadingScore(hit.excerpt) * 0.12)
        const actionBoost = isProceduralQuestion(question) ? 1 + Math.min(0.45, proceduralActionScore(hit.excerpt) * 0.09) : 1
        const referencePenalty = isReferenceOnlyPage(hit.excerpt) ? 0.5 : 1
        const focusEvidence = directQueryFocusScore(focusTerms, hit.excerpt)
        const focusBoost = focusTerms.length > 0 ? (focusEvidence > 0 ? 1.85 + Math.min(0.45, focusEvidence * 0.15) : 0.62) : 1
        const sourceAuthorityBoost = this.sourceAuthority(hit) === 400 ? 1.4
          : this.sourceAuthority(hit) === 300 ? 1.2
            : this.sourceAuthority(hit) === 250 ? 1.1
              : this.sourceAuthority(hit) === 200 ? 1.0 : 0.72
        const aircraftSpecificityBoost = aircraftScope.length === 0 || (hit.aircraft && aircraftScope.includes(hit.aircraft)) ? 1.25 : 0.9
        return { ...hit, score: score * coverageBoost * evidenceBoost * coreTaskBoost * headingBoost * actionBoost * referencePenalty * focusBoost * sourceAuthorityBoost * aircraftSpecificityBoost }
      })
      .sort((left, right) => right.score - left.score)
    if (outlineRoutes.seedSections.length > 0) {
      const outlineSeeds = outlineRoutes.seedSections.flatMap((section) => (
        [section.startPage, Math.min(section.endPage, section.startPage + 1)]
          .map((page) => this.pageContextHit(section.documentId, page, 100))
          .filter((hit): hit is ManualSearchHit => Boolean(hit))
      ))
      const byPage = new Map<string, ManualSearchHit>()
      for (const hit of [...outlineSeeds, ...ranked]) {
        const key = hit.page ? `${hit.documentId}:${hit.page}` : hit.id
        const previous = byPage.get(key)
        if (!previous || hit.score > previous.score) byPage.set(key, hit)
      }
      ranked = [...byPage.values()].sort((left, right) => right.score - left.score)
    }
    const expandedPages = this.expandCandidatePages(ranked, queries)
    if (expandedPages.length > 0) {
      const byPage = new Map<string, ManualSearchHit>()
      for (const hit of [...expandedPages, ...ranked]) {
        const key = hit.page ? `${hit.documentId}:${hit.page}` : hit.id
        const previous = byPage.get(key)
        if (!previous || hit.score > previous.score) byPage.set(key, hit)
      }
      ranked = [...byPage.values()].sort((left, right) => right.score - left.score)
    }
    // An aircraft match only establishes the document boundary.  When the
    // question names a concrete subject, reject unrelated pages from the same
    // aircraft unless they are close neighbours of a page that actually names
    // that subject.  This prevents an F-16 radar page from answering a GBU
    // question and an F-14 acronym table from answering an AIM-54 question.
    ranked = focusBoundedCandidates(ranked, focusTerms, question)
    ranked = applyRetrievalBoundaries(ranked)
    // Explicit PDF outline seeds are verified structural evidence. Re-add their
    // boundary pages after lexical focus bounding: translated/abbreviated user
    // wording may not literally occur on a complementary chapter (for example
    // Chinese “空投” versus “Aerial Delivery Panel”), but the manual itself has
    // already linked that chapter to the selected procedure.
    if (outlineRoutes.seedSections.length > 0) {
      const structuralSeeds = outlineRoutes.seedSections.flatMap((section) => (
        [...new Set([section.startPage, Math.min(section.endPage, section.startPage + 1), section.endPage])]
          .map((page) => this.pageContextHit(section.documentId, page, 100))
          .filter((hit): hit is ManualSearchHit => Boolean(hit))
          .filter((hit) => !isReferenceOnlyPage(hit.excerpt))
      ))
      const restored = new Map<string, ManualSearchHit>()
      for (const hit of [...structuralSeeds, ...ranked]) {
        const key = hit.page ? `${hit.documentId}:${hit.page}` : hit.id
        if (!restored.has(key)) restored.set(key, hit)
      }
      ranked = applyRetrievalBoundaries([...restored.values()])
    }
    const diverse: ManualSearchHit[] = []
    const seenPages = new Set<string>()
    const perDocument = new Map<string, number>()
    const perDocumentLimit = aircraftScope.includes('F-14B(U)') ? 12 : 20
    const focusAnchors = focusTerms.length > 0
      ? ranked
        .filter((hit) => !isReferenceOnlyPage(hit.excerpt) && directQueryFocusScore(focusTerms, hit.excerpt) > 0)
        .sort((left, right) => (
          directQueryFocusScore(focusTerms, right.excerpt) - directQueryFocusScore(focusTerms, left.excerpt)
          || proceduralHeadingScore(right.excerpt) - proceduralHeadingScore(left.excerpt)
          || proceduralActionScore(right.excerpt) - proceduralActionScore(left.excerpt)
          || right.score - left.score
        ))
        .slice(0, 10)
      : []
    const taskAnchors = taskProfile
      ? ranked
        .filter((hit) => !isReferenceOnlyPage(hit.excerpt) && taskEvidenceScore(taskProfile, hit.excerpt) >= 6)
        .sort((left, right) => (
          proceduralHeadingScore(right.excerpt) - proceduralHeadingScore(left.excerpt)
          || proceduralActionScore(right.excerpt) - proceduralActionScore(left.excerpt)
          || right.score - left.score
        ))
        .slice(0, 8)
      : []
    const coreAnchors = interpretation.coreTaskTerms.flatMap((term) => {
      const termKeywords = retrievalKeywords([term])
      if (termKeywords.length === 0) return []
      return ranked
        .filter((hit) => !isReferenceOnlyPage(hit.excerpt))
        .map((hit) => ({ hit, evidence: keywordEvidenceScore(hit.excerpt, termKeywords), action: proceduralActionScore(hit.excerpt) }))
        .filter((item) => item.evidence >= (termKeywords.length >= 2 ? 1.5 : 1))
        .sort((left, right) => right.evidence - left.evidence || right.action - left.action || right.hit.score - left.hit.score)
        .slice(0, 3)
        .map((item) => item.hit)
    })
    const coreAnchorNeighbors = coreAnchors.slice(0, 12).flatMap((hit) => {
      if (!hit.page) return []
      return [-3, -2, -1, 1, 2, 3]
        .map((offset) => this.pageContextHit(hit.documentId, hit.page! + offset, hit.score * 0.72))
        .filter((neighbor): neighbor is ManualSearchHit => Boolean(neighbor))
    })
    const structuralAnchors = outlineRoutes.seedSections.flatMap((section) => (
      [...new Set([section.startPage, section.endPage])]
        .map((page) => this.pageContextHit(section.documentId, page, 100))
        .filter((hit): hit is ManualSearchHit => Boolean(hit))
        .filter((hit) => !isReferenceOnlyPage(hit.excerpt))
    ))
    for (const hit of [...structuralAnchors, ...focusAnchors, ...taskAnchors, ...coreAnchors, ...coreAnchorNeighbors, ...ranked]) {
      const pageKey = hit.page ? `${hit.documentId}:${hit.page}` : hit.id
      if (seenPages.has(pageKey) || (perDocument.get(hit.documentId) || 0) >= perDocumentLimit) continue
      seenPages.add(pageKey)
      perDocument.set(hit.documentId, (perDocument.get(hit.documentId) || 0) + 1)
      diverse.push(hit)
      if (diverse.length >= 32) break
    }
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') {
      console.log('[manual-library] retrieval stages', {
        outlineSeeds: structuralAnchors.map((source) => `${source.page}:${source.sectionPath}`),
        diverse: diverse.map((source) => `${source.page}:${source.sectionPath}`),
      })
    }
    const precedenceGroups = this.sourcePrecedenceGroups(question, diverse, queries, taskProfile)
    const precedenceCandidates = precedenceGroups[0] || diverse
    const protectedOutlineIds = new Set(structuralAnchors.map((source) => source.id))
    const reranked = await this.rerankSources(connection, question, precedenceCandidates, weightedQueries, interpretation.coreTaskTerms, taskProfile, localConfidenceHigh, protectedOutlineIds)
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') {
      console.log('[manual-library] precedence/rerank', {
        precedence: precedenceCandidates.map((source) => `${source.page}:${source.sectionPath}`),
        reranked: reranked.map((source) => `${source.page}:${source.sectionPath}`),
      })
    }
    const precedenceSelected = this.applySourcePrecedence(question, reranked, queries, taskProfile)
    let sources = applyRetrievalBoundaries(this.completeProceduralEvidence(question, precedenceSelected, queries, taskProfile))
    let fallbackSources = precedenceGroups.slice(1, 4)
      .map((group) => applyRetrievalBoundaries(this.completeProceduralEvidence(question, group, queries, taskProfile)))
      .filter((group) => group.length > 0)
    let supportedSubIntents = interpretation.subIntents
    if (interpretation.subIntents.length === 1 && interpretation.subIntents[0].sectionDocumentId) {
      const structured = this.selectSubIntentSources(question, interpretation.subIntents[0], diverse, taskProfile)
      if (structured.length > 0) {
        sources = structured
        fallbackSources = [structured, ...fallbackSources].slice(0, 4)
      }
    }
    if (interpretation.subIntents.length >= 2) {
      const supportedBranches = interpretation.subIntents
        .map((subIntent) => ({ subIntent, sources: this.selectSubIntentSources(question, subIntent, diverse, taskProfile) }))
        .filter((branch) => branch.sources.length > 0)
      const branchGroups = supportedBranches.map((branch) => branch.sources)
      supportedSubIntents = supportedBranches.length >= 2 ? supportedBranches.map((branch) => branch.subIntent) : []
      // Only replace the ordinary single-intent result after at least two real
      // branches found evidence. Otherwise retain the strongest supported answer
      // rather than padding a missing branch with unrelated pages.
      if (branchGroups.length >= 2) {
        const merged = new Map<string, ManualSearchHit>()
        const longestBranch = Math.max(...branchGroups.map((group) => group.length))
        // Interleave evidence instead of concatenating branches. Concatenation
        // allowed the first two variants to consume the global source budget and
        // silently removed later variants (for example AGM-65L or SLAM-ER).
        for (let index = 0; index < longestBranch && merged.size < ANSWER_SOURCES; index += 1) {
          for (const group of branchGroups) {
            const source = group[index]
            if (!source) continue
            const key = source.page ? `${source.documentId}:${source.page}` : source.id
            if (!merged.has(key)) merged.set(key, source)
            if (merged.size >= ANSWER_SOURCES) break
          }
        }
        sources = [...merged.values()].slice(0, ANSWER_SOURCES)
        fallbackSources = [sources, ...fallbackSources].slice(0, 4)
      }
    }
    if (longProcedureProfile?.id === 'flight-procedure' && outlineRoutes.seedSections.length > 0) {
      const structuralGroups = outlineRoutes.seedSections.map((section) => {
        const pages: ManualSearchHit[] = []
        for (let page = section.startPage; page <= section.endPage; page += 1) {
          const hit = this.pageContextHit(section.documentId, page, 20 - Math.min(12, page - section.startPage))
          if (hit && !isReferenceOnlyPage(hit.excerpt)) pages.push(hit)
        }
        return pages
      }).filter((group) => group.length > 0)
      const merged = new Map<string, ManualSearchHit>()
      const longestGroup = Math.max(0, ...structuralGroups.map((group) => group.length))
      for (let index = 0; index < longestGroup && merged.size < ANSWER_SOURCES; index += 1) {
        for (const group of structuralGroups) {
          const source = group[index]
          if (!source) continue
          merged.set(source.page ? `${source.documentId}:${source.page}` : source.id, source)
          if (merged.size >= ANSWER_SOURCES) break
        }
      }
      for (const source of sources) {
        if (merged.size >= ANSWER_SOURCES) break
        merged.set(source.page ? `${source.documentId}:${source.page}` : source.id, source)
      }
      sources = applyRetrievalBoundaries([...merged.values()])
      fallbackSources = [sources, ...fallbackSources].slice(0, 4)
    }
    return { sources, fallbackSources, aircraftScope, unavailableAircraft: matchedAircraft.unavailable, subIntents: supportedSubIntents }
  }

  private selectSubIntentSources(question: string, subIntent: QuerySubIntent, candidates: ManualSearchHit[], taskProfile: TaskSemanticProfile | null): ManualSearchHit[] {
    const queries = [subIntent.intent, ...subIntent.coreTaskTerms, ...subIntent.queries]
    const keywords = retrievalKeywords(queries)
    const structuredLimit = detectLongProcedureProfile(question) ? ANSWER_SOURCES : 8
    const structuredCandidates: ManualSearchHit[] = []
    if (subIntent.sectionDocumentId && subIntent.sectionStartPage && subIntent.sectionEndPage) {
      for (let page = subIntent.sectionStartPage; page <= subIntent.sectionEndPage; page += 1) {
        const hit = this.pageContextHit(subIntent.sectionDocumentId, page, 20 - Math.min(12, page - subIntent.sectionStartPage))
        if (hit && !isReferenceOnlyPage(hit.excerpt)) structuredCandidates.push(hit)
      }
    }
    if (structuredCandidates.length > 0) {
      const bySection = new Map<string, ManualSearchHit[]>()
      for (const source of structuredCandidates) {
        const key = source.sectionPath || `${source.documentId}:${source.page}`
        const group = bySection.get(key) || []
        group.push(source)
        bySection.set(key, group)
      }
      const rankedSections = [...bySection.entries()].map(([sectionPath, pages]) => ({
        sectionPath,
        pages,
        score: keywordEvidenceScore(sectionPath, keywords) * 12
          + pages.reduce((total, page) => total + proceduralHeadingScore(page.excerpt) * 3 + proceduralActionScore(page.excerpt), 0),
      })).sort((left, right) => right.score - left.score || (left.pages[0].page || 0) - (right.pages[0].page || 0))
      const selected = new Map<string, ManualSearchHit>()
      const addBestPage = (pages: ManualSearchHit[]) => {
        const best = [...pages].sort((left, right) => (
          keywordEvidenceScore(right.excerpt, keywords) - keywordEvidenceScore(left.excerpt, keywords)
          || proceduralActionScore(right.excerpt) - proceduralActionScore(left.excerpt)
          || (left.page || 0) - (right.page || 0)
        ))[0]
        if (best) selected.set(`${best.documentId}:${best.page}`, best)
      }
      const opening = structuredCandidates.find((source) => source.page === subIntent.sectionStartPage)
      if (opening) selected.set(`${opening.documentId}:${opening.page}`, opening)
      for (const section of rankedSections) {
        addBestPage(section.pages)
        if (selected.size >= structuredLimit) break
      }
      // Long procedures often exceed the source budget. Sample the ordered
      // chapter across its full range before sequential filling so late phases
      // such as INS/GPS alignment and post-start checks cannot disappear.
      if (structuredLimit > 8 && structuredCandidates.length > selected.size) {
        const ordered = [...structuredCandidates].sort((left, right) => (left.page || 0) - (right.page || 0))
        const slots = Math.max(1, structuredLimit - selected.size)
        for (let index = 0; index < slots; index += 1) {
          const position = slots === 1
            ? ordered.length - 1
            : Math.round(index * (ordered.length - 1) / (slots - 1))
          const page = ordered[position]
          if (page) selected.set(`${page.documentId}:${page.page}`, page)
          if (selected.size >= structuredLimit) break
        }
      }
      for (const section of rankedSections) {
        for (const page of section.pages.sort((left, right) => (left.page || 0) - (right.page || 0))) {
          if (selected.size >= structuredLimit) break
          selected.set(`${page.documentId}:${page.page}`, page)
        }
        if (selected.size >= structuredLimit) break
      }
      return [...selected.values()].sort((left, right) => (left.page || 0) - (right.page || 0))
    }
    const weaponFamily = subIntent.weaponFamilyId
      ? DCS_WEAPON_ONTOLOGY.find((family) => family.id === subIntent.weaponFamilyId)
      : undefined
    const weaponVariant: WeaponVariantSemantic | undefined = weaponFamily?.variants?.find((variant) => variant.id === subIntent.weaponVariantId)
    // The broad first pass may retain a neighbouring procedure page while
    // dropping the exact A/A or A/G page. Re-introduce nearby cached pages for
    // each branch, then score the branch independently.
    const branchPool = structuredCandidates.length > 0 ? structuredCandidates : candidates
    const variantAnchors = weaponVariant
      ? branchPool.filter((source) => weaponVariantEvidenceScore(weaponVariant, source.excerpt) > 0)
      : []
    const candidateSeeds = variantAnchors.length > 0 ? variantAnchors : branchPool
    const expandedCandidates = new Map<string, ManualSearchHit>()
    for (const source of candidateSeeds) {
      expandedCandidates.set(source.page ? `${source.documentId}:${source.page}` : source.id, source)
      if (!source.page) continue
      const radius = weaponVariant || structuredCandidates.length > 0 ? 8 : 2
      for (let offset = -radius; offset <= radius; offset += 1) {
        if (offset === 0) continue
        const neighbor = this.pageContextHit(source.documentId, source.page + offset, source.score * 0.82)
        if (neighbor) expandedCandidates.set(`${neighbor.documentId}:${neighbor.page}`, neighbor)
      }
    }
    const branchIdentity = `${subIntent.label}\n${subIntent.intent}`
    const airBranch = /(?:空对空|air[-\s]to[-\s]air|air\s+target|radar.*lock|missile\s+seeker)/i.test(branchIdentity)
    const groundBranch = /(?:空对地|air[-\s]to[-\s]ground|ground\s+target|target\s+designation)/i.test(branchIdentity)
    const markpointBranch = /(?:导航标记|MARKPOINT|mark\s*point|store.*mark)/i.test(branchIdentity)
    const variantQuestion = weaponVariant ? `${question}\n明确型号：${weaponVariant.canonical}` : question
    const variantBoundedKeys = weaponVariant
      ? new Set(weaponVariantBoundedCandidates([...expandedCandidates.values()], variantQuestion)
        .map((source) => source.page ? `${source.documentId}:${source.page}` : source.id))
      : null
    const branchCompatible = (source: ManualSearchHit) => {
      const text = source.excerpt
      if (variantBoundedKeys) return variantBoundedKeys.has(source.page ? `${source.documentId}:${source.page}` : source.id)
      if (taskProfile?.family !== 'helmet-target-designation') return true
      const helmetSubject = /(?:JHMCS|HMCS|HMD|helmet(?:-mounted)?)/i.test(text)
      if (!helmetSubject) return false
      if (airBranch) return /(?:AIR[-\s]TO[-\s]AIR|Air\s+Target|radar\s+lock|\bSTT\b|\bBORE\b|AIM-9|missile\s+seeker|Cage\/Uncage)/i.test(text)
      if (groundBranch) return /(?:Ground\s+Target\s+Designation|AIR[-\s]TO[-\s]GROUND|Dynamic\s+Aiming\s+Cross|TDC\s+Designate|designation\s+diamond)/i.test(text)
      if (markpointBranch) return /(?:MARKPOINT|mark\s*point|MARK\s+page|Mark\s+Cue|store.*mark)/i.test(text)
      return true
    }
    const assessed = [...expandedCandidates.values()]
      .filter(branchCompatible)
      .filter((source) => !isReferenceOnlyPage(source.excerpt))
      .map((source) => ({
        source,
        authority: this.sourceAuthority(source),
        evidence: keywordEvidenceScore(source.excerpt, keywords),
        action: proceduralActionScore(source.excerpt),
        heading: proceduralHeadingScore(source.excerpt),
      }))
      // Branch queries are intentionally narrow and later pass through strict
      // intent compatibility, so one strong term plus an operational sentence
      // is enough to keep the exact procedure page in play.
      .filter((item) => item.evidence >= 1 && item.action + item.heading > 0)
    const authorities = [...new Set(assessed.map((item) => item.authority))].sort((left, right) => right - left)
    for (const authority of authorities) {
      const byDocument = new Map<string, typeof assessed>()
      for (const item of assessed.filter((candidate) => candidate.authority === authority)) {
        const group = byDocument.get(item.source.documentId) || []
        group.push(item)
        byDocument.set(item.source.documentId, group)
      }
      const bestDocument = [...byDocument.values()].sort((left, right) => (
        right.reduce((total, item) => total + item.evidence * 4 + item.action * 2 + item.heading * 3 + item.source.score, 0)
        - left.reduce((total, item) => total + item.evidence * 4 + item.action * 2 + item.heading * 3 + item.source.score, 0)
      ))[0]
      if (!bestDocument) continue
      const selected = bestDocument
        .sort((left, right) => right.evidence - left.evidence || right.action - left.action || right.source.score - left.source.score)
        .slice(0, 8)
        .map((item) => item.source)
      const branchQuestion = `${question}\n明确场景：${subIntent.intent}`
      const completed = weaponVariantBoundedCandidates(
        this.completeProceduralEvidence(branchQuestion, selected, queries, taskProfile),
        branchQuestion,
      )
      if (completed.length > 0) return completed.slice(0, 8)
    }
    return []
  }

  private sourceAuthority(source: ManualSearchHit): number {
    return manualAuthority(source)
  }

  private sourceSearchMultiplier(source: ManualSearchHit): number {
    const authority = this.sourceAuthority(source)
    return authority === 400 ? 1.75
      : authority === 300 ? 1.35
        : authority === 250 ? 1.18
          : authority === 200 ? 1 : 0.68
  }

  private sourceAuthorityLabel(source: ManualSearchHit): string {
    const authority = this.sourceAuthority(source)
    const label = authority === 400 ? 'Chuck 社区手册'
      : authority === 300 ? 'DCS 官方全点击模组手册'
        : authority === 250 ? 'DCS 官方手册'
          : authority === 200 ? (source.isTranslation ? '用户汉化资料' : '用户资料') : 'DCS 官方非全点击模组手册'
    const modifiedAt = this.manifest.documents.find((document) => document.id === source.documentId)?.modifiedAt
    return modifiedAt ? `${label} · ${modifiedAt.slice(0, 10)}` : label
  }

  private sourceFreshness(source: ManualSearchHit): number {
    const document = this.manifest.documents.find((item) => item.id === source.documentId)
    const frontMatter = [1, 2]
      .map((page) => this.pageContextHit(source.documentId, page, 0)?.excerpt || '')
      .join('\n')
    const identity = `${source.documentName}\n${frontMatter}\n${source.excerpt.slice(0, 700)}`
    const dated = [...identity.matchAll(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?/g)]
      .map((match) => Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] || 1)))
      .filter(Number.isFinite)
    const years = [...identity.matchAll(/\b(20\d{2})\b/g)].map((match) => Date.UTC(Number(match[1]), 0, 1)).filter(Number.isFinite)
    const declared = Math.max(0, ...dated, ...years)
    // Confidence bands ensure an explicit publication date or edition beats a
    // filesystem timestamp that may only reflect when an old copy was imported.
    if (declared > 0) return 3_000_000_000_000_000 + declared
    const editions = [...identity.matchAll(/\b(?:version|edition|revision|rev\.?|ver\.?|v)\s*([0-9]{1,3})(?:\.([0-9]{1,3}))?(?:\.([0-9]{1,3}))?/gi)]
      .map((match) => Number(match[1]) * 1_000_000 + Number(match[2] || 0) * 1_000 + Number(match[3] || 0))
      .filter(Number.isFinite)
    const edition = Math.max(0, ...editions)
    if (edition > 0) return 2_000_000_000_000_000 + edition
    const modified = Date.parse(document?.modifiedAt || '')
    return 1_000_000_000_000_000 + (Number.isFinite(modified) ? modified : 0)
  }

  private applySourcePrecedence(question: string, sources: ManualSearchHit[], queries: string[], taskProfile: TaskSemanticProfile | null): ManualSearchHit[] {
    return this.sourcePrecedenceGroups(question, sources, queries, taskProfile)[0] || sources
  }

  private sourcePrecedenceGroups(question: string, sources: ManualSearchHit[], queries: string[], taskProfile: TaskSemanticProfile | null): ManualSearchHit[][] {
    if (sources.length <= 1) return sources.length > 0 ? [sources] : []
    const keywords = retrievalKeywords(queries)
    const procedural = isProceduralQuestion(question)
    const longProcedure = detectLongProcedureProfile(question)
    const assessed = sources.map((source) => ({
      source,
      authority: this.sourceAuthority(source),
      freshness: this.sourceFreshness(source),
      evidence: keywordEvidenceScore(source.excerpt, keywords),
      taskEvidence: taskEvidenceScore(taskProfile, source.excerpt),
      actionEvidence: proceduralActionScore(source.excerpt),
      procedurePhases: longProcedure ? procedurePhaseIds(longProcedure, source.excerpt) : new Set<string>(),
      procedureChapter: longProcedure ? procedureChapterSignal(longProcedure, source.excerpt) : 0,
    }))
    const maximumEvidence = Math.max(0, ...assessed.map((item) => item.evidence))
    const relevant = assessed.filter((item) => (
      !isReferenceOnlyPage(item.source.excerpt)
      && (taskProfile
        ? item.taskEvidence >= 6
        : item.evidence >= Math.max(1, maximumEvidence * 0.4) || Boolean(longProcedure && item.procedureChapter > 0))
      && (!procedural || item.actionEvidence > 0 || proceduralHeadingScore(item.source.excerpt) > 0)
    ))
    if (relevant.length === 0) return [sources]
    const authorityGroups: ManualSearchHit[][] = []
    const byAuthority = [...new Set(relevant.map((item) => item.authority))].sort((left, right) => right - left)
    for (const authority of byAuthority) {
      const atLevel = relevant.filter((item) => item.authority === authority)
      const byDocument = new Map<string, typeof atLevel>()
      for (const item of atLevel) {
        const group = byDocument.get(item.source.documentId) || []
        group.push(item)
        byDocument.set(item.source.documentId, group)
      }
      const documentClusters = [...byDocument.values()].flatMap((group) => {
        if (group.every((item) => !item.source.page)) return [group]
        const ordered = [...group].sort((left, right) => (left.source.page || 0) - (right.source.page || 0))
        const clusters: typeof group[] = []
        for (const item of ordered) {
          const current = clusters.at(-1)
          const previousPage = current?.at(-1)?.source.page
          if (!current || !previousPage || !item.source.page || item.source.page - previousPage > 8) clusters.push([item])
          else current.push(item)
        }
        return clusters
      })
      const candidates = documentClusters.filter((group) => {
        if (!procedural) return true
        const actionCoverage = group.reduce((total, item) => total + item.actionEvidence, 0)
        const pageCount = new Set(group.map((item) => item.source.page).filter(Boolean)).size
        if (taskProfile) {
          const combined = group.map((item) => item.source.excerpt).join('\n')
          const numberedSequence = /^\s*1[.)]\s+/m.test(combined) && /^\s*[2-9][.)]\s+/m.test(combined)
          const directTaskHeading = /(?:Ground\s+Target\s+Designation|JHMCS\s+AIR-TO-GROUND\s+MODE|HMCS\s+Ground\s+Target\s+Designation)/i.test(combined)
          const taskSubjectAndAction = /(?:JHMCS|HMCS|HMD|helmet(?:-mounted)?)/i.test(combined)
            && /(?:ground\s+target\s+designation|designat(?:e|ed|ion)|TDC\s+Designate|designation\s+diamond|目标指定)/i.test(combined)
          const directEvidence = Math.max(...group.map((item) => item.taskEvidence)) >= 6
          if (!directEvidence || !taskSubjectAndAction || (!numberedSequence && !directTaskHeading)) return false
        }
        // A concise one-page PDF procedure is just as valid as a non-paginated
        // text note; do not discard it merely because it has a page number.
        return actionCoverage >= 2 || pageCount >= 2 || (pageCount <= 1 && actionCoverage >= 1)
      })
      if (candidates.length === 0) continue
      const selected = candidates.sort((left, right) => {
        if (longProcedure) {
          const combinedLeft = left.map((item) => item.source.excerpt).join('\n')
          const combinedRight = right.map((item) => item.source.excerpt).join('\n')
          const leftCoverage = procedurePhaseIds(longProcedure, combinedLeft).size
          const rightCoverage = procedurePhaseIds(longProcedure, combinedRight).size
          const leftOptionalPenalty = longProcedure.optionalOnlyPattern.test(combinedLeft) && leftCoverage < 3 ? 1 : 0
          const rightOptionalPenalty = longProcedure.optionalOnlyPattern.test(combinedRight) && rightCoverage < 3 ? 1 : 0
          const completenessOrder = rightCoverage - leftCoverage
            || right.reduce((total, item) => total + item.procedureChapter * 3 + item.actionEvidence, 0)
              - left.reduce((total, item) => total + item.procedureChapter * 3 + item.actionEvidence, 0)
            || leftOptionalPenalty - rightOptionalPenalty
          if (completenessOrder !== 0) return completenessOrder
        }
        return Math.max(...right.map((item) => item.freshness)) - Math.max(...left.map((item) => item.freshness))
          || right.reduce((total, item) => total + item.taskEvidence * 3 + item.evidence + item.actionEvidence, 0)
            - left.reduce((total, item) => total + item.taskEvidence * 3 + item.evidence + item.actionEvidence, 0)
      })
      const orderedItems = longProcedure && longProcedureOutlineFocusPatterns(longProcedure, question).length > 0 && selected.length > 1
        ? (() => {
          const interleaved: typeof relevant = []
          const longest = Math.max(...selected.map((group) => group.length))
          for (let index = 0; index < longest && interleaved.length < ANSWER_SOURCES; index += 1) {
            for (const group of selected) {
              const item = group[index]
              if (item) interleaved.push(item)
              if (interleaved.length >= ANSWER_SOURCES) break
            }
          }
          return interleaved
        })()
        : selected.flatMap((group) => group)
      const tierSources = [...new Map(orderedItems
        .map((item) => [item.source.page ? `${item.source.documentId}:${item.source.page}` : item.source.id, item.source])).values()]
      if (tierSources.length > 0) authorityGroups.push(tierSources)
    }
    if (authorityGroups.length === 0) return [sources]

    // The selected aircraft is already a hard boundary, so the primary context
    // can safely combine authority tiers. Reserve most slots for the strongest
    // tier, then let lower tiers fill genuinely missing details instead of
    // forcing the answer through an all-or-nothing single-source fallback.
    const tierBudgets = [8, 4, 3, 2]
    const primaryCandidates = authorityGroups.flatMap((group, index) => group.slice(0, tierBudgets[index] || 2))
    const primary = [...new Map([...primaryCandidates, ...authorityGroups.flat()]
      .map((source) => [source.page ? `${source.documentId}:${source.page}` : source.id, source])).values()]
      .slice(0, ANSWER_SOURCES)
    return [primary, ...authorityGroups]
  }

  private completeProceduralEvidence(question: string, sources: ManualSearchHit[], queries: string[], taskProfile: TaskSemanticProfile | null): ManualSearchHit[] {
    if (!isProceduralQuestion(question) || sources.length === 0) return sources
    const longProcedure = detectLongProcedureProfile(question)
    if (longProcedure) return this.completeLongProcedureEvidence(question, longProcedure, sources, queries)
    const byDocument = new Map<string, ManualSearchHit[]>()
    for (const source of sources) {
      if (!source.page) continue
      const group = byDocument.get(source.documentId) || []
      group.push(source)
      byDocument.set(source.documentId, group)
    }
    let bestSpan: { documentId: string; start: number; end: number; score: number } | null = null
    for (const [documentId, group] of byDocument) {
      const ordered = [...group].sort((left, right) => left.page! - right.page!)
      for (let left = 0; left < ordered.length; left += 1) {
        for (let right = left + 1; right < ordered.length; right += 1) {
          const distance = ordered[right].page! - ordered[left].page!
          if (distance < 2 || distance > 8) continue
          if (taskProfile && (taskEvidenceScore(taskProfile, ordered[left].excerpt) < 4 || taskEvidenceScore(taskProfile, ordered[right].excerpt) < 4)) continue
          const endpointEvidence = proceduralActionScore(ordered[left].excerpt) + proceduralActionScore(ordered[right].excerpt)
            + taskEvidenceScore(taskProfile, ordered[left].excerpt) + taskEvidenceScore(taskProfile, ordered[right].excerpt)
          const score = endpointEvidence * 10 - distance
          if (!bestSpan || score > bestSpan.score) bestSpan = { documentId, start: ordered[left].page!, end: ordered[right].page!, score }
        }
      }
    }
    const additions: ManualSearchHit[] = []
    // A section heading often lands at the bottom of one PDF page while the actual
    // numbered procedure begins on the next pages. Keep that continuous run even
    // when those pages do not repeat the user's search terms verbatim.
    const headingAnchors = [...sources]
      .filter((source) => source.page && proceduralHeadingScore(source.excerpt) > 0)
      .sort((left, right) => (
        proceduralHeadingScore(right.excerpt) * 30 + taskEvidenceScore(taskProfile, right.excerpt) * 8 + proceduralActionScore(right.excerpt)
        - proceduralHeadingScore(left.excerpt) * 30 - taskEvidenceScore(taskProfile, left.excerpt) * 8 - proceduralActionScore(left.excerpt)
      ))
      .slice(0, 1)
    for (const anchor of headingAnchors) {
      for (let page = Math.max(1, anchor.page! - 1); page <= anchor.page! + 4; page += 1) {
        const hit = this.pageContextHit(anchor.documentId, page, anchor.score * 0.9)
        if (hit && !isReferenceOnlyPage(hit.excerpt)) additions.push(hit)
      }
    }
    if (bestSpan) {
      for (let page = bestSpan.start; page <= bestSpan.end; page += 1) {
        const hit = this.pageContextHit(bestSpan.documentId, page, 1 - (page - bestSpan.start) * 0.01)
        if (hit && !isReferenceOnlyPage(hit.excerpt)) additions.push(hit)
      }
    } else {
      const strongest = [...sources].filter((source) => source.page).sort((left, right) => (
        taskEvidenceScore(taskProfile, right.excerpt) + proceduralActionScore(right.excerpt)
        - taskEvidenceScore(taskProfile, left.excerpt) - proceduralActionScore(left.excerpt)
      ))[0]
      if (strongest?.page) {
        for (let page = Math.max(1, strongest.page - 2); page <= strongest.page + 2; page += 1) {
          const hit = this.pageContextHit(strongest.documentId, page, strongest.score * 0.8)
          if (hit && !isReferenceOnlyPage(hit.excerpt) && (taskProfile ? taskEvidenceScore(taskProfile, hit.excerpt) >= 4 : proceduralActionScore(hit.excerpt) > 0)) additions.push(hit)
        }
      }
    }
    const keywords = retrievalKeywords(queries)
    const explicitlyWantsMarkpoint = /(?:标记点|航路点|保存(?:目标|坐标|位置)|MARKPOINT|MARK\s+page)/i.test(question)
    const explicitlyWantsAirLock = /(?:空中目标|敌机|雷达锁定|锁住(?:飞机|敌机)|air\s+target|radar\s+lock|STT)/i.test(question)
    const intentCompatible = (source: ManualSearchHit) => {
      if (taskProfile?.family !== 'helmet-target-designation') return true
      const text = source.excerpt
      const markpointProcedure = /(?:with\s+markpoints|designate\s+a\s+markpoint|MARK\s*\(7\)|标记点创建)/i.test(text)
      const airLockProcedure = /(?:Air\s+Target\s+Radar\s+Lock|AIR[-\s]TO[-\s]AIR|HMCS\s+Lock|STT\s+Radar\s+Lock|AIM-9|missile\s+seeker|seeker\s+FOV|Cage\/Uncage)/i.test(text)
      if (explicitlyWantsMarkpoint) return markpointProcedure
      if (explicitlyWantsAirLock) return airLockProcedure
      return !markpointProcedure && !airLockProcedure
    }
    const compatible = [...additions, ...sources].filter(intentCompatible)
    let bounded = compatible.length > 0 ? compatible : [...additions, ...sources]
    if (taskProfile?.family === 'helmet-target-designation' && !explicitlyWantsAirLock && !explicitlyWantsMarkpoint) {
      const directProcedure = bounded.filter((source) => (
        source.page
        && /(?:Ground\s+Target\s+Designation|JHMCS\s+AIR-TO-GROUND\s+MODE|HMCS\s+Ground\s+Target\s+Designation|With\s+Bombs\s*\((?:DTOS|VIS)\s+Mode\))/i.test(source.excerpt)
      ))
      if (directProcedure.length > 0) {
        const directClusters: ManualSearchHit[][] = []
        for (const source of [...directProcedure].sort((left, right) => (
          left.documentId.localeCompare(right.documentId, 'en') || left.page! - right.page!
        ))) {
          const current = directClusters.at(-1)
          const previous = current?.at(-1)
          if (!current || previous?.documentId !== source.documentId || source.page! - previous.page! > 2) directClusters.push([source])
          else current.push(source)
        }
        const selectedCluster = directClusters.sort((left, right) => (
          right.length - left.length
          || right.reduce((total, source) => total + proceduralHeadingScore(source.excerpt) * 3 + proceduralActionScore(source.excerpt), 0)
            - left.reduce((total, source) => total + proceduralHeadingScore(source.excerpt) * 3 + proceduralActionScore(source.excerpt), 0)
        ))[0]
        const byProcedureDocument = new Map<string, number[]>()
        for (const source of selectedCluster) {
          const pages = byProcedureDocument.get(source.documentId) || []
          pages.push(source.page!)
          byProcedureDocument.set(source.documentId, pages)
        }
        bounded = bounded.filter((source) => {
          if (!source.page) return false
          const pages = byProcedureDocument.get(source.documentId)
          if (!pages) return false
          const start = Math.min(...pages)
          const end = Math.max(...pages)
          return source.page >= start - 1 && source.page <= end + 2
        })
      }
    }
    return [...new Map(bounded.map((source) => {
      const key = source.page ? `${source.documentId}:${source.page}` : source.id
      return [key, { ...source, excerpt: focusedEvidence(source.excerpt, keywords, 3_600) }]
    })).values()].slice(0, ANSWER_SOURCES)
  }

  private completeLongProcedureEvidence(question: string, profile: LongProcedureProfile, sources: ManualSearchHit[], queries: string[]): ManualSearchHit[] {
    type ProcedureCluster = {
      documentId: string
      pages: ManualSearchHit[]
      phases: Set<string>
      authority: number
      chapterSignal: number
      actionSignal: number
      optionalOnly: boolean
      score: number
      sectionFamily: string
    }

    const focusTerms = directQueryFocusTerms(question)
    const seedsByDocument = new Map<string, ManualSearchHit[]>()
    for (const source of sources) {
      if (!source.page) continue
      const group = seedsByDocument.get(source.documentId) || []
      group.push(source)
      seedsByDocument.set(source.documentId, group)
    }

    const clusters: ProcedureCluster[] = []
    for (const [documentId, seeds] of seedsByDocument) {
      const scanned = new Map<number, ManualSearchHit>()
      for (const seed of seeds) {
        for (let offset = -profile.maximumSpan; offset <= profile.maximumSpan; offset += 1) {
          const page = seed.page! + offset
          if (page < 1 || scanned.has(page)) continue
          const hit = this.pageContextHit(documentId, page, seed.score * Math.max(0.55, 1 - Math.abs(offset) * 0.015))
          if (hit) scanned.set(page, hit)
        }
      }

      const semanticAnchors = [...scanned.values()]
        .filter((hit) => !isReferenceOnlyPage(hit.excerpt))
        .filter((hit) => {
          const chapter = procedureChapterSignal(profile, hit.excerpt)
          const phases = procedurePhaseIds(profile, hit.excerpt).size
          const directSubject = directQueryFocusScore(focusTerms, hit.excerpt) > 0
          return chapter > 0 || (directSubject && phases > 0) || (profile.id === 'cold-start' && phases >= 1)
        })
        .sort((left, right) => left.page! - right.page!)
      if (semanticAnchors.length === 0) continue

      const anchorRuns: ManualSearchHit[][] = []
      for (const anchor of semanticAnchors) {
        const current = anchorRuns.at(-1)
        const previousPage = current?.at(-1)?.page
        if (!current || !previousPage || anchor.page! - previousPage > 12) anchorRuns.push([anchor])
        else current.push(anchor)
      }

      for (const run of anchorRuns) {
        const start = Math.max(1, run[0].page! - 1)
        let end = run.at(-1)!.page! + 2
        if (run.length === 1) end = run[0].page! + 6
        if (end - start + 1 > profile.maximumSpan) end = start + profile.maximumSpan - 1
        const pages: ManualSearchHit[] = []
        for (let page = start; page <= end; page += 1) {
          const hit = scanned.get(page) || this.pageContextHit(documentId, page, run[0].score * 0.75)
          if (hit && !isReferenceOnlyPage(hit.excerpt)) pages.push(hit)
        }
        if (pages.length === 0) continue
        const combined = pages.map((page) => page.excerpt).join('\n')
        const phases = procedurePhaseIds(profile, combined)
        const chapterSignal = pages.reduce((total, page) => total + procedureChapterSignal(profile, page.excerpt), 0)
        const actionSignal = pages.reduce((total, page) => total + proceduralActionScore(page.excerpt), 0)
        const optionalOnly = profile.optionalOnlyPattern.test(combined) && phases.size < Math.min(3, profile.phases.length)
        const authority = this.sourceAuthority(pages[0])
        const score = phases.size * 1_000 + chapterSignal * 80 + actionSignal * 4 + Math.min(80, pages.length * 4) - (optionalOnly ? 900 : 0)
        const firstPath = pages.find((page) => page.sectionPath)?.sectionPath || ''
        const pathParts = firstPath.split(' > ')
        const sectionFamily = pathParts.slice(0, Math.min(2, pathParts.length)).join(' > ')
        clusters.push({ documentId, pages, phases, authority, chapterSignal, actionSignal, optionalOnly, score, sectionFamily })
      }
    }

    if (clusters.length === 0) return sources
    const explicitlyRequestsAutomation = /(?:Jester|AI|自动启动|辅助启动|assisted|automatic|auto[\s-]*start)/i.test(question)
    const usable = explicitlyRequestsAutomation ? clusters : clusters.filter((cluster) => !cluster.optionalOnly)
    const ranked = (usable.length > 0 ? usable : clusters).sort((left, right) => (
      right.authority - left.authority
      || right.phases.size - left.phases.size
      || right.score - left.score
    ))
    const primary = ranked[0]
    const compactPages = (pages: ManualSearchHit[], limit = ANSWER_SOURCES) => {
      if (pages.length <= limit) return pages
      const scored = pages.map((page) => ({
        page,
        score: procedurePhaseIds(profile, page.excerpt).size * 20
          + procedureChapterSignal(profile, page.excerpt) * 8
          + proceduralActionScore(page.excerpt) * 3
          + Math.min(4, page.excerpt.length / 900),
      }))
      const mandatory = new Map<string, ManualSearchHit>()
      for (const phase of profile.phases) {
        const best = scored
          .filter((item) => phase.patterns.some((pattern) => pattern.test(item.page.excerpt)))
          .sort((left, right) => right.score - left.score)[0]
        if (best) mandatory.set(`${best.page.documentId}:${best.page.page}`, best.page)
      }
      const last = pages.at(-1)
      if (last) mandatory.set(`${last.documentId}:${last.page}`, last)
      for (const item of scored.sort((left, right) => right.score - left.score)) {
        if (mandatory.size >= limit) break
        mandatory.set(`${item.page.documentId}:${item.page.page}`, item.page)
      }
      return [...mandatory.values()]
        .sort((left, right) => (left.page || 0) - (right.page || 0))
        .slice(0, limit)
    }
    const focusPatterns = longProcedureOutlineFocusPatterns(profile, question)
    const sourceSectionFamily = (source: ManualSearchHit) => {
      const pathParts = (source.sectionPath || '').split(' > ')
      return pathParts.slice(0, Math.min(2, pathParts.length)).join(' > ')
    }
    // Some complementary systems live far away from the main procedure and do
    // not form a dense semantic cluster (C-130 CARP is around p.292 while its
    // Aerial Delivery Panel is around p.49). Preserve structurally matched input
    // sections directly instead of expecting a ±N page scanner to rediscover
    // the relationship.
    const explicitSupplementGroups = new Map<string, ManualSearchHit[]>()
    if (focusPatterns.length > 0) {
      for (const source of sources) {
        const family = sourceSectionFamily(source)
        if (!family || family === primary.sectionFamily) continue
        if (!focusPatterns.some((pattern) => pattern.test(`${source.sectionPath}\n${source.excerpt}`))) continue
        const group = explicitSupplementGroups.get(family) || []
        group.push(source)
        explicitSupplementGroups.set(family, group)
      }
    }
    const explicitSupplements = [...explicitSupplementGroups.values()]
      .map((group) => [...new Map(group.map((source) => [`${source.documentId}:${source.page}`, source])).values()]
        .sort((left, right) => (left.page || 0) - (right.page || 0))
        .slice(0, 3))
      .filter((group) => group.length > 0)
    const reserve = Math.min(6, explicitSupplements.reduce((total, group) => total + group.length, 0))
    const selected = new Map<string, ManualSearchHit>()
    for (const source of compactPages(primary.pages, ANSWER_SOURCES - reserve)) selected.set(`${source.documentId}:${source.page}`, source)
    for (const supplement of explicitSupplements) {
      for (const source of supplement) {
        selected.set(`${source.documentId}:${source.page}`, source)
        if (selected.size >= ANSWER_SOURCES) break
      }
      if (selected.size >= ANSWER_SOURCES) break
    }
    if (process.env.DCSHUB_DEBUG_MANUAL === '1') {
      console.log('[manual-library] long-procedure clusters', {
        profile: profile.id,
        clusters: ranked.map((cluster) => ({ pages: `${cluster.pages[0]?.page}-${cluster.pages.at(-1)?.page}`, phases: [...cluster.phases], family: cluster.sectionFamily })),
        primary: `${primary.pages[0]?.page}-${primary.pages.at(-1)?.page}`,
        complementary: explicitSupplements.map((group) => group.map((page) => page.page)),
        selected: [...selected.values()].map((page) => page.page),
      })
    }

    // A high-priority manual remains the main flow. Lower-priority manuals may
    // only fill lifecycle phases that the primary source genuinely does not
    // contain; optional AI/automatic modes never replace a complete manual flow.
    const covered = new Set(primary.phases)
    for (const supplement of ranked.slice(1)) {
      const contributes = [...supplement.phases].some((phase) => !covered.has(phase))
      if (!contributes) continue
      for (const phase of supplement.phases) covered.add(phase)
      for (const source of supplement.pages) {
        if (selected.size >= ANSWER_SOURCES) break
        selected.set(`${source.documentId}:${source.page}`, source)
      }
      if (covered.size >= profile.phases.length || selected.size >= ANSWER_SOURCES) break
    }

    const keywords = retrievalKeywords([...queries, ...profile.searchQueries])
    return [...selected.values()]
      .sort((left, right) => (
        (left.documentId === primary.documentId ? 0 : 1) - (right.documentId === primary.documentId ? 0 : 1)
        || left.documentId.localeCompare(right.documentId, 'en')
        || (left.page || 0) - (right.page || 0)
      ))
      .slice(0, ANSWER_SOURCES)
      .map((source) => ({ ...source, excerpt: focusedEvidence(source.excerpt, keywords, 3_600) }))
  }

  private expandCandidatePages(ranked: ManualSearchHit[], queries: string[]): ManualSearchHit[] {
    const requested = new Map<string, { documentId: string; page: number; score: number }>()
    const procedural = isProceduralQuestion(queries.join(' '))
    for (const [rank, hit] of ranked.slice(0, 12).entries()) {
      if (!hit.page) continue
      const references = tocReferences(hit.excerpt, queries)
      if (references.length > 0) {
        for (const page of references) {
          for (const targetPage of [page, page + 1]) {
            const key = `${hit.documentId}:${targetPage}`
            const score = hit.score * 1.04
            if (!requested.has(key) || requested.get(key)!.score < score) requested.set(key, { documentId: hit.documentId, page: targetPage, score })
          }
        }
      } else if (rank < 6 && !isReferenceOnlyPage(hit.excerpt)) {
        const offsets = procedural && rank < 4 ? [-3, -2, -1, 1, 2, 3] : [-1, 1]
        for (const offset of offsets) {
          const targetPage = hit.page + offset
          if (targetPage < 1) continue
          const key = `${hit.documentId}:${targetPage}`
          const score = hit.score * (Math.abs(offset) === 1 ? 0.72 : 0.52)
          if (!requested.has(key) || requested.get(key)!.score < score) requested.set(key, { documentId: hit.documentId, page: targetPage, score })
        }
      }
      if (requested.size >= 48) break
    }
    return [...requested.values()]
      .map(({ documentId, page, score }) => this.pageContextHit(documentId, page, score))
      .filter((hit): hit is ManualSearchHit => Boolean(hit))
  }

  private pageContextHit(documentId: string, page: number, score: number): ManualSearchHit | null {
    const document = this.manifest.documents.find((item) => item.id === documentId)
    if (!document || page < 1 || page > document.pageCount) return null
    const chunks = this.loadDocumentChunks(documentId)
    const pageChunks = chunks.filter((chunk) => chunk.page === page).sort((left, right) => {
      const leftPart = Number(left.id.split(':').at(-1))
      const rightPart = Number(right.id.split(':').at(-1))
      return Number.isFinite(leftPart) && Number.isFinite(rightPart) ? leftPart - rightPart : left.id.localeCompare(right.id, 'en')
    })
    if (pageChunks.length === 0) return null
    return {
      id: `${documentId}:page:${page}`,
      documentId,
      documentName: document.name,
      relativePath: document.relativePath,
      sourcePath: document.sourcePath,
      sourceKind: document.sourceKind,
      sourceVersion: document.sourceVersion,
      officialModuleType: document.officialModuleType,
      isTranslation: document.isTranslation,
      translatedFrom: document.translatedFrom,
      classificationConfidence: document.classificationConfidence,
      language: document.language,
      aircraft: document.aircraft,
      page,
      sectionTitle: pageChunks[0].sectionTitle || undefined,
      sectionPath: pageChunks[0].sectionPath || undefined,
      sectionStartPage: pageChunks[0].sectionStartPage || undefined,
      sectionEndPage: pageChunks[0].sectionEndPage || undefined,
      excerpt: mergeOverlappingTexts(pageChunks.map((chunk) => chunk.text)),
      score,
    }
  }

  private async rerankSources(connection: ManualAiConnection, question: string, candidates: ManualSearchHit[], queries: WeightedRetrievalQuery[], coreTaskTerms: string[], taskProfile: TaskSemanticProfile | null, skipLlm = false, protectedCandidateIds = new Set<string>()): Promise<ManualSearchHit[]> {
    if (candidates.length <= 1) return taskProfile && candidates.some((candidate) => taskEvidenceScore(taskProfile, candidate.excerpt) < 6) ? [] : candidates
    const queryTexts = queries.map((query) => query.text)
    const keywords = retrievalKeywords(queryTexts)
    const coreTaskKeywords = retrievalKeywords(coreTaskTerms)
    const procedural = isProceduralQuestion(`${question} ${queryTexts.join(' ')}`)
    const scoredCandidates = candidates.map((candidate, index) => {
      const authority = this.sourceAuthority(candidate)
      const sourceWeight = authority === 400 ? 1.4 : authority === 300 ? 1.2 : authority === 250 ? 1.1 : authority === 200 ? 1.0 : 0.72
      return {
        candidate,
        index,
        evidence: keywordEvidenceScore(candidate.excerpt, keywords) * sourceWeight,
        coreTaskEvidence: keywordEvidenceScore(candidate.excerpt, coreTaskKeywords) * sourceWeight,
        referenceOnly: isReferenceOnlyPage(candidate.excerpt),
        actionEvidence: proceduralActionScore(candidate.excerpt) * sourceWeight,
        taskEvidence: taskEvidenceScore(taskProfile, candidate.excerpt) * sourceWeight,
        headingEvidence: proceduralHeadingScore(candidate.excerpt) * sourceWeight,
      }
    })
    const deterministic = [...scoredCandidates].sort((left, right) => (
      Number(left.referenceOnly) - Number(right.referenceOnly)
      || right.taskEvidence - left.taskEvidence
      || right.coreTaskEvidence - left.coreTaskEvidence
      || right.headingEvidence - left.headingEvidence
      || right.evidence - left.evidence
      || right.actionEvidence - left.actionEvidence
      || right.candidate.score - left.candidate.score
    ))
    const coverageAnchors = [...queries]
      .sort((left, right) => right.weight - left.weight)
      .map((query) => {
        const aspectKeywords = retrievalKeywords([query.text])
        if (aspectKeywords.length === 0) return null
        const rankedForAspect = scoredCandidates
          .filter((item) => !item.referenceOnly)
          .map((item) => ({ ...item, aspectEvidence: keywordEvidenceScore(item.candidate.excerpt, aspectKeywords) }))
          .filter((item) => item.aspectEvidence >= (aspectKeywords.length >= 2 ? 1.5 : 1))
          .sort((left, right) => right.aspectEvidence - left.aspectEvidence || right.evidence - left.evidence || right.candidate.score - left.candidate.score)
        return rankedForAspect[0] || null
      })
      .filter((item): item is (typeof scoredCandidates)[number] & { aspectEvidence: number } => Boolean(item))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.candidate.id === item.candidate.id) === index)
      .slice(0, 6)
    const maximumEvidence = deterministic.find((item) => !item.referenceOnly)?.evidence || 0
    const minimumEvidence = maximumEvidence >= 3 ? Math.max(2.5, maximumEvidence * 0.42) : 0
    const anchors = maximumEvidence >= 2
      ? deterministic.filter((item) => !item.referenceOnly && item.evidence >= maximumEvidence * 0.58).slice(0, ANSWER_SOURCES)
      : deterministic.filter((item) => !item.referenceOnly).slice(0, Math.min(6, ANSWER_SOURCES))
    const protectedCandidates = scoredCandidates.filter((item) => protectedCandidateIds.has(item.candidate.id) && !item.referenceOnly)
    let result = [...new Map([...protectedCandidates, ...coverageAnchors, ...anchors]
      .filter((item) => protectedCandidateIds.has(item.candidate.id) || (item.evidence >= minimumEvidence && (!procedural || item.actionEvidence > 0 || item.evidence >= maximumEvidence * 0.75)))
      .map((item) => [item.candidate.id, item.candidate])).values()]
      .slice(0, ANSWER_SOURCES)
    if (skipLlm || result.length >= Math.max(2, ANSWER_SOURCES * 0.5)) {
      return result.map((candidate) => ({ ...candidate, excerpt: focusedEvidence(candidate.excerpt, keywords, PAGE_CONTEXT_LENGTH - 400) }))
    }
    const candidateSignature = candidates.map((candidate) => candidate.id).join('|')
    const cacheKey = crypto.createHash('sha256').update(`${RETRIEVAL_PIPELINE_VERSION}\n${connection.provider}:${connection.model}\n${this.manifest.lastIndexedAt || ''}\n${question}\n${candidateSignature}`).digest('hex')
    const cachedOrder = this.rerankCache.get(cacheKey)
    if (cachedOrder) {
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
      return cachedOrder.map((id) => byId.get(id)).filter((candidate): candidate is ManualSearchHit => Boolean(candidate)).slice(0, ANSWER_SOURCES)
        .map((candidate) => ({ ...candidate, excerpt: focusedEvidence(candidate.excerpt, keywords, PAGE_CONTEXT_LENGTH - 400) }))
    }
    try {
      const candidateText = scoredCandidates.map(({ candidate, evidence, coreTaskEvidence, taskEvidence }, index) => (
        `[C${index + 1}] [task=${taskEvidence.toFixed(2)} core=${coreTaskEvidence.toFixed(2)} evidence=${evidence.toFixed(2)}] ${candidate.documentName}${candidate.page ? ` · 第 ${candidate.page} 页` : ''}\n${focusedEvidence(candidate.excerpt, [...coreTaskKeywords, ...keywords], 1_200)}`
      )).join('\n\n')
      const content = await this.callAi(connection, [
        { role: 'system', content: `你是 DCS 技术手册检索重排器。根据问题，只选出能够直接回答用户核心任务且互相补充的候选段落，并按答案应使用的顺序排列。core 分数表示页面覆盖核心动作术语的程度。必须优先保留真正讲核心动作的具体步骤、控制项作用、前提、限制和参数；若一套步骤跨页，必须同时保留包含步骤开头、适用模式标题和后续动作的相邻页，不能只取中间一页。开机、装备切换、准备或校准页只能作为补充，不能排在核心操作页之前，也不能在缺少核心操作证据时冒充答案。若“标记目标”可能指目标指定、MARKPOINT 或空中锁定，保留能够区分这些流程的直接证据。丢弃目录、术语表、机型历史、只偶然出现关键词的页面和重复内容；不要为了凑数量保留弱相关段落。只输出 JSON：{"order":["C1","C2"]}，最多 ${ANSWER_SOURCES} 项。` },
        { role: 'user', content: `问题：${question}\n任务族：${taskProfile?.family || '通用'}\n核心任务术语：${coreTaskTerms.join('；') || '未单独识别'}${taskProfile ? `\n稳定任务边界：${taskProfile.evidenceBoundary}` : ''}\n\n候选：\n${candidateText}` },
      ], 250, true, false)
      const parsed = JSON.parse(content) as { order?: unknown }
      const selected = Array.isArray(parsed.order)
        ? parsed.order.map((item) => typeof item === 'string' ? Number(item.replace(/^C/i, '')) - 1 : -1).filter((index) => index >= 0 && index < candidates.length)
        : []
      const selectedCandidates = [...new Set(selected)]
        .map((index) => scoredCandidates[index])
        .filter((item) => item && !item.referenceOnly && item.evidence >= minimumEvidence)
      const combinedCandidates = [...coverageAnchors, ...anchors, ...selectedCandidates]
        .filter((item) => !taskProfile || (item.taskEvidence >= 6 && (!procedural || item.actionEvidence > 0)))
      result = [...new Map(combinedCandidates
        .filter((item) => item.evidence >= minimumEvidence && (!procedural || item.actionEvidence > 0 || item.evidence >= maximumEvidence * 0.75))
        .map((item) => [item.candidate.id, item.candidate])).values()]
        .slice(0, ANSWER_SOURCES)
      const deterministicFallback = deterministic
        .filter((item) => !item.referenceOnly && (!taskProfile || (item.taskEvidence >= 6 && (!procedural || item.actionEvidence > 0))))
        .slice(0, 6)
        .map((item) => item.candidate)
      const fallback = result.length > 0 ? result : deterministicFallback
      this.setBoundedCache(this.rerankCache, cacheKey, fallback.map((candidate) => candidate.id))
      return fallback.map((candidate) => ({ ...candidate, excerpt: focusedEvidence(candidate.excerpt, keywords, PAGE_CONTEXT_LENGTH - 400) }))
    } catch {
      return deterministic.filter((item) => !item.referenceOnly && (!taskProfile || (item.taskEvidence >= 6 && (!procedural || item.actionEvidence > 0)))).slice(0, 6)
        .map(({ candidate }) => ({ ...candidate, excerpt: focusedEvidence(candidate.excerpt, keywords, PAGE_CONTEXT_LENGTH - 400) }))
    }
  }

  async configureDeepSeek(apiKey: string): Promise<ManualLibraryOverview> {
    return this.configureAiProvider('deepseek', apiKey)
  }

  clearDeepSeek(): ManualLibraryOverview {
    return this.clearAiProvider('deepseek')
  }

  async testDeepSeek(apiKey?: string): Promise<ManualOperationResult> {
    return this.testAiProvider('deepseek', apiKey)
  }

  async configureAiProvider(provider: ManualAiProvider, apiKey: string, baseUrl?: string): Promise<ManualLibraryOverview> {
    const cleaned = apiKey.trim()
    if (cleaned.length < 10 || cleaned.length > 512) throw new Error(`${MANUAL_AI_PROVIDER_NAMES[provider]} API Key 格式无效`)
    if (!this.protector.available()) throw new Error('当前系统无法安全加密 API Key，已拒绝明文保存')
    const resolvedBaseUrl = this.normalizeProviderBaseUrl(provider, baseUrl)
    await this.testAiProvider(provider, cleaned, resolvedBaseUrl)
    const firstProvider = !Object.values(this.settings.providerCredentials).some((credential) => Boolean(credential?.apiKey))
    this.settings.providerCredentials[provider] = { apiKey: this.protector.protect(cleaned), baseUrl: resolvedBaseUrl }
    if (firstProvider) {
      this.settings.localAi = provider === 'deepseek'
        ? { ...DEFAULT_LOCAL_AI }
        : { provider, model: MANUAL_AI_DEFAULT_MODELS[provider].local, thinkingLevel: 'medium' }
      if (providerSupportsOnlineSearch(provider)) {
        this.settings.onlineAi = provider === 'deepseek'
          ? { ...DEFAULT_ONLINE_AI }
          : { provider, model: MANUAL_AI_DEFAULT_MODELS[provider].online, thinkingLevel: 'max' }
      }
    }
    this.settings.version = 4
    this.saveSettings()
    return this.overview()
  }

  clearAiProvider(provider: ManualAiProvider): ManualLibraryOverview {
    delete this.settings.providerCredentials[provider]
    this.saveSettings()
    return this.overview()
  }

  async testAiProvider(provider: ManualAiProvider, apiKey?: string, baseUrl?: string): Promise<ManualOperationResult> {
    const credential = this.settings.providerCredentials[provider]
    const key = apiKey?.trim() || (credential?.apiKey ? this.protector.unprotect(credential.apiKey) : '')
    if (!key) throw new Error(`请先填写 ${MANUAL_AI_PROVIDER_NAMES[provider]} API Key`)
    const stage = this.settings.localAi.provider === provider
      ? this.settings.localAi
      : { provider, model: MANUAL_AI_DEFAULT_MODELS[provider].local, thinkingLevel: provider === 'deepseek' ? 'off' as const : 'medium' as const }
    const connection: ManualAiConnection = {
      ...stage,
      apiKey: key,
      baseUrl: this.normalizeProviderBaseUrl(provider, baseUrl || credential?.baseUrl),
    }
    await this.callAi(connection, [
      { role: 'system', content: '只回复 OK。' },
      { role: 'user', content: '测试连接' },
    ], 8, false, false)
    return { ok: true, message: `${MANUAL_AI_PROVIDER_NAMES[provider]} 连接成功` }
  }

  setAiStageSettings(stage: ManualAiStage, settings: ManualAiStageSettings): ManualLibraryOverview {
    const normalized = this.normalizeAiStageSettings(stage, settings)
    if (!this.settings.providerCredentials[normalized.provider]?.apiKey) throw new Error(`请先配置 ${MANUAL_AI_PROVIDER_NAMES[normalized.provider]} API Key`)
    if (stage === 'local') this.settings.localAi = normalized
    else this.settings.onlineAi = normalized
    this.clearAnswerCache()
    this.clearOnlineAnswerCache()
    this.settings.version = 4
    this.saveSettings()
    return this.overview()
  }

  async listAiProviderModels(provider: ManualAiProvider): Promise<string[]> {
    const credential = this.settings.providerCredentials[provider]
    if (!credential?.apiKey) return [MANUAL_AI_DEFAULT_MODELS[provider].local]
    const connection: ManualAiConnection = {
      provider,
      model: MANUAL_AI_DEFAULT_MODELS[provider].local,
      thinkingLevel: 'off',
      apiKey: this.protector.unprotect(credential.apiKey),
      baseUrl: credential.baseUrl || MANUAL_AI_DEFAULT_BASE_URLS[provider],
    }
    return this.deepSeekClient.listModels(connection)
  }

  async askOnline(question: string, answerLanguage: ManualAnswerLanguage = 'zh'): Promise<ManualOnlineSearchAnswer> {
    const cleaned = normalizeQuestionInput(question).slice(0, 2_000)
    if (!cleaned) throw new Error('请输入问题')
    const cacheKey = this.onlineAnswerCacheKey(cleaned, answerLanguage)
    const cached = this.onlineAnswerCache.get(cacheKey)
    if (cached) {
      if (process.env.DCSHUB_DEBUG_MANUAL === '1') console.log('[manual-library] Online cache hit')
      return { ...structuredClone(cached.answer), cached: true }
    }
    const connection = this.readAiConnection('online')
    const semanticContext = deterministicQuestionSemantics(cleaned)
    const taskProfile = detectTaskSemanticProfile(cleaned)
    const weaponVariantInstruction = weaponVariantAnswerInstruction(cleaned)
    const researchQuestion = [
      `用户原始问题：${cleaned}`,
      semanticContext,
      taskProfile?.evidenceBoundary ? `任务边界：${taskProfile.evidenceBoundary}` : '',
      weaponVariantInstruction ? `武器型号边界：${weaponVariantInstruction}` : '',
      '请直接联网检索并生成最终答案，不要先输出检索计划、术语分析或中间草稿。',
    ].filter(Boolean).join('\n\n')
    const online = await this.deepSeekClient.onlineSearch(
      connection,
      researchQuestion,
      `你是 DCS World 技术资料在线研究助手。DCSHUB 已在本地完成机型、武器、弹药、系统术语和任务意图的确定性归一，不需要再调用模型做一次问题改写。必须在同一次请求中完成联网检索、来源核对和最终答案生成。优先采用 Eagle Dynamics 官方手册、官方更新日志、官方论坛和模组开发者的一手资料；社区资料只能作为补充并明确标注。${languageInstruction(answerLanguage)}\n\n${MANUAL_ANSWER_STYLE_GUIDE}\n\n${MANUAL_ANSWER_STRUCTURE_GUIDE}\n\n${DCS_TERMINOLOGY_ROLE_GUIDE}\n\n${weaponVariantInstruction}\n\n以本地语义解析给出的规范型号作为主要搜索词，同时保留用户原始叫法。若只给出武器家族或同时存在多个具体型号，必须按型号和制导方式分场景回答；若明确具体型号，只回答该型号，禁止混入同族其他型号的操作。区分游戏版本和现实航空资料，不要把其他机型的按键或系统术语混入。所有关键结论都附可点击的 Markdown 来源链接；若网络证据互相冲突，说明冲突和适用版本。`,
    )
    const result = { ...online, answer: ensureManualAnswerStructure(online.answer), model: connection.model, cached: false }
    this.cacheOnlineAnswer(cacheKey, result)
    return result
  }

  chuckCatalog(): ChuckGuideCatalogItem[] {
    const libraryPath = this.settings.libraryPath
    const installedNames = new Set<string>()
    if (libraryPath) {
      const chuckPath = path.join(libraryPath, "Chuck's Guides")
      try {
        for (const entry of fs.readdirSync(chuckPath, { withFileTypes: true })) if (entry.isFile()) installedNames.add(entry.name.toLocaleLowerCase())
      } catch { /* Empty catalog. */ }
    }
    return CHUCK_GUIDES.map((guide) => ({
      ...guide,
      installed: [...installedNames].some((name) => name.startsWith(`${guide.id.toLocaleLowerCase()} - `)),
    }))
  }

  async downloadChuckGuide(guideId: string): Promise<ManualOperationResult> {
    const guide = CHUCK_GUIDES.find((item) => item.id === guideId)
    if (!guide) throw new Error('未知 Chuck 手册')
    return this.downloadChuckGuides([guide], false)
  }

  async downloadSelectedChuckGuides(guideIds: string[]): Promise<ManualOperationResult> {
    const guides = CHUCK_GUIDES.filter((guide) => guideIds.includes(guide.id))
    if (guides.length === 0) throw new Error('未选择要下载的手册')
    return this.downloadChuckGuides(guides, false)
  }

  async downloadAllChuckGuides(): Promise<ManualOperationResult> {
    const missingIds = new Set(this.chuckCatalog().filter((guide) => !guide.installed).map((guide) => guide.id))
    const guides = CHUCK_GUIDES.filter((guide) => missingIds.has(guide.id))
    if (guides.length === 0) return { ok: true, message: '所有 Chuck 手册均已入库', overview: this.overview() }
    return this.downloadChuckGuides(guides, true)
  }

  private async downloadChuckGuides(guides: ReadonlyArray<Omit<ChuckGuideCatalogItem, 'installed'>>, continueOnError: boolean): Promise<ManualOperationResult> {
    const failures: string[] = []
    let downloaded = 0
    for (let index = 0; index < guides.length; index += 1) {
      const guide = guides[index]
      try {
        await this.downloadChuckGuideFile(guide, index, guides.length)
        downloaded += 1
      } catch (error) {
        if (!continueOnError) throw error
        failures.push(`${guide.displayName}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const indexed = downloaded > 0
      ? await this.startRebuild(false, 'chuck-download', 78, 100)
      : { ok: failures.length === 0, message: failures.join('；'), overview: this.overview() }
    const ok = indexed.ok && failures.length === 0
    const message = failures.length > 0
      ? `已下载 ${downloaded}/${guides.length} 份 Chuck 手册；${failures.length} 份失败`
      : guides.length === 1
        ? `${guides[0].displayName} 已下载并加入手册库`
        : `已下载全部 ${downloaded} 份缺失的 Chuck 手册`
    this.reportProgress('chuck-download', 'complete', guides.length, guides.length, 100, message)
    return { ok, message, overview: this.overview() }
  }

  private async downloadChuckGuideFile(guide: Omit<ChuckGuideCatalogItem, 'installed'>, guideIndex: number, guideCount: number): Promise<void> {
    const libraryPath = this.requireLibraryPath()
    const basePercent = (guideIndex / Math.max(1, guideCount)) * 75
    const guideSpan = 75 / Math.max(1, guideCount)
    this.reportProgress('chuck-download', 'downloading', guideIndex, guideCount, basePercent, `正在读取 Chuck 手册页面 ${guideIndex + 1}/${guideCount}`, guide.displayName)
    const pageResponse = await this.fetchWithTimeout(guide.pageUrl, { headers: { 'User-Agent': 'DCSHUB/1.8.12 manual-library' } }, 30_000)
    if (!pageResponse.ok) throw new Error(`无法读取 Chuck 手册页面（HTTP ${pageResponse.status}）`)
    const html = await pageResponse.text()
    const rawUrl = html.match(/https:\/\/assets\.chucksguides\.com\/pdf\/[^"'<>\s]+\.pdf(?:\?[^"'<>\s]*)?/i)?.[0]
      || html.match(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i)?.[1]
    if (!rawUrl) throw new Error('Chuck 官方页面中没有找到 PDF 下载地址')
    const pdfUrl = new URL(decodeEntities(rawUrl), guide.pageUrl)
    if (pdfUrl.protocol !== 'https:' || pdfUrl.hostname !== 'assets.chucksguides.com') throw new Error('Chuck 手册下载地址未通过安全检查')
    const originalName = safeFileName(decodeURIComponent(path.basename(pdfUrl.pathname)))
    const destinationDirectory = path.join(libraryPath, "Chuck's Guides")
    const destinationPath = path.join(destinationDirectory, `${guide.id} - ${originalName}`)
    fs.mkdirSync(destinationDirectory, { recursive: true })
    const response = await this.fetchWithTimeout(pdfUrl.toString(), { headers: { 'User-Agent': 'DCSHUB/1.8.12 manual-library' } }, 180_000)
    if (!response.ok || !response.body) throw new Error(`Chuck 手册下载失败（HTTP ${response.status}）`)
    const contentLength = Number(response.headers.get('content-length')) || 0
    const temporaryPath = `${destinationPath}.download`
    try {
      const handle = await fs.promises.open(temporaryPath, 'w')
      try {
        const reader = response.body.getReader()
        let downloaded = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          downloaded += value.byteLength
          if (downloaded > 750 * 1024 * 1024) throw new Error('Chuck 手册超过 750 MB 安全限制')
          await handle.write(value)
          const fileProgress = contentLength > 0 ? Math.min(1, downloaded / contentLength) : 0.45
          this.reportProgress('chuck-download', 'downloading', guideIndex, guideCount, basePercent + fileProgress * guideSpan, `正在下载 Chuck 手册 ${guideIndex + 1}/${guideCount}`, guide.displayName)
        }
      } finally {
        await handle.close()
      }
      const signature = Buffer.alloc(4)
      const descriptor = fs.openSync(temporaryPath, 'r')
      try { fs.readSync(descriptor, signature, 0, 4, 0) } finally { fs.closeSync(descriptor) }
      if (signature.toString('ascii') !== '%PDF') throw new Error('下载内容不是有效的 PDF 文件')
      for (const entry of fs.readdirSync(destinationDirectory, { withFileTypes: true })) {
        const entryPath = path.join(destinationDirectory, entry.name)
        if (entry.isFile() && entryPath !== temporaryPath && entry.name.toLocaleLowerCase().startsWith(`${guide.id.toLocaleLowerCase()} - `)) {
          fs.rmSync(entryPath, { force: true })
        }
      }
      fs.renameSync(temporaryPath, destinationPath)
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true })
      throw error
    }
    this.reportProgress('chuck-download', 'downloading', guideIndex + 1, guideCount, basePercent + guideSpan, `Chuck 手册已下载 ${guideIndex + 1}/${guideCount}`, guide.displayName)
  }

  documentPath(documentId: string): string {
    const document = this.manifest.documents.find((item) => item.id === documentId)
    if (!document) throw new Error('手册不存在或已经移除')
    return document.sourcePath
  }

  async pagePreview(documentId: string, pageNumber: number): Promise<ManualPagePreview | null> {
    const document = this.manifest.documents.find((item) => item.id === documentId)
    if (!document) return null
    const fingerprint = this.manifest.files[document.relativePath]?.sha256 || String(fs.statSync(document.sourcePath).mtimeMs)
    return this.previewCache.render(document, pageNumber, fingerprint)
  }

  async askWithScreenshot(_question: string, _imageDataUrl: string): Promise<ManualQuestionAnswer> {
    void _question
    void _imageDataUrl
    throw new Error('截图提问接口已经预留；当前版本暂未开放图片识别')
  }

  private reportProgress(operation: ManualLibraryProgressOperation, stage: ManualLibraryProgress['stage'], current: number, total: number, percent: number, message: string, itemName?: string): void {
    const progress: ManualLibraryProgress = {
      operation,
      stage,
      current,
      total,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      ...(itemName ? { itemName } : {}),
    }
    this.currentProgress = progress
    this.progressReporter(progress)
    if (stage === 'complete' || percent >= 100) {
      setTimeout(() => { if (this.currentProgress === progress) this.currentProgress = null }, 3000)
    }
  }

  currentOperationProgress(): ManualLibraryProgress | null {
    return this.currentProgress
  }

  private async performRebuild(force: boolean, operation: ManualLibraryProgressOperation, startPercent: number, endPercent: number, sourceKind: ManualSourceKind): Promise<ManualOperationResult> {
    try {
      const libraryPath = this.requireLibraryPath()
      const scale = (progress: number) => startPercent + (endPercent - startPercent) * progress
      this.reportProgress(operation, 'scanning', 0, 1, scale(0), '正在扫描手册目录…')
      await yieldToEventLoop()
      const previousFiles = this.manifest.files
      const previousDocuments = new Map(this.manifest.documents.map((document) => [document.relativePath, document]))
      const nextFiles: Record<string, FileFingerprint> = Object.fromEntries(Object.entries(previousFiles).filter(([relativePath]) => this.storageKindFor(relativePath) !== sourceKind))
      const nextDocuments: ManualDocumentRecord[] = this.manifest.documents.filter((document) => this.storageKindFor(document.relativePath) !== sourceKind)
      const allChunks: SearchableChunk[] = []
      const sourcePaths = this.walkSupportedFiles(libraryPath).filter((sourcePath) => {
        const relativePath = normalizeRelative(path.relative(libraryPath, sourcePath))
        return this.storageKindFor(relativePath) === sourceKind && (sourceKind !== 'dcs' || isEnglishDcsManual(relativePath))
      })
      this.reportProgress(operation, 'hashing', 0, sourcePaths.length, scale(0.04), `发现 ${sourcePaths.length} 份手册，正在检查文件变化…`)
      const preflightFiles: Record<string, FileFingerprint> = {}
      const previousSourceFileCount = Object.keys(previousFiles).filter((relativePath) => this.storageKindFor(relativePath) === sourceKind).length
      const sourceIndexPath = this.indexPaths[sourceKind]
      const metadataNeedsRefresh = this.manifest.sourceMetadataVersions?.[sourceKind] !== SOURCE_METADATA_VERSION
      let hasContentChanges = force || metadataNeedsRefresh || sourcePaths.length !== previousSourceFileCount || !fs.existsSync(sourceIndexPath)
      for (let index = 0; index < sourcePaths.length; index += 1) {
        const sourcePath = sourcePaths[index]
        this.reportProgress(operation, 'hashing', index, sourcePaths.length, scale(0.04 + (index / Math.max(1, sourcePaths.length)) * 0.18), `正在检查手册 ${index + 1}/${sourcePaths.length}`, path.basename(sourcePath))
        const stat = fs.statSync(sourcePath)
        const relativePath = normalizeRelative(path.relative(libraryPath, sourcePath))
        const previous = previousFiles[relativePath]
        const cacheId = crypto.createHash('sha1').update(relativePath.toLocaleLowerCase()).digest('hex')
        const cachePath = path.join(this.documentCachePath, `${cacheId}.json.gz`)
        const metadataUnchanged = !force && previous && previous.size === stat.size && Math.abs(previous.mtimeMs - stat.mtimeMs) < 1 && fs.existsSync(cachePath)
        const fingerprint: FileFingerprint = metadataUnchanged
          ? previous
          : { relativePath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: await hashFile(sourcePath) }
        preflightFiles[relativePath] = fingerprint
        if (force || !previous || previous.sha256 !== fingerprint.sha256 || !fs.existsSync(cachePath)) hasContentChanges = true
        await yieldToEventLoop()
      }
      if (!hasContentChanges) {
        this.manifest.files = { ...nextFiles, ...preflightFiles }
        this.saveManifest()
        this.reportProgress(operation, 'complete', sourcePaths.length, sourcePaths.length, endPercent, '手册没有变化，已加载本地索引缓存')
        return { ok: true, message: '手册没有变化，已直接使用永久索引缓存', overview: this.overview() }
      }
      for (let index = 0; index < sourcePaths.length; index += 1) {
        const sourcePath = sourcePaths[index]
        this.reportProgress(operation, 'parsing', index, sourcePaths.length, scale(0.22 + (index / Math.max(1, sourcePaths.length)) * 0.63), `正在解析手册 ${index + 1}/${sourcePaths.length}`, path.basename(sourcePath))
        const stat = fs.statSync(sourcePath)
        const relativePath = normalizeRelative(path.relative(libraryPath, sourcePath))
        const previous = previousFiles[relativePath]
        const cacheId = crypto.createHash('sha1').update(relativePath.toLocaleLowerCase()).digest('hex')
        const cachePath = path.join(this.documentCachePath, `${cacheId}.json.gz`)
        const fingerprint = preflightFiles[relativePath]
        const unchanged = !force && !metadataNeedsRefresh && previous?.sha256 === fingerprint.sha256 && fs.existsSync(cachePath)
        nextFiles[relativePath] = fingerprint
        let document = unchanged ? previousDocuments.get(relativePath) : undefined
        let chunks: SearchableChunk[] = []
        if (unchanged && document) {
          chunks = this.storage.readCompressedJson<SearchableChunk[]>(cachePath)
        } else {
          const id = cacheId
          const storageKind = this.storageKindFor(relativePath)
          try {
            const parsed = await this.documentParser.parse(sourcePath)
            const sample = parsed.pages.map((page) => page.text).join('\n').slice(0, 80_000)
            const language = detectLanguage(sample)
            const aircraft = detectAircraft(relativePath, sample)
            const classification = classifyManualSource({ relativePath, contentSample: sample, language, aircraft, storageKind })
            const metadata = {
              documentId: id,
              documentName: path.basename(sourcePath),
              relativePath,
              sourcePath,
              ...classification,
              language,
              aircraft,
            }
            chunks = chunkPages(id, metadata, parsed.pages, parsed.outline)
            document = {
              id,
              name: path.basename(sourcePath),
              relativePath,
              sourcePath,
              ...classification,
              extension: path.extname(sourcePath).toLocaleLowerCase(),
              language,
              aircraft,
              size: stat.size,
              modifiedAt: new Date(stat.mtimeMs).toISOString(),
              indexedAt: new Date().toISOString(),
              pageCount: Math.max(1, parsed.pages.filter((page) => page.text.trim()).length),
              chunkCount: chunks.length,
            }
          } catch (error) {
            document = {
              id,
              name: path.basename(sourcePath),
              relativePath,
              sourcePath,
              sourceKind: 'user',
              sourceVersion: null,
              officialModuleType: null,
              isTranslation: false,
              translatedFrom: null,
              classificationConfidence: 'low',
              extension: path.extname(sourcePath).toLocaleLowerCase(),
              language: 'unknown',
              aircraft: detectAircraft(relativePath),
              size: stat.size,
              modifiedAt: new Date(stat.mtimeMs).toISOString(),
              indexedAt: new Date().toISOString(),
              pageCount: 0,
              chunkCount: 0,
              error: error instanceof Error ? error.message : String(error),
            }
          }
          this.storage.writeCompressedJson(cachePath, chunks)
        }
        if (document) {
          // Re-evaluate metadata even when parsed chunks came from an older cache.
          // This upgrades incorrect cross-aircraft labels without reparsing PDFs.
          const contentSample = chunks.slice(0, 24).map((chunk) => chunk.text).join('\n').slice(0, 80_000)
          const aircraft = detectAircraft(relativePath, contentSample)
          const language = document.language === 'unknown' ? detectLanguage(contentSample) : document.language
          const classification = classifyManualSource({
            relativePath,
            contentSample,
            language,
            aircraft,
            storageKind: this.storageKindFor(relativePath),
          })
          document = { ...document, aircraft, language, ...classification }
          chunks = chunks.map((chunk) => ({ ...chunk, aircraft, language, ...classification }))
          nextDocuments.push(document)
        }
        allChunks.push(...chunks)
        await yieldToEventLoop()
      }
      this.reportProgress(operation, 'building', sourcePaths.length, sourcePaths.length, scale(0.9), `正在生成检索索引（${allChunks.length} 个片段）…`)
      await yieldToEventLoop()
      const index = createSearchDatabase()
      if (allChunks.length > 0) insertMultiple(index, allChunks.map((chunk) => ({
        ...chunk,
        aircraft: chunk.aircraft || '',
        aircraftKey: chunk.aircraft || '__unclassified__',
        sourceVersion: chunk.sourceVersion || '',
        officialModuleType: chunk.officialModuleType || '__not-official__',
        isTranslation: String(chunk.isTranslation),
        translatedFrom: chunk.translatedFrom || 'none',
        page: chunk.page || 0,
      })))
      this.reportProgress(operation, 'saving', sourcePaths.length, sourcePaths.length, scale(0.97), '正在保存本地索引缓存…')
      await yieldToEventLoop()
      this.storage.writeCompressedJson(sourceIndexPath, save(index))
      this.searchIndexes.set(sourceKind, index)
      this.expandedQueryCache.clear()
      this.rerankCache.clear()
      this.documentChunksCache.clear()
      this.clearAnswerCache()
      this.manifest = {
        version: MANIFEST_VERSION,
        lastIndexedAt: new Date().toISOString(),
        files: nextFiles,
        documents: nextDocuments,
        sourceMetadataVersions: {
          ...this.manifest.sourceMetadataVersions,
          [sourceKind]: SOURCE_METADATA_VERSION,
        },
      }
      this.saveManifest()
      this.removeOrphanCaches(new Set(nextDocuments.map((document) => `${document.id}.json.gz`)))
      this.reportProgress(operation, 'complete', sourcePaths.length, sourcePaths.length, endPercent, `索引完成：${nextDocuments.length} 份手册`)
      return { ok: true, message: `索引完成：${nextDocuments.length} 份手册，${allChunks.length} 个永久检索片段`, overview: this.overview() }
    } catch (error) {
      this.indexError = error instanceof Error ? error.message : String(error)
      return { ok: false, message: this.indexError, overview: this.overview() }
    }
  }

  private async interpretQuestion(connection: ManualAiConnection, question: string, availableAircraft: string[], deterministicAircraft: string[]): Promise<QueryInterpretation> {
    const catalogSignature = crypto.createHash('sha1').update(availableAircraft.sort().join('\n')).digest('hex').slice(0, 12)
    const cacheKey = `semantic-${RETRIEVAL_PIPELINE_VERSION}:${connection.provider}:${connection.model}:${catalogSignature}:${question.normalize('NFKC').toLocaleLowerCase().trim()}`
    const cached = this.expandedQueryCache.get(cacheKey)
    if (cached) return cached
    const localTerms = detectDomainTerms(question).map((term) => `${term.canonical}: ${term.searchTerms}`)
    const fallback: QueryInterpretation = {
      queries: buildDomainSearchQueries(question),
      coreTaskTerms: deterministicCoreTaskTerms(question),
      subIntents: deterministicSubIntents(question),
      aircraftCandidates: deterministicAircraft,
      aircraftMentioned: deterministicAircraft.length > 0,
      confidence: deterministicAircraft.length > 0 ? 1 : 0,
      canonicalTerms: detectDomainTerms(question).map((term) => term.canonical),
      intent: question,
    }
    try {
      const content = await this.callAi(connection, [
        {
          role: 'system',
          content: `你是 DCS World、军用航空和现代空战领域的结构化检索路由器。用户可能是新手，会使用中文名称、机型绰号、玩家俗称、音译、错别字、现象描述或不完整的系统名称。识别他明确或隐含询问的机型、系统和实际任务，并转换为适合英文/中文飞行手册全文检索的互补查询；增删“目标”“操作”“功能”等普通词不得把同一任务改路由。aircraftCandidates 只能优先使用“当前资料库机型”中的标准名称；若用户明确询问的机型不在列表中，仍原样输出该机型，以便系统报告资料缺失，绝不能替换成相似机型。比较问题可以输出多个机型。aircraftMentioned 仅表示问题是否确实指向某个机型；泛化问题必须为 false。confidence 是机型识别置信度 0 到 1。coreTaskTerms 只写回答用户核心动作不可缺少的英文标准章节名、动作和控制项。subIntents 用于真正存在多种合法操作含义的模糊提问：每个分支给出简短中文 label、明确 intent、专属 coreTaskTerms 和 queries；用户已经明确模式或结果时不得制造伪歧义，用户表述宽泛时应覆盖手册可能支持的全部独立含义。对于“头盔标记目标”但未说明目标类型的提问，应分别检索空对空目标获取/锁定、空对地目标指定和保存 MARKPOINT，并由后续流程只保留实际找到手册证据的场景。${DCS_TERMINOLOGY_ROLE_GUIDE} queries 描述任务、系统、面板、控制项、前提、完整步骤、成功判断、限制、故障现象和可能的章节标题，不要在每条 queries 中重复机型名称，因为系统会单独限定机型文档。查询应包含若干短而明确的标准术语，并覆盖英文缩写、完整系统名、章节名和操作表达，最多 10 项，每项不超过 180 字。只输出 JSON：{"aircraftCandidates":["AH-64D"],"aircraftMentioned":true,"confidence":0.95,"canonicalTerms":["CPG","line of sight"],"coreTaskTerms":["Player-as-CPG AI Helper Controls"],"subIntents":[{"label":"场景名称","intent":"独立任务","coreTaskTerms":["标准章节或动作"],"queries":["专属检索词"]}],"intent":"...","queries":["..."]}。没有真实歧义时 subIntents 必须为空数组；最多输出 4 个分支。`,
        },
        {
          role: 'user',
          content: `用户问题：${question}\n当前资料库机型：${availableAircraft.length > 0 ? availableAircraft.join('、') : '无'}\n本地已识别机型：${deterministicAircraft.length > 0 ? deterministicAircraft.join('、') : '无'}\n本地术语本体：${localTerms.length > 0 ? localTerms.join('；') : '无；请根据 DCS 和军事航空知识推断'}`,
        },
      ], 800, true, false)
      const parsed = JSON.parse(content) as Record<string, unknown>
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 180)).slice(0, 10)
        : []
      const aircraftCandidates = Array.isArray(parsed.aircraftCandidates)
        ? parsed.aircraftCandidates.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 80)).slice(0, 6)
        : []
      const canonicalTerms = Array.isArray(parsed.canonicalTerms)
        ? parsed.canonicalTerms.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 100)).slice(0, 12)
        : []
      const parsedCoreTaskTerms = Array.isArray(parsed.coreTaskTerms)
        ? parsed.coreTaskTerms.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 140)).slice(0, 10)
        : []
      const parsedSubIntents = Array.isArray(parsed.subIntents)
        ? parsed.subIntents.flatMap((item): QuerySubIntent[] => {
            if (!item || typeof item !== 'object') return []
            const candidate = item as Record<string, unknown>
            const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, 100) : ''
            const intent = typeof candidate.intent === 'string' ? candidate.intent.trim().slice(0, 300) : ''
            const coreTaskTerms = Array.isArray(candidate.coreTaskTerms)
              ? candidate.coreTaskTerms.filter((term): term is string => typeof term === 'string').map((term) => term.slice(0, 140)).slice(0, 8)
              : []
            const queries = Array.isArray(candidate.queries)
              ? candidate.queries.filter((query): query is string => typeof query === 'string').map((query) => query.slice(0, 180)).slice(0, 8)
              : []
            return label && intent && (queries.length > 0 || coreTaskTerms.length > 0) ? [{ label, intent, queries, coreTaskTerms }] : []
          }).slice(0, 4)
        : []
      const subIntents = detectTaskSemanticProfile(question)?.family === 'helmet-target-designation'
        ? fallback.subIntents
        : parsedSubIntents.length >= 2 ? parsedSubIntents : fallback.subIntents
      const interpretation: QueryInterpretation = {
        queries: queries.length > 0 ? queries : fallback.queries,
        coreTaskTerms: [...new Set([...fallback.coreTaskTerms, ...parsedCoreTaskTerms])],
        subIntents,
        aircraftCandidates: [...new Set([...deterministicAircraft, ...aircraftCandidates])],
        aircraftMentioned: deterministicAircraft.length > 0 || parsed.aircraftMentioned === true,
        confidence: deterministicAircraft.length > 0 ? 1 : Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        canonicalTerms,
        intent: typeof parsed.intent === 'string' ? parsed.intent.slice(0, 500) : question,
      }
      this.setBoundedCache(this.expandedQueryCache, cacheKey, interpretation)
      return interpretation
    } catch {
      return fallback
    }
  }

  private setBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
    if (cache.size >= 100) cache.delete(cache.keys().next().value as string)
    cache.set(key, value)
  }

  private async callAi(
    connection: ManualAiConnection,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens: number,
    json = false,
    allowThinking = true,
  ): Promise<string> {
    return this.deepSeekClient.chat(connection, messages, maxTokens, json, allowThinking)
  }

  private fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }

  private normalizeProviderBaseUrl(provider: ManualAiProvider, value?: string): string {
    const normalized = (value || MANUAL_AI_DEFAULT_BASE_URLS[provider]).trim().replace(/\/+$/, '')
    let parsed: URL
    try { parsed = new URL(normalized) } catch { throw new Error('API 地址格式无效') }
    if (parsed.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS')
    if (parsed.username || parsed.password) throw new Error('API 地址不能包含账号或密码')
    return normalized
  }

  private normalizeAiStageSettings(stage: ManualAiStage, settings: ManualAiStageSettings): ManualAiStageSettings {
    if (settings.provider === 'deepseek') return stage === 'local' ? { ...DEFAULT_LOCAL_AI } : { ...DEFAULT_ONLINE_AI }
    if (stage === 'online' && !providerSupportsOnlineSearch(settings.provider)) throw new Error(`${MANUAL_AI_PROVIDER_NAMES[settings.provider]} 当前不支持原生联网搜索`)
    const model = settings.model.trim()
    if (model.length < 2 || model.length > 200) throw new Error('模型名称格式无效')
    const thinkingLevel = ['off', 'low', 'medium', 'high', 'max'].includes(settings.thinkingLevel) ? settings.thinkingLevel : 'medium'
    return { provider: settings.provider, model, thinkingLevel }
  }

  private readAiConnection(stage: ManualAiStage): ManualAiConnection {
    const settings = stage === 'local' ? this.settings.localAi : this.settings.onlineAi
    const credential = this.settings.providerCredentials[settings.provider]
    if (!credential?.apiKey) throw new Error(`请先配置 ${MANUAL_AI_PROVIDER_NAMES[settings.provider]} API Key`)
    try {
      return {
        ...settings,
        apiKey: this.protector.unprotect(credential.apiKey),
        baseUrl: credential.baseUrl || MANUAL_AI_DEFAULT_BASE_URLS[settings.provider],
      }
    } catch {
      throw new Error(`${MANUAL_AI_PROVIDER_NAMES[settings.provider]} API Key 无法解密，请重新填写`)
    }
  }

  private loadSearchIndex(sourceKind: ManualSourceKind): ManualSearchDatabase | null {
    const loaded = this.searchIndexes.get(sourceKind)
    if (loaded) return loaded
    try {
      const index = createSearchDatabase()
      load(index, this.storage.readCompressedJson(this.indexPaths[sourceKind]))
      this.searchIndexes.set(sourceKind, index)
      return index
    } catch {
      return null
    }
  }

  private storageKindFor(relativePath: string): ManualSourceKind {
    const normalized = relativePath.toLocaleLowerCase()
    if (normalized.startsWith('dcs manuals/')) return 'dcs'
    if (normalized.startsWith("chuck's guides/")) return 'chuck'
    return 'user'
  }

  private walkSupportedFiles(root: string): string[] {
    const result: string[] = []
    const pending = [root]
    while (pending.length > 0) {
      const current = pending.pop()!
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.endsWith('.download')) continue
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) pending.push(entryPath)
        else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase())) result.push(entryPath)
      }
    }
    return result.sort((left, right) => left.localeCompare(right, 'en'))
  }

  private findDcsManualFiles(dcsRoot: string): string[] {
    const roots = new Set<string>()
    for (const container of ['Mods', 'CoreMods']) {
      const categoryPath = path.join(dcsRoot, container, 'aircraft')
      if (!this.isDirectory(categoryPath)) continue
      for (const module of fs.readdirSync(categoryPath, { withFileTypes: true })) {
        if (!module.isDirectory()) continue
        for (const name of ['Doc', 'Docs']) {
          const candidate = path.join(categoryPath, module.name, name)
          if (this.isDirectory(candidate)) roots.add(candidate)
        }
      }
    }
    return [...roots].flatMap((root) => this.walkSupportedFiles(root)).filter((filePath) => path.extname(filePath).toLocaleLowerCase() === '.pdf')
  }

  private removeOrphanCaches(expected: Set<string>): void {
    try {
      for (const entry of fs.readdirSync(this.documentCachePath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json.gz') && !expected.has(entry.name)) fs.rmSync(path.join(this.documentCachePath, entry.name), { force: true })
      }
    } catch { /* Cache directory may not exist yet. */ }
  }

  private cacheSize(): number {
    let total = 0
    for (const filePath of [...Object.values(this.indexPaths), this.manifestPath]) {
      try { total += fs.statSync(filePath).size } catch { /* Missing cache. */ }
    }
    try {
      for (const entry of fs.readdirSync(this.documentCachePath, { withFileTypes: true })) {
        if (entry.isFile()) total += fs.statSync(path.join(this.documentCachePath, entry.name)).size
      }
    } catch { /* Missing cache. */ }
    try {
      for (const entry of fs.readdirSync(this.pagePreviewCachePath, { withFileTypes: true })) {
        if (entry.isFile()) total += fs.statSync(path.join(this.pagePreviewCachePath, entry.name)).size
      }
    } catch { /* Missing preview cache. */ }
    return total
  }

  private answerCacheStatus(): ManualLibraryOverview['answerCache'] {
    let size = 0
    for (const cachePath of [this.answerCachePath, this.onlineAnswerCachePath]) {
      try { size += fs.statSync(cachePath).size } catch { /* Cache has not been created yet. */ }
    }
    const savedTimes = [...this.answerCache.values(), ...this.onlineAnswerCache.values()]
      .map((entry) => Date.parse(entry.savedAt))
      .filter(Number.isFinite)
    const localEntries = this.answerCache.size
    const onlineEntries = this.onlineAnswerCache.size
    return {
      localEntries,
      onlineEntries,
      totalEntries: localEntries + onlineEntries,
      size,
      lastUpdatedAt: savedTimes.length > 0 ? new Date(Math.max(...savedTimes)).toISOString() : null,
    }
  }

  private answerCacheKey(question: string, answerLanguage: ManualAnswerLanguage = 'zh'): string {
    return crypto.createHash('sha256').update([
      ANSWER_CACHE_VERSION,
      RETRIEVAL_PIPELINE_VERSION,
      `${this.settings.localAi.provider}:${this.settings.localAi.model}:${this.settings.localAi.thinkingLevel}`,
      this.manifest.lastIndexedAt || 'no-index',
      answerLanguage,
      normalizeQuestionCacheIdentity(question),
    ].join('\n')).digest('hex')
  }

  private loadAnswerCache(): void {
    try {
      const parsed = this.storage.readCompressedJson<{ version?: number; entries?: StoredAnswerCacheEntry[] }>(this.answerCachePath)
      if (parsed.version !== ANSWER_CACHE_VERSION || !Array.isArray(parsed.entries)) return
      for (const entry of parsed.entries.slice(-MAX_ANSWER_CACHE_ENTRIES)) {
        if (entry?.key && entry.answer?.answer && Array.isArray(entry.answer.sources)) this.answerCache.set(entry.key, entry)
      }
    } catch { /* First run or an obsolete cache. */ }
  }

  private saveAnswerCache(): void {
    const entries = [...this.answerCache.values()].slice(-MAX_ANSWER_CACHE_ENTRIES)
    this.storage.writeCompressedJson(this.answerCachePath, { version: ANSWER_CACHE_VERSION, entries })
  }

  private cacheVerifiedAnswer(key: string, answer: ManualQuestionAnswer): void {
    if (this.answerCache.has(key)) this.answerCache.delete(key)
    this.answerCache.set(key, { key, savedAt: new Date().toISOString(), answer: { ...answer, cached: false } })
    while (this.answerCache.size > MAX_ANSWER_CACHE_ENTRIES) this.answerCache.delete(this.answerCache.keys().next().value as string)
    this.saveAnswerCache()
  }

  private clearAnswerCache(): void {
    this.answerCache.clear()
    try { this.storage.remove(this.answerCachePath) } catch { /* Best-effort cache invalidation. */ }
  }

  private onlineAnswerCacheKey(question: string, answerLanguage: ManualAnswerLanguage = 'zh'): string {
    return crypto.createHash('sha256').update([
      ONLINE_ANSWER_CACHE_VERSION,
      `${this.settings.onlineAi.provider}:${this.settings.onlineAi.model}:${this.settings.onlineAi.thinkingLevel}`,
      answerLanguage,
      normalizeQuestionCacheIdentity(question),
    ].join('\n')).digest('hex')
  }

  private loadOnlineAnswerCache(): void {
    try {
      const parsed = this.storage.readCompressedJson<{ version?: number; entries?: StoredOnlineAnswerCacheEntry[] }>(this.onlineAnswerCachePath)
      if (parsed.version !== ONLINE_ANSWER_CACHE_VERSION || !Array.isArray(parsed.entries)) return
      for (const entry of parsed.entries.slice(-MAX_ONLINE_ANSWER_CACHE_ENTRIES)) {
        if (entry?.key && entry.answer?.answer && Array.isArray(entry.answer.sources)) this.onlineAnswerCache.set(entry.key, entry)
      }
    } catch { /* First run or an obsolete cache. */ }
  }

  private saveOnlineAnswerCache(): void {
    const entries = [...this.onlineAnswerCache.values()].slice(-MAX_ONLINE_ANSWER_CACHE_ENTRIES)
    this.storage.writeCompressedJson(this.onlineAnswerCachePath, { version: ONLINE_ANSWER_CACHE_VERSION, entries })
  }

  private cacheOnlineAnswer(key: string, answer: ManualOnlineSearchAnswer): void {
    if (this.onlineAnswerCache.has(key)) this.onlineAnswerCache.delete(key)
    this.onlineAnswerCache.set(key, { key, savedAt: new Date().toISOString(), answer: { ...answer, cached: false } })
    while (this.onlineAnswerCache.size > MAX_ONLINE_ANSWER_CACHE_ENTRIES) this.onlineAnswerCache.delete(this.onlineAnswerCache.keys().next().value as string)
    this.saveOnlineAnswerCache()
  }

  private clearOnlineAnswerCache(): void {
    this.onlineAnswerCache.clear()
    try { this.storage.remove(this.onlineAnswerCachePath) } catch { /* Best-effort cache invalidation. */ }
  }

  private requireLibraryPath(): string {
    if (!this.settings.libraryPath || !this.isDirectory(this.settings.libraryPath)) throw new Error('请先选择手册库目录')
    return this.settings.libraryPath
  }

  private isDirectory(directory: string): boolean {
    try { return fs.statSync(directory).isDirectory() } catch { return false }
  }

  private loadSettings(): StoredSettings {
    try {
      const parsed = this.storage.readJson<Partial<StoredSettings>>(this.settingsPath)
      if (parsed.version === 1 || parsed.version === 2 || parsed.version === 3 || parsed.version === 4) {
        const providers = ['deepseek', 'siliconflow', 'qwen'] as ManualAiProvider[]
        const providerCredentials: StoredSettings['providerCredentials'] = {}
        for (const provider of providers) {
          const credential = parsed.providerCredentials?.[provider]
          if (credential?.apiKey && typeof credential.apiKey === 'string') {
            providerCredentials[provider] = {
              apiKey: credential.apiKey,
              baseUrl: typeof credential.baseUrl === 'string' ? credential.baseUrl : MANUAL_AI_DEFAULT_BASE_URLS[provider],
            }
          }
        }
        if (!providerCredentials.deepseek && typeof parsed.deepSeekApiKey === 'string') {
          providerCredentials.deepseek = { apiKey: parsed.deepSeekApiKey, baseUrl: MANUAL_AI_DEFAULT_BASE_URLS.deepseek }
        }
        const normalizeLoadedStage = (stage: ManualAiStage, value: ManualAiStageSettings | undefined): ManualAiStageSettings => {
          if (!value || !providers.includes(value.provider)) return stage === 'local' ? { ...DEFAULT_LOCAL_AI } : { ...DEFAULT_ONLINE_AI }
          try { return this.normalizeAiStageSettings(stage, value) } catch { return stage === 'local' ? { ...DEFAULT_LOCAL_AI } : { ...DEFAULT_ONLINE_AI } }
        }
        return {
          version: 4,
          libraryPath: typeof parsed.libraryPath === 'string' ? parsed.libraryPath : null,
          providerCredentials,
          localAi: normalizeLoadedStage('local', parsed.localAi),
          onlineAi: normalizeLoadedStage('online', parsed.onlineAi),
          onboardingCompleted: parsed.onboardingCompleted === true,
        }
      }
    } catch { /* First run. */ }
    return defaultSettings()
  }

  private saveSettings(): void {
    this.storage.writeJson(this.settingsPath, this.settings)
  }

  private loadManifest(): StoredManifest {
    try {
      const parsed = this.storage.readJson<StoredManifest>(this.manifestPath)
      if ((parsed.version === 1 || parsed.version === MANIFEST_VERSION) && parsed.files && Array.isArray(parsed.documents)) return parsed
    } catch { /* First index. */ }
    return emptyManifest()
  }

  private saveManifest(): void {
    this.storage.writeJson(this.manifestPath, this.manifest)
  }
}
