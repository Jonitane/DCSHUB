import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ManualLibraryOverview,
  ManualPagePreview,
  ManualQuestionAnswer,
  ManualOnlineSearchAnswer,
} from '@/shared/manual-library-contracts'

function processTextWithCitations(
  text: string,
  sourcePreviews: Array<ManualPagePreview | undefined>,
  activeSource: number | null,
  onCitationClick: (sourceNumber: number) => void,
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
      <button
        key={`cite-${key++}`}
        type="button"
        onClick={() => validSource && onCitationClick(sourceNumber)}
        className={cn(
          'mx-0.5 inline-flex items-center rounded px-1 py-0 text-[0.7em] font-bold transition-all cursor-pointer align-baseline ring-1',
          activeSource === sourceNumber
            ? 'bg-primary text-primary-foreground ring-primary shadow-sm scale-105'
            : 'bg-amber-400/20 text-amber-300 ring-amber-400/40 hover:bg-amber-400/30 hover:scale-105'
        )}
      >
        S{sourceNumber}
      </button>
    )

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function OverlayAnswer({
  response,
  previews,
  loading,
}: {
  response: ManualQuestionAnswer
  previews: ManualPagePreview[]
  loading: boolean
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
  const [expandedPreview, setExpandedPreview] = useState(false)

  useEffect(() => {
    setCurrentPreviewIndex(0)
    setActiveCitation(null)
    setExpandedPreview(false)
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
        return processTextWithCitations(children, sourcePreviews, activeCitation, jumpToSource)
      }
      if (Array.isArray(children)) {
        return children.map((child, i) => {
          if (typeof child === 'string') {
            return <Fragment key={i}>{processTextWithCitations(child, sourcePreviews, activeCitation, jumpToSource)}</Fragment>
          }
          return child
        })
      }
      return children
    }

    return {
      h1: ({ children }: any) => <h2 className="mb-2 mt-0.5 text-base font-bold tracking-tight text-foreground">{processChildren(children)}</h2>,
      h2: ({ children }: any) => <h3 className="mb-2 mt-4 flex items-center gap-1.5 border-l-2 border-primary pl-2 text-sm font-bold text-foreground">{processChildren(children)}</h3>,
      h3: ({ children }: any) => <h4 className="mb-1.5 mt-3 text-[13px] font-semibold text-foreground/95">{processChildren(children)}</h4>,
      p: ({ children }: any) => <p className="my-2 text-[13px] leading-[1.7] text-foreground/90">{processChildren(children)}</p>,
      ul: ({ children }: any) => <ul className="my-2.5 space-y-1.5 pl-4 text-[13px] leading-[1.65] [list-style-type:disc] marker:text-primary">{children}</ul>,
      ol: ({ children }: any) => <ol className="my-2.5 space-y-2 pl-0 text-[13px] leading-[1.7] [list-style-type:decimal] marker:text-primary">{children}</ol>,
      li: ({ children }: any) => <li className="text-foreground/90">{processChildren(children)}</li>,
      strong: ({ children }: any) => <strong className="font-semibold text-foreground">{processChildren(children)}</strong>,
      blockquote: ({ children }: any) => <blockquote className="my-1.5 ml-1.5 border-l-2 border-primary/40 pl-2 py-0.5 text-[12px] leading-[1.5] text-foreground/70">{processChildren(children)}</blockquote>,
      code: ({ children }: any) => <code className="rounded bg-muted/60 px-1 py-0 font-mono text-[0.85em] text-primary font-medium">{children}</code>,
      hr: () => <hr className="my-3 border-border/40" />,
    }
  }

  const markdown = (content: string) => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>
      {content}
    </ReactMarkdown>
  )

  const current = allPreviewsWithSources[currentPreviewIndex]
  const hasImages = allPreviewsWithSources.length > 0

  const goToPrev = () => setCurrentPreviewIndex(Math.max(0, currentPreviewIndex - 1))
  const goToNext = () => setCurrentPreviewIndex(Math.min(allPreviewsWithSources.length - 1, currentPreviewIndex + 1))

  return (
    <div ref={answerContainerRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-0.5 pb-2">
          {paragraphs.map((paragraph, paragraphIndex) => (
            <div key={`${paragraphIndex}:${paragraph.slice(0, 20)}`} className="min-w-0">
              {markdown(paragraph)}
            </div>
          ))}
        </div>

        {loading && (
          <div className="mt-3 flex h-14 items-center justify-center rounded-lg border border-border/40 bg-black/20 text-xs text-muted-foreground">
            <LoaderCircle className="mr-2 size-3.5 animate-spin" />
            正在加载页面预览…
          </div>
        )}
      </div>

      {hasImages && !expandedPreview && (
        <div className="mt-2 shrink-0 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-1 mb-1.5">
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
            </div>
            <button type="button" onClick={() => setExpandedPreview(true)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors">
              <Maximize2 className="size-3" />放大
            </button>
          </div>
          <div className="relative bg-white/95 rounded overflow-hidden" style={{ maxHeight: '180px' }}>
            {current && (
              <img src={current.preview.imageDataUrl} alt="" className="mx-auto max-h-[180px] w-auto object-contain" />
            )}
          </div>
        </div>
      )}

      {expandedPreview && current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setExpandedPreview(false)}>
          <div className="relative max-h-[95vh] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setExpandedPreview(false)}
              className="absolute -top-8 right-0 flex items-center gap-1 rounded px-2 py-1 text-xs text-white/80 hover:text-white">
              <X className="size-3.5" />关闭
            </button>
            <img src={current.preview.imageDataUrl} alt="" className="max-h-[90vh] max-w-[90vw] object-contain rounded" />
          </div>
        </div>
      )}
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
        <Globe className="size-3.5" />联网搜索 · {response.model}
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    const unsub = overlay.onFocusInput(() => {
      setTimeout(() => textareaRef.current?.focus(), 50)
    })
    return unsub
  }, [overlay])

  const loadPagePreviews = useCallback(async (answer: ManualQuestionAnswer) => {
    if (!bridge) return
    const sources = answer.sources.filter((source) => source.page && source.sourcePath.toLocaleLowerCase().endsWith('.pdf'))
    const unique = [...new Map(sources.map((source) => [`${source.documentId}:${source.page}`, source])).values()].slice(0, 5)
    setPagePreviews([])
    if (unique.length === 0) return
    setPreviewsLoading(true)
    try {
      const previews = await Promise.all(unique.map((source) => bridge.pagePreview(source.documentId, source.page!)))
      setPagePreviews(previews.filter((p): p is ManualPagePreview => Boolean(p)))
    } finally {
      setPreviewsLoading(false)
    }
  }, [bridge])

  const ask = async () => {
    if (!bridge || !question.trim() || asking) return
    const q = question.trim()
    setAsking(true)
    setResponse(null)
    setOnlineResponse(null)
    setPagePreviews([])
    try {
      const answer = await bridge.ask(q)
      setResponse(answer)
      void loadPagePreviews(answer)
    } catch {
      /* overlay silently ignores errors */
    } finally {
      setAsking(false)
      setQuestion('')
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const askOnline = async () => {
    if (!bridge || !question.trim() || askingOnline) return
    const q = question.trim()
    setAskingOnline(true)
    setResponse(null)
    setOnlineResponse(null)
    setPagePreviews([])
    try {
      const answer = await bridge.askOnline(q)
      setOnlineResponse(answer)
    } catch {
      /* overlay silently ignores errors */
    } finally {
      setAskingOnline(false)
      setQuestion('')
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  const close = () => overlay?.hide()

  const configured = overview?.configured && overview.deepSeek.configured && overview.index.chunkCount > 0

  const panelWidth = 680
  const panelMaxHeight = 'min(780px, calc(100vh - 80px))'

  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      const maxX = Math.floor(window.innerWidth / 2 - 40)
      const maxY = Math.floor(window.innerHeight / 2 - 40)
      const nextX = Math.max(-maxX, Math.min(maxX, dragRef.current.origX + dx))
      const nextY = Math.max(-maxY, Math.min(maxY, dragRef.current.origY + dy))
      setPanelPos({ x: nextX, y: nextY })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [panelPos])

  const onDoubleClickHeader = useCallback(() => {
    setPanelPos({ x: 0, y: 0 })
  }, [])

  return (
    <div
      className="flex h-screen w-screen items-center justify-center overflow-hidden"
      style={{ background: 'transparent' }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 backdrop-blur-xl shadow-2xl"
        style={{
          width: panelWidth,
          maxHeight: panelMaxHeight,
          transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between border-b border-white/10 px-4 py-2.5 active:cursor-grabbing select-none"
        onMouseDown={onDragStart}
        onDoubleClick={onDoubleClickHeader}
        title="拖动可移动面板 · 双击复位"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="size-4 text-white/30" />
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-semibold text-white/90">超级手册</span>
          {overview && (
            <span className="text-[10px] text-white/40 tabular-nums">
              {overview.index.chunkCount.toLocaleString()} 片段
            </span>
          )}
        </div>
        <button type="button" onClick={close}
          className="flex size-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors"
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
              <Bot className="size-3.5" />{response.model}
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
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
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
              onClick={() => void askOnline()}
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
              onClick={() => void ask()}
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
      </div>
    </div>
  )
}
