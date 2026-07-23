import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, BookCopy, BookOpenText, ChevronDown, CircleAlert, Download, FolderOpen, Gamepad2, LoaderCircle, Trash2, Check, Keyboard, Mic, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import type { ChuckGuideCatalogItem, ManualLibraryOverview, ManualLibraryProgress } from '@/shared/manual-library-contracts'
import type { OverlaySettings, SpeechInputDevice, SpeechModelStatus, VrOverlayStatus } from '@/shared/window-contracts'
import { keyboardEventToAccelerator } from '@/shared/overlay-hotkey'
import ManualAiSettingsPanel from '@/components/manual/ManualAiSettingsPanel'

function formatHotkeyForDisplay(accelerator: string): string {
  const joystick = /^JOY:(\d+):BUTTON:(\d+)$/i.exec(accelerator)
  if (joystick) return `外设 ${Number(joystick[1]) + 1} · 按钮 ${Number(joystick[2]) + 1}`
  return accelerator
    .replace(/num([0-9])/gi, 'Num $1')
    .replace(/numadd/gi, 'Num +')
    .replace(/numsub/gi, 'Num -')
    .replace(/nummult/gi, 'Num ×')
    .replace(/numdiv/gi, 'Num ÷')
    .replace(/numdec/gi, 'Num .')
    .replace(/Semicolon/gi, ';')
    .replace(/Plus/gi, '+')
    .replace(/Equal/gi, '=')
    .replace(/Comma/gi, ',')
    .replace(/Minus/gi, '-')
    .replace(/Period/gi, '.')
    .replace(/Slash/gi, '/')
    .replace(/Backslash/gi, '\\')
    .replace(/Quote/gi, "'")
    .replace(/LeftBracket/gi, '[')
    .replace(/RightBracket/gi, ']')
    .replace(/Backquote/gi, '`')
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
    let frame = 0
    const initialButtons = new Set<string>()
    for (const gamepad of navigator.getGamepads?.() || []) {
      gamepad?.buttons.forEach((button, index) => { if (button.pressed) initialButtons.add(`${gamepad.index}:${index}`) })
    }
    const pollGamepads = () => {
      for (const gamepad of navigator.getGamepads?.() || []) {
        if (!gamepad) continue
        const buttonIndex = gamepad.buttons.findIndex((button, index) => button.pressed && !initialButtons.has(`${gamepad.index}:${index}`))
        if (buttonIndex < 0) continue
        setRecording(false)
        setSaving(true)
        overlay?.setHotkey(`JOY:${gamepad.index}:BUTTON:${buttonIndex}`)
          .then((next) => { setSettings(next); onChange(next); toast.success('外设呼出按键已更新') })
          .catch((reason) => toast.error('外设按键设置失败', { description: reason instanceof Error ? reason.message : String(reason) }))
          .finally(() => setSaving(false))
        return
      }
      frame = requestAnimationFrame(pollGamepads)
    }
    frame = requestAnimationFrame(pollGamepads)
    const handler = (e: KeyboardEvent) => {
      const accel = keyboardEventToAccelerator(e)
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
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('blur', blurHandler)
    }
  }, [onChange, recording, overlay])

  const currentHotkey = settings?.hotkey || 'Ctrl+Alt+M'
  const defaultHotkey = 'Ctrl+Alt+M'
  const disabled = !settings?.enabled

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Keyboard className="size-4 text-primary" />
        呼出/隐藏浮窗
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        短按呼出或隐藏；长按开始语音输入，松开后自动提问。可自由设置普通单键、组合键、数字键盘键或 Windows Game Controller 外设按钮。
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
              <Keyboard className="size-4" />按下任意按键或外设按钮…
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
        {recording && (
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => setRecording(false)}>
            取消
          </Button>
        )}
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
  const [duplicateCleanupOpen, setDuplicateCleanupOpen] = useState(false)
  const [removableDuplicates, setRemovableDuplicates] = useState(0)
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings | null>(null)
  const [vrOverlayStatus, setVrOverlayStatus] = useState<VrOverlayStatus | null>(null)
  const [microphones, setMicrophones] = useState<SpeechInputDevice[]>([])
  const [speechModel, setSpeechModel] = useState<SpeechModelStatus | null>(null)
  const [manualSourcesOpen, setManualSourcesOpen] = useState(false)
  const [overlayOptionsOpen, setOverlayOptionsOpen] = useState(false)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)

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
    void Promise.all([overlay.listMicrophones(), overlay.speechModelStatus()])
      .then(([devices, model]) => { setMicrophones(devices); setSpeechModel(model) })
      .catch(() => undefined)
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

  const setMicrophone = (microphoneId: string) => {
    if (!overlay) return
    overlay.setMicrophone(microphoneId || null)
      .then(setOverlaySettings)
      .catch((reason) => toast.error('麦克风设置失败', { description: reason instanceof Error ? reason.message : String(reason) }))
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

  const removeDuplicates = () => run('deduplicate', async () => {
    const result = await bridge!.removeDuplicateDcsManuals()
    if (result.overview) setOverview(result.overview)
    setDuplicateCleanupOpen(false)
    toast.success(result.message)
  })

  const busy = operation !== null
  const installedCount = catalog.filter((guide) => guide.installed).length

  return (
    <Card className="overflow-hidden border-border/50 bg-card/78 shadow-[0_12px_32px_hsl(var(--background)/0.2)]">
      <button type="button" className={`flex w-full items-center gap-3.5 border-b border-transparent bg-background/70 p-5 text-left transition-colors hover:bg-background/85 ${open ? 'border-border/45 bg-background/85' : ''}`} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><BookOpenText className="size-5 text-primary" /></div>
        <div className="min-w-0 flex-1"><p className="text-base font-bold tracking-wide">超级手册</p><p className="mt-1 text-xs text-muted-foreground">目录概览与按需展开的功能设置</p></div>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180 text-primary' : ''}`} />
      </button>
      {open && <CardContent className="space-y-3 bg-card/35 p-5">
        {progress && busy && <ProgressLine progress={progress} />}
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-background/45 p-3.5"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.08]"><FolderOpen className="size-4 text-primary" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold">手册库目录</p>{overview?.configured && <span className="rounded-md border border-emerald-400/20 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[9px] text-emerald-300">已配置</span>}</div><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={overview?.libraryPath || undefined}>{overview?.libraryPath || '尚未设置'}</p></div><Button size="sm" variant="outline" onClick={() => void chooseLibrary()} disabled={busy}>{operation === 'directory' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择目录</Button></div>

        <section className="overflow-visible rounded-xl border border-border/40 bg-background/30">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-background/65 p-3.5 text-left transition-colors hover:bg-background/80" onClick={() => setManualSourcesOpen((current) => !current)} aria-expanded={manualSourcesOpen}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.08]"><BookCopy className="size-4 text-primary" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">手册来源</p><p className="mt-0.5 text-[10px] text-muted-foreground">DCS 官方英文手册 · Chuck's Guides</p></div>
            <span className="rounded-md border border-border/35 bg-card/45 px-2 py-1 text-[10px] text-muted-foreground">Chuck {installedCount}/{catalog.length}</span>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform ${manualSourcesOpen ? 'rotate-180 text-primary' : ''}`} />
          </button>
          {manualSourcesOpen && <div className="grid gap-3 border-t border-border/35 p-3.5 xl:grid-cols-2">
            <div className="rounded-lg border border-border/35 bg-background/40 p-3.5"><div className="flex items-center gap-2 text-xs font-semibold"><BookCopy className="size-3.5 text-primary" />DCS 官方英文手册</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">仅复制英文版，并单独维护官方索引。</p><Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => void importDcs()} disabled={busy || !overview?.configured}>{operation === 'dcs' ? <LoaderCircle className="size-3.5 animate-spin" /> : <BookCopy className="size-3.5" />}复制或更新</Button></div>
            <div className="rounded-lg border border-border/35 bg-background/40 p-3.5">
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs font-semibold"><Download className="size-3.5 text-primary" />Chuck's Guides</span><span className="text-[10px] text-muted-foreground">{installedCount}/{catalog.length} 已入库</span></div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">选择一个或多个机型后批量下载。</p>
              <div className="mt-3 flex items-start gap-2">
                <div className="relative min-w-0 flex-1" ref={chuckDropdownRef}>
                  <button type="button" onClick={() => setChuckDropdownOpen(!chuckDropdownOpen)} disabled={busy} className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                    <span className={`min-w-0 flex-1 truncate text-left ${selectedGuides.size === 0 ? 'text-muted-foreground' : ''}`}>{selectedGuides.size === 0 ? '选择机型' : selectedGuides.size === 1 ? catalog.find((g) => g.id === Array.from(selectedGuides)[0])?.displayName || '已选 1 项' : `已选 ${selectedGuides.size} 个机型`}</span>
                    <div className="flex items-center gap-1">{selectedGuides.size > 0 && <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); clearSelection() }} className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3" /></span>}<ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${chuckDropdownOpen ? 'rotate-180 text-primary' : ''}`} /></div>
                  </button>
                  {chuckDropdownOpen && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-hidden rounded-xl border bg-popover shadow-xl"><div className="flex items-center gap-1 border-b p-1.5"><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(event) => { event.stopPropagation(); selectAllMissing() }} disabled={busy}>全选未下载</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(event) => { event.stopPropagation(); clearSelection() }} disabled={busy || selectedGuides.size === 0}>清空选择</Button></div><div className="max-h-[260px] overflow-y-auto p-1">{catalog.map((guide) => <label key={guide.id} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent/20 ${guide.installed ? 'opacity-50' : ''}`} onClick={(event) => event.preventDefault()}><Checkbox checked={selectedGuides.has(guide.id)} onCheckedChange={() => !guide.installed && toggleGuide(guide.id)} disabled={busy || guide.installed} className="size-4" /><span className="flex-1 select-none">{guide.displayName}</span>{guide.installed && <Check className="size-3.5 text-emerald-400" aria-label="已入库" />}</label>)}</div></div>}
                </div>
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => void downloadSelected()} disabled={selectedGuides.size === 0 || busy || !overview?.configured}>{operation === 'chuck-selected' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}下载{selectedGuides.size > 0 && ` (${selectedGuides.size})`}</Button>
              </div>
            </div>
          </div>}
        </section>

        <section className="overflow-hidden rounded-xl border border-border/40 bg-background/30">
          <div className="flex items-center gap-3 bg-background/65 p-3.5">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOverlayOptionsOpen((current) => !current)} aria-expanded={overlayOptionsOpen}><div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.08]"><Gamepad2 className="size-4 text-primary" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">内置手册窗口</p><p className="mt-0.5 text-[10px] text-muted-foreground">{overlaySettings?.enabled === false ? '已关闭' : `已开启 · ${formatHotkeyForDisplay(overlaySettings?.hotkey || 'Ctrl+Alt+M')} · ${vrOverlayStatus?.mode === 'vr' ? 'VR / OpenXR' : '桌面'}`}</p></div><ChevronDown className={`size-4 text-muted-foreground transition-transform ${overlayOptionsOpen ? 'rotate-180 text-primary' : ''}`} /></button>
            <Switch aria-label="启用内置手册窗口" checked={overlaySettings?.enabled ?? true} onCheckedChange={toggleOverlayEnabled} />
          </div>
          {overlayOptionsOpen && <div className="space-y-3 border-t border-border/35 p-3.5"><div className="rounded-lg border border-border/30 bg-background/35 p-3"><HotkeyRecorder settings={overlaySettings} onChange={setOverlaySettings} /></div><div className="rounded-lg border border-border/30 bg-background/35 p-3"><div className="flex items-center gap-2 text-sm font-semibold"><Mic className="size-4 text-primary" />语音输入</div><div className="mt-3 flex flex-wrap items-center gap-2"><select value={overlaySettings?.microphoneId || microphones.find((device) => device.isDefault)?.id || ''} onChange={(event) => setMicrophone(event.target.value)} className="h-9 min-w-56 flex-1 rounded-lg border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring"><option value="">系统默认麦克风</option>{microphones.map((device) => <option key={device.id} value={device.id}>{device.name}{device.isDefault ? '（默认）' : ''}</option>)}</select>{speechModel?.installed ? <span className="rounded-md border border-emerald-400/25 bg-emerald-500/8 px-2.5 py-2 text-[11px] text-emerald-300">SenseVoice 已内置</span> : <span className="rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-2 text-[11px] text-destructive">语音模型缺失</span>}</div>{speechModel?.error && <p className="mt-2 text-[11px] text-destructive">{speechModel.error}</p>}<p className="mt-2 text-[11px] leading-5 text-muted-foreground">语音模型已随 DCSHUB 安装，可完全离线使用，无需另行下载。短按呼出键控制窗口；长按说话，松开后由 SenseVoice 在本地转写并直接提问。转写会自动校正常见 DCS 机型、武器和航电术语。</p></div>{vrOverlayStatus && <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${vrOverlayStatus.mode === 'vr' && vrOverlayStatus.available && !vrOverlayStatus.error ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} /><span>当前跟随：{vrOverlayStatus.mode === 'vr' ? 'VR / OpenXR' : '桌面'}</span>{vrOverlayStatus.mode === 'vr' && (!vrOverlayStatus.available || vrOverlayStatus.error) && <span className="text-amber-400">VR 组件不可用</span>}</div>}<div className="rounded-lg border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">VR 操作：</span>呼出时面板会出现在当前视线正前方并保持空间固定；拖动标题栏可环绕移动，再次呼出会按新的视线方向定位。</div></div>}
        </section>

        <section className="overflow-hidden rounded-xl border border-border/40 bg-background/30">
          <button type="button" className="flex w-full items-center gap-3 bg-background/65 p-3.5 text-left transition-colors hover:bg-background/80" onClick={() => setAiSettingsOpen((current) => !current)} aria-expanded={aiSettingsOpen}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.08]"><Bot className="size-4 text-primary" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">AI 问答服务</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{overview?.ai.configured ? `${overview.ai.providers.find((provider) => provider.id === overview.ai.local.provider)?.name || overview.ai.local.provider} · 本地与联网模型配置` : '尚未配置 API 供应商'}</p></div>
            <span className={`size-1.5 rounded-full ${overview?.ai.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <ChevronDown className={`size-4 text-muted-foreground transition-transform ${aiSettingsOpen ? 'rotate-180 text-primary' : ''}`} />
          </button>
          {aiSettingsOpen && <div className="border-t border-border/35 p-3.5"><ManualAiSettingsPanel overview={overview} onOverviewChange={setOverview} /></div>}
        </section>
      </CardContent>}

      <Dialog open={duplicateCleanupOpen} onOpenChange={(next) => { if (!busy) setDuplicateCleanupOpen(next) }}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><CircleAlert className="size-5 text-amber-400" />发现重复官方手册</DialogTitle><DialogDescription>有 {removableDuplicates} 份手册同时存在于用户目录和 DCSHUB 管理的“DCS Manuals”目录。是否移除后者？用户自己放入的手册不会被删除。</DialogDescription></DialogHeader><DialogFooter className="mt-6 gap-2"><Button variant="outline" onClick={() => setDuplicateCleanupOpen(false)} disabled={busy}>保留</Button><Button variant="destructive" onClick={() => void removeDuplicates()} disabled={busy}>{operation === 'deduplicate' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}移除重复副本</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  )
}
