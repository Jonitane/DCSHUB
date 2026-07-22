import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookCopy,
  BookOpenText,
  Bot,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe2,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Send,
  Settings2,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Image } from '@/components/ui/image'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type {
  ManualDocumentRecord,
  ManualLibraryOverview,
  ManualOnlineSearchAnswer,
  ManualLibraryProgress,
  ManualPagePreview,
  ManualQuestionAnswer,
} from '@/shared/manual-library-contracts'

type ManualCategory = 'dcs' | 'user' | 'chuck' | 'all'

const MANUAL_CATEGORY_LABELS: Record<ManualCategory, string> = {
  dcs: '官方手册',
  user: '用户手册',
  chuck: 'Chuck 手册',
  all: '全部手册',
}

function manualCategory(document: ManualDocumentRecord): Exclude<ManualCategory, 'all'> {
  if (document.sourceKind === 'user') return 'user'
  if (document.sourceKind === 'chuck') return 'chuck'
  return 'dcs'
}

function documentSourceDetail(document: ManualDocumentRecord): string {
  if (document.sourceKind === 'user') return '用户添加'
  if (document.sourceKind === 'chuck') return "Chuck's Guides"
  return 'DCS 官方手册'
}

function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ProgressPanel({ progress }: { progress: ManualLibraryProgress }) {
  return (
    <div className="rounded-xl border border-primary/25 bg-card/90 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-sm font-medium">{progress.message}</p>{progress.itemName && <p className="mt-1 truncate text-xs text-muted-foreground" title={progress.itemName}>{progress.itemName}</p>}</div>
        <span className="shrink-0 font-mono text-sm font-semibold text-primary">{progress.percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/70"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} /></div>
      {progress.total > 1 && <p className="mt-2 text-right text-[10px] text-muted-foreground">{Math.min(progress.current, progress.total)} / {progress.total}</p>}
    </div>
  )
}

function CitationBadge({
  sourceNumber,
  isActive,
  onClick,
  onMouseEnter,
}: {
  sourceNumber: number
  isActive: boolean
  onClick: () => void
  onMouseEnter: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'mx-0.5 inline-flex items-center rounded-md px-1.5 py-0 text-[0.75em] font-bold transition-all duration-150 cursor-pointer align-baseline ring-1',
        isActive
          ? 'bg-primary text-primary-foreground ring-primary shadow-md shadow-primary/30 scale-110'
          : 'bg-amber-400/15 text-amber-600 ring-amber-400/40 hover:bg-amber-400/25 hover:text-amber-700 hover:ring-amber-500/60 hover:scale-105'
      )}
      title={`S${sourceNumber}：悬停预览页面，点击放大查看`}
    >
      <span className="text-[0.7em] mr-0.5 opacity-70">📄</span>S{sourceNumber}
    </button>
  )
}

function FixedImagePanel({
  previews,
  currentIndex,
  onIndexChange,
  onExpand,
}: {
  previews: Array<{ preview: ManualPagePreview; sourceNumber: number }>
  currentIndex: number
  onIndexChange: (index: number) => void
  onExpand: (preview: ManualPagePreview) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)
  const wheelTimeoutRef = useRef<number | null>(null)

  const current = previews[currentIndex]

  const goToPrev = useCallback(() => {
    onIndexChange(Math.max(0, currentIndex - 1))
  }, [currentIndex, onIndexChange])

  const goToNext = useCallback(() => {
    onIndexChange(Math.min(previews.length - 1, currentIndex + 1))
  }, [currentIndex, onIndexChange, previews.length])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handleWheel = (e: WheelEvent) => {
      if (!isHovering) return
      e.preventDefault()
      e.stopPropagation()

      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current)
      }
      wheelTimeoutRef.current = window.setTimeout(() => {
        if (e.deltaY > 15) {
          goToNext()
        } else if (e.deltaY < -15) {
          goToPrev()
        }
      }, 80)
    }

    panel.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      panel.removeEventListener('wheel', handleWheel, { passive: false } as any)
      if (wheelTimeoutRef.current) window.clearTimeout(wheelTimeoutRef.current)
    }
  }, [isHovering, goToNext, goToPrev])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isHovering) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovering, goToNext, goToPrev])

  if (previews.length === 0) return null

  return (
    <aside className="hidden xl:block xl:w-[380px] xl:shrink-0">
      <div
        ref={panelRef}
        className="sticky top-2 flex flex-col overflow-hidden rounded-xl border border-primary/20 bg-background/60 shadow-sm"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <div className="flex items-center gap-1">
            {previews.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={goToPrev}
                  disabled={currentIndex === 0}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md transition-all',
                    currentIndex === 0
                      ? 'text-muted-foreground/30 cursor-not-allowed'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={goToNext}
                  disabled={currentIndex === previews.length - 1}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md transition-all',
                    currentIndex === previews.length - 1
                      ? 'text-muted-foreground/30 cursor-not-allowed'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            )}
            <span className="ml-1 text-[11px] font-medium text-muted-foreground">
              <MousePointerClick className="mr-1 inline size-3 align-text-bottom" />滚轮翻页
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary tabular-nums">
              {currentIndex + 1} / {previews.length}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onClick={() => current && onExpand(current.preview)}
              title="放大查看"
            >
              <Maximize2 className="size-3" />
              <span>放大</span>
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-gradient-to-b from-white/98 to-white/90 p-2">
          <button
            type="button"
            className="group relative block w-full cursor-zoom-in"
            onClick={() => current && onExpand(current.preview)}
          >
            {current && (
              <img
                key={`${current.preview.documentId}:${current.preview.page}`}
                src={current.preview.imageDataUrl}
                alt={`${current.preview.documentName} 第 ${current.preview.page} 页`}
                className={cn(
                  'mx-auto max-h-[520px] w-auto max-w-full object-contain transition-all duration-300',
                  isHovering ? 'scale-[1.01]' : ''
                )}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/5 group-hover:opacity-100">
              <div className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-medium text-white backdrop-blur-sm">
                <Maximize2 className="size-3" />
                点击放大
              </div>
            </div>
          </button>
        </div>

        {current && (
          <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5 text-[11px]">
            <span className="truncate font-medium text-foreground/90" title={current.preview.documentName}>
              <Badge variant="outline" className="mr-1.5 border-primary/30 bg-primary/10 px-1 py-0 text-[9px] font-bold text-primary">
                S{current.sourceNumber}
              </Badge>
              第 {current.preview.page} 页
            </span>
          </div>
        )}

        {previews.length > 1 && (
          <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5 overflow-x-auto">
            {previews.map((item, index) => (
              <button
                key={`${item.preview.documentId}:${item.preview.page}:thumb`}
                type="button"
                onClick={() => onIndexChange(index)}
                className={cn(
                  'relative shrink-0 overflow-hidden rounded border-2 transition-all',
                  index === currentIndex
                    ? 'border-amber-400 shadow-sm shadow-amber-400/30'
                    : 'border-transparent opacity-50 hover:opacity-80'
                )}
              >
                <img
                  src={item.preview.imageDataUrl}
                  alt={`S${item.sourceNumber}`}
                  className="h-8 w-auto object-contain bg-white"
                />
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 py-0 text-center text-[8px] font-bold text-white">
                  {item.sourceNumber}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function processTextWithCitations(
  text: string,
  sourcePreviews: Array<ManualPagePreview | undefined>,
  activeSource: number | null,
  onCitationClick: (sourceNumber: number) => void,
  onCitationHover: (sourceNumber: number) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /\[S(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    const sourceNumber = Number(match[1])
    const validSource = sourceNumber >= 1 && sourceNumber <= sourcePreviews.length

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    parts.push(
      <CitationBadge
        key={`cite-${key++}`}
        sourceNumber={sourceNumber}
        isActive={activeSource === sourceNumber}
        onClick={() => validSource && onCitationClick(sourceNumber)}
        onMouseEnter={() => validSource && onCitationHover(sourceNumber)}
      />
    )

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function AnswerWithPageImages({ response, previews, loading, onExpand }: {
  response: ManualQuestionAnswer
  previews: ManualPagePreview[]
  loading: boolean
  onExpand: (preview: ManualPagePreview) => void
}) {
  const answerContainerRef = useRef<HTMLDivElement>(null)
  const previewByPage = useMemo(
    () => new Map(previews.map((preview) => [`${preview.documentId}:${preview.page}`, preview])),
    [previews]
  )
  const sourcePreviews = useMemo(
    () => response.sources.map((source) => source.page ? previewByPage.get(`${source.documentId}:${source.page}`) : undefined),
    [response.sources, previewByPage]
  )

  const allPreviewsWithSources = useMemo(() => {
    const seen = new Set<string>()
    return response.sources
      .map((source, index) => {
        if (!source.page) return null
        const preview = previewByPage.get(`${source.documentId}:${source.page}`)
        if (!preview) return null
        const key = `${preview.documentId}:${preview.page}`
        if (seen.has(key)) return null
        seen.add(key)
        return { preview, sourceNumber: index + 1 }
      })
      .filter((item): item is { preview: ManualPagePreview; sourceNumber: number } => Boolean(item))
  }, [response.sources, previewByPage])

  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0)
  const [activeCitation, setActiveCitation] = useState<number | null>(null)

  useEffect(() => {
    setCurrentPreviewIndex(0)
    setActiveCitation(null)
  }, [response])

  const jumpToSource = useCallback((sourceNumber: number) => {
    const source = response.sources[sourceNumber - 1]
    if (!source?.page) return
    const previewKey = `${source.documentId}:${source.page}`
    const index = allPreviewsWithSources.findIndex(
      (item) => `${item.preview.documentId}:${item.preview.page}` === previewKey
    )
    if (index >= 0) {
      setCurrentPreviewIndex(index)
      setActiveCitation(sourceNumber)
      onExpand(allPreviewsWithSources[index].preview)
    }
  }, [response.sources, allPreviewsWithSources, onExpand])

  const previewSourceOnHover = useCallback((sourceNumber: number) => {
    const source = response.sources[sourceNumber - 1]
    if (!source?.page) return
    const previewKey = `${source.documentId}:${source.page}`
    const index = allPreviewsWithSources.findIndex(
      (item) => `${item.preview.documentId}:${item.preview.page}` === previewKey
    )
    if (index >= 0) {
      setCurrentPreviewIndex(index)
      setActiveCitation(sourceNumber)
    }
  }, [response.sources, allPreviewsWithSources])

  const paragraphs = useMemo(() => {
    return response.answer.split(/\n{2,}/).filter(Boolean).reduce<string[]>((blocks, block) => {
      const previous = blocks.at(-1)
      const listItem = /^\s*(?:[-*+]\s|\d+[.)]\s)/
      if (previous && listItem.test(previous) && listItem.test(block)) blocks[blocks.length - 1] = `${previous}\n\n${block}`
      else blocks.push(block)
      return blocks
    }, [])
  }, [response.answer])

  const createMarkdownComponents = () => {
    const processChildren = (children: React.ReactNode): React.ReactNode => {
      if (typeof children === 'string') {
        return processTextWithCitations(children, sourcePreviews, activeCitation, jumpToSource, previewSourceOnHover)
      }
      if (Array.isArray(children)) {
        return children.map((child, i) => {
          if (typeof child === 'string') {
            return <Fragment key={i}>{processTextWithCitations(child, sourcePreviews, activeCitation, jumpToSource, previewSourceOnHover)}</Fragment>
          }
          return child
        })
      }
      return children
    }

    return {
      h1: ({ children }: any) => <h2 className="mb-3 mt-1 text-xl font-bold tracking-tight text-foreground">{processChildren(children)}</h2>,
      h2: ({ children }: any) => <h3 className="mb-3 mt-6 flex items-center gap-2 border-l-[3px] border-primary pl-3 text-lg font-bold text-foreground"><span className="h-4 w-1 rounded-full bg-primary/60" />{processChildren(children)}</h3>,
      h3: ({ children }: any) => <h4 className="mb-2 mt-5 text-base font-semibold text-foreground/95">{processChildren(children)}</h4>,
      p: ({ children }: any) => <p className="my-2.5 text-[14.5px] leading-[1.85] text-foreground/90">{processChildren(children)}</p>,
      ul: ({ children }: any) => <ul className="answer-list-unordered my-3.5 space-y-2.5 pl-5 text-[14.5px] leading-[1.8]">{children}</ul>,
      ol: ({ children }: any) => <ol className="answer-list-ordered my-3.5 space-y-3 pl-0 text-[15px] leading-[1.85]">{children}</ol>,
      li: ({ children }: any) => <li className="text-foreground/90">{processChildren(children)}</li>,
      strong: ({ children }: any) => <strong className="font-semibold text-foreground">{processChildren(children)}</strong>,
      blockquote: ({ children }: any) => <blockquote className="my-2 ml-2 border-l-2 border-primary/30 pl-3 py-0.5 text-[13px] leading-[1.6] text-foreground/65">{processChildren(children)}</blockquote>,
      code: ({ children }: any) => <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-primary font-medium">{children}</code>,
      table: ({ children }: any) => <div className="my-4 overflow-x-auto rounded-lg border border-border/60"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
      th: ({ children }: any) => <th className="border-b border-border/60 bg-muted/55 px-3 py-2 font-semibold">{processChildren(children)}</th>,
      td: ({ children }: any) => <td className="border-b border-border/35 px-3 py-2 align-top leading-5">{processChildren(children)}</td>,
      hr: () => <hr className="my-6 border-border/40" />,
      a: ({ href, children }: any) => (
        <a href={href} className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60" target="_blank" rel="noopener noreferrer">{processChildren(children)}</a>
      ),
    }
  }

  const markdown = (content: string) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>
      {content}
    </ReactMarkdown>
  )

  return (
    <div ref={answerContainerRef} className="flex gap-5">
      <div className="min-w-0 flex-1">
        <div className="space-y-1">
          {paragraphs.map((paragraph, paragraphIndex) => (
            <div key={`${paragraphIndex}:${paragraph.slice(0, 24)}`} className="min-w-0">
              {markdown(paragraph)}
            </div>
          ))}
        </div>

        {loading && (
          <div className="mt-4 flex h-20 items-center justify-center rounded-xl border border-border/40 bg-background/30 text-xs text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载手册页面预览…
          </div>
        )}

        {!loading && allPreviewsWithSources.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-border/50 bg-background/20 px-4 py-3 text-center text-xs text-muted-foreground">
            本次回答暂无 PDF 页面预览
          </div>
        )}
      </div>

      <FixedImagePanel
        previews={allPreviewsWithSources}
        currentIndex={currentPreviewIndex}
        onIndexChange={setCurrentPreviewIndex}
        onExpand={onExpand}
      />
    </div>
  )
}

export default function ManualLibraryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const bridge = window.electronAPI?.manualLibrary
  const [overview, setOverview] = useState<ManualLibraryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<string | null>(null)
  const [progress, setProgress] = useState<ManualLibraryProgress | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupDcs, setSetupDcs] = useState(true)
  const [setupChuck, setSetupChuck] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<ManualQuestionAnswer | null>(null)
  const [answeredQuestion, setAnsweredQuestion] = useState('')
  const [onlineResponse, setOnlineResponse] = useState<ManualOnlineSearchAnswer | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pagePreviews, setPagePreviews] = useState<ManualPagePreview[]>([])
  const [previewsLoading, setPreviewsLoading] = useState(false)
  const [expandedPreview, setExpandedPreview] = useState<ManualPagePreview | null>(null)
  const [documentCategory, setDocumentCategory] = useState<ManualCategory>('all')
  const [askFocusMode, setAskFocusMode] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!bridge) return
    setLoading(true)
    try {
      const [next, current] = await Promise.all([bridge.overview(), bridge.currentProgress()])
      setOverview(next)
      if (current && current.stage !== 'complete') setProgress(current)
      if (next.configured && !next.onboardingCompleted) setSetupOpen(true)
    } catch (reason) {
      toast.error('超级手册加载失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => bridge?.onProgress(setProgress), [bridge])

  const enterFocusMode = useCallback(() => {
    setAskFocusMode(true)
    setSearchParams({ focus: '1' }, { replace: true })
  }, [setSearchParams])

  const exitFocusMode = useCallback(() => {
    setAskFocusMode(false)
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    if (searchParams.get('focus') === '1' && overview?.configured && overview.index.chunkCount > 0) {
      setAskFocusMode(true)
    }
  }, [searchParams, overview?.configured, overview?.index?.chunkCount])

  useEffect(() => {
    if (!askFocusMode) return
    const leaveFocusMode = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !expandedPreview && !libraryOpen && !addOpen && !setupOpen) exitFocusMode()
    }
    window.addEventListener('keydown', leaveFocusMode)
    return () => window.removeEventListener('keydown', leaveFocusMode)
  }, [addOpen, askFocusMode, expandedPreview, libraryOpen, setupOpen, exitFocusMode])

  const finishOperation = () => {
    setOperation(null)
    window.setTimeout(() => setProgress(null), 900)
  }

  const chooseLibrary = async () => {
    if (!bridge) return
    setOperation('library')
    try {
      const next = await bridge.chooseLibraryDirectory()
      if (next) {
        setOverview(next)
        if (!next.onboardingCompleted) setSetupOpen(true)
        toast.success('手册库目录已设置')
      }
    } catch (reason) {
      toast.error('设置手册库失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      finishOperation()
    }
  }

  const applyImportResult = async (task: Promise<{ ok: boolean; message: string; overview?: ManualLibraryOverview } | null>) => {
    setOperation('manual-import')
    try {
      const result = await task
      if (!result) return
      if (result.overview) setOverview(result.overview)
      if (result.ok) {
        toast.success(result.message)
        setAddOpen(false)
      } else toast.error('添加手册失败', { description: result.message })
    } catch (reason) {
      toast.error('添加手册失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      finishOperation()
    }
  }

  const chooseManualFiles = () => {
    if (!bridge) return
    void applyImportResult(bridge.chooseManualFiles())
  }

  const importDroppedFiles = (files: FileList) => {
    if (!bridge || files.length === 0) return
    void applyImportResult(bridge.importDroppedFiles(Array.from(files)))
  }

  const loadPagePreviews = async (answer: ManualQuestionAnswer) => {
    if (!bridge) return
    const sources = answer.sources.filter((source) => source.page && source.sourcePath.toLocaleLowerCase().endsWith('.pdf'))
    const unique = [...new Map(sources.map((source) => [`${source.documentId}:${source.page}`, source])).values()].slice(0, 6)
    setPagePreviews([])
    if (unique.length === 0) return
    setPreviewsLoading(true)
    try {
      const previews = await Promise.all(unique.map((source) => bridge.pagePreview(source.documentId, source.page!)))
      setPagePreviews(previews.filter((preview): preview is ManualPagePreview => Boolean(preview)))
    } finally {
      setPreviewsLoading(false)
    }
  }

  const completeInitialSetup = async (withSources: boolean) => {
    if (!bridge) return
    setOperation('setup')
    try {
      const userIndex = await bridge.rebuildIndex(false)
      if (userIndex.overview) setOverview(userIndex.overview)
      if (withSources && setupDcs) {
        const imported = await bridge.importDcsManuals()
        if (imported.overview) setOverview(imported.overview)
        if (!imported.ok) toast.error('DCS 手册导入未完成', { description: imported.message })
      }
      if (withSources && setupChuck) {
        const downloaded = await bridge.downloadAllChuckGuides()
        if (downloaded.overview) setOverview(downloaded.overview)
        if (!downloaded.ok) toast.error('部分 Chuck 手册下载失败', { description: downloaded.message })
      }
      if (withSources && apiKey.trim()) {
        setOverview(await bridge.configureDeepSeek(apiKey))
        setApiKey('')
      }
      const completed = await bridge.completeOnboarding()
      setOverview(completed)
      setSetupOpen(false)
      toast.success('超级手册初始化完成')
    } catch (reason) {
      toast.error('初始化失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      finishOperation()
    }
  }

  const ask = async () => {
    if (!bridge || !question.trim()) return
    const submittedQuestion = question.trim()
    setOperation('ask')
    setResponse(null)
    setOnlineResponse(null)
    try {
      const answer = await bridge.ask(submittedQuestion)
      setResponse(answer)
      setAnsweredQuestion(submittedQuestion)
      void loadPagePreviews(answer)
      void bridge.overview().then(setOverview).catch(() => undefined)
    } catch (reason) {
      toast.error('提问失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const askOnline = async () => {
    if (!bridge || !answeredQuestion) return
    setOperation('online-search')
    try {
      setOnlineResponse(await bridge.askOnline(answeredQuestion))
      void bridge.overview().then(setOverview).catch(() => undefined)
    } catch (reason) {
      toast.error('在线搜索失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const openOnlineSource = (url?: string) => {
    if (!bridge || !url) return
    void bridge.openOnlineSource(url).catch((reason) => {
      toast.error('无法打开在线来源', { description: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  const documents = overview?.documents || []
  const categoryCounts = documents.reduce<Record<Exclude<ManualCategory, 'all'>, number>>((counts, document) => {
    counts[manualCategory(document)] += 1
    return counts
  }, { dcs: 0, user: 0, chuck: 0 })
  const visibleDocuments = documentCategory === 'all' ? documents : documents.filter((document) => manualCategory(document) === documentCategory)

  if (loading && !overview) {
    return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取手册索引…</div>
  }

  return (
    <div className="space-y-6">
      {progress && operation && <ProgressPanel progress={progress} />}

      {!overview?.configured ? (
        <Card className="border-primary/25 bg-card/75"><CardContent className="flex min-h-[460px] flex-col items-center justify-center text-center"><div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25"><BookOpenText className="size-8 text-primary" /></div><h2 className="text-lg font-semibold">创建本地手册知识库</h2><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">选择一个长期保存手册的目录。首次处理会显示实时进度，之后只分析新增或发生变化的用户手册。</p><Button className="mt-6" onClick={() => void chooseLibrary()} disabled={operation !== null}>{operation === 'library' ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}选择手册库目录</Button></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-5">
            {askFocusMode && <div className="fixed inset-0 z-[90] bg-background/92 backdrop-blur-md" />}

            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="border-border/50 bg-card/75 shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><BookOpenText className="size-5 text-primary" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">已索引手册</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{overview.index.documentCount}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {overview.documents.length} 本</span></p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/75 shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><Database className="size-5 text-primary" /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">问答缓存</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{overview.answerCache.totalEntries.toLocaleString()}<span className="ml-1 text-xs font-normal text-muted-foreground">条</span></p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">本地 {overview.answerCache.localEntries} · 联网 {overview.answerCache.onlineEntries} · {formatCacheSize(overview.answerCache.size)}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/75 shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><HardDrive className="size-5 text-primary" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">本地手册库</p>
                    <p className="mt-0.5 truncate text-sm font-medium" title={overview.libraryPath || ''}>{overview.libraryPath ? overview.libraryPath.split(/[/\\]/).slice(-2).join('/') : '未设置'}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 rounded-lg" onClick={() => setLibraryOpen(true)}><FolderOpen className="size-3.5" />浏览</Button>
                </CardContent>
              </Card>
            </div>

            <Card className={cn('border-primary/20 bg-card/75', askFocusMode && 'fixed inset-3 z-[100] flex flex-col overflow-hidden border-primary/35 bg-card/98 shadow-2xl')}>
              <CardHeader className="shrink-0 pb-4"><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" />超级手册</CardTitle></div><div className="flex items-center gap-2">{overview.deepSeek.configured ? <Badge variant="outline" className="border-emerald-400/30 bg-emerald-500/8 text-emerald-300">DeepSeek 已连接</Badge> : <Button size="sm" variant="outline" onClick={() => navigate('/settings')}><Settings2 className="size-3.5" />配置 API</Button>}{!askFocusMode && overview?.configured && <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} disabled={operation !== null}><FilePlus2 className="size-4" />添加手册</Button>}{askFocusMode && <Button size="sm" variant="outline" onClick={exitFocusMode} title="也可以按 Esc 退出"><Minimize2 className="size-3.5" />退出专注</Button>}</div></div></CardHeader>
              <CardContent className={cn('space-y-4', askFocusMode && 'min-h-0 flex-1 overflow-y-auto px-6 pb-6')}>
                <textarea className={cn('min-h-28 w-full resize-y rounded-xl border border-input bg-background/55 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15', askFocusMode && 'min-h-32 resize-none')} value={question} onFocus={enterFocusMode} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：F/A-18C 冷启动时 INS 应该如何设置？（Enter 提问，Shift+Enter 换行）" onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.repeat) return; event.preventDefault(); if (operation === null && question.trim() && overview.deepSeek.configured && overview.index.chunkCount > 0) void ask() }} />
                <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled title="接口已预留；当前 DeepSeek 仅支持文字"><Camera className="size-4" />截图提问（预留）</Button><Button onClick={() => void ask()} disabled={operation !== null || !question.trim() || !overview.deepSeek.configured || overview.index.chunkCount === 0}>{operation === 'ask' ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}提问</Button></div>
                {response && <div className="space-y-4 border-t border-border/45 pt-4">
                  <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary"><Bot className="size-4" />{response.model}{response.cached && <Badge variant="outline" className="ml-1 border-emerald-400/25 bg-emerald-500/8 text-[10px] text-emerald-300">缓存命中</Badge>}</div><AnswerWithPageImages response={response} previews={pagePreviews} loading={previewsLoading} onExpand={setExpandedPreview} /></div>
                  <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.035] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold"><Globe2 className="size-4 text-sky-400" />在线搜索</p><p className="mt-1 text-xs text-muted-foreground">使用 DeepSeek V4 Pro · MAX 思考联网核对；同一问题优先读取持久缓存，未命中时才产生 API 费用。</p></div><Button variant="outline" onClick={() => void askOnline()} disabled={operation !== null}>{operation === 'online-search' ? <LoaderCircle className="size-4 animate-spin" /> : <Globe2 className="size-4" />}{onlineResponse ? '重新搜索' : '在线搜索'}</Button></div>{onlineResponse && <div className="mt-4 border-t border-sky-400/15 pt-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-sky-300"><Bot className="size-4" />V4 Pro · MAX{onlineResponse.cached && <Badge variant="outline" className="ml-1 border-emerald-400/25 bg-emerald-500/8 text-[10px] text-emerald-300">缓存命中</Badge>}</div><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground/90">{children}</p>, h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>, h3: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold">{children}</h4>, ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-5 text-sm leading-7 [list-style-type:disc] marker:text-sky-400">{children}</ul>, ol: ({ children }) => <ol className="my-3 space-y-2 pl-5 text-sm leading-7 [list-style-type:decimal] marker:text-sky-400">{children}</ol>, a: ({ href, children }) => <button type="button" className="text-sky-300 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-200" onClick={() => openOnlineSource(href)}>{children}</button> }}>{onlineResponse.answer}</ReactMarkdown>{onlineResponse.sources.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{onlineResponse.sources.map((source) => <button type="button" key={source.url} onClick={() => openOnlineSource(source.url)} className="max-w-full truncate rounded-full border border-sky-400/20 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-200 hover:bg-sky-500/10" title={source.url}>{source.title}</button>)}</div>}</div>}</div>
                  <div><p className="mb-2 text-xs font-semibold text-muted-foreground">引用来源</p><div className="space-y-2">{response.sources.map((source, index) => <button key={source.id} type="button" className="flex w-full items-start gap-3 rounded-lg border border-border/45 bg-background/35 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5" onClick={() => void bridge?.openDocument(source.documentId, source.page ?? undefined)}><Badge variant="outline" className="mt-0.5 shrink-0">S{index + 1}</Badge><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{source.documentName}{source.page ? ` · 第 ${source.page} 页` : ''}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{source.excerpt}</p></div><ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground" /></button>)}</div></div>
                </div>}
              </CardContent>
            </Card>

          </div>
        </>
      )}

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="flex h-[84vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0"><div className="flex items-center justify-between gap-4 pr-8"><div className="min-w-0"><DialogTitle>已入库手册</DialogTitle><DialogDescription className="mt-1 max-w-2xl truncate"><span title={overview?.libraryPath || ''}>{overview?.libraryPath}</span></DialogDescription></div><Badge variant="outline">{visibleDocuments.length} / {overview?.documents.length || 0}</Badge></div></DialogHeader>
          {overview && <><div className="shrink-0"><Select value={documentCategory} onValueChange={(value) => setDocumentCategory(value as ManualCategory)}><SelectTrigger className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger><SelectContent>{(['all', 'dcs', 'chuck', 'user'] as ManualCategory[]).map((category) => <SelectItem key={category} value={category}>{MANUAL_CATEGORY_LABELS[category]}（{category === 'all' ? overview.documents.length : categoryCounts[category]}）</SelectItem>)}</SelectContent></Select></div><div className="min-h-0 flex-1 overflow-y-auto pr-1"><div className="grid gap-2 sm:grid-cols-2">{visibleDocuments.length === 0 ? <div className="col-span-full flex min-h-56 flex-col items-center justify-center text-center text-sm text-muted-foreground"><FileText className="mb-3 size-8 opacity-40" /><p>当前分类中没有手册</p><p className="mt-1 text-xs">可以切换其他分类或添加新手册</p></div> : visibleDocuments.map((document) => <button key={document.id} type="button" className="flex w-full items-center gap-3 rounded-lg border border-border/35 bg-background/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5" onClick={() => void bridge?.openDocument(document.id)}><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60"><FileText className="size-4 text-primary/80" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{documentSourceDetail(document)} · {document.aircraft || document.language.toUpperCase()} · {document.pageCount} 页</p></div><ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" /></button>)}</div></div></>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(expandedPreview)} onOpenChange={(open) => { if (!open) setExpandedPreview(null) }}>
        <DialogContent overlayClassName="z-[120]" className="flex h-[92vh] max-w-[94vw] flex-col overflow-hidden p-3">
          {expandedPreview && <><DialogHeader><DialogTitle className="truncate pr-8 text-sm">{expandedPreview.documentName} · 第 {expandedPreview.page} 页</DialogTitle><DialogDescription>手册内容区域，可按 Esc 或点击背景关闭。</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-auto rounded-lg bg-white/95 p-2"><Image src={expandedPreview.imageDataUrl} alt={`${expandedPreview.documentName} 第 ${expandedPreview.page} 页`} className="mx-auto h-auto max-w-full object-contain" /></div><DialogFooter className="pt-2"><Button variant="outline" onClick={() => setExpandedPreview(null)}>关闭</Button><Button onClick={() => void bridge?.openDocument(expandedPreview.documentId, expandedPreview.page)}><ExternalLink className="size-4" />定位到原手册</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { if (operation === null) setAddOpen(open) }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>添加手册</DialogTitle><DialogDescription>文件会复制到手册库并自动建立增量索引；相同内容不会重复添加。</DialogDescription></DialogHeader>
          <div
            className={`mt-4 flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition-colors ${dragActive ? 'border-primary bg-primary/10 ring-2 ring-primary/15' : 'border-border/70 bg-background/35 hover:border-primary/45 hover:bg-primary/[0.035]'}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragActive(true) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); importDroppedFiles(event.dataTransfer.files) }}
          >
            {operation === 'manual-import' ? <LoaderCircle className="mb-4 size-10 animate-spin text-primary" /> : <UploadCloud className={`mb-4 size-10 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`} />}
            <p className="text-sm font-semibold">{operation === 'manual-import' ? '正在复制并索引手册…' : '把手册拖到这里'}</p>
            <p className="mt-2 text-xs text-muted-foreground">支持 PDF、DOCX、EPUB、HTML、Markdown、TXT 和 RTF</p>
            <Button className="mt-5" variant="outline" onClick={chooseManualFiles} disabled={operation !== null}><FilePlus2 className="size-4" />选择文件</Button>
          </div>
          {progress && operation === 'manual-import' && <ProgressPanel progress={progress} />}
        </DialogContent>
      </Dialog>

      <Dialog open={setupOpen} onOpenChange={(open) => { if (operation === null && open) setSetupOpen(true) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>首次设置超级手册</DialogTitle><DialogDescription>选择需要建立的手册来源，并可立即配置 DeepSeek。完成后这些选项只在“设置”中显示。</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            {progress && operation === 'setup' && <ProgressPanel progress={progress} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-card/55 p-4"><Checkbox checked={setupDcs} onCheckedChange={setSetupDcs} disabled={operation !== null} /><div><p className="flex items-center gap-2 text-sm font-semibold"><BookCopy className="size-4 text-primary" />DCS 官方英文手册</p><p className="mt-1 text-xs leading-5 text-muted-foreground">仅复制英文版，生成独立固定索引。</p></div></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-card/55 p-4"><Checkbox checked={setupChuck} onCheckedChange={setSetupChuck} disabled={operation !== null} /><div><p className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-primary" />全部 Chuck 手册</p><p className="mt-1 text-xs leading-5 text-muted-foreground">下载量较大，也可以稍后在设置中按机型选择。</p></div></label>
            </div>
            <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-primary" />DeepSeek API（可稍后设置）</div><Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" disabled={operation !== null} /><p className="mt-2 text-[11px] leading-5 text-muted-foreground">手册问答固定使用 V4 Flash；主动在线搜索使用 V4 Pro MAX。</p></div>
          </div>
          <DialogFooter className="mt-6 gap-2"><Button variant="ghost" onClick={() => void completeInitialSetup(false)} disabled={operation !== null}>{operation === 'setup' ? <LoaderCircle className="size-4 animate-spin" /> : null}稍后设置</Button><Button onClick={() => void completeInitialSetup(true)} disabled={operation !== null || (apiKey.length > 0 && apiKey.trim().length < 10)}>{operation === 'setup' ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}开始初始化</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
