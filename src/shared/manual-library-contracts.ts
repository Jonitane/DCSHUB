export type ManualSourceKind = 'user' | 'dcs' | 'chuck'

export type ManualIndexState = 'idle' | 'indexing' | 'ready' | 'error'

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

export interface ManualOperationResult {
  ok: boolean
  message: string
  overview?: ManualLibraryOverview
}

export interface DcsManualImportResult extends ManualOperationResult {
  copied: number
  unchanged: number
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
  rebuildIndex: (force?: boolean) => Promise<ManualOperationResult>
  importDcsManuals: () => Promise<DcsManualImportResult>
  search: (query: string, limit?: number) => Promise<ManualSearchHit[]>
  ask: (question: string) => Promise<ManualQuestionAnswer>
  configureDeepSeek: (apiKey: string, model: DeepSeekConfigurationStatus['model']) => Promise<ManualLibraryOverview>
  clearDeepSeek: () => Promise<ManualLibraryOverview>
  testDeepSeek: (apiKey?: string, model?: DeepSeekConfigurationStatus['model']) => Promise<ManualOperationResult>
  chuckCatalog: () => Promise<ChuckGuideCatalogItem[]>
  downloadChuckGuide: (guideId: string) => Promise<ManualOperationResult>
  openDocument: (documentId: string) => Promise<void>
  askWithScreenshot: (question: string, imageDataUrl: string) => Promise<ManualQuestionAnswer>
}
