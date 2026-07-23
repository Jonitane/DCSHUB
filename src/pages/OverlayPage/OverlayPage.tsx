import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  X,
  LoaderCircle,
  Maximize2,
  Send,
  Sparkles,
  GripVertical,
  Globe,
  ExternalLink,
  Scaling,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { ManualAnswerMarkdown, ManualImageLightbox, manualPreviewSources, useManualAnswerNavigation } from '@/components/manual/ManualAnswerRenderer'
import type {
  ManualLibraryOverview,
  ManualPagePreview,
  ManualQuestionAnswer,
  ManualOnlineSearchAnswer,
} from '@/shared/manual-library-contracts'
import type { OverlayDisplayMode, OverlaySettings, SpeechRecognitionState } from '@/shared/window-contracts'

function formatOverlayHotkey(hotkey: string): string {
  return hotkey.replace(/^num([0-9])$/i, 'Num $1')
}

const VOICE_REVIEW_DELAY_MS = 1_600

function OverlayAnswer({
  response,
  previews,
  loading,
}: {
  response: ManualQuestionAnswer
  previews: ManualPagePreview[]
  loading: boolean
}) {
  const {
    sourcePreviews,
    previewItems: allPreviewsWithSources,
    currentIndex: currentPreviewIndex,
    setCurrentIndex: setCurrentPreviewIndex,
    activeCitation,
    jumpToSource,
    previewSourceOnHover,
  } = useManualAnswerNavigation(response, previews)
  const [expandedPreview, setExpandedPreview] = useState(false)
  const imagePanelRef = useRef<HTMLElement>(null)
  const wheelTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    setExpandedPreview(false)
  }, [response])

  const current = allPreviewsWithSources[currentPreviewIndex]
  const hasImages = allPreviewsWithSources.length > 0

  const goToPrev = useCallback(() => {
    setCurrentPreviewIndex((currentIndex) => Math.max(0, currentIndex - 1))
  }, [setCurrentPreviewIndex])
  const goToNext = useCallback(() => {
    setCurrentPreviewIndex((currentIndex) => Math.min(allPreviewsWithSources.length - 1, currentIndex + 1))
  }, [allPreviewsWithSources.length, setCurrentPreviewIndex])

  const queueWheelPage = useCallback((deltaY: number) => {
    if (Math.abs(deltaY) < 15) return
    if (wheelTimeoutRef.current) window.clearTimeout(wheelTimeoutRef.current)
    wheelTimeoutRef.current = window.setTimeout(() => {
      if (deltaY > 0) goToNext()
      else goToPrev()
    }, 80)
  }, [goToNext, goToPrev])

  useEffect(() => {
    const panel = imagePanelRef.current
    if (!panel) return
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 15) return
      event.preventDefault()
      event.stopPropagation()
      queueWheelPage(event.deltaY)
    }
    panel.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      panel.removeEventListener('wheel', handleWheel)
      if (wheelTimeoutRef.current) window.clearTimeout(wheelTimeoutRef.current)
    }
  }, [hasImages, queueWheelPage])

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="min-w-0 flex-1 overflow-y-auto pr-2">
        <ManualAnswerMarkdown answer={response.answer} sourcePreviews={sourcePreviews} activeCitation={activeCitation} onCitationClick={jumpToSource} onCitationHover={previewSourceOnHover} variant="compact" />

      </div>

      {hasImages && (
        <aside ref={imagePanelRef} className="flex w-[350px] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-primary/20 bg-background/60" title="悬停后滚动滚轮切换页面">
          <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border/40 px-2.5 py-2">
            <div className="flex items-center gap-1">
              {allPreviewsWithSources.length > 1 && (
                <>
                  <button type="button" onClick={goToPrev} disabled={currentPreviewIndex === 0}
                    className={cn('flex size-5 items-center justify-center rounded transition-colors',
                      currentPreviewIndex === 0 ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:bg-white/10'
                    )}>
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <button type="button" onClick={goToNext} disabled={currentPreviewIndex === allPreviewsWithSources.length - 1}
                    className={cn('flex size-5 items-center justify-center rounded transition-colors',
                      currentPreviewIndex === allPreviewsWithSources.length - 1 ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:bg-white/10'
                    )}>
                    <ChevronRight className="size-3.5" />
                  </button>
                </>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {currentPreviewIndex + 1}/{allPreviewsWithSources.length}
              </span>
              {loading && <span className="ml-1 flex items-center gap-1 text-[9px] text-muted-foreground"><LoaderCircle className="size-2.5 animate-spin" />补全引用页</span>}
            </div>
            <button type="button" onClick={() => setExpandedPreview(true)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors">
              <Maximize2 className="size-3" />放大
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-white/95 p-2">
            <button
              type="button"
              className="group relative flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden"
              onClick={() => current && setExpandedPreview(true)}
              title="点击放大"
            >
              {current && (
                <img
                  src={current.preview.imageDataUrl}
                  alt={`${current.preview.documentName} 第 ${current.preview.page} 页`}
                  className="max-h-full max-w-full object-contain transition-transform group-hover:scale-[1.01]"
                />
              )}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/5 group-hover:opacity-100">
                <span className="flex items-center gap-1 rounded-full bg-black/65 px-3 py-1.5 text-[10px] font-medium text-white">
                  <Maximize2 className="size-3" />点击放大
                </span>
              </span>
            </button>
          </div>
          {current && (
            <div className="shrink-0 border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold text-primary">S{current.sourceNumber}</span>
              <span className="mx-1">·</span>
              <span className="truncate">第 {current.preview.page} 页</span>
            </div>
          )}
          {allPreviewsWithSources.length > 1 && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border/40 p-1.5">
              {allPreviewsWithSources.map((item, index) => (
                <button
                  key={`${item.preview.documentId}:${item.preview.page}:thumb`}
                  type="button"
                  onClick={() => setCurrentPreviewIndex(index)}
                  className={cn(
                    'relative shrink-0 overflow-hidden rounded border-2 transition-all',
                    index === currentPreviewIndex ? 'border-primary shadow-sm shadow-primary/30' : 'border-transparent opacity-50 hover:opacity-90'
                  )}
                >
                  <img src={item.preview.imageDataUrl} alt={`S${item.sourceNumber}`} className="h-9 w-auto bg-white object-contain" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/65 text-center text-[8px] font-bold text-white">S{item.sourceNumber}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
      {loading && !hasImages && <aside className="flex w-[350px] min-h-0 shrink-0 animate-pulse flex-col overflow-hidden rounded-xl border border-border/40 bg-background/35"><div className="h-9 border-b border-border/35 bg-muted/25" /><div className="m-2 flex min-h-56 flex-1 items-center justify-center rounded-lg bg-white/8 text-[11px] text-muted-foreground"><LoaderCircle className="mr-2 size-3.5 animate-spin" />正在生成页面预览…</div></aside>}

      {expandedPreview && current && <ManualImageLightbox preview={current.preview} onClose={() => setExpandedPreview(false)} onWheel={queueWheelPage} />}
    </div>
  )
}

function OverlayOnlineAnswer({ response }: { response: ManualOnlineSearchAnswer }) {
  const bridge = window.electronAPI?.manualLibrary
  const openSource = (url: string) => {
    bridge?.openOnlineSource(url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-cyan-400">
        <Globe className="size-3.5" />联网搜索 · {response.model}{response.cached && <span className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">缓存命中</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-[13px] leading-6 text-white/85">
        <div className="space-y-2 prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-white prose-strong:text-white prose-code:text-cyan-200 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-cyan-300 hover:prose-a:text-cyan-200 prose-pre:bg-white/5 prose-pre:border prose-pre:border-white/10">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {response.answer}
          </ReactMarkdown>
        </div>
      </div>
      {response.sources.length > 0 && (
        <div className="mt-3 shrink-0 border-t border-white/10 pt-2">
          <div className="mb-1.5 text-[10px] font-semibold text-white/50">来源</div>
          <div className="flex flex-wrap gap-1.5">
            {response.sources.map((s, i) => (
              <button key={i} type="button" onClick={() => openSource(s.url)}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-cyan-300/90 hover:bg-white/10 hover:text-cyan-200 transition-colors">
                <ExternalLink className="size-3 shrink-0" />
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OverlayPage() {
  const { language } = useI18n()
  const answerLanguage = language === 'en-US' ? 'en' : 'zh'
  const bridge = window.electronAPI?.manualLibrary
  const overlay = window.electronAPI?.overlay
  const [overview, setOverview] = useState<ManualLibraryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<ManualQuestionAnswer | null>(null)
  const [onlineResponse, setOnlineResponse] = useState<ManualOnlineSearchAnswer | null>(null)
  const [asking, setAsking] = useState(false)
  const [askingOnline, setAskingOnline] = useState(false)
  const [pagePreviews, setPagePreviews] = useState<ManualPagePreview[]>([])
  const [previewsLoading, setPreviewsLoading] = useState(false)
  const previewRequestRef = useRef(0)
  const [displayMode, setDisplayMode] = useState<OverlayDisplayMode>('desktop')
  const [runtimeSettings, setRuntimeSettings] = useState<OverlaySettings | null>(null)
  const [speechState, setSpeechState] = useState<SpeechRecognitionState>({ state: 'idle' })
  const vrPointerRef = useRef<HTMLSpanElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const askRef = useRef<(voiceQuestion?: string) => Promise<void>>(async () => undefined)
  const voiceSubmitTimerRef = useRef<number | null>(null)

  const cancelVoiceSubmit = useCallback((resetState = true) => {
    if (voiceSubmitTimerRef.current !== null) {
      window.clearTimeout(voiceSubmitTimerRef.current)
      voiceSubmitTimerRef.current = null
    }
    if (resetState) setSpeechState((current) => current.state === 'reviewing' ? { state: 'idle' } : current)
  }, [])

  useEffect(() => () => cancelVoiceSubmit(false), [cancelVoiceSubmit])

  useEffect(() => {
    if (!bridge) return
    bridge.overview().then(setOverview).catch(() => {}).finally(() => setLoading(false))
  }, [bridge])

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent'
    document.body.style.backgroundImage = 'none'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.backgroundColor = 'transparent'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.backgroundColor = ''
      document.body.style.backgroundImage = ''
      document.body.style.overflow = ''
      document.documentElement.style.backgroundColor = ''
      document.documentElement.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay?.hide()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [overlay])

  useEffect(() => {
    if (!overlay) return
    void overlay.getSettings().then(setRuntimeSettings).catch(() => undefined)
    const unsub = overlay.onFocusInput(() => {
      void overlay.getSettings().then(setRuntimeSettings).catch(() => undefined)
      setTimeout(() => textareaRef.current?.focus(), 50)
    })
    return unsub
  }, [overlay])

  useEffect(() => {
    if (!bridge) return
    return bridge.onOverviewChanged((nextOverview) => {
      setOverview(nextOverview)
      setResponse(null)
      setOnlineResponse(null)
      setPagePreviews([])
    })
  }, [bridge])

  useEffect(() => {
    if (!overlay) return
    void overlay.getDisplayMode().then((status) => setDisplayMode(status.mode)).catch(() => undefined)
    return overlay.onDisplayModeChanged((status) => setDisplayMode(status.mode))
  }, [overlay])

  const loadPagePreviews = useCallback(async (answer: ManualQuestionAnswer) => {
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
          console.warn('[manual-library] overlay page preview failed', { documentId: source.documentId, page: source.page, reason })
        }
      }
    } finally {
      if (requestId === previewRequestRef.current) setPreviewsLoading(false)
    }
  }, [bridge])

  const ask = async (voiceQuestion?: string) => {
    const q = (voiceQuestion ?? question).trim()
    if (!bridge || !q || asking) return
    setAsking(true)
    setResponse(null)
    setOnlineResponse(null)
    setPagePreviews([])
    try {
      const cached = await bridge.preferredCachedAnswer(q, answerLanguage)
      if (cached?.kind === 'online') {
        setOnlineResponse(cached.answer)
        void bridge.overview().then(setOverview).catch(() => undefined)
        return
      }
      if (cached?.kind === 'local') {
        setResponse(cached.answer)
        void loadPagePreviews(cached.answer)
        void bridge.overview().then(setOverview).catch(() => undefined)
        return
      }
      const answer = await bridge.ask(q, answerLanguage)
      setResponse(answer)
      void loadPagePreviews(answer)
      void bridge.overview().then(setOverview).catch(() => undefined)
    } catch {
      /* overlay silently ignores errors */
    } finally {
      setAsking(false)
      setQuestion('')
      if (displayMode === 'vr') void overlay?.endTextInput()
      else setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }
  useEffect(() => {
    askRef.current = ask
  })

  useEffect(() => {
    if (!overlay) return
    const removeState = overlay.onSpeechState(setSpeechState)
    const removeResult = overlay.onSpeechResult((text) => {
      cancelVoiceSubmit(false)
      setQuestion(text)
      setSpeechState({ state: 'reviewing', message: '识别完成，1.6 秒后自动提问；可直接修改或按 Enter 立即发送' })
      voiceSubmitTimerRef.current = window.setTimeout(() => {
        voiceSubmitTimerRef.current = null
        setSpeechState({ state: 'idle' })
        void askRef.current(text)
      }, VOICE_REVIEW_DELAY_MS)
    })
    return () => { removeState(); removeResult() }
  }, [cancelVoiceSubmit, overlay])

  const askOnline = async () => {
    if (!bridge || !question.trim() || askingOnline) return
    const q = question.trim()
    setAskingOnline(true)
    setResponse(null)
    setOnlineResponse(null)
    setPagePreviews([])
    try {
      const answer = await bridge.askOnline(q, answerLanguage)
      setOnlineResponse(answer)
      void bridge.overview().then(setOverview).catch(() => undefined)
    } catch {
      /* overlay silently ignores errors */
    } finally {
      setAskingOnline(false)
      setQuestion('')
      if (displayMode === 'vr') void overlay?.endTextInput()
      else setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const close = () => {
    cancelVoiceSubmit()
    overlay?.hide()
  }

  const configured = overview?.configured && overview.ai.configured && overview.index.chunkCount > 0

  // Both modes fill their own host window. Electron gives desktop mode a compact
  // movable window and VR mode a 1200x750 capture surface.
  const panelWidth = '100vw'
  const panelMaxHeight = '100vh'

  const dragRef = useRef<{ lastX: number; lastY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (displayMode !== 'vr') return
    e.preventDefault()
    dragRef.current = { lastX: e.clientX, lastY: e.clientY }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.lastX
      const dy = ev.clientY - dragRef.current.lastY
      dragRef.current.lastX = ev.clientX
      dragRef.current.lastY = ev.clientY
      void overlay?.moveVr(dx / Math.max(1, window.innerWidth), -dy / Math.max(1, window.innerHeight))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [displayMode, overlay])

  const onResizeStart = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = {
      startX: event.screenX,
      startY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const onMove = (moveEvent: MouseEvent) => {
      const start = resizeRef.current
      if (!start) return
      const width = Math.min(2_000, Math.max(400, start.width + moveEvent.screenX - start.startX))
      const height = Math.min(1_600, Math.max(300, start.height + moveEvent.screenY - start.startY))
      void overlay?.setSize(width, height)
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [overlay])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center overflow-hidden"
      style={{ background: 'transparent' }}
      onPointerUpCapture={(event) => {
        if (displayMode !== 'vr') return
        const target = event.target as HTMLElement
        if (!target.closest('[data-overlay-text-input]')) {
          window.setTimeout(() => { void overlay?.endTextInput() }, 0)
        }
      }}
      onMouseMove={(event) => {
        if (displayMode !== 'vr' || !vrPointerRef.current) return
        vrPointerRef.current.style.display = 'block'
        vrPointerRef.current.style.left = `${event.clientX}px`
        vrPointerRef.current.style.top = `${event.clientY}px`
      }}
      onMouseLeave={() => {
        if (vrPointerRef.current) vrPointerRef.current.style.display = 'none'
      }}
    >
      {displayMode === 'vr' && <span
        ref={vrPointerRef}
        aria-hidden="true"
        className="pointer-events-none fixed z-[999] hidden size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-[0_0_10px_rgba(255,120,20,0.85)]"
      />}
      <div
        className={`relative flex flex-col overflow-hidden border border-white/10 bg-black/80 backdrop-blur-xl shadow-2xl ${displayMode === 'desktop' ? 'rounded-2xl' : ''}`}
        style={{
          width: panelWidth,
          height: panelMaxHeight,
          maxHeight: panelMaxHeight,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between border-b border-white/10 px-4 py-2.5 active:cursor-grabbing select-none"
        style={{ WebkitAppRegion: displayMode === 'desktop' ? 'drag' : 'no-drag' } as React.CSSProperties}
        onMouseDown={onDragStart}
        title={displayMode === 'vr' ? '拖动可移动并固定 VR 面板位置' : '拖动可移动面板'}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="size-4 text-white/30" />
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-semibold text-white/90">超级手册</span>
          {overview && (
            <span className="text-[10px] text-white/40 tabular-nums">
              缓存 {overview.answerCache.totalEntries.toLocaleString()} 条 · 本地 {overview.answerCache.localEntries} / 联网 {overview.answerCache.onlineEntries}
            </span>
          )}
          {displayMode === 'vr' && runtimeSettings && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
              {formatOverlayHotkey(runtimeSettings.hotkey)} 呼出/隐藏 · 每次呼出自动回中
            </span>
          )}
        </div>
        <button type="button" onClick={close}
          className="flex size-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
          title="关闭 (Esc)">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-white/50">
            <LoaderCircle className="mr-2 size-4 animate-spin" />加载中…
          </div>
        ) : !configured ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/60">
            <p className="text-sm mb-2">超级手册尚未配置</p>
            <p className="text-xs text-white/40">请先在主界面完成手册索引和API配置</p>
          </div>
        ) : asking || askingOnline ? (
          <div className="flex h-full items-center justify-center text-xs text-white/50">
            <LoaderCircle className="mr-2 size-4 animate-spin" />{askingOnline ? '联网搜索中…' : '思考中…'}
          </div>
        ) : onlineResponse ? (
          <OverlayOnlineAnswer response={onlineResponse} />
        ) : response ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-primary/90">
              <Bot className="size-3.5" />{response.model}{response.cached && <span className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">缓存命中</span>}
            </div>
            <div className="min-h-0 flex-1">
              <OverlayAnswer response={response} previews={pagePreviews} loading={previewsLoading} />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/40">
            <Sparkles className="mb-3 size-8 opacity-30" />
            <p className="text-sm text-white/60">输入问题开始提问</p>
            <p className="mt-1 text-xs text-white/30">Enter 本地问答 · Ctrl+Enter 联网搜索</p>
          </div>
        )}
      </div>

      {configured && (
        <div className="shrink-0 border-t border-white/10 p-3">
          {speechState.state !== 'idle' && <div className={cn('mb-2 rounded-lg border px-3 py-2 text-xs', speechState.state === 'error' ? 'border-red-400/30 bg-red-500/10 text-red-200' : speechState.state === 'reviewing' ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-primary/30 bg-primary/10 text-primary')}><span className={speechState.state === 'recording' ? 'animate-pulse' : ''}>{speechState.message || (speechState.state === 'recording' ? '正在录音' : speechState.state === 'reviewing' ? '等待发送' : '正在识别')}</span></div>}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              data-overlay-text-input
              onPointerDown={() => {
                if (displayMode === 'vr') void overlay?.beginTextInput()
              }}
              value={question}
              onChange={(e) => {
                cancelVoiceSubmit()
                setQuestion(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  cancelVoiceSubmit()
                  if (e.ctrlKey || e.metaKey) {
                    if (!askingOnline && question.trim()) void askOnline()
                  } else {
                    if (!asking && question.trim()) void ask()
                  }
                }
              }}
              placeholder="输入问题… (Enter本地问答 · Ctrl+Enter联网 · Shift+Enter换行)"
              rows={1}
              className="min-h-[36px] max-h-[100px] flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors"
            />
            <button
              type="button"
              onClick={() => {
                cancelVoiceSubmit()
                void askOnline()
              }}
              disabled={askingOnline || !question.trim()}
              title="联网搜索 (Ctrl+Enter)"
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg transition-all',
                askingOnline || !question.trim()
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-cyan-600/80 text-white hover:bg-cyan-500 shadow-lg shadow-cyan-500/20'
              )}
            >
              {askingOnline ? <LoaderCircle className="size-4 animate-spin" /> : <Globe className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                cancelVoiceSubmit()
                void ask()
              }}
              disabled={asking || !question.trim()}
              title="本地问答 (Enter)"
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg transition-all',
                asking || !question.trim()
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20'
              )}
            >
              {asking ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label="调整内置手册窗口大小"
        title={displayMode === 'vr' ? '拖动调整 VR 膝板大小' : '拖动调整桌面膝板大小'}
        className="absolute bottom-1 right-1 z-50 flex size-6 cursor-nwse-resize items-center justify-center rounded text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onMouseDown={onResizeStart}
      >
        <Scaling className="size-3.5" />
      </button>
      </div>
    </div>
  )
}
