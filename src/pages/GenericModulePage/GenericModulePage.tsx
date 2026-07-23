import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Activity, ExternalLink, Play, Save, Square, Terminal, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useModule, useModuleActions } from '@/modules/hooks'
import { getRunStatePresentation } from '@/modules/run-state'
import { resolveAssetUrl } from '@/lib/assets'
import type { ModuleId, ModuleLogEntry, ModuleSettingField, ModuleSettings } from '@/shared/module-contracts'

function SettingControl({ field, value, disabled, onChange }: { field: ModuleSettingField; value: unknown; disabled?: boolean; onChange: (value: unknown) => void }) {
  if (field.kind === 'boolean') return <Switch aria-label={field.label} checked={value === true} disabled={disabled} onCheckedChange={onChange} />
  if (field.kind === 'slider') {
    const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : (field.min ?? 0)
    return (
      <div className="flex w-full max-w-md items-center gap-4 sm:w-96">
        <Slider
          value={[numericValue]}
          min={field.min}
          max={field.max}
          step={field.step}
          onValueChange={([next]) => onChange(next)}
        />
        <div className="min-w-36 rounded-md border border-border/40 bg-background/65 px-3 py-1.5 text-right text-xs tabular-nums backdrop-blur-sm">
          <span className="font-semibold text-foreground">{numericValue}</span>{field.suffix && <span className="ml-1 text-muted-foreground">{field.suffix}</span>}
        </div>
      </div>
    )
  }
  if (field.kind === 'select') {
    return (
      <Select value={value === undefined ? '' : String(value)} onValueChange={(next) => {
        const option = field.options?.find((candidate) => String(candidate.value) === next)
        onChange(option?.value ?? next)
      }}>
        <SelectTrigger aria-label={field.label} disabled={disabled} className="w-48"><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>{field.options?.map((option) => <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    )
  }
  return (
    <Input
      className="w-48"
      type={field.kind === 'number' ? 'number' : 'text'}
      min={field.min}
      max={field.max}
      step={field.step}
      disabled={disabled}
      value={typeof value === 'string' || typeof value === 'number' ? value : ''}
      onChange={(event) => onChange(field.kind === 'number' ? event.target.valueAsNumber : event.target.value)}
    />
  )
}

export default function GenericModulePage({ moduleId }: { moduleId: ModuleId }) {
  const { manifest, snapshot } = useModule(moduleId)
  const actions = useModuleActions(moduleId)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<ModuleSettings>({})
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [logs, setLogs] = useState<ModuleLogEntry[]>([])
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({})
  const [operatingActionId, setOperatingActionId] = useState<string | null>(null)
  const [silentLaunch, setSilentLaunch] = useState<boolean | null>(null)
  const [silentLaunchBusy, setSilentLaunchBusy] = useState(false)
  const settingsDirtyRef = useRef(false)
  const busyRef = useRef(false)

  useEffect(() => { busyRef.current = busy }, [busy])

  useEffect(() => {
    let cancelled = false
    const refreshSilentLaunch = () => {
      void window.electronAPI?.softwareCatalog.overview().then((overview) => {
        if (!cancelled) setSilentLaunch(overview.items.find((item) => item.id === moduleId)?.silentLaunch ?? null)
      }).catch(() => undefined)
    }
    refreshSilentLaunch()
    window.addEventListener('focus', refreshSilentLaunch)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshSilentLaunch)
    }
  }, [moduleId])

  useEffect(() => {
    if (!manifest?.capabilities.settings) return
    let cancelled = false
    let initialRead = true
    const refreshSettings = async () => {
      if (settingsDirtyRef.current || busyRef.current) return
      try {
        const next = await actions.readSettings()
        if (!cancelled) setSettings(next)
      } catch (reason) {
        if (!cancelled && initialRead) toast.error('读取设置失败', { description: reason instanceof Error ? reason.message : String(reason) })
      } finally {
        initialRead = false
      }
    }
    const intervalMs = manifest.settingsSyncIntervalMs
    let timer: number | undefined
    const syncPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      void refreshSettings()
      if (intervalMs) timer = window.setInterval(() => { void refreshSettings() }, Math.max(500, intervalMs))
    }
    syncPolling()
    window.addEventListener('focus', syncPolling)
    window.addEventListener('blur', syncPolling)
    document.addEventListener('visibilitychange', syncPolling)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      window.removeEventListener('focus', syncPolling)
      window.removeEventListener('blur', syncPolling)
      document.removeEventListener('visibilitychange', syncPolling)
    }
  }, [manifest?.id, manifest?.capabilities.settings, manifest?.settingsSyncIntervalMs, actions])

  useEffect(() => {
    if (!manifest?.capabilities.logs || !window.electronAPI?.modules) return
    const bridge = window.electronAPI.modules
    void bridge.recentLogs(moduleId, 200).then(setLogs)
    return bridge.onLog((entry) => {
      if (entry.moduleId !== moduleId) return
      setLogs((current) => [...current, entry].slice(-500))
    })
  }, [manifest?.id, manifest?.capabilities.logs, moduleId])

  useEffect(() => {
    if (!manifest?.actions?.length) return
    let cancelled = false
    const refreshActions = async () => {
      try {
        const states = await actions.readActions()
        if (!cancelled) setActionStates(Object.fromEntries(states.map((state) => [state.actionId, state.active])))
      } catch {
        // The action remains clickable; invoking it surfaces the detailed driver error.
      }
    }
    let timer: number | undefined
    const syncPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      void refreshActions()
      timer = window.setInterval(() => { void refreshActions() }, 2_000)
    }
    syncPolling()
    window.addEventListener('focus', syncPolling)
    window.addEventListener('blur', syncPolling)
    document.addEventListener('visibilitychange', syncPolling)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      window.removeEventListener('focus', syncPolling)
      window.removeEventListener('blur', syncPolling)
      document.removeEventListener('visibilitychange', syncPolling)
    }
  }, [manifest?.id, manifest?.actions, actions])

  if (!manifest) return null
  const shouldStop = snapshot?.runState === 'running' || snapshot?.runState === 'degraded' || snapshot?.runState === 'starting'
  const runState = getRunStatePresentation(snapshot?.runState)
  const lifecycleLabel = shouldStop ? (manifest.actionLabels?.stop || '停止') : (manifest.actionLabels?.start || '启动')

  const operate = async (operation: 'start' | 'stop' | 'show' | 'settings') => {
    setBusy(true)
    try {
      const result = operation === 'start' ? await actions.start()
        : operation === 'stop' ? await actions.stop()
        : operation === 'show' ? await actions.showWindow()
        : await actions.applySettings(settings)
      if (result.ok) {
        if (operation === 'settings') {
          settingsDirtyRef.current = false
          setSettingsDirty(false)
          try { setSettings(await actions.readSettings()) } catch { /* The applied values remain visible if refresh fails. */ }
        }
        toast.success('操作完成')
      }
      else toast.error('操作失败', { description: result.error?.message })
    } finally { setBusy(false) }
  }

  const changeSetting = (field: ModuleSettingField, value: unknown) => {
    const previous = settings[field.key]
    setSettings((current) => ({ ...current, [field.key]: value }))
    if (field.autoApply) {
      setBusy(true)
      void actions.applySettings({ [field.key]: value }).then((result) => {
        if (!result.ok) {
          setSettings((current) => ({ ...current, [field.key]: previous }))
          toast.error('选择服务器失败', { description: result.error?.message })
        }
      }).catch((reason) => {
        setSettings((current) => ({ ...current, [field.key]: previous }))
        toast.error('选择服务器失败', { description: reason instanceof Error ? reason.message : String(reason) })
      }).finally(() => setBusy(false))
      return
    }
    settingsDirtyRef.current = true
    setSettingsDirty(true)
  }

  const toggleModuleAction = async (actionId: string, active: boolean) => {
    setOperatingActionId(actionId)
    try {
      const result = await actions.invokeAction(actionId, !active)
      if (result.ok) {
        setActionStates((current) => ({ ...current, [actionId]: Boolean(result.active) }))
        toast.success(result.active ? '功能已启动' : '功能已停止')
      } else toast.error('功能切换失败', { description: result.error?.message })
    } catch (reason) {
      toast.error('功能切换失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingActionId(null)
    }
  }

  const toggleSilentLaunch = async (checked: boolean) => {
    setSilentLaunchBusy(true)
    try {
      const overview = await window.electronAPI?.softwareCatalog.setSilentLaunch(moduleId, checked)
      setSilentLaunch(overview?.items.find((item) => item.id === moduleId)?.silentLaunch ?? checked)
    } catch (reason) {
      toast.error('静默启动设置失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setSilentLaunchBusy(false)
    }
  }

  const lifecycleCard = manifest.ui?.lifecycleCard
  const settingsCard = manifest.ui?.settingsCard
  const lifecycleBackground = lifecycleCard?.backgroundImage || manifest.backgroundImage

  return (
    <div className="space-y-6">
      <Card className="relative min-h-40 overflow-hidden border-border/40 bg-card/60">
        {lifecycleBackground && <div aria-hidden className="absolute inset-0 bg-cover bg-center opacity-70" style={{ backgroundImage: `url(${resolveAssetUrl(lifecycleBackground)})` }} />}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-card via-card/90 to-card/55" />
        <CardHeader className="relative z-10 min-h-40 justify-center pt-12">
          <Badge variant="outline" className={`absolute left-6 top-5 ${runState.badgeClassName} backdrop-blur-sm`}>{runState.label}</Badge>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="text-base">{lifecycleCard?.title || manifest.displayName}</CardTitle>
              {silentLaunch !== null && <div className="mt-2 flex w-fit items-center gap-2 rounded-lg border border-border/45 bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm"><span>静默启动</span><Switch className="scale-75" aria-label={`${manifest.displayName} 静默启动`} checked={silentLaunch} disabled={silentLaunchBusy} onCheckedChange={(checked) => void toggleSilentLaunch(checked)} /></div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {manifest.capabilities.showWindow && <Button size="sm" variant="outline" disabled={busy} onClick={() => void operate('show')} className="gap-1.5 bg-background/65 backdrop-blur-sm"><ExternalLink className="size-3.5" />打开窗口</Button>}
              {manifest.capabilities.lifecycle && <Button size="sm" disabled={busy} onClick={() => void operate(shouldStop ? 'stop' : 'start')} className="gap-1.5 shadow-lg">{busy ? <Activity className="size-3.5 animate-spin" /> : shouldStop ? <Square className="size-3.5" /> : <Play className="size-3.5" />}{lifecycleLabel}</Button>}
            </div>
          </div>
          {manifest.actions?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {manifest.actions.map((action) => {
                const active = actionStates[action.id] ?? false
                const actionBusy = operatingActionId === action.id
                return (
                  <button
                    key={action.id}
                    type="button"
                    aria-pressed={active}
                    disabled={operatingActionId !== null || snapshot?.installState !== 'installed'}
                    onClick={() => void toggleModuleAction(action.id, active)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold backdrop-blur-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-emerald-500/35 bg-emerald-500/10 text-foreground shadow-[0_0_10px_rgba(16,185,129,0.08)]' : 'border-border/60 bg-background/65 text-muted-foreground hover:border-primary/45 hover:text-foreground'}`}
                  >
                    {actionBusy ? <Activity className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.55)]' : 'bg-muted-foreground/40'}`} />}
                    <span>{action.label}</span>
                    <span className={active ? 'text-emerald-400' : 'text-foreground/75'}>{active ? (action.activeLabel || '停止') : (action.inactiveLabel || '启用')}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </CardHeader>
      </Card>

      {manifest.capabilities.settings && (
        <Card className="relative overflow-hidden border-border/40 bg-card/60">
          {settingsCard?.backgroundImage && <div aria-hidden className="absolute inset-0 bg-cover bg-center opacity-15" style={{ backgroundImage: `url(${resolveAssetUrl(settingsCard.backgroundImage)})` }} />}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-card via-card/95 to-card/80" />
          <CardHeader className="relative z-10"><CardTitle className="text-base">{settingsCard?.title || '模块设置'}</CardTitle></CardHeader>
          <CardContent className="relative z-10 space-y-4">
            {manifest.settingsSchema?.map((field) => (
              <div key={field.key} className="flex items-center justify-between gap-6 rounded-lg border border-border/20 bg-background/30 px-4 py-3">
                <Label>{field.label}</Label>
                <SettingControl field={field} value={settings[field.key]} disabled={busy && field.autoApply} onChange={(value) => changeSetting(field, value)} />
              </div>
            ))}
            {manifest.settingsSchema?.some((field) => !field.autoApply) ? <Button size="sm" disabled={busy || !settingsDirty} onClick={() => void operate('settings')} className="gap-1.5"><Save className="size-3.5" />{settingsCard?.actionLabel || '应用设置'}</Button> : null}
          </CardContent>
        </Card>
      )}

      {manifest.capabilities.logs && (
        <Card className="border-border/40 bg-card/60">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-base"><Terminal className="size-4 text-primary" />运行日志</CardTitle>
              <Button size="icon" variant="ghost" onClick={() => setLogs([])}><Trash2 className="size-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            <div data-i18n-ignore="true" className="h-72 overflow-y-auto rounded-lg border border-border/20 bg-black/40 p-3 font-mono text-xs leading-relaxed">
              {logs.length === 0 ? <p className="pt-24 text-center text-muted-foreground/50">启动后将在这里显示 EyeMouse 运行日志</p> : logs.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className={`whitespace-pre-wrap break-all ${entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  {entry.message}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
