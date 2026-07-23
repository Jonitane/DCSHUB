import { Children, Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManualPagePreview, ManualQuestionAnswer } from '@/shared/manual-library-contracts'

export interface ManualPreviewItem {
  preview: ManualPagePreview
  sourceNumber: number
}

/**
 * Keep the image rail aligned with citations that actually appear in the
 * answer.  The answer service currently returns at most 16 sources, so loading
 * every referenced PDF page remains bounded while avoiding an arbitrary UI
 * cutoff such as the old first-five/first-six limit.
 */
export function manualPreviewSources(response: ManualQuestionAnswer) {
  const cited = [...response.answer.matchAll(/\[S(\d+)\]/g)]
    .map((match) => Number(match[1]) - 1)
    .filter((index, position, indexes) => index >= 0 && index < response.sources.length && indexes.indexOf(index) === position)
  const indexes = cited.length > 0 ? cited : response.sources.map((_source, index) => index)
  const seen = new Set<string>()
  return indexes.flatMap((index) => {
    const source = response.sources[index]
    if (!source?.page || !source.sourcePath.toLocaleLowerCase().endsWith('.pdf')) return []
    const key = `${source.documentId}:${source.page}`
    if (seen.has(key)) return []
    seen.add(key)
    return [source]
  })
}

export function useManualAnswerNavigation(
  response: ManualQuestionAnswer,
  previews: ManualPagePreview[],
  onExpand?: (preview: ManualPagePreview) => void,
) {
  const previewByPage = useMemo(
    () => new Map(previews.map((preview) => [`${preview.documentId}:${preview.page}`, preview])),
    [previews],
  )
  const sourcePreviews = useMemo(
    () => response.sources.map((source) => source.page ? previewByPage.get(`${source.documentId}:${source.page}`) : undefined),
    [response.sources, previewByPage],
  )
  const previewItems = useMemo(() => {
    const seen = new Set<string>()
    return previews.flatMap((preview) => {
      const key = `${preview.documentId}:${preview.page}`
      if (seen.has(key)) return []
      const sourceIndex = response.sources.findIndex((source) => source.page === preview.page && source.documentId === preview.documentId)
      if (sourceIndex < 0) return []
      seen.add(key)
      return [{ preview, sourceNumber: sourceIndex + 1 }]
    })
  }, [previews, response.sources])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [activeCitation, setActiveCitation] = useState<number | null>(null)

  useEffect(() => {
    setCurrentIndex(0)
    setActiveCitation(null)
  }, [response])

  useEffect(() => {
    if (previewItems.length === 0) setCurrentIndex(0)
    else if (currentIndex >= previewItems.length) setCurrentIndex(previewItems.length - 1)
  }, [currentIndex, previewItems.length])

  const selectSource = useCallback((sourceNumber: number, expand: boolean) => {
    const source = response.sources[sourceNumber - 1]
    if (!source?.page) return
    const previewKey = `${source.documentId}:${source.page}`
    const index = previewItems.findIndex((item) => `${item.preview.documentId}:${item.preview.page}` === previewKey)
    if (index < 0) return
    setCurrentIndex(index)
    setActiveCitation(sourceNumber)
    if (expand) onExpand?.(previewItems[index].preview)
  }, [onExpand, previewItems, response.sources])

  return {
    sourcePreviews,
    previewItems,
    currentIndex,
    setCurrentIndex,
    activeCitation,
    jumpToSource: (sourceNumber: number) => selectSource(sourceNumber, true),
    previewSourceOnHover: (sourceNumber: number) => selectSource(sourceNumber, false),
  }
}

interface ManualAnswerMarkdownProps {
  answer: string
  sourcePreviews: Array<ManualPagePreview | undefined>
  activeCitation: number | null
  onCitationClick: (sourceNumber: number) => void
  onCitationHover: (sourceNumber: number) => void
  variant: 'full' | 'compact'
}

function CitationBadge({
  sourceNumber,
  active,
  compact,
  onClick,
  onMouseEnter,
}: {
  sourceNumber: number
  active: boolean
  compact: boolean
  onClick: () => void
  onMouseEnter: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "relative -top-[0.45em] mx-[1px] inline-block cursor-pointer border-0 bg-transparent p-0 text-[0.5em] font-black leading-none align-baseline transition-colors after:absolute after:-inset-1 after:content-['']",
        active
          ? 'text-primary underline decoration-2 underline-offset-1'
          : compact
            ? 'text-amber-300/90 hover:text-amber-200'
            : 'text-amber-500/90 hover:text-amber-400',
      )}
      title={`S${sourceNumber}：悬停预览页面，点击放大查看`}
    >
      S{sourceNumber}
    </button>
  )
}

function renderCitations(
  text: string,
  sourcePreviews: Array<ManualPagePreview | undefined>,
  activeCitation: number | null,
  compact: boolean,
  onCitationClick: (sourceNumber: number) => void,
  onCitationHover: (sourceNumber: number) => void,
): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = /\[S(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    const sourceNumber = Number(match[1])
    const valid = sourceNumber >= 1 && sourceNumber <= sourcePreviews.length
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <CitationBadge
        key={`cite-${key++}`}
        sourceNumber={sourceNumber}
        active={activeCitation === sourceNumber}
        compact={compact}
        onClick={() => valid && onCitationClick(sourceNumber)}
        onMouseEnter={() => valid && onCitationHover(sourceNumber)}
      />,
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

export function ManualAnswerMarkdown({
  answer,
  sourcePreviews,
  activeCitation,
  onCitationClick,
  onCitationHover,
  variant,
}: ManualAnswerMarkdownProps) {
  const compact = variant === 'compact'
  const processChildren = useCallback((children: ReactNode): ReactNode => Children.map(children, (child, index) => (
    typeof child === 'string'
      ? <Fragment key={index}>{renderCitations(child, sourcePreviews, activeCitation, compact, onCitationClick, onCitationHover)}</Fragment>
      : child
  )), [activeCitation, compact, onCitationClick, onCitationHover, sourcePreviews])

  const components = useMemo<Components>(() => compact ? {
    h1: ({ children }) => <h2 className="mb-2 mt-0.5 text-base font-semibold text-foreground">{processChildren(children)}</h2>,
    h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-foreground">{processChildren(children)}</h3>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-foreground">{processChildren(children)}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-2.5 text-[13px] font-semibold text-foreground">{processChildren(children)}</h4>,
    p: ({ children }) => <p className="my-1.5 text-[13px] leading-[1.55] text-foreground/90">{processChildren(children)}</p>,
    ul: ({ children }) => <ul className="my-2 space-y-1 pl-4 text-[13px] leading-[1.55] [list-style-type:disc] marker:text-primary">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 space-y-1.5 pl-4 text-[13px] leading-[1.55] [list-style-type:decimal] marker:text-primary">{children}</ol>,
    li: ({ children }) => <li className="text-foreground/90">{processChildren(children)}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{processChildren(children)}</strong>,
    blockquote: ({ children }) => <blockquote className="my-1.5 ml-1.5 border-l-2 border-primary/40 py-0.5 pl-2 text-[12px] leading-[1.5] text-foreground/70">{processChildren(children)}</blockquote>,
    code: ({ children }) => <code className="rounded bg-muted/60 px-1 py-0 font-mono text-[0.85em] font-medium text-primary">{children}</code>,
    hr: () => <hr className="my-3 border-border/40" />,
  } : {
    h1: ({ children }) => <h2 className="mb-2 mt-5 text-base font-semibold text-foreground">{processChildren(children)}</h2>,
    h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-foreground">{processChildren(children)}</h3>,
    h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground">{processChildren(children)}</h3>,
    h4: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold text-foreground">{processChildren(children)}</h4>,
    p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground/90">{processChildren(children)}</p>,
    ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-5 text-sm leading-7 [list-style-type:disc] marker:text-primary">{children}</ul>,
    ol: ({ children }) => <ol className="my-3 space-y-2 pl-5 text-sm leading-7 [list-style-type:decimal] marker:text-primary">{children}</ol>,
    li: ({ children }) => <li className="text-foreground/90">{processChildren(children)}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{processChildren(children)}</strong>,
    blockquote: ({ children }) => <blockquote className="my-1.5 ml-0 border-l-2 border-primary/30 px-2.5 py-0.5 text-[12.5px] leading-[1.5] text-foreground/65">{processChildren(children)}</blockquote>,
    code: ({ children }) => <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.88em] font-medium text-primary">{children}</code>,
    table: ({ children }) => <div className="my-4 overflow-x-auto rounded-lg border border-border/60"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
    th: ({ children }) => <th className="border-b border-border/60 bg-muted/55 px-3 py-2 font-semibold">{processChildren(children)}</th>,
    td: ({ children }) => <td className="border-b border-border/35 px-3 py-2 align-top leading-5">{processChildren(children)}</td>,
    hr: () => <hr className="my-6 border-border/40" />,
  }, [compact, processChildren])

  // Render the complete Markdown document in one parser pass. Splitting on
  // blank lines caused every ordered-list block to restart at 1 and broke
  // nested explanations away from their parent step.
  return <div className={compact ? 'min-w-0 space-y-0.5 pb-2' : 'min-w-0 space-y-1'}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{answer}</ReactMarkdown>
  </div>
}

export function ManualImageLightbox({
  preview,
  onClose,
  onWheel,
  onOpenDocument,
}: {
  preview: ManualPagePreview
  onClose: () => void
  onWheel?: (deltaY: number) => void
  onOpenDocument?: (preview: ManualPagePreview) => void
}) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      onWheel={(event) => {
        if (!onWheel) return
        event.preventDefault()
        event.stopPropagation()
        onWheel(event.deltaY)
      }}
      title="滚动滚轮切换页面 · 点击图片关闭"
    >
      <div className="relative flex max-h-full max-w-full items-center justify-center">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-black/75 px-2.5 py-1.5 text-xs text-white/90 shadow-lg hover:bg-black/90 hover:text-white">
          <X className="size-3.5" />关闭
        </button>
        <img src={preview.imageDataUrl} alt={`${preview.documentName} 第 ${preview.page} 页`} onClick={onClose} className="max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] cursor-zoom-out rounded object-contain" />
        {onOpenDocument && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenDocument(preview) }} className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg bg-black/75 px-2.5 py-1.5 text-xs text-white/90 shadow-lg hover:bg-black/90 hover:text-white"><ExternalLink className="size-3.5" />定位到原手册</button>}
      </div>
    </div>
  )
}
