import { useCallback, useEffect, useRef, useState } from 'react'
import { BookCopy, BookOpenText, ChevronDown, CircleAlert, Download, FolderOpen, Gamepad2, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Check, Keyboard, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import type { ChuckGuideCatalogItem, ManualLibraryOverview, ManualLibraryProgress } from '@/shared/manual-library-contracts'
import type { OverlaySettings, VrOverlayStatus } from '@/shared/window-contracts'

function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  let key = e.key
  const code = e.code

  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null

  if (key === ' ' || code === 'Space') key = 'Space'
  else if (key === 'Escape' || key === 'Esc') key = 'Escape'
  else if (key === 'Enter' || key === 'Return') key = 'Enter'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key === 'Backspace') key = 'Backspace'
  else if (key === 'Delete') key = 'Delete'
  else if (key === 'Insert') key = 'Insert'
  else if (key === 'Home') key = 'Home'
  else if (key === 'End') key = 'End'
  else if (key === 'PageUp') key = 'PageUp'
  else if (key === 'PageDown') key = 'PageDown'
  else if (key === 'Tab') key = 'Tab'
  else if (key === 'CapsLock') key = 'CapsLock'
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    // keep F1-F24 as-is
  } else if (/^[a-zA-Z]$/.test(key)) {
    key = key.toUpperCase()
  } else if (/^[0-9]$/.test(key)) {
    // keep 0-9 as-is
  } else if (code.startsWith('Numpad') && code !== 'NumpadAdd' && code !== 'NumpadSubtract' && code !== 'NumpadMultiply' && code !== 'NumpadDivide' && code !== 'NumpadDecimal') {
    const num = code.replace('Numpad', '')
    if (/^[0-9]$/.test(num)) key = `num${num}`
    else return null
  } else if (code === 'NumpadAdd') key = 'numadd'
  else if (code === 'NumpadSubtract') key = 'numsub'
  else if (code === 'NumpadMultiply') key = 'nummult'
  else if (code === 'NumpadDivide') key = 'numdiv'
  else if (code === 'NumpadDecimal') key = 'numdec'
  else if (key === '+' || code === 'Equal') key = 'Plus'
  else if (key === '-' || code === 'Minus') key = '-'
  else if (key === ',' || code === 'Comma') key = ','
  else if (key === '.' || code === 'Period') key = '.'
  else if (key === '/' || code === 'Slash') key = '/'
  else if (key === '\\' || code === 'Backslash') key = '\\'
  else if (key === ';' || code === 'Semicolon') key = ';'
  else if (key === "'" || code === 'Quote') key = "'"
  else if (key === '[' || code === 'BracketLeft') key = '['
  else if (key === ']' || code === 'BracketRight') key = ']'
  else if (key === '`' || code === 'Backquote') key = '`'
  else return null

  parts.push(key)
  return parts.join('+')
}

function formatHotkeyForDisplay(accelerator: string): string {
  return accelerator
    .replace(/num([0-9])/gi, 'Num $1')
    .replace(/numadd/gi, 'Num +')
    .replace(/numsub/gi, 'Num -')
    .replace(/nummult/gi, 'Num ×')
    .replace(/numdiv/gi, 'Num ÷')
    .replace(/numdec/gi, 'Num .')
    .replace(/\+/g, ' + ')
    .replace(/Control/g, 'Ctrl')
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Super/g, 'Win')
    .replace(/Option/g, 'Alt')
}

function HotkeyRecorder({
  settings: externalSettings,
  onChange,
}: {
  settings: OverlaySettings | null
  onChange: (settings: OverlaySettings) => void
}) {
  const overlay = window.electronAPI?.overlay
  const [settings, setSettings] = useState<OverlaySettings | null>(externalSettings)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const recordingBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (externalSettings) setSettings(externalSettings)
  }, [externalSettings])

  useEffect(() => {
    if (!overlay || externalSettings) return
    overlay.getSettings().then(setSettings).catch(() => {})
  }, [overlay, externalSettings])

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        setRecording(false)
        return
      }
      const accel = keyEventToAccelerator(e)
      if (!accel) return
      e.preventDefault()
      e.stopPropagation()
      setRecording(false)
      setSaving(true)
      if (!overlay) {
        setSaving(false)
        return
      }
      overlay.setHotkey(accel)
        .then((next) => {
          setSettings(next)
          onChange(next)
          toast.success('呼出热键已更新')
        })
        .catch((reason) => {
          toast.error('热键设置失败', { description: reason instanceof Error ? reason.message : String(reason) })
        })
        .finally(() => setSaving(false))
    }
    const blurHandler = () => setRecording(false)
    window.addEventListener('keydown', handler, true)
    window.addEventListener('blur', blurHandler)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('blur', blurHandler)
    }
  }, [onChange, recording, overlay])

  const currentHotkey = settings?.hotkey || 'F9'
  const defaultHotkey = 'F9'
  const disabled = !settings?.enabled

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Keyboard className="size-4 text-primary" />
        呼出/隐藏浮窗
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        DCS 运行时按一次呼出、再按一次隐藏；每次呼出都会把 VR 浮窗重新放到当前头部朝向的正前方。支持组合键（如 Ctrl+Alt+K）。
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          ref={recordingBtnRef}
          type="button"
          onClick={() => !saving && !disabled && setRecording(true)}
          disabled={saving || disabled}
          className={`relative min-w-[160px] select-none rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
            disabled
              ? 'cursor-not-allowed border-border/50 bg-background/30 text-muted-foreground/50'
              : recording
              ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30 animate-pulse'
              : 'border-border bg-background/60 text-foreground hover:border-primary/40 hover:bg-primary/5'
          }`}
        >
          {recording ? (
            <span className="flex items-center justify-center gap-2">
              <Keyboard className="size-4" />按下按键组合… (Esc取消)
            </span>
          ) : saving ? (
            <span className="flex items-center justify-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />保存中…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2 font-mono text-[13px]">
              <Keyboard className="size-3.5 opacity-60" />
              {formatHotkeyForDisplay(currentHotkey)}
            </span>
          )}
        </button>
        {settings && currentHotkey !== defaultHotkey && !recording && !saving && !disabled && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (!overlay) return
              setSaving(true)
              overlay.setHotkey(defaultHotkey)
                .then((next) => { setSettings(next); onChange(next); toast.success(`已恢复默认热键 ${formatHotkeyForDisplay(defaultHotkey)}`) })
                .catch((r) => toast.error('恢复失败', { description: r instanceof Error ? r.message : String(r) }))
                .finally(() => setSaving(false))
            }}
          >
            恢复默认
          </Button>
        )}
      </div>
    </div>
  )
}

function ProgressLine({ progress }: { progress: ManualLibraryProgress }) {
  return <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium">{progress.message}</p>{progress.itemName && <p className="mt-1 truncate text-[10px] text-muted-foreground">{progress.itemName}</p>}</div><span className="shrink-0 font-mono text-xs text-primary">{progress.percent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} /></div></div>
}

export default function ManualLibrarySettingsCard() {
  const bridge = window.electronAPI?.manualLibrary
  const overlay = window.electronAPI?.overlay
  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState<ManualLibraryOverview | null>(null)
  const [catalog, setCatalog] = useState<ChuckGuideCatalogItem[]>([])
  const [selectedGuides, setSelectedGuides] = useState<Set<string>>(new Set())
  const [chuckDropdownOpen, setChuckDropdownOpen] = useState(false)
  const [operation, setOperation] = useState<string | null>(null)
  const [progress, setProgress] = useState<ManualLibraryProgress | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [duplicateCleanupOpen, setDuplicateCleanupOpen] = useState(false)
  const [removableDuplicates, setRemovableDuplicates] = useState(0)
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings | null>(null)
  const [vrOverlayStatus, setVrOverlayStatus] = useState<VrOverlayStatus | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge) return
    const [nextOverview, nextCatalog] = await Promise.all([bridge.overview(), bridge.chuckCatalog()])
    setOverview(nextOverview)
    setCatalog(nextCatalog)
  }, [bridge])

  useEffect(() => {
    void refresh().catch((reason) => toast.error('读取超级手册设置失败', { description: reason instanceof Error ? reason.message : String(reason) }))
  }, [refresh])
  useEffect(() => bridge?.onProgress(setProgress), [bridge])
  useEffect(() => {
    overlay?.getSettings().then(setOverlaySettings).catch(() => {})
  }, [overlay])
  useEffect(() => {
    if (!overlay) return
    void overlay.getDisplayMode().then(setVrOverlayStatus).catch(() => undefined)
    return overlay.onDisplayModeChanged(setVrOverlayStatus)
  }, [overlay])

  const toggleOverlayEnabled = (checked: boolean) => {
    if (!overlay) return
    overlay.setEnabled(checked)
      .then((next) => setOverlaySettings(next))
      .catch((r) => toast.error('设置失败', { description: r instanceof Error ? r.message : String(r) }))
  }

  const chuckDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chuckDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (chuckDropdownRef.current && !chuckDropdownRef.current.contains(e.target as Node)) {
        setChuckDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [chuckDropdownOpen])

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
    if (ids.length === 0) { toast.error('请先选择要下载的机型'); return }
    const result = await bridge!.downloadSelectedChuckGuides(ids)
    if (result.overview) setOverview(result.overview)
    if (result.ok) { toast.success(result.message); clearSelection() }
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
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">超级手册</p><p className="mt-1 text-xs text-muted-foreground">手册目录、问答热键与 DeepSeek API</p></div>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180 text-primary' : ''}`} />
      </button>
      {open && <CardContent className="space-y-4 border-t border-border/35 p-5">
        {progress && busy && <ProgressLine progress={progress} />}
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/35 bg-background/45 p-3"><FolderOpen className="size-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">手册库目录</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={overview?.libraryPath || undefined}>{overview?.libraryPath || '尚未设置'}</p></div><Button size="sm" variant="outline" onClick={() => void chooseLibrary()} disabled={busy}>{operation === 'directory' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择目录</Button></div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><BookCopy className="size-4 text-primary" />DCS 官方英文手册</div><p className="mt-2 text-xs leading-5 text-muted-foreground">只复制英文版；官方索引仅在此处更新，不受用户手册刷新影响。</p><Button className="mt-4 w-full" size="sm" variant="outline" onClick={() => void importDcs()} disabled={busy || !overview?.configured}>{operation === 'dcs' ? <LoaderCircle className="size-3.5 animate-spin" /> : <BookCopy className="size-3.5" />}复制或更新英文手册</Button></div>
          <div className="rounded-xl border border-border/35 bg-background/45 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-primary" />Chuck's Guides</span>
              <span className="text-[10px] text-muted-foreground">{installedCount}/{catalog.length} 已入库</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">点击选择多个机型批量下载；Chuck讲解最全面，问答优先级更高。</p>
            <div className="mt-3 flex items-start gap-2">
              <div className="relative flex-1" ref={chuckDropdownRef}>
                <button
                  type="button"
                  onClick={() => setChuckDropdownOpen(!chuckDropdownOpen)}
                  disabled={busy}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className={`min-w-0 flex-1 truncate text-left ${selectedGuides.size === 0 ? 'text-muted-foreground' : ''}`}>
                    {selectedGuides.size === 0
                      ? '选择机型'
                      : selectedGuides.size === 1
                        ? catalog.find((g) => g.id === Array.from(selectedGuides)[0])?.displayName || '已选 1 项'
                        : `已选 ${selectedGuides.size} 个机型`}
                  </span>
                  <div className="flex items-center gap-1">
                    {selectedGuides.size > 0 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); clearSelection() }}
                        className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="size-3" />
                      </span>
                    )}
                    <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${chuckDropdownOpen ? 'rotate-180 text-primary' : ''}`} />
                  </div>
                </button>
                {chuckDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-hidden rounded-xl border bg-popover shadow-xl outline-none">
                    <div className="flex items-center gap-1 border-b p-1.5">
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); selectAllMissing() }} disabled={busy}>
                        全选未下载
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); clearSelection() }} disabled={busy || selectedGuides.size === 0}>
                        清空选择
                      </Button>
                    </div>
                    <div className="max-h-[260px] overflow-y-auto p-1">
                      {catalog.map((guide) => (
                        <label
                          key={guide.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/20 ${guide.installed ? 'opacity-50' : ''}`}
                          onClick={(e) => e.preventDefault()}
                        >
                          <Checkbox
                            checked={selectedGuides.has(guide.id)}
                            onCheckedChange={() => !guide.installed && toggleGuide(guide.id)}
                            disabled={busy || guide.installed}
                            className="size-4"
                          />
                          <span className="flex-1 select-none">{guide.displayName}</span>
                          {guide.installed && <Check className="size-3.5 text-emerald-400" aria-label="已入库" />}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => void downloadSelected()} disabled={selectedGuides.size === 0 || busy || !overview?.configured}>
                {operation === 'chuck-selected' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                下载{selectedGuides.size > 0 && ` (${selectedGuides.size})`}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/35 bg-background/45 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Gamepad2 className="size-4 text-primary" />内置手册窗口</div>
            <Switch checked={overlaySettings?.enabled ?? true} onCheckedChange={toggleOverlayEnabled} />
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">开启后可在 DCS 中使用快捷键呼出或隐藏超级手册。浮窗会自动跟随仪表板的桌面/VR 启动模式。</p>
          {vrOverlayStatus && <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${vrOverlayStatus.mode === 'vr' && vrOverlayStatus.available && !vrOverlayStatus.error ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} /><span>当前跟随：{vrOverlayStatus.mode === 'vr' ? 'VR / OpenXR' : '桌面'}</span>{vrOverlayStatus.mode === 'vr' && (!vrOverlayStatus.available || vrOverlayStatus.error) && <span className="text-amber-400">VR 组件不可用</span>}</div>}
          <div className="mt-4">
            <div className="rounded-lg border border-border/30 bg-background/30 p-3">
              <HotkeyRecorder settings={overlaySettings} onChange={setOverlaySettings} />
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">VR 操作：</span>按呼出键时，浮窗始终出现在当前头部朝向的正前方，并自动消除歪头造成的画布侧倾；显示后会固定在空间中，拖动顶部标题栏可让面板围绕呼出位置做弧形移动。再次隐藏并呼出即可按新的视线方向重新定位。
          </div>
        </div>

        <div className="rounded-xl border border-border/35 bg-background/45 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-primary" />DeepSeek API</div>{overview?.deepSeek.configured ? <div className="flex flex-wrap items-center gap-3"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/7 p-3"><ShieldCheck className="size-4 text-emerald-400" /><div><p className="text-xs font-medium">API Key 已安全保存</p><p className="mt-1 text-[10px] text-muted-foreground">手册问答：V4 Flash · 在线搜索：V4 Pro MAX</p></div></div><Button size="sm" variant="outline" onClick={() => void testApi()} disabled={busy}>{operation === 'api-test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}测试</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void clearApi()} disabled={busy}><Trash2 className="size-3.5" />重新配置</Button></div> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-1.5"><Label htmlFor="settings-deepseek-key">API Key</Label><Input id="settings-deepseek-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" /></div><Button className="self-end" onClick={() => void saveApi()} disabled={busy || apiKey.trim().length < 10}>{operation === 'api-save' ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}测试并保存</Button></div>}<p className="mt-3 text-[10px] leading-5 text-muted-foreground">普通手册问答固定使用 V4 Flash 无思考模式；用户主动点击“在线搜索”时才使用 V4 Pro MAX。密钥使用 Windows 当前用户凭据加密保存。</p></div>
      </CardContent>}

      <Dialog open={duplicateCleanupOpen} onOpenChange={(next) => { if (!busy) setDuplicateCleanupOpen(next) }}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><CircleAlert className="size-5 text-amber-400" />发现重复官方手册</DialogTitle><DialogDescription>有 {removableDuplicates} 份手册同时存在于用户目录和 DCSHUB 管理的“DCS Manuals”目录。是否移除后者？用户自己放入的手册不会被删除。</DialogDescription></DialogHeader><DialogFooter className="mt-6 gap-2"><Button variant="outline" onClick={() => setDuplicateCleanupOpen(false)} disabled={busy}>保留</Button><Button variant="destructive" onClick={() => void removeDuplicates()} disabled={busy}>{operation === 'deduplicate' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除重复副本</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  )
}
