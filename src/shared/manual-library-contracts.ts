export type ManualSourceKind = 'user' | 'dcs' | 'chuck'

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

export interface DeepSeekConfigurationStatus {
  configured: boolean
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  visionAvailable: false
}

export interface ManualLibraryOverview {
  configured: boolean
  onboardingCompleted: boolean
  libraryPath: string | null
  documents: ManualDocumentRecord[]
  index: ManualIndexStatus
  deepSeek: DeepSeekConfigurationStatus
}

export interface ManualSearchHit {
  id: string
  documentId: string
  documentName: string
  relativePath: string
  sourcePath: string
  sourceKind: ManualSourceKind
  language: string
  aircraft: string | null
  page: number | null
  excerpt: string
  score: number
}

export interface ManualQuestionAnswer {
  answer: string
  sources: ManualSearchHit[]
  model: string
}

export interface ManualOnlineSearchSource {
  title: string
  url: string
}

export interface ManualOnlineSearchAnswer {
  answer: string
  sources: ManualOnlineSearchSource[]
  model: 'deepseek-v4-pro'
}

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
  chooseLibraryDirectory: () => Promise<ManualLibraryOverview | null>
  chooseManualFiles: () => Promise<ManualOperationResult | null>
  importDroppedFiles: (files: ReadonlyArray<unknown>) => Promise<ManualOperationResult>
  rebuildIndex: (force?: boolean) => Promise<ManualOperationResult>
  importDcsManuals: () => Promise<DcsManualImportResult>
  search: (query: string, limit?: number) => Promise<ManualSearchHit[]>
  ask: (question: string) => Promise<ManualQuestionAnswer>
  askOnline: (question: string) => Promise<ManualOnlineSearchAnswer>
  configureDeepSeek: (apiKey: string) => Promise<ManualLibraryOverview>
  clearDeepSeek: () => Promise<ManualLibraryOverview>
  testDeepSeek: (apiKey?: string) => Promise<ManualOperationResult>
  chuckCatalog: () => Promise<ChuckGuideCatalogItem[]>
  downloadChuckGuide: (guideId: string) => Promise<ManualOperationResult>
  downloadAllChuckGuides: () => Promise<ManualOperationResult>
  removeDuplicateDcsManuals: () => Promise<ManualOperationResult>
  completeOnboarding: () => Promise<ManualLibraryOverview>
  openDocument: (documentId: string, page?: number) => Promise<void>
  openOnlineSource: (url: string) => Promise<void>
  pagePreview: (documentId: string, page: number) => Promise<ManualPagePreview | null>
  askWithScreenshot: (question: string, imageDataUrl: string) => Promise<ManualQuestionAnswer>
  onProgress: (listener: (progress: ManualLibraryProgress) => void) => () => void
}
