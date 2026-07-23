export type ManualSourceKind = 'user' | 'dcs' | 'chuck'
export type ManualOfficialModuleType = 'full-fidelity' | 'non-full-click' | 'unknown'
export type ManualClassificationConfidence = 'high' | 'medium' | 'low'

export type ManualIndexState = 'idle' | 'indexing' | 'ready' | 'error'

export type ManualLibraryProgressOperation = 'index' | 'manual-import' | 'dcs-import' | 'chuck-download'

export type ManualLibraryProgressStage = 'scanning' | 'hashing' | 'copying' | 'downloading' | 'parsing' | 'building' | 'saving' | 'complete'

export interface ManualLibraryProgress {
  operation: ManualLibraryProgressOperation
  stage: ManualLibraryProgressStage
  current: number
  total: number
  percent: number
  message: string
  itemName?: string
}

export interface ManualDocumentRecord {
  id: string
  name: string
  relativePath: string
  sourcePath: string
  sourceKind: ManualSourceKind
  sourceVersion: string | null
  officialModuleType: ManualOfficialModuleType | null
  isTranslation: boolean
  translatedFrom: Exclude<ManualSourceKind, 'user'> | null
  classificationConfidence: ManualClassificationConfidence
  extension: string
  language: string
  aircraft: string | null
  size: number
  modifiedAt: string
  indexedAt: string
  pageCount: number
  chunkCount: number
  error?: string
}

export interface ManualIndexStatus {
  state: ManualIndexState
  documentCount: number
  pageCount: number
  chunkCount: number
  cacheSize: number
  lastIndexedAt: string | null
  lastError?: string
}

export type ManualAiProvider = 'deepseek' | 'siliconflow' | 'qwen'
export type ManualAiThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max'
export type ManualAiStage = 'local' | 'online'
/** Language selected in the main HUB UI, used for generated manual answers. */
export type ManualAnswerLanguage = 'zh' | 'en'

export interface ManualAiStageSettings {
  provider: ManualAiProvider
  model: string
  thinkingLevel: ManualAiThinkingLevel
}

export interface ManualAiProviderStatus {
  id: ManualAiProvider
  name: string
  configured: boolean
  supportsOnlineSearch: boolean
  baseUrl: string
}

export interface ManualAiConfigurationStatus {
  configured: boolean
  providers: ManualAiProviderStatus[]
  local: ManualAiStageSettings
  online: ManualAiStageSettings
}

/** @deprecated Kept for renderer compatibility while older cached windows close. */
export interface DeepSeekConfigurationStatus {
  configured: boolean
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  visionAvailable: false
}

export interface ManualAnswerCacheStatus {
  localEntries: number
  onlineEntries: number
  totalEntries: number
  size: number
  lastUpdatedAt: string | null
}

export interface ManualLibraryOverview {
  configured: boolean
  onboardingCompleted: boolean
  libraryPath: string | null
  documents: ManualDocumentRecord[]
  index: ManualIndexStatus
  answerCache: ManualAnswerCacheStatus
  deepSeek: DeepSeekConfigurationStatus
  ai: ManualAiConfigurationStatus
}

export interface ManualSearchHit {
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
  classificationConfidence: ManualClassificationConfidence
  language: string
  aircraft: string | null
  page: number | null
  sectionTitle?: string
  sectionPath?: string
  sectionStartPage?: number
  sectionEndPage?: number
  excerpt: string
  score: number
}

export interface ManualQuestionAnswer {
  answer: string
  sources: ManualSearchHit[]
  model: string
  cached: boolean
}

export interface ManualOnlineSearchSource {
  title: string
  url: string
}

export interface ManualOnlineSearchAnswer {
  answer: string
  sources: ManualOnlineSearchSource[]
  model: string
  cached: boolean
}

export type ManualCachedAnswerMatch =
  | { kind: 'online'; answer: ManualOnlineSearchAnswer }
  | { kind: 'local'; answer: ManualQuestionAnswer }

export interface ManualPagePreview {
  documentId: string
  documentName: string
  page: number
  imageDataUrl: string
}

export interface ManualOperationResult {
  ok: boolean
  message: string
  overview?: ManualLibraryOverview
}

export interface DcsManualImportResult extends ManualOperationResult {
  copied: number
  unchanged: number
  duplicateSkipped: number
  removableDuplicates: number
}

export interface ChuckGuideCatalogItem {
  id: string
  displayName: string
  pageUrl: string
  installed: boolean
}

export interface ManualLibraryBridge {
  overview: () => Promise<ManualLibraryOverview>
  currentProgress: () => Promise<ManualLibraryProgress | null>
  chooseLibraryDirectory: () => Promise<ManualLibraryOverview | null>
  chooseManualFiles: () => Promise<ManualOperationResult | null>
  importDroppedFiles: (files: ReadonlyArray<unknown>) => Promise<ManualOperationResult>
  rebuildIndex: (force?: boolean) => Promise<ManualOperationResult>
  importDcsManuals: () => Promise<DcsManualImportResult>
  search: (query: string, limit?: number) => Promise<ManualSearchHit[]>
  ask: (question: string, language?: ManualAnswerLanguage) => Promise<ManualQuestionAnswer>
  askOnline: (question: string, language?: ManualAnswerLanguage) => Promise<ManualOnlineSearchAnswer>
  preferredCachedAnswer: (question: string, language?: ManualAnswerLanguage) => Promise<ManualCachedAnswerMatch | null>
  clearAnswerCaches: () => Promise<ManualLibraryOverview>
  configureAiProvider: (provider: ManualAiProvider, apiKey: string, baseUrl?: string) => Promise<ManualLibraryOverview>
  clearAiProvider: (provider: ManualAiProvider) => Promise<ManualLibraryOverview>
  testAiProvider: (provider: ManualAiProvider, apiKey?: string, baseUrl?: string) => Promise<ManualOperationResult>
  setAiStageSettings: (stage: ManualAiStage, settings: ManualAiStageSettings) => Promise<ManualLibraryOverview>
  listAiProviderModels: (provider: ManualAiProvider) => Promise<string[]>
  configureDeepSeek: (apiKey: string) => Promise<ManualLibraryOverview>
  clearDeepSeek: () => Promise<ManualLibraryOverview>
  testDeepSeek: (apiKey?: string) => Promise<ManualOperationResult>
  chuckCatalog: () => Promise<ChuckGuideCatalogItem[]>
  downloadChuckGuide: (guideId: string) => Promise<ManualOperationResult>
  downloadSelectedChuckGuides: (guideIds: string[]) => Promise<ManualOperationResult>
  downloadAllChuckGuides: () => Promise<ManualOperationResult>
  removeDuplicateDcsManuals: () => Promise<ManualOperationResult>
  completeOnboarding: () => Promise<ManualLibraryOverview>
  openDocument: (documentId: string, page?: number) => Promise<void>
  openOnlineSource: (url: string) => Promise<void>
  pagePreview: (documentId: string, page: number) => Promise<ManualPagePreview | null>
  askWithScreenshot: (question: string, imageDataUrl: string) => Promise<ManualQuestionAnswer>
  onProgress: (listener: (progress: ManualLibraryProgress) => void) => () => void
  onOverviewChanged: (listener: (overview: ManualLibraryOverview) => void) => () => void
}
