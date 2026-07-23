import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { ManualAnswerMarkdown, ManualImageLightbox, manualPreviewSources, useManualAnswerNavigation } from '@/components/manual/ManualAnswerRenderer'
import type {
  ManualDocumentRecord,
  ManualAiProvider,
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
  const version = document.sourceVersion ? ` · ${document.sourceVersion}` : ''
  if (document.sourceKind === 'user') return `${document.isTranslation ? '用户汉化版' : '用户资料'}${document.translatedFrom ? ` · 基于 ${document.translatedFrom === 'chuck' ? 'Chuck' : 'DCS 官方'}` : ''}${version}`
  if (document.sourceKind === 'chuck') return `Chuck's Guides${version}`
  const moduleType = document.officialModuleType === 'full-fidelity' ? '全点击模组' : document.officialModuleType === 'non-full-click' ? '非全点击模组' : '未识别模组类型'
  return `DCS 官方 · ${moduleType}${version}`
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

function FocusExitControl({ onExit }: { onExit: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="app-no-drag pointer-events-auto fixed right-5 top-4 z-[2500]">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-10 gap-2 border-primary/35 bg-background px-4 text-sm font-semibold shadow-xl hover:border-primary/60 hover:bg-accent"
        onClick={onExit}
        title="退出专注模式（也可以按 Esc）"
      >
        <Minimize2 className="size-4" />退出专注
      </Button>
    </div>,
    document.body,
  )
}

function FixedImagePanel({
  previews,
  loading,
  currentIndex,
  onIndexChange,
  onExpand,
}: {
  previews: Array<{ preview: ManualPagePreview; sourceNumber: number }>
  loading: boolean
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
      panel.removeEventListener('wheel', handleWheel)
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

  if (previews.length === 0) {
    if (!loading) return null
    return (
      <aside className="hidden self-stretch xl:block xl:min-w-0">
        <div className="sticky top-3 overflow-hidden rounded-xl border border-border/50 bg-background/45 shadow-sm">
          <div className="flex h-10 items-center justify-between border-b border-border/40 px-3 text-[11px] text-muted-foreground"><span>引用页面</span><span className="flex items-center gap-1"><LoaderCircle className="size-3 animate-spin" />正在生成预览</span></div>
          <div className="flex h-[460px] items-center justify-center bg-muted/15"><LoaderCircle className="size-7 animate-spin text-primary/55" /></div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hidden self-stretch xl:block xl:min-w-0">
      <div
        ref={panelRef}
        className="sticky top-3 flex flex-col overflow-hidden rounded-xl border border-primary/20 bg-background/70 shadow-sm"
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
            {loading && <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />补全引用页</span>}
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
                  'mx-auto max-h-[min(58vh,560px)] w-auto max-w-full object-contain transition-all duration-300',
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

function AnswerWithPageImages({ response, previews, loading, onExpand }: {
  response: ManualQuestionAnswer
  previews: ManualPagePreview[]
  loading: boolean
  onExpand: (preview: ManualPagePreview) => void
}) {
  const {
    sourcePreviews,
    previewItems: allPreviewsWithSources,
    currentIndex: currentPreviewIndex,
    setCurrentIndex: setCurrentPreviewIndex,
    activeCitation,
    jumpToSource,
    previewSourceOnHover,
  } = useManualAnswerNavigation(response, previews, onExpand)

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,36%)]">
      <div className="min-w-0 flex-1">
        <ManualAnswerMarkdown answer={response.answer} sourcePreviews={sourcePreviews} activeCitation={activeCitation} onCitationClick={jumpToSource} onCitationHover={previewSourceOnHover} variant="full" />

        {!loading && allPreviewsWithSources.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-border/50 bg-background/20 px-4 py-3 text-center text-xs text-muted-foreground">
            本次回答暂无 PDF 页面预览
          </div>
        )}
      </div>

      <FixedImagePanel
        previews={allPreviewsWithSources}
        loading={loading}
        currentIndex={currentPreviewIndex}
        onIndexChange={setCurrentPreviewIndex}
        onExpand={onExpand}
      />
    </div>
  )
}

export default function ManualLibraryPage() {
  const { language } = useI18n()
  const answerLanguage = language === 'en-US' ? 'en' : 'zh'
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
  const [setupProvider, setSetupProvider] = useState<ManualAiProvider>('deepseek')
  const [setupBaseUrl, setSetupBaseUrl] = useState('https://dashscope.aliyuncs.com/compatible-mode/v1')
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<ManualQuestionAnswer | null>(null)
  const [answeredQuestion, setAnsweredQuestion] = useState('')
  const [onlineResponse, setOnlineResponse] = useState<ManualOnlineSearchAnswer | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pagePreviews, setPagePreviews] = useState<ManualPagePreview[]>([])
  const [previewsLoading, setPreviewsLoading] = useState(false)
  const previewRequestRef = useRef(0)
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
  useEffect(() => bridge?.onProgress((nextProgress) => {
    setProgress(nextProgress)
    // Startup can perform a lightweight source-metadata migration in the
    // background. Refresh the document list as soon as it completes so an
    // already-open library dialog never keeps showing the old category.
    if (nextProgress.stage === 'complete') void refresh()
  }), [bridge, refresh])

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
    const requestId = ++previewRequestRef.current
    const unique = manualPreviewSources(answer)
    setPagePreviews([])
    if (unique.length === 0) return
    setPreviewsLoading(true)
    try {
      for (const source of unique) {
        try {
          const preview = await bridge.pagePreview(source.documentId, source.page!)
          if (requestId !== previewRequestRef.current) return
          if (preview) setPagePreviews((current) => [...current, preview])
        } catch (reason) {
          console.warn('[manual-library] page preview failed', { documentId: source.documentId, page: source.page, reason })
        }
      }
    } finally {
      if (requestId === previewRequestRef.current) setPreviewsLoading(false)
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
        setOverview(await bridge.configureAiProvider(setupProvider, apiKey, setupProvider === 'deepseek' ? undefined : setupBaseUrl))
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
      const cached = await bridge.preferredCachedAnswer(submittedQuestion, answerLanguage)
      if (cached?.kind === 'online') {
        setOnlineResponse(cached.answer)
        setAnsweredQuestion(submittedQuestion)
        void bridge.overview().then(setOverview).catch(() => undefined)
        return
      }
      if (cached?.kind === 'local') {
        setResponse(cached.answer)
        setAnsweredQuestion(submittedQuestion)
        void loadPagePreviews(cached.answer)
        void bridge.overview().then(setOverview).catch(() => undefined)
        return
      }
      const answer = await bridge.ask(submittedQuestion, answerLanguage)
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

  const clearAnswerCaches = async () => {
    if (!bridge) return
    setOperation('clear-answer-cache')
    try {
      const next = await bridge.clearAnswerCaches()
      setOverview(next)
      toast.success('问答缓存已清除', { description: '本地与联网回答缓存均已删除，手册索引和预览缓存未受影响。' })
    } catch (reason) {
      toast.error('清除问答缓存失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const askOnline = async () => {
    if (!bridge || !answeredQuestion) return
    setOperation('online-search')
    try {
      setOnlineResponse(await bridge.askOnline(answeredQuestion, answerLanguage))
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
  const onlineProvider = overview?.ai.providers.find((item) => item.id === overview.ai.online.provider)
  const onlineConfigured = Boolean(onlineProvider?.configured && onlineProvider.supportsOnlineSearch)

  return (
    <div className="space-y-6">
      {progress && operation && <ProgressPanel progress={progress} />}

      {!overview?.configured ? (
        <Card className="border-primary/25 bg-card/75"><CardContent className="flex min-h-[460px] flex-col items-center justify-center text-center"><div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25"><BookOpenText className="size-8 text-primary" /></div><h2 className="text-lg font-semibold">创建本地手册知识库</h2><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">选择一个长期保存手册的目录。首次处理会显示实时进度，之后只分析新增或发生变化的用户手册。</p><Button className="mt-6" onClick={() => void chooseLibrary()} disabled={operation !== null}>{operation === 'library' ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}选择手册库目录</Button></CardContent></Card>
      ) : (
        <>
          <div className="grid gap-5">
            {askFocusMode && <><div className="app-no-drag fixed inset-0 z-[90] bg-background/92 backdrop-blur-md" /><FocusExitControl onExit={exitFocusMode} /></>}

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
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">问答缓存</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{overview.answerCache.totalEntries.toLocaleString()}<span className="ml-1 text-xs font-normal text-muted-foreground">条</span></p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">本地 {overview.answerCache.localEntries} · 联网 {overview.answerCache.onlineEntries} · {formatCacheSize(overview.answerCache.size)}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-destructive" disabled={operation !== null || overview.answerCache.totalEntries === 0} onClick={() => void clearAnswerCaches()} title="只清除本地与联网问答缓存"><Trash2 className="size-3.5" />一键清除</Button>
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

            <Card className={cn('border-primary/20 bg-card/75', askFocusMode && 'app-no-drag fixed inset-3 z-[100] flex flex-col overflow-hidden border-primary/35 bg-card/98 shadow-2xl')}>
              <CardHeader className={cn('shrink-0 pb-4', askFocusMode && 'pr-40')}><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" />超级手册</CardTitle><div className="flex shrink-0 items-center gap-2">{overview.ai.configured ? <Badge variant="outline" className="border-emerald-400/30 bg-emerald-500/8 text-emerald-300">{overview.ai.providers.find((item) => item.id === overview.ai.local.provider)?.name || overview.ai.local.provider} 已连接</Badge> : <Button size="sm" variant="outline" onClick={() => navigate('/settings')}><Settings2 className="size-3.5" />配置 API</Button>}{!askFocusMode && overview?.configured && <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} disabled={operation !== null}><FilePlus2 className="size-4" />添加手册</Button>}</div></div></CardHeader>
              <CardContent className={cn('space-y-4', askFocusMode && 'min-h-0 flex-1 overflow-y-auto px-6 pb-6')}>
                <textarea className={cn('min-h-28 w-full resize-y rounded-xl border border-input bg-background/55 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15', askFocusMode && 'min-h-32 resize-none')} value={question} onFocus={enterFocusMode} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：F-16C 冷启动后怎么对准导航？（Enter 提问，Shift+Enter 换行）" onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.repeat) return; event.preventDefault(); if (operation === null && question.trim() && overview.ai.configured && overview.index.chunkCount > 0) void ask() }} />
                <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" disabled title="截图提问接口已预留"><Camera className="size-4" />截图提问（预留）</Button><Button onClick={() => void ask()} disabled={operation !== null || !question.trim() || !overview.ai.configured || overview.index.chunkCount === 0}>{operation === 'ask' ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}提问</Button></div>
                {response && <div className="space-y-4 border-t border-border/45 pt-4">
                  <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-primary"><Bot className="size-4" />{response.model}{response.cached && <Badge variant="outline" className="ml-1 border-emerald-400/25 bg-emerald-500/8 text-[10px] text-emerald-300">缓存命中</Badge>}</div><AnswerWithPageImages response={response} previews={pagePreviews} loading={previewsLoading} onExpand={setExpandedPreview} /></div>
                  <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.035] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-semibold"><Globe2 className="size-4 text-sky-400" />在线搜索</p><p className="mt-1 text-xs text-muted-foreground">{onlineConfigured ? `使用 ${onlineProvider?.name} · ${overview.ai.online.model}；本地先解析机型、武器和任务语义，再用单次联网请求生成答案，缓存命中时不重复调用 API。` : '尚未配置具备原生联网搜索能力的供应商，请前往设置选择 DeepSeek 或 Qwen。'}</p></div><Button variant="outline" onClick={() => void askOnline()} disabled={operation !== null || !onlineConfigured}>{operation === 'online-search' ? <LoaderCircle className="size-4 animate-spin" /> : <Globe2 className="size-4" />}{onlineResponse ? '重新搜索' : '在线搜索'}</Button></div>{onlineResponse && <div className="mt-4 border-t border-sky-400/15 pt-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-sky-300"><Bot className="size-4" />{onlineResponse.model}{onlineResponse.cached && <Badge variant="outline" className="ml-1 border-emerald-400/25 bg-emerald-500/8 text-[10px] text-emerald-300">缓存命中</Badge>}</div><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground/90">{children}</p>, h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>, h3: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold">{children}</h4>, ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-5 text-sm leading-7 [list-style-type:disc] marker:text-sky-400">{children}</ul>, ol: ({ children }) => <ol className="my-3 space-y-2 pl-5 text-sm leading-7 [list-style-type:decimal] marker:text-sky-400">{children}</ol>, a: ({ href, children }) => <button type="button" className="text-sky-300 underline decoration-sky-400/40 underline-offset-2 hover:text-sky-200" onClick={() => openOnlineSource(href)}>{children}</button> }}>{onlineResponse.answer}</ReactMarkdown>{onlineResponse.sources.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{onlineResponse.sources.map((source) => <button type="button" key={source.url} onClick={() => openOnlineSource(source.url)} className="max-w-full truncate rounded-full border border-sky-400/20 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-200 hover:bg-sky-500/10" title={source.url}>{source.title}</button>)}</div>}</div>}</div>
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
          {overview && <><div className="shrink-0"><Select value={documentCategory} onValueChange={(value) => setDocumentCategory(value as ManualCategory)}><SelectTrigger className="h-9 w-full sm:w-80"><SelectValue>{MANUAL_CATEGORY_LABELS[documentCategory]}（{documentCategory === 'all' ? overview.documents.length : categoryCounts[documentCategory]}）</SelectValue></SelectTrigger><SelectContent>{(['all', 'dcs', 'chuck', 'user'] as ManualCategory[]).map((category) => <SelectItem key={category} value={category}>{MANUAL_CATEGORY_LABELS[category]}（{category === 'all' ? overview.documents.length : categoryCounts[category]}）</SelectItem>)}</SelectContent></Select></div><div className="min-h-0 flex-1 overflow-y-auto pr-1"><div className="grid gap-2 sm:grid-cols-2">{visibleDocuments.length === 0 ? <div className="col-span-full flex min-h-56 flex-col items-center justify-center text-center text-sm text-muted-foreground"><FileText className="mb-3 size-8 opacity-40" /><p>当前分类中没有手册</p><p className="mt-1 text-xs">可以切换其他分类或添加新手册</p></div> : visibleDocuments.map((document) => <button key={document.id} type="button" className="flex w-full items-center gap-3 rounded-lg border border-border/35 bg-background/30 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5" onClick={() => void bridge?.openDocument(document.id)}><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60"><FileText className="size-4 text-primary/80" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{documentSourceDetail(document)} · {document.aircraft || document.language.toUpperCase()} · {document.pageCount} 页</p></div><ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" /></button>)}</div></div></>}
        </DialogContent>
      </Dialog>

      {expandedPreview && <ManualImageLightbox preview={expandedPreview} onClose={() => setExpandedPreview(null)} onOpenDocument={(preview) => void bridge?.openDocument(preview.documentId, preview.page)} />}

      <Dialog open={addOpen} onOpenChange={(open) => { if (operation === null) setAddOpen(open) }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>添加手册</DialogTitle><DialogDescription>可以一次选择或拖入多本手册；缓存完成后窗口会保持开启，方便继续添加。相同内容不会重复入库。</DialogDescription></DialogHeader>
          <div
            className={`mt-4 flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center transition-colors ${dragActive ? 'border-primary bg-primary/10 ring-2 ring-primary/15' : 'border-border/70 bg-background/35 hover:border-primary/45 hover:bg-primary/[0.035]'}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragActive(true) }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); importDroppedFiles(event.dataTransfer.files) }}
          >
            {operation === 'manual-import' ? <LoaderCircle className="mb-4 size-10 animate-spin text-primary" /> : <UploadCloud className={`mb-4 size-10 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`} />}
            <p className="text-sm font-semibold">{operation === 'manual-import' ? '正在复制并索引手册…' : '把一本或多本手册拖到这里'}</p>
            <p className="mt-2 text-xs text-muted-foreground">支持 PDF、DOCX、EPUB、HTML、Markdown、TXT 和 RTF</p>
            <Button className="mt-5" variant="outline" onClick={chooseManualFiles} disabled={operation !== null}><FilePlus2 className="size-4" />选择一个或多个文件</Button>
          </div>
          {progress && operation === 'manual-import' && <ProgressPanel progress={progress} />}
        </DialogContent>
      </Dialog>

      <Dialog open={setupOpen} onOpenChange={(open) => { if (operation === null && open) setSetupOpen(true) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>首次设置超级手册</DialogTitle><DialogDescription>选择手册来源和 AI 供应商。模型与思考强度可随时在“设置”中调整。</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            {progress && operation === 'setup' && <ProgressPanel progress={progress} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-card/55 p-4"><Checkbox checked={setupDcs} onCheckedChange={setSetupDcs} disabled={operation !== null} /><div><p className="flex items-center gap-2 text-sm font-semibold"><BookCopy className="size-4 text-primary" />DCS 官方英文手册</p><p className="mt-1 text-xs leading-5 text-muted-foreground">仅复制英文版，生成独立固定索引。</p></div></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-card/55 p-4"><Checkbox checked={setupChuck} onCheckedChange={setSetupChuck} disabled={operation !== null} /><div><p className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-primary" />全部 Chuck 手册</p><p className="mt-1 text-xs leading-5 text-muted-foreground">下载量较大，也可以稍后在设置中按机型选择。</p></div></label>
            </div>
            <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-primary" />AI API（可稍后设置）</div><div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]"><Select value={setupProvider} onValueChange={(value) => { const next = value as ManualAiProvider; setSetupProvider(next); setSetupBaseUrl(next === 'siliconflow' ? 'https://api.siliconflow.cn/v1' : next === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : 'https://api.deepseek.com') }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="siliconflow">硅基流动</SelectItem><SelectItem value="qwen">Qwen（阿里云百炼）</SelectItem></SelectContent></Select><Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API Key" disabled={operation !== null} /></div>{setupProvider !== 'deepseek' && <Input className="mt-3" value={setupBaseUrl} onChange={(event) => setSetupBaseUrl(event.target.value)} placeholder="OpenAI 兼容 API 地址" disabled={operation !== null} />}<p className="mt-2 text-[11px] leading-5 text-muted-foreground">DeepSeek 自动使用默认组合；硅基流动和 Qwen 的模型与思考强度可在设置中调整。硅基流动本身不提供原生联网搜索。</p></div>
          </div>
          <DialogFooter className="mt-6 gap-2"><Button variant="ghost" onClick={() => void completeInitialSetup(false)} disabled={operation !== null}>{operation === 'setup' ? <LoaderCircle className="size-4 animate-spin" /> : null}稍后设置</Button><Button onClick={() => void completeInitialSetup(true)} disabled={operation !== null || (apiKey.length > 0 && apiKey.trim().length < 10)}>{operation === 'setup' ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}开始初始化</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
