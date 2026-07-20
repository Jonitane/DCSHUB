import { useCallback, useEffect, useState } from 'react'
import { BookCopy, BookOpenText, ChevronDown, CircleAlert, Download, FolderOpen, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import type { ChuckGuideCatalogItem, ManualLibraryOverview, ManualLibraryProgress } from '@/shared/manual-library-contracts'

function ProgressLine({ progress }: { progress: ManualLibraryProgress }) {
  return <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium">{progress.message}</p>{progress.itemName && <p className="mt-1 truncate text-[10px] text-muted-foreground">{progress.itemName}</p>}</div><span className="shrink-0 font-mono text-xs text-primary">{progress.percent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} /></div></div>
}

export default function ManualLibrarySettingsCard() {
  const bridge = window.electronAPI?.manualLibrary
  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState<ManualLibraryOverview | null>(null)
  const [catalog, setCatalog] = useState<ChuckGuideCatalogItem[]>([])
  const [selectedGuides, setSelectedGuides] = useState<Set<string>>(new Set())
  const [operation, setOperation] = useState<string | null>(null)
  const [progress, setProgress] = useState<ManualLibraryProgress | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [duplicateCleanupOpen, setDuplicateCleanupOpen] = useState(false)
  const [removableDuplicates, setRemovableDuplicates] = useState(0)

  const refresh = useCallback(async () => {
    if (!bridge) return
    const [nextOverview, nextCatalog] = await Promise.all([bridge.overview(), bridge.chuckCatalog()])
    setOverview(nextOverview)
    setCatalog(nextCatalog)
  }, [bridge])

  useEffect(() => { void refresh().catch((reason) => toast.error('读取超级手册设置失败', { description: reason instanceof Error ? reason.message : String(reason) })) }, [refresh])
  useEffect(() => bridge?.onProgress(setProgress), [bridge])

  const toggleGuide = (id: string) => {
    setSelectedGuides((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllMissing = () => {
    setSelectedGuides(new Set(catalog.filter((g) => !g.installed).map((g) => g.id)))
  }
  const clearSelection = () => setSelectedGuides(new Set())
  const finish = () => { setOperation(null); window.setTimeout(() => setProgress(null), 900) }
  const run = async (name: string, task: () => Promise<void>) => {
    setOperation(name)
    try { await task() } catch (reason) { toast.error('操作失败', { description: reason instanceof Error ? reason.message : String(reason) }) } finally { finish() }
  }

  const chooseLibrary = () => run('directory', async () => {
    const next = await bridge?.chooseLibraryDirectory()
    if (!next) return
    setOverview(next)
    toast.success(next.onboardingCompleted ? '手册库目录已更新' : '目录已选择，请进入超级手册完成首次设置')
  })

  const importDcs = () => run('dcs', async () => {
    const result = await bridge!.importDcsManuals()
    if (result.overview) setOverview(result.overview)
    if (result.ok) toast.success(result.message)
    else toast.error('导入失败', { description: result.message })
    if (result.removableDuplicates > 0) {
      setRemovableDuplicates(result.removableDuplicates)
      setDuplicateCleanupOpen(true)
    }
  })

  const downloadSelected = () => run('chuck-selected', async () => {
    const ids = Array.from(selectedGuides)
    if (ids.length === 0) { toast.error('请先选择要下载的手册'); return }
    const result = await bridge!.downloadSelectedChuckGuides(ids)
    if (result.overview) setOverview(result.overview)
    if (result.ok) { toast.success(result.message); clearSelection() }
    else toast.error('部分下载失败', { description: result.message })
    await refresh()
  })

  const downloadAll = () => run('chuck-all', async () => {
    const result = await bridge!.downloadAllChuckGuides()
    if (result.overview) setOverview(result.overview)
    if (result.ok) toast.success(result.message)
    else toast.error('部分下载失败', { description: result.message })
    await refresh()
  })

  const saveApi = () => run('api-save', async () => {
    const next = await bridge!.configureDeepSeek(apiKey)
    setOverview(next)
    setApiKey('')
    toast.success('DeepSeek 已连接，API Key 已加密保存')
  })

  const testApi = () => run('api-test', async () => { toast.success((await bridge!.testDeepSeek()).message) })
  const clearApi = () => run('api-clear', async () => { setOverview(await bridge!.clearDeepSeek()); toast.success('DeepSeek API Key 已清除') })
  const removeDuplicates = () => run('deduplicate', async () => {
    const result = await bridge!.removeDuplicateDcsManuals()
    if (result.overview) setOverview(result.overview)
    setDuplicateCleanupOpen(false)
    toast.success(result.message)
  })

  const busy = operation !== null
  const installedCount = catalog.filter((guide) => guide.installed).length

  return (
    <Card className="overflow-hidden border-border/45 bg-card/75">
      <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-accent/15" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><BookOpenText className="size-5 text-primary" /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">超级手册</p><p className="mt-1 text-xs text-muted-foreground">手册目录、内容来源与 DeepSeek API</p></div>
        <span className="text-xs text-muted-foreground">{overview?.index.documentCount || 0} 份手册</span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180 text-primary' : ''}`} />
      </button>
      {open && <CardContent className="space-y-4 border-t border-border/35 p-5">
        {progress && busy && <ProgressLine progress={progress} />}
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/35 bg-background/45 p-3"><FolderOpen className="size-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">手册库目录</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={overview?.libraryPath || undefined}>{overview?.libraryPath || '尚未设置'}</p></div><Button size="sm" variant="outline" onClick={() => void chooseLibrary()} disabled={busy}>{operation === 'directory' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择目录</Button></div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><BookCopy className="size-4 text-primary" />DCS 官方英文手册</div><p className="mt-2 text-xs leading-5 text-muted-foreground">只复制英文版；官方索引仅在此处更新，不受用户手册刷新影响。</p><Button className="mt-4 w-full" size="sm" variant="outline" onClick={() => void importDcs()} disabled={busy || !overview?.configured}>{operation === 'dcs' ? <LoaderCircle className="size-3.5 animate-spin" /> : <BookCopy className="size-3.5" />}复制或更新英文手册</Button></div>
          <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-primary" />Chuck's Guides</span><span className="text-[10px] text-muted-foreground">{installedCount}/{catalog.length} 已入库</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">勾选多个机型一起批量下载；Chuck讲解最全面，问答优先级更高。</p><div className="mt-3 space-y-2"><div className="flex items-center gap-2"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={selectAllMissing} disabled={busy}>全选未下载</Button><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearSelection} disabled={busy || selectedGuides.size === 0}>清空选择</Button><span className="ml-auto text-[10px] text-muted-foreground">已选 {selectedGuides.size} 项</span></div><div className="h-[180px] overflow-y-auto rounded-lg border border-border/35 bg-background/60 p-1"><div className="space-y-0.5 p-1">{catalog.map((guide) => (<label key={guide.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/20"><Checkbox checked={selectedGuides.has(guide.id)} onCheckedChange={() => toggleGuide(guide.id)} disabled={busy} /><span className="flex-1">{guide.displayName}</span>{guide.installed && <Check className="size-3 text-emerald-400" aria-label="已入库" />}</label>))}</div></div><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={() => void downloadSelected()} disabled={busy || !overview?.configured || selectedGuides.size === 0}>{operation === 'chuck-selected' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}下载选中 ({selectedGuides.size})</Button><Button size="sm" variant="outline" onClick={() => void downloadAll()} disabled={busy || !overview?.configured}>{operation === 'chuck-all' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}下载全部缺失</Button></div></div></div></div>

        <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-primary" />DeepSeek API</div>{overview?.deepSeek.configured ? <div className="flex flex-wrap items-center gap-3"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/7 p-3"><ShieldCheck className="size-4 text-emerald-400" /><div><p className="text-xs font-medium">API Key 已安全保存</p><p className="mt-1 text-[10px] text-muted-foreground">手册问答：V4 Flash · 在线搜索：V4 Pro MAX</p></div></div><Button size="sm" variant="outline" onClick={() => void testApi()} disabled={busy}>{operation === 'api-test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}测试</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void clearApi()} disabled={busy}><Trash2 className="size-3.5" />重新配置</Button></div> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-1.5"><Label htmlFor="settings-deepseek-key">API Key</Label><Input id="settings-deepseek-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" /></div><Button className="self-end" onClick={() => void saveApi()} disabled={busy || apiKey.trim().length < 10}>{operation === 'api-save' ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}测试并保存</Button></div>}<p className="mt-3 text-[10px] leading-5 text-muted-foreground">普通手册问答固定使用 V4 Flash 无思考模式；用户主动点击“在线搜索”时才使用 V4 Pro MAX。密钥使用 Windows 当前用户凭据加密保存。</p></div>
      </CardContent>}

      <Dialog open={duplicateCleanupOpen} onOpenChange={(next) => { if (!busy) setDuplicateCleanupOpen(next) }}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><CircleAlert className="size-5 text-amber-400" />发现重复官方手册</DialogTitle><DialogDescription>有 {removableDuplicates} 份手册同时存在于用户目录和 DCSHUB 管理的“DCS Manuals”目录。是否移除后者？用户自己放入的手册不会被删除。</DialogDescription></DialogHeader><DialogFooter className="mt-6 gap-2"><Button variant="outline" onClick={() => setDuplicateCleanupOpen(false)} disabled={busy}>保留</Button><Button variant="destructive" onClick={() => void removeDuplicates()} disabled={busy}>{operation === 'deduplicate' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除重复副本</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  )
}
