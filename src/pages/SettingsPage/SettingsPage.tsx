import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleAlert, CloudDownload, FolderOpen, Gamepad2, HardDrive, LoaderCircle, Minus, Moon, Package, Plus, RefreshCw, Settings, SlidersHorizontal, Sun, Timer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Image } from '@/components/ui/image'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { loadAppSettings, saveAppSettings, type AppSettings } from '@/lib/app-settings'
import { useModuleContext } from '@/modules/ModuleContext'
import ManualLibrarySettingsCard from '@/components/ManualLibrarySettingsCard'
import type { DcsInstallationStatus } from '@/shared/dcs-contracts'
import type { SoftwareCatalogOverview } from '@/shared/software-catalog-contracts'
import type { UpdateSettings } from '@/shared/update-contracts'
import { announceMajorUpdate } from '@/lib/update-events'

type CatalogOperation = 'refresh' | 'detect-all' | 'add' | 'dcs-path' | string

export default function SettingsPage() {
  const { modules } = useModuleContext()
  const lifecycleModules = useMemo(() => modules.filter((module) => module.capabilities.lifecycle), [modules])
  const lifecycleModuleIds = useMemo(() => lifecycleModules.map((module) => module.id), [lifecycleModules])
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings())
  const [themeOpen, setThemeOpen] = useState(false)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings>({ automaticChecks: true })
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [softwareOpen, setSoftwareOpen] = useState(false)
  const [dcsStatus, setDcsStatus] = useState<DcsInstallationStatus | null>(null)
  const [catalog, setCatalog] = useState<SoftwareCatalogOverview | null>(null)
  const [catalogOperation, setCatalogOperation] = useState<CatalogOperation | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    setSettings(loadAppSettings(lifecycleModuleIds))
  }, [lifecycleModuleIds])

  useEffect(() => {
    void Promise.all([
      window.electronAPI?.dcs.status().then(setDcsStatus),
      window.electronAPI?.softwareCatalog.overview().then(setCatalog),
    ]).catch((reason) => toast.error('读取软件路径失败', { description: reason instanceof Error ? reason.message : String(reason) }))
  }, [])

  useEffect(() => {
    void window.electronAPI?.updates.settings().then(setUpdateSettings)
      .catch(() => { /* Keep the default enabled state if settings cannot be read. */ })
  }, [])

  const update = (next: AppSettings) => {
    setSettings(next)
    saveAppSettings(next)
  }

  const selectedProfile = settings.startupProfiles.find((profile) => profile.id === settings.selectedStartupProfileId)
    || settings.startupProfiles[0]

  const updateSelectedProfile = (patch: Partial<typeof selectedProfile>) => update({
    ...settings,
    startupProfiles: settings.startupProfiles.map((profile) => profile.id === selectedProfile.id ? { ...profile, ...patch } : profile),
  })

  const addProfile = () => {
    const profile = { id: `profile-${Date.now()}`, name: `配置 ${settings.startupProfiles.length + 1}`, moduleIds: [] }
    update({ ...settings, startupProfiles: [...settings.startupProfiles, profile], selectedStartupProfileId: profile.id })
  }

  const removeProfile = () => {
    if (settings.startupProfiles.length <= 1) return
    const startupProfiles = settings.startupProfiles.filter((profile) => profile.id !== selectedProfile.id)
    update({ ...settings, startupProfiles, selectedStartupProfileId: startupProfiles[0].id })
  }

  const runCatalogOperation = async (operation: CatalogOperation, task: () => Promise<void>) => {
    setCatalogOperation(operation)
    try { await task() }
    catch (reason) { toast.error('操作失败', { description: reason instanceof Error ? reason.message : String(reason) }) }
    finally { setCatalogOperation(null) }
  }

  const refreshSoftwarePaths = () => runCatalogOperation('refresh', async () => {
    const [nextDcs, nextCatalog] = await Promise.all([
      window.electronAPI?.dcs.status(),
      window.electronAPI?.softwareCatalog.overview(),
    ])
    if (nextDcs) setDcsStatus(nextDcs)
    if (nextCatalog) setCatalog(nextCatalog)
    toast.success('软件状态已刷新')
  })

  const detectAllBuiltinSoftware = () => runCatalogOperation('detect-all', async () => {
    const [nextDcs, nextCatalog] = await Promise.all([
      window.electronAPI?.dcs.useAutomaticDetection(),
      window.electronAPI?.softwareCatalog.useAutomaticDetection(),
    ])
    if (nextDcs) setDcsStatus(nextDcs)
    if (nextCatalog) setCatalog(nextCatalog)
    toast.success('已重新识别全部内置软件')
  })

  const chooseDcsDirectory = () => runCatalogOperation('dcs-path', async () => {
    const next = await window.electronAPI?.dcs.chooseInstallDirectory()
    if (next) {
      setDcsStatus(next)
      toast.success('DCS World 路径已更新')
    }
  })

  const chooseBuiltinExecutable = (id: string, displayName: string) => runCatalogOperation(`path-${id}`, async () => {
    const next = await window.electronAPI?.softwareCatalog.chooseBuiltinExecutable(id)
    if (next) {
      setCatalog(next)
      toast.success(`${displayName} 路径已更新`)
    }
  })

  const addSoftware = () => runCatalogOperation('add', async () => {
    const next = await window.electronAPI?.softwareCatalog.chooseAndAdd()
    if (next) {
      setCatalog(next)
      toast.success('软件已添加到 DCS Hub')
    }
  })

  const setSoftwareEnabled = (id: string, enabled: boolean) => runCatalogOperation(`toggle-${id}`, async () => {
    const next = await window.electronAPI?.softwareCatalog.setEnabled(id, enabled)
    if (next) setCatalog(next)
  })

  const setSoftwareSilentLaunch = (id: string, silent: boolean) => runCatalogOperation(`silent-${id}`, async () => {
    const next = await window.electronAPI?.softwareCatalog.setSilentLaunch(id, silent)
    if (next) setCatalog(next)
  })

  const setSoftwareLaunchDelay = (id: string, seconds: number) => runCatalogOperation(`delay-${id}`, async () => {
    const next = await window.electronAPI?.softwareCatalog.setLaunchDelay(id, seconds)
    if (next) setCatalog(next)
  })

  const removeSoftware = (id: string) => runCatalogOperation(`remove-${id}`, async () => {
    const next = await window.electronAPI?.softwareCatalog.remove(id)
    if (next) setCatalog(next)
    toast.success('已移除用户软件')
  })

  const dcsSourceLabel = dcsStatus?.source === 'manual'
    ? '手动设置'
    : dcsStatus?.source === 'registry'
      ? '自动识别 · 独立版'
      : dcsStatus?.source === 'steam'
        ? '自动识别 · Steam'
        : dcsStatus?.source === 'default'
          ? '自动识别 · 默认目录'
          : '尚未识别'

  const enabledSoftwareCount = catalog?.items.filter((item) => item.enabled).length || 0

  const resetAllUserData = async () => {
    setResetting(true)
    try {
      await window.electronAPI?.windowControls.resetAllUserData()
    } catch (reason) {
      setResetting(false)
      toast.error('清除失败', { description: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const setAutomaticUpdateChecks = async (enabled: boolean) => {
    try {
      const next = await window.electronAPI?.updates.setAutomaticChecks(enabled)
      if (next) setUpdateSettings(next)
    } catch (reason) {
      toast.error('保存更新设置失败', { description: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const checkForMajorUpdate = async () => {
    setCheckingUpdates(true)
    try {
      const result = await window.electronAPI?.updates.check(true)
      if (result?.status === 'available') announceMajorUpdate(result.update)
      else toast.success('当前没有发布者指定推送的新版本')
    } catch (reason) {
      toast.error('检查更新失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setCheckingUpdates(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25"><Settings className="size-5 text-primary" /></div>
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
      </div>

      <Card className="overflow-hidden border-border/45 bg-card/75">
        <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-accent/15" onClick={() => setThemeOpen((current) => !current)} aria-expanded={themeOpen}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">{settings.theme === 'dark' ? <Moon className="size-5 text-primary" /> : <Sun className="size-5 text-primary" />}</div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">主题</p><p className="mt-1 text-xs text-muted-foreground">深色与亮色界面</p></div>
          <span className="text-xs font-medium text-muted-foreground">{settings.theme === 'dark' ? '深色' : '亮色'}</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${themeOpen ? 'rotate-180 text-primary' : ''}`} />
        </button>
        {themeOpen && <CardContent className="flex items-center justify-end gap-3 border-t border-border/35 p-5">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${settings.theme === 'light' ? 'text-primary' : 'text-muted-foreground'}`}><Sun className="size-3.5" />亮色</span>
          <Switch aria-label="主题模式" checked={settings.theme === 'dark'} onCheckedChange={(checked) => update({ ...settings, theme: checked ? 'dark' : 'light' })} />
          <span className={`flex items-center gap-1.5 text-xs font-medium ${settings.theme === 'dark' ? 'text-primary' : 'text-muted-foreground'}`}><Moon className="size-3.5" />深色</span>
        </CardContent>}
      </Card>

      <Card className="overflow-hidden border-primary/20 bg-card/80 shadow-[inset_3px_0_0_hsl(var(--primary)/0.7)]">
        <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-accent/15" onClick={() => setSoftwareOpen((current) => !current)} aria-expanded={softwareOpen}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><HardDrive className="size-5 text-primary" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">软件设置</p><p className="mt-1 text-xs text-muted-foreground">预设、启动方式、延迟与软件路径</p></div>
          <span className="rounded-md border border-primary/15 bg-primary/[0.07] px-2 py-1 text-xs text-muted-foreground">{selectedProfile.name} · {enabledSoftwareCount}/{catalog?.items.length || 0}</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${softwareOpen ? 'rotate-180 text-primary' : ''}`} />
        </button>

        {softwareOpen && <CardContent className="space-y-4 border-t border-border/35 p-5">
          <section className="space-y-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-auto flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4 text-primary" />软件预设</div>
              <Select value={selectedProfile.id} onValueChange={(id) => update({ ...settings, selectedStartupProfileId: id })}>
                <SelectTrigger aria-label="选择软件预设" className="h-8 w-40"><SelectValue>{selectedProfile.name}</SelectValue></SelectTrigger>
                <SelectContent>{settings.startupProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label="软件预设名称" className="h-8 w-36" value={selectedProfile.name} maxLength={32} onChange={(event) => updateSelectedProfile({ name: event.target.value })} />
              <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={addProfile}><Plus className="size-3.5" />新建</Button>
              <Button aria-label="删除当前软件预设" size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" disabled={settings.startupProfiles.length <= 1} onClick={removeProfile}><Trash2 className="size-3.5" /></Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lifecycleModules.map((module) => {
                const enabled = selectedProfile.moduleIds.includes(module.id)
                return <div key={module.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2">
                  <span className="truncate text-xs font-medium">{module.displayName}</span>
                  <Switch className="scale-90" aria-label={`${module.displayName} 是否加入软件预设`} checked={enabled} onCheckedChange={(checked) => updateSelectedProfile({ moduleIds: checked ? [...selectedProfile.moduleIds, module.id] : selectedProfile.moduleIds.filter((id) => id !== module.id) })} />
                </div>
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border/35 bg-background/25 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-auto flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4 text-primary" />软件路径与启动</div>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => void refreshSoftwarePaths()} disabled={catalogOperation !== null}>{catalogOperation === 'refresh' ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}刷新</Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => void detectAllBuiltinSoftware()} disabled={catalogOperation !== null}>{catalogOperation === 'detect-all' ? <LoaderCircle className="size-3.5 animate-spin" /> : <HardDrive className="size-3.5" />}自动识别</Button>
              <Button size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => void addSoftware()} disabled={catalogOperation !== null}>{catalogOperation === 'add' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}添加软件</Button>
            </div>

            <div className="space-y-2">
              <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/30 bg-background/45 px-3 py-2">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${dcsStatus?.executablePath ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>{dcsStatus?.executablePath ? <Gamepad2 className="size-4 text-emerald-400" /> : <CircleAlert className="size-4 text-amber-400" />}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-medium">DCS World</span><span className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">{dcsSourceLabel}</span></div><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={dcsStatus?.executablePath || undefined}>{dcsStatus?.executablePath || '尚未识别'}</p></div>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void chooseDcsDirectory()} disabled={catalogOperation !== null}>{catalogOperation === 'dcs-path' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择目录</Button>
              </div>

              {catalog?.items.map((item) => (
                <div key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/30 bg-background/45 px-3 py-2">
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/70">{item.icon ? <Image src={item.icon} alt="" className="size-5 object-contain" /> : <Package className="size-4 text-muted-foreground" />}</div>
                  <div className="min-w-[12rem] flex-1"><div className="flex items-center gap-2"><span className="truncate text-xs font-medium">{item.displayName}</span><span className={`size-1.5 rounded-full ${item.installState === 'installed' ? 'bg-emerald-400' : 'bg-amber-400'}`} /><span className="text-[9px] text-muted-foreground">{item.kind === 'custom' ? '用户软件' : '内置模块'}</span></div><p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={item.executablePath || undefined}>{item.executablePath || '未识别程序路径'}</p></div>
                  <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border/35 bg-card/45 px-2" title="启动软件后最小化其窗口">
                    <span className="text-[10px] text-muted-foreground">静默</span>
                    <Switch className="scale-75" aria-label={`${item.displayName} 静默启动`} checked={item.silentLaunch} onCheckedChange={(checked) => void setSoftwareSilentLaunch(item.id, checked)} disabled={catalogOperation !== null} />
                  </div>
                  <div className="flex h-8 items-center rounded-lg border border-border/35 bg-card/45" title="检测到软件运行后，启动 DCS 前的等待时间">
                    <Button aria-label={`${item.displayName} 减少启动延迟`} variant="ghost" size="icon" className="size-7 rounded-r-none" disabled={catalogOperation !== null || item.launchDelaySeconds <= 0} onClick={() => void setSoftwareLaunchDelay(item.id, item.launchDelaySeconds - 1)}><Minus className="size-3" /></Button>
                    <span className="flex w-12 items-center justify-center gap-1 text-[10px] tabular-nums text-muted-foreground"><Timer className="size-3" />{item.launchDelaySeconds}秒</span>
                    <Button aria-label={`${item.displayName} 增加启动延迟`} variant="ghost" size="icon" className="size-7 rounded-l-none" disabled={catalogOperation !== null || item.launchDelaySeconds >= 120} onClick={() => void setSoftwareLaunchDelay(item.id, item.launchDelaySeconds + 1)}><Plus className="size-3" /></Button>
                  </div>
                  {item.kind === 'builtin' && <Button aria-label={`选择 ${item.displayName} 路径`} title="选择路径" variant="outline" size="icon" className="size-8" onClick={() => void chooseBuiltinExecutable(item.id, item.displayName)} disabled={catalogOperation !== null}>{catalogOperation === `path-${item.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}</Button>}
                  {item.removable && <Button aria-label={`移除 ${item.displayName}`} size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => void removeSoftware(item.id)} disabled={catalogOperation !== null}>{catalogOperation === `remove-${item.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</Button>}
                  <Switch aria-label={`${item.displayName} 接入状态`} checked={item.enabled} onCheckedChange={(checked) => void setSoftwareEnabled(item.id, checked)} disabled={catalogOperation !== null} />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">延迟仅用于一键启动：每个本次新启动的软件从确认运行时独立计时，全部延迟结束后再启动 DCS。关闭接入不会强制结束外部程序。</p>
          </section>
        </CardContent>}
      </Card>

      <ManualLibrarySettingsCard />

      <Card className="overflow-hidden border-border/45 bg-card/75">
        <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-accent/15" onClick={() => setUpdatesOpen((current) => !current)} aria-expanded={updatesOpen}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><CloudDownload className="size-5 text-primary" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">更新推送</p><p className="mt-1 text-xs text-muted-foreground">检查发布者指定的版本</p></div>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${updatesOpen ? 'rotate-180 text-primary' : ''}`} />
        </button>
        {updatesOpen && <CardContent className="space-y-4 border-t border-border/35 p-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/35 bg-background/45 px-4 py-3">
            <div className="min-w-0"><p className="text-sm font-medium">启动时检查推送版本</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">日常修复和未指定推送的 Release 不会弹窗。</p></div>
            <Switch aria-label="启动时检查推送版本" checked={updateSettings.automaticChecks} onCheckedChange={(checked) => void setAutomaticUpdateChecks(checked)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] text-muted-foreground">只读取 DCSHUB GitHub Releases，不会自动下载或安装。</p>
            <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={() => void checkForMajorUpdate()} disabled={checkingUpdates}>{checkingUpdates ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}立即检查</Button>
          </div>
        </CardContent>}
      </Card>

      <Card className="border-red-400/20 bg-red-500/[0.025]"><CardContent className="flex flex-wrap items-center gap-4 p-5"><div className="flex size-10 items-center justify-center rounded-xl bg-red-500/10 ring-1 ring-red-400/20"><Trash2 className="size-5 text-red-400" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-red-300">清除所有设置与缓存</p><p className="mt-1 text-xs text-muted-foreground">恢复 DCSHUB 首次运行状态并自动重新启动</p></div><Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>清除缓存</Button></CardContent></Card>

      <Dialog open={resetOpen} onOpenChange={(next) => { if (!resetting) setResetOpen(next) }}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-red-300"><CircleAlert className="size-5" />确认清除全部 DCSHUB 数据？</DialogTitle><DialogDescription>这会删除软件路径、软件预设、模组管理状态、超级手册索引、API Key、主题和语言等设置，然后自动重启。不会删除用户手册原文件、模组仓库、游戏文件或备份目录中的文件。</DialogDescription></DialogHeader><DialogFooter className="mt-6 gap-2"><Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>取消</Button><Button variant="destructive" onClick={() => void resetAllUserData()} disabled={resetting}>{resetting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}清除并重新启动</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
