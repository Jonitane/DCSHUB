import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookCopy,
  BookOpenText,
  Bot,
  Camera,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  ChuckGuideCatalogItem,
  DeepSeekConfigurationStatus,
  ManualLibraryOverview,
  ManualQuestionAnswer,
} from '@/shared/manual-library-contracts'

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

function sourceLabel(source: 'user' | 'dcs' | 'chuck'): string {
  if (source === 'dcs') return 'DCS 客户端'
  if (source === 'chuck') return "Chuck's Guides"
  return '用户手册'
}

export default function ManualLibraryPage() {
  const bridge = window.electronAPI?.manualLibrary
  const [overview, setOverview] = useState<ManualLibraryOverview | null>(null)
  const [catalog, setCatalog] = useState<ChuckGuideCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<DeepSeekConfigurationStatus['model']>('deepseek-v4-flash')
  const [selectedGuide, setSelectedGuide] = useState('')
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<ManualQuestionAnswer | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge) return
    setLoading(true)
    try {
      const [nextOverview, nextCatalog] = await Promise.all([bridge.overview(), bridge.chuckCatalog()])
      setOverview(nextOverview)
      setModel(nextOverview.deepSeek.model)
      setCatalog(nextCatalog)
      setSelectedGuide((current) => current || nextCatalog.find((guide) => !guide.installed)?.id || nextCatalog[0]?.id || '')
    } catch (reason) {
      toast.error('智能手册加载失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => { void refresh() }, [refresh])

  const selectedCatalogGuide = useMemo(() => catalog.find((guide) => guide.id === selectedGuide), [catalog, selectedGuide])

  const chooseLibrary = async () => {
    if (!bridge) return
    setOperation('library')
    try {
      const next = await bridge.chooseLibraryDirectory()
      if (next) {
        setOverview(next)
        toast.success('手册库目录已设置')
      }
    } catch (reason) {
      toast.error('设置手册库失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const rebuildIndex = async () => {
    if (!bridge) return
    setOperation('index')
    try {
      const result = await bridge.rebuildIndex(false)
      if (result.overview) setOverview(result.overview)
      if (result.ok) toast.success(result.message)
      else toast.error('索引失败', { description: result.message })
    } catch (reason) {
      toast.error('索引失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const importDcsManuals = async () => {
    if (!bridge) return
    setOperation('dcs')
    try {
      const result = await bridge.importDcsManuals()
      if (result.overview) setOverview(result.overview)
      if (result.ok) toast.success(result.message)
      else toast.error('DCS 手册导入失败', { description: result.message })
      setCatalog(await bridge.chuckCatalog())
    } catch (reason) {
      toast.error('DCS 手册导入失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const saveDeepSeek = async () => {
    if (!bridge) return
    setOperation('deepseek')
    try {
      const next = await bridge.configureDeepSeek(apiKey, model)
      setOverview(next)
      setApiKey('')
      toast.success('DeepSeek 已连接，API Key 已加密保存')
    } catch (reason) {
      toast.error('DeepSeek 连接失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const testDeepSeek = async () => {
    if (!bridge) return
    setOperation('deepseek-test')
    try {
      const result = await bridge.testDeepSeek()
      toast.success(result.message)
    } catch (reason) {
      toast.error('DeepSeek 连接失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const clearDeepSeek = async () => {
    if (!bridge) return
    setOperation('deepseek-clear')
    try {
      setOverview(await bridge.clearDeepSeek())
      toast.success('DeepSeek API Key 已清除')
    } catch (reason) {
      toast.error('清除失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const downloadChuckGuide = async () => {
    if (!bridge || !selectedGuide) return
    setOperation('chuck')
    try {
      const result = await bridge.downloadChuckGuide(selectedGuide)
      if (result.overview) setOverview(result.overview)
      if (result.ok) toast.success(result.message)
      else toast.error('下载失败', { description: result.message })
      setCatalog(await bridge.chuckCatalog())
    } catch (reason) {
      toast.error('Chuck 手册下载失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const ask = async () => {
    if (!bridge || !question.trim()) return
    setOperation('ask')
    setResponse(null)
    try {
      setResponse(await bridge.ask(question))
    } catch (reason) {
      toast.error('提问失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  if (loading && !overview) {
    return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取永久索引…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">DCS 智能手册</h1><Badge variant="outline" className="border-primary/30 bg-primary/8 text-primary">永久索引</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">多语言本地手册库 · DeepSeek 文字问答 · 精确来源引用</p>
        </div>
        {overview?.configured && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void chooseLibrary()} disabled={operation !== null}><FolderOpen className="size-4" />更换目录</Button>
            <Button size="sm" variant="outline" onClick={() => void rebuildIndex()} disabled={operation !== null}>{operation === 'index' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}增量刷新</Button>
          </div>
        )}
      </div>

      {!overview?.configured ? (
        <Card className="border-primary/25 bg-card/75">
          <CardContent className="flex min-h-[460px] flex-col items-center justify-center text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25"><BookOpenText className="size-8 text-primary" /></div>
            <h2 className="text-lg font-semibold">创建本地手册知识库</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">选择一个长期保存手册的目录。DCSHUB 只在首次导入或手动刷新时处理文件，之后直接读取永久缓存，不会在后台反复扫描。</p>
            <Button className="mt-6" onClick={() => void chooseLibrary()} disabled={operation !== null}>{operation === 'library' ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}选择手册库目录</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card className="border-border/45 bg-card/70"><CardContent className="flex items-center gap-3 p-4"><Database className="size-6 text-primary" /><div><p className="text-xl font-semibold">{overview.index.documentCount}</p><p className="text-[11px] text-muted-foreground">已索引手册</p></div></CardContent></Card>
            <Card className="border-border/45 bg-card/70"><CardContent className="flex items-center gap-3 p-4"><FileText className="size-6 text-sky-400" /><div><p className="text-xl font-semibold">{overview.index.pageCount}</p><p className="text-[11px] text-muted-foreground">可检索页面</p></div></CardContent></Card>
            <Card className="border-border/45 bg-card/70"><CardContent className="flex items-center gap-3 p-4"><Search className="size-6 text-violet-400" /><div><p className="text-xl font-semibold">{overview.index.chunkCount}</p><p className="text-[11px] text-muted-foreground">永久检索片段</p></div></CardContent></Card>
            <Card className="border-border/45 bg-card/70"><CardContent className="flex items-center gap-3 p-4"><HardDrive className="size-6 text-emerald-400" /><div><p className="text-xl font-semibold">{formatSize(overview.index.cacheSize)}</p><p className="text-[11px] text-muted-foreground">本地索引缓存</p></div></CardContent></Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <div className="space-y-5">
              <Card className="border-primary/20 bg-card/75">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" />向手册提问</CardTitle><CardDescription className="mt-1">自动检索对应语言和术语，只向 DeepSeek 发送命中的少量文字片段。</CardDescription></div><Badge variant="outline" className={overview.deepSeek.configured ? 'border-emerald-400/30 bg-emerald-500/8 text-emerald-300' : ''}>{overview.deepSeek.configured ? 'DeepSeek 已连接' : '尚未配置 API'}</Badge></div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <textarea
                    className="min-h-28 w-full resize-y rounded-xl border border-input bg-background/55 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="例如：F/A-18C 冷启动时 INS 应该如何设置？"
                    onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void ask() }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="outline" disabled title="接口已预留；当前 DeepSeek 仅支持文字"><Camera className="size-4" />截图提问（预留）</Button>
                    <Button onClick={() => void ask()} disabled={operation !== null || !question.trim() || !overview.deepSeek.configured || overview.index.chunkCount === 0}>{operation === 'ask' ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}提问</Button>
                  </div>
                  {response && (
                    <div className="space-y-4 border-t border-border/45 pt-4">
                      <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary"><Bot className="size-4" />{response.model}</div><div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{response.answer}</div></div>
                      <div><p className="mb-2 text-xs font-semibold text-muted-foreground">引用来源</p><div className="space-y-2">{response.sources.map((source, index) => <button key={source.id} type="button" className="flex w-full items-start gap-3 rounded-lg border border-border/45 bg-background/35 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5" onClick={() => void bridge?.openDocument(source.documentId)}><Badge variant="outline" className="mt-0.5 shrink-0">S{index + 1}</Badge><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{source.documentName}{source.page ? ` · 第 ${source.page} 页` : ''}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{source.excerpt}</p></div><ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground" /></button>)}</div></div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/45 bg-card/70">
                <CardHeader className="pb-4"><CardTitle className="flex items-center gap-2 text-base"><BookCopy className="size-4 text-sky-400" />手册来源</CardTitle><CardDescription>复制操作不会修改 DCS 客户端中的原文件。</CardDescription></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/45 bg-background/35 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><BookOpenText className="size-4 text-sky-400" />DCS 客户端手册</div><p className="mt-2 text-xs leading-5 text-muted-foreground">自动查找各机型和地图模块的 Doc 目录，复制到知识库并增量索引。</p><Button className="mt-4 w-full" variant="outline" onClick={() => void importDcsManuals()} disabled={operation !== null}>{operation === 'dcs' ? <LoaderCircle className="size-4 animate-spin" /> : <BookCopy className="size-4" />}复制 DCS 手册</Button></div>
                  <div className="rounded-xl border border-border/45 bg-background/35 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-amber-400" />Chuck's Guides</div><p className="mt-2 text-xs leading-5 text-muted-foreground">从 Chuck 官方页面下载用户主动选择的机型手册，不随 DCSHUB 分发。</p><div className="mt-3 flex gap-2"><Select value={selectedGuide} onValueChange={setSelectedGuide}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="选择机型" /></SelectTrigger><SelectContent>{catalog.map((guide) => <SelectItem key={guide.id} value={guide.id}>{guide.displayName}{guide.installed ? ' · 已入库' : ''}</SelectItem>)}</SelectContent></Select><Button className="shrink-0" variant="outline" onClick={() => void downloadChuckGuide()} disabled={operation !== null || !selectedGuide}>{operation === 'chuck' ? <LoaderCircle className="size-4 animate-spin" /> : selectedCatalogGuide?.installed ? <RefreshCw className="size-4" /> : <Download className="size-4" />}{selectedCatalogGuide?.installed ? '更新' : '下载'}</Button></div></div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="border-violet-400/20 bg-card/75">
                <CardHeader className="pb-4"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-violet-300" />DeepSeek API</CardTitle><CardDescription>密钥使用 Windows 当前用户凭据加密保存。</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {overview.deepSeek.configured ? (
                    <>
                      <div className="flex items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-500/7 p-3"><ShieldCheck className="size-5 text-emerald-400" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">API Key 已安全保存</p><p className="text-[11px] text-muted-foreground">模型：{overview.deepSeek.model}</p></div><CheckCircle2 className="size-4 text-emerald-400" /></div>
                      <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => void testDeepSeek()} disabled={operation !== null}>{operation === 'deepseek-test' ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}测试连接</Button><Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void clearDeepSeek()} disabled={operation !== null}><Trash2 className="size-4" />重新配置</Button></div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2"><Label htmlFor="deepseek-key">API Key</Label><Input id="deepseek-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" /></div>
                      <div className="space-y-2"><Label>回答模型</Label><Select value={model} onValueChange={(value) => setModel(value as DeepSeekConfigurationStatus['model'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deepseek-v4-flash">V4 Flash · 快速低成本</SelectItem><SelectItem value="deepseek-v4-pro">V4 Pro · 更强理解</SelectItem></SelectContent></Select></div>
                      <Button className="w-full" onClick={() => void saveDeepSeek()} disabled={operation !== null || apiKey.trim().length < 10}>{operation === 'deepseek' ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}测试并保存</Button>
                    </>
                  )}
                  <p className="text-[11px] leading-5 text-muted-foreground">当前仅发送问题和最相关的手册文字片段。截图接口已预留，但 DeepSeek 暂不支持图片输入。</p>
                </CardContent>
              </Card>

              <Card className="border-border/45 bg-card/70">
                <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base">已入库手册</CardTitle><Badge variant="outline">{overview.documents.length}</Badge></div><CardDescription className="truncate" title={overview.libraryPath || ''}>{overview.libraryPath}</CardDescription></CardHeader>
                <CardContent><div className="max-h-[440px] space-y-1.5 overflow-y-auto pr-1">{overview.documents.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground"><FileText className="mb-3 size-8 opacity-40" /><p>目录中还没有可检索手册</p><p className="mt-1 text-xs">复制 DCS 手册或自行放入文件后刷新</p></div> : overview.documents.map((document) => <button key={document.id} type="button" className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors hover:border-border/55 hover:bg-accent/35" onClick={() => void bridge?.openDocument(document.id)}><div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60"><FileText className="size-4 text-primary/80" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{document.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{sourceLabel(document.sourceKind)} · {document.language.toUpperCase()} · {document.pageCount} 页</p></div><ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" /></button>)}</div></CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
