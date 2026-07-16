import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Activity, Bookmark, ChevronDown, ChevronUp, ExternalLink, Glasses, Monitor, Play, RefreshCw, Settings2, SlidersHorizontal, Square } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Image } from '@/components/ui/image'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useModuleContext } from '@/modules/ModuleContext'
import { APP_SETTINGS_CHANGED_EVENT, loadAppSettings, saveAppSettings } from '@/lib/app-settings'
import { resolveAssetUrl } from '@/lib/assets'
import type { ModManagerOverview, ModPresetEntry } from '@/shared/mod-manager-contracts'
import { APP_VERSION } from '@/shared/app-meta'

const isRunningState = (state?: string) => state === 'running' || state === 'degraded' || state === 'starting'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { modules, snapshots, loading, startModule, stopModule, startProfile, stopProfile, readSettings, applySettings, showWindow, readActions, invokeAction } = useModuleContext()
  const [batchOperation, setBatchOperation] = useState<'start' | 'stop' | null>(null)
  const [operatingModuleId, setOperatingModuleId] = useState<string | null>(null)
  const [operatingModKey, setOperatingModKey] = useState<string | null>(null)
  const [moduleMenu, setModuleMenu] = useState<{ moduleId: string; x: number; y: number } | null>(null)
  const [menuActionStates, setMenuActionStates] = useState<Record<string, boolean>>({})
  const [menuSettings, setMenuSettings] = useState<Record<string, unknown>>({})
  const [operatingMenuItem, setOperatingMenuItem] = useState<string | null>(null)
  const lifecycleModuleIds = useMemo(() => modules.filter((module) => module.capabilities.lifecycle).map((module) => module.id), [modules])
  const [appSettings, setAppSettings] = useState(() => loadAppSettings())
  const [modOverview, setModOverview] = useState<ModManagerOverview | null>(null)
  const [selectedModPresetId, setSelectedModPresetId] = useState('')
  const [applyingModPreset, setApplyingModPreset] = useState(false)
  const [launchingDcsLauncher, setLaunchingDcsLauncher] = useState(false)
  const [showAllPresetMods, setShowAllPresetMods] = useState(false)

  useEffect(() => {
    const reload = () => setAppSettings(loadAppSettings(lifecycleModuleIds))
    reload()
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [lifecycleModuleIds])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const next = await window.electronAPI?.modManager.overview()
        if (!cancelled && next) {
          setModOverview(next)
          setSelectedModPresetId(next.activePresetId || next.presets[0]?.id || '')
        }
      } catch { /* The dashboard remains available before Mod Manager is configured. */ }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!moduleMenu) return
    const close = () => setModuleMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moduleMenu])

  const selectedProfile = appSettings.startupProfiles.find((profile) => profile.id === appSettings.selectedStartupProfileId)
    || appSettings.startupProfiles[0]
  const profileModuleIds = selectedProfile.moduleIds.filter((id) => lifecycleModuleIds.includes(id))
  const profileModules = modules.filter((module) => profileModuleIds.includes(module.id))
  const profileIncludesAll = lifecycleModuleIds.length > 0 && profileModuleIds.length === lifecycleModuleIds.length
  const selectedModPreset = modOverview?.presets.find((preset) => preset.id === selectedModPresetId)
  const enabledModKeys = useMemo(() => new Set(modOverview?.enabledModKeys || []), [modOverview?.enabledModKeys])
  const activeModuleIds = modules.filter(({ id }) => isRunningState(snapshots[id]?.runState)).map(({ id }) => id)
  const runningCount = activeModuleIds.length

  const applyModPreset = async (presetId: string) => {
    setApplyingModPreset(true)
    try {
      const next = await window.electronAPI?.modManager.applyPreset(presetId)
      if (next) {
        setModOverview(next)
        setSelectedModPresetId(presetId)
      }
      setShowAllPresetMods(false)
      toast.success('模组预设已应用')
    } catch (reason) {
      toast.error('应用模组预设失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setApplyingModPreset(false)
    }
  }

  const disableAllMods = async () => {
    setApplyingModPreset(true)
    try {
      const next = await window.electronAPI?.modManager.disableAllMods()
      if (next) setModOverview(next)
      setShowAllPresetMods(false)
      toast.success('所有目录中的模组已停用')
    } catch (reason) {
      toast.error('关闭所有模组失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setApplyingModPreset(false)
    }
  }

  const toggleModule = async (moduleId: string, active: boolean) => {
    setOperatingModuleId(moduleId)
    try {
      const result = active ? await stopModule(moduleId) : await startModule(moduleId)
      if (result.ok) toast.success(active ? '软件已停止' : '软件已启动')
      else toast.error(active ? '停止失败' : '启动失败', { description: result.error?.message })
    } catch (reason) {
      toast.error(active ? '停止失败' : '启动失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingModuleId(null)
    }
  }

  const openModuleMenu = async (event: React.MouseEvent, moduleId: string) => {
    event.preventDefault()
    const width = 218
    const height = 300
    setModuleMenu({
      moduleId,
      x: Math.min(event.clientX, window.innerWidth - width - 10),
      y: Math.min(event.clientY, window.innerHeight - height - 10),
    })
    setMenuActionStates({})
    setMenuSettings({})
    const module = modules.find((item) => item.id === moduleId)
    if (!module) return
    await Promise.all([
      module.actions?.length ? readActions(moduleId).then((states) => {
        setMenuActionStates(Object.fromEntries(states.map((state) => [state.actionId, state.active])))
      }).catch(() => setMenuActionStates({})) : Promise.resolve(),
      module.settingsSchema?.some((field) => field.quickAccess) ? readSettings(moduleId).then(setMenuSettings).catch(() => setMenuSettings({})) : Promise.resolve(),
    ])
  }

  const openModuleWindow = async (moduleId: string) => {
    setOperatingMenuItem('window')
    try {
      const result = await showWindow(moduleId)
      if (result.ok) toast.success('软件窗口已打开')
      else toast.error('打开窗口失败', { description: result.error?.message })
    } catch (reason) {
      toast.error('打开窗口失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingMenuItem(null)
      setModuleMenu(null)
    }
  }

  const toggleMenuAction = async (moduleId: string, actionId: string, active: boolean) => {
    setOperatingMenuItem(actionId)
    try {
      const result = await invokeAction(moduleId, actionId, !active)
      if (result.ok) {
        setMenuActionStates((current) => ({ ...current, [actionId]: Boolean(result.active) }))
        toast.success(result.active ? '功能已启动' : '功能已停止')
      } else toast.error('功能切换失败', { description: result.error?.message })
    } catch (reason) {
      toast.error('功能切换失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingMenuItem(null)
    }
  }

  const applyMenuSetting = async (moduleId: string, key: string, value: unknown) => {
    const previous = menuSettings[key]
    setMenuSettings((current) => ({ ...current, [key]: value }))
    setOperatingMenuItem(`setting:${key}`)
    try {
      const result = await applySettings(moduleId, { [key]: value })
      if (!result.ok) {
        setMenuSettings((current) => ({ ...current, [key]: previous }))
        toast.error('选择服务器失败', { description: result.error?.message })
      }
    } catch (reason) {
      setMenuSettings((current) => ({ ...current, [key]: previous }))
      toast.error('选择服务器失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingMenuItem(null)
    }
  }

  const togglePresetMod = async (entry: ModPresetEntry, active: boolean) => {
    const key = `${entry.gameDirectoryId}:${entry.modId}`
    setOperatingModKey(key)
    try {
      const bridge = window.electronAPI?.modManager
      if (!bridge) throw new Error('模组管理服务不可用')
      const result = await bridge.setDirectoryModEnabled(entry.gameDirectoryId, entry.modId, !active, true)
      if (!result.ok) {
        toast.error(active ? '停用模组失败' : '启用模组失败', { description: result.message })
        return
      }
      setModOverview(await bridge.overview())
      toast.success(active ? `${entry.modName} 已停用` : `${entry.modName} 已启用`)
    } catch (reason) {
      toast.error(active ? '停用模组失败' : '启用模组失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperatingModKey(null)
    }
  }

  const runAll = async (operation: 'start' | 'stop') => {
    setBatchOperation(operation)
    try {
      if (operation === 'start') {
        const missingModuleIds = profileModuleIds.filter((id) => !isRunningState(snapshots[id]?.runState))
        if (missingModuleIds.length > 0) {
          const result = await startProfile(missingModuleIds, true)
          if (!result.ok) {
            toast.error('软件预设启动未完成', { description: result.results.find((item) => !item.ok)?.error?.message })
            return
          }
        }
        const dcsResult = await window.electronAPI?.dcs.launch(appSettings.dcsLaunchMode)
        if (dcsResult?.ok) toast.success(dcsResult.message || '全部软件正常运行，DCS 已启动')
        else toast.error('软件已正常运行，但 DCS 启动失败', { description: dcsResult?.message || 'DCS 启动服务不可用' })
        return
      }
      const result = await stopProfile(activeModuleIds)
      if (result.ok) toast.success('所有运行中的软件已停止')
      else toast.error('批量操作未完成', { description: result.results.find((item) => !item.ok)?.error?.message })
    } catch (reason) {
      toast.error('批量操作失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setBatchOperation(null)
    }
  }

  const openDcsLauncher = async () => {
    setLaunchingDcsLauncher(true)
    try {
      const result = await window.electronAPI?.dcs.launchLauncher()
      if (result?.ok) toast.success(result.message || 'DCS Launcher 已打开')
      else toast.error('打开 DCS Launcher 失败', { description: result?.message || 'DCS 启动服务不可用' })
    } catch (reason) {
      toast.error('打开 DCS Launcher 失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setLaunchingDcsLauncher(false)
    }
  }

  return (
    <div className="relative isolate -m-3 min-h-full space-y-8 overflow-hidden rounded-2xl p-3">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-20 h-[calc(100vh-3.5rem)] scale-[1.01] bg-cover bg-center bg-no-repeat opacity-45 blur-[1.5px]" style={{ backgroundImage: `url(${resolveAssetUrl('/images/dashboard-f15e.webp')})` }} />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[calc(100vh-3.5rem)] bg-gradient-to-b from-background/35 via-background/68 to-background" />
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
        <div aria-hidden className="h-[44px] shrink-0" />
        <div className="w-full space-y-4">
          <div className="flex w-full flex-wrap items-start gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-primary/35 bg-card/95 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
              <div className="flex min-w-32 items-center gap-1.5 px-2 text-sm font-semibold text-primary"><SlidersHorizontal className="size-4" />软件预设</div>
              <Select value={selectedProfile.id} onValueChange={(id) => {
                const next = { ...appSettings, selectedStartupProfileId: id }
                setAppSettings(next)
                saveAppSettings(next)
              }}>
                <SelectTrigger aria-label="选择软件预设" className="w-48 border-primary/25 bg-background"><SelectValue>{selectedProfile.name}</SelectValue></SelectTrigger>
                <SelectContent>{appSettings.startupProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-lg border border-border/55 bg-background/75 p-1 text-[10px] font-semibold shadow-inner">
                  <span className={`flex items-center gap-1 rounded-md border px-2 py-1 transition-all duration-200 ${appSettings.dcsLaunchMode === 'desktop' ? 'border-cyan-300/65 bg-cyan-400/20 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.38)]' : 'border-transparent text-muted-foreground/55'}`}><Monitor className="size-3" />桌面</span>
                  <Switch className={appSettings.dcsLaunchMode === 'vr' ? '!bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.7)]' : '!bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.7)]'} aria-label="DCS 启动模式" checked={appSettings.dcsLaunchMode === 'vr'} onCheckedChange={(checked) => { const next = { ...appSettings, dcsLaunchMode: checked ? 'vr' as const : 'desktop' as const }; setAppSettings(next); saveAppSettings(next) }} />
                  <span className={`flex items-center gap-1 rounded-md border px-2 py-1 transition-all duration-200 ${appSettings.dcsLaunchMode === 'vr' ? 'border-violet-300/65 bg-violet-400/20 text-violet-200 shadow-[0_0_12px_rgba(167,139,250,0.42)]' : 'border-transparent text-muted-foreground/55'}`}><Glasses className="size-3" />VR</span>
                </div>
                <Button variant="outline" className="h-8 gap-1.5 border-amber-400/40 bg-amber-400/10 px-2.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20 hover:text-amber-100" onClick={() => void openDcsLauncher()} disabled={launchingDcsLauncher}>
                  {launchingDcsLauncher ? <Activity className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}启动器
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => void runAll('start')} disabled={loading || batchOperation !== null || operatingModuleId !== null} className="h-11 gap-2 border border-emerald-300/35 bg-emerald-500 px-4 font-semibold text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.28)] hover:bg-emerald-400">
                  {batchOperation === 'start' ? <Activity className="size-4 animate-spin" /> : <Play className="size-4" />}一键启动
                </Button>
                <Button onClick={() => void runAll('stop')} disabled={loading || runningCount === 0 || batchOperation !== null || operatingModuleId !== null} className="h-11 gap-2 border border-red-300/35 bg-red-500 px-4 font-semibold text-white shadow-[0_0_20px_rgba(239,68,68,0.28)] hover:bg-red-400">
                  {batchOperation === 'stop' ? <Activity className="size-4 animate-spin" /> : <Square className="size-4" />}一键停止
                </Button>
              </div>
            </div>
          </div>
          <div className="w-fit space-y-1.5">
            <div className="flex items-center gap-2 rounded-xl border border-violet-400/30 bg-card/95 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
              <div className="flex min-w-32 items-center gap-1.5 px-2 text-sm font-semibold text-violet-300"><Bookmark className="size-4" />模组预设</div>
              <Select value={selectedModPresetId} onValueChange={setSelectedModPresetId}>
                <SelectTrigger aria-label="选择模组预设" className="w-48 border-violet-400/25 bg-background" disabled={!modOverview?.configured || applyingModPreset}><SelectValue>{selectedModPreset?.name || '尚未配置'}</SelectValue></SelectTrigger>
                <SelectContent>{modOverview?.presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button className="h-6 gap-1 rounded-md border border-violet-300/30 bg-violet-500 px-2 text-[10px] font-semibold text-white hover:bg-violet-400" onClick={() => void applyModPreset(selectedModPresetId)} disabled={!modOverview?.configured || !selectedModPresetId || applyingModPreset || operatingModKey !== null}><Play className="size-3" />应用预设</Button>
              <Button variant="outline" className="h-6 gap-1 rounded-md border-red-400/35 px-2 text-[10px] text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => void disableAllMods()} disabled={!modOverview?.configured || !modOverview.totalEnabledCount || applyingModPreset || operatingModKey !== null}><Square className="size-3" />关闭所有</Button>
            </div>
          </div>
        </div>
      </motion.div>

      <Card className="border-border/55 bg-card/90 shadow-[0_18px_45px_rgba(0,0,0,0.26)] backdrop-blur-md">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="text-sm font-semibold">全局设置</p>
            <Badge variant="outline" className="border-primary/35 bg-primary/5 text-primary">当前</Badge>
          </div>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span>软件预设</span><Badge variant="outline" className="h-5 text-[10px]">{selectedProfile.name}</Badge><span>{profileIncludesAll ? 'ALL' : `${profileModules.length} 个软件`}</span></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {profileModules.length > 0 ? profileModules.map((module) => {
                  const active = isRunningState(snapshots[module.id]?.runState)
                  const busy = operatingModuleId === module.id
                  return (
                    <button
                      key={module.id}
                      type="button"
                      aria-pressed={active}
                      title={active ? `停止 ${module.displayName}` : `启动 ${module.displayName}`}
                      aria-haspopup="menu"
                      disabled={operatingModuleId !== null || batchOperation !== null || snapshots[module.id]?.installState !== 'installed'}
                      onClick={() => void toggleModule(module.id, active)}
                      onContextMenu={(event) => void openModuleMenu(event, module.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-emerald-500/35 bg-emerald-500/10 text-foreground shadow-[0_0_10px_rgba(16,185,129,0.08)] hover:bg-emerald-500/15' : 'border-border/55 bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground'}`}
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.55)]' : 'bg-muted-foreground/35'}`} />
                      {busy ? <Activity className="size-3.5 animate-spin" /> : module.brandLogo ? <Image src={module.brandLogo} alt="" className="size-3.5 object-contain" /> : null}
                      <span>{module.displayName}</span>
                    </button>
                  )
                }) : <span className="text-xs text-muted-foreground">当前配置尚未选择启动模块</span>}
              </div>
            </div>
            <div className="border-t border-border/35 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span>模组预设</span><Badge variant="outline" className="h-5 border-violet-400/30 text-[10px] text-violet-300">{selectedModPreset?.name || '未选择'}</Badge><span>{selectedModPreset?.entries.length || 0} 个模组</span></div>
              <div className={`mt-3 flex flex-wrap gap-2 ${showAllPresetMods ? '' : 'max-h-[4.25rem] overflow-hidden'}`}>
                {selectedModPreset?.entries.length ? selectedModPreset.entries.map((entry) => {
                  const key = `${entry.gameDirectoryId}:${entry.modId}`
                  const active = enabledModKeys.has(key)
                  const busy = operatingModKey === key
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      title={active ? `停用 ${entry.modName}` : `启用 ${entry.modName}`}
                      disabled={operatingModKey !== null || applyingModPreset}
                      onClick={() => void togglePresetMod(entry, active)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-emerald-500/35 bg-emerald-500/10 text-foreground shadow-[0_0_10px_rgba(16,185,129,0.08)] hover:bg-emerald-500/15' : 'border-border/55 bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground'}`}
                    >
                      {busy ? <Activity className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.55)]' : 'bg-muted-foreground/35'}`} />}
                      {entry.modName}
                    </button>
                  )
                }) : <span className="text-xs text-muted-foreground">当前模组预设没有包含模组</span>}
              </div>
              {(selectedModPreset?.entries.length || 0) > 4 && <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs text-violet-300" onClick={() => setShowAllPresetMods((current) => !current)}>{showAllPresetMods ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{showAllPresetMods ? '收起' : '展开全部'}</Button>}
            </div>
          </div>
          <div className="mt-3 flex justify-end border-t border-border/25 pt-2">
            <button
              type="button"
              title="打开 DCSHUB 更新下载页面"
              onClick={() => void window.electronAPI?.windowControls.openUpdatePage()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground/55 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
            >
              <RefreshCw className="size-3" />检查更新 · {APP_VERSION}
            </button>
          </div>
        </CardContent>
      </Card>
      {moduleMenu ? createPortal((() => {
        const module = modules.find((item) => item.id === moduleMenu.moduleId)
        if (!module) return null
        return (
          <div
            role="menu"
            aria-label={`${module.displayName} 快捷菜单`}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            className="fixed z-[100] w-[13rem] overflow-hidden rounded-xl border border-border/65 bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            style={{ left: moduleMenu.x, top: moduleMenu.y }}
          >
            <div className="border-b border-border/45 px-2.5 py-2">
              <p className="truncate text-xs font-semibold">{module.displayName}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">快捷操作</p>
            </div>
            {module.capabilities.showWindow ? (
              <button type="button" role="menuitem" disabled={operatingMenuItem !== null} onClick={() => void openModuleWindow(module.id)} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50">
                {operatingMenuItem === 'window' ? <Activity className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5 text-primary" />}
                <span>打开窗口</span>
              </button>
            ) : null}
            {module.capabilities.settings ? (
              <button type="button" role="menuitem" onClick={() => { setModuleMenu(null); navigate(`/module/${module.id}`) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted">
                <Settings2 className="size-3.5 text-primary" />
                <span>打开内置设置</span>
              </button>
            ) : null}
            {module.settingsSchema?.filter((field) => field.quickAccess && field.kind === 'select').map((field) => (
              <div key={field.key} className="mt-1 border-t border-border/45 px-2.5 pt-2">
                <label className="mb-1.5 block text-[10px] font-medium text-muted-foreground" htmlFor={`quick-${module.id}-${field.key}`}>{field.label}预设</label>
                <select
                  id={`quick-${module.id}-${field.key}`}
                  aria-label={`${field.label}预设`}
                  value={menuSettings[field.key] === undefined ? '' : String(menuSettings[field.key])}
                  disabled={operatingMenuItem !== null || !field.options?.length}
                  onChange={(event) => void applyMenuSetting(module.id, field.key, event.target.value)}
                  className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:opacity-50"
                >
                  {!field.options?.length ? <option value="">SRS 中暂无服务器预设</option> : null}
                  {field.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
                </select>
              </div>
            ))}
            {module.actions?.length ? (
              <div className="mt-1 border-t border-border/45 pt-1">
                {module.actions.map((action) => {
                  const active = menuActionStates[action.id] ?? false
                  const busy = operatingMenuItem === action.id
                  return (
                    <button key={action.id} type="button" role="menuitemcheckbox" aria-checked={active} disabled={operatingMenuItem !== null} onClick={() => void toggleMenuAction(module.id, action.id, active)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50">
                      <span className="flex items-center gap-2">
                        {busy ? <Activity className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-muted-foreground/35'}`} />}
                        {action.label}
                      </span>
                      <span className={active ? 'text-emerald-400' : 'text-muted-foreground'}>{active ? (action.activeLabel || '停止') : (action.inactiveLabel || '启用')}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {!module.capabilities.showWindow && !module.capabilities.settings && !module.actions?.length ? <p className="px-2.5 py-3 text-xs text-muted-foreground">该软件没有可用的快捷操作</p> : null}
          </div>
        )
      })(), document.body) : null}
    </div>
  )
}
