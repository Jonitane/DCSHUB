import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleAlert, FolderOpen, Gamepad2, HardDrive, LoaderCircle, Moon, Package, Plus, RefreshCw, Settings, SlidersHorizontal, Sun, Trash2 } from 'lucide-react'
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

type CatalogOperation = 'refresh' | 'detect-all' | 'add' | 'dcs-path' | string

export default function SettingsPage() {
  const { modules } = useModuleContext()
  const lifecycleModules = useMemo(() => modules.filter((module) => module.capabilities.lifecycle), [modules])
  const lifecycleModuleIds = useMemo(() => lifecycleModules.map((module) => module.id), [lifecycleModules])
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings())
  const [themeOpen, setThemeOpen] = useState(false)
  const [startupPresetsOpen, setStartupPresetsOpen] = useState(false)
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

      <Card className="overflow-hidden border-primary/25 bg-gradient-to-r from-primary/[0.075] via-card/85 to-card/75 shadow-[inset_3px_0_0_var(--primary)]">
        <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-primary/5" onClick={() => setStartupPresetsOpen((current) => !current)} aria-expanded={startupPresetsOpen}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25"><SlidersHorizontal className="size-5 text-primary" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-primary">软件预设</p><p className="mt-1 text-xs text-muted-foreground">配置一键启动和停止包含的软件</p></div>
          <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{selectedProfile.name}</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${startupPresetsOpen ? 'rotate-180 text-primary' : ''}`} />
        </button>
        {startupPresetsOpen && <CardContent className="space-y-3 border-t border-primary/15 p-5">
          <div className="flex items-center justify-end gap-2">
            <Select value={selectedProfile.id} onValueChange={(id) => update({ ...settings, selectedStartupProfileId: id })}>
              <SelectTrigger aria-label="选择软件预设" className="w-44"><SelectValue>{selectedProfile.name}</SelectValue></SelectTrigger>
              <SelectContent>{settings.startupProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="icon" variant="outline" onClick={addProfile}><Plus className="size-4" /></Button>
            <Button size="icon" variant="outline" disabled={settings.startupProfiles.length <= 1} onClick={removeProfile}><Trash2 className="size-4" /></Button>
          </div>
          <Input value={selectedProfile.name} maxLength={32} onChange={(event) => updateSelectedProfile({ name: event.target.value })} />
          {lifecycleModules.map((module) => {
            const enabled = selectedProfile.moduleIds.includes(module.id)
            return <div key={module.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-background/40 px-4 py-3">
              <span className="text-sm font-medium">{module.displayName}</span>
              <Switch aria-label={`${module.displayName} 是否加入软件预设`} checked={enabled} onCheckedChange={(checked) => updateSelectedProfile({ moduleIds: checked ? [...selectedProfile.moduleIds, module.id] : selectedProfile.moduleIds.filter((id) => id !== module.id) })} />
            </div>
          })}
        </CardContent>}
      </Card>

      <Card className="overflow-hidden border-border/45 bg-card/75">
        <button type="button" className="flex w-full items-center gap-3.5 p-5 text-left transition-colors hover:bg-accent/15" onClick={() => setSoftwareOpen((current) => !current)} aria-expanded={softwareOpen}>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"><HardDrive className="size-5 text-primary" /></div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">软件路径与管理</p><p className="mt-1 text-xs text-muted-foreground">识别路径、选择主程序并控制模块加载</p></div>
          <span className="text-xs text-muted-foreground">{enabledSoftwareCount}/{catalog?.items.length || 0} 已加载</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${softwareOpen ? 'rotate-180 text-primary' : ''}`} />
        </button>

        {softwareOpen && <CardContent className="space-y-4 border-t border-border/35 p-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void refreshSoftwarePaths()} disabled={catalogOperation !== null}>{catalogOperation === 'refresh' ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}刷新状态</Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void detectAllBuiltinSoftware()} disabled={catalogOperation !== null}>{catalogOperation === 'detect-all' ? <LoaderCircle className="size-3.5 animate-spin" /> : <HardDrive className="size-3.5" />}自动识别全部</Button>
            <Button size="sm" className="gap-2" onClick={() => void addSoftware()} disabled={catalogOperation !== null}>{catalogOperation === 'add' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}添加软件</Button>
          </div>

          <div className="space-y-2">
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/35 bg-background/45 px-3 py-2.5">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${dcsStatus?.executablePath ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>{dcsStatus?.executablePath ? <Gamepad2 className="size-4.5 text-emerald-400" /> : <CircleAlert className="size-4.5 text-amber-400" />}</div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-medium">DCS World</span><span className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">{dcsSourceLabel}</span></div><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={dcsStatus?.executablePath || undefined}>{dcsStatus?.executablePath || '尚未识别'}</p></div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void chooseDcsDirectory()} disabled={catalogOperation !== null}>{catalogOperation === 'dcs-path' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择目录</Button>
            </div>

            {catalog?.items.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/35 bg-background/45 px-3 py-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/70">{item.icon ? <Image src={item.icon} alt="" className="size-6 object-contain" /> : <Package className="size-4 text-muted-foreground" />}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{item.displayName}</span><span className={`size-1.5 rounded-full ${item.installState === 'installed' ? 'bg-emerald-400' : 'bg-amber-400'}`} /><span className="text-[9px] text-muted-foreground">{item.kind === 'custom' ? '用户软件' : '内置模块'}</span></div><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={item.executablePath || undefined}>{item.executablePath || '未识别程序路径'}</p></div>
                {item.kind === 'builtin' && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void chooseBuiltinExecutable(item.id, item.displayName)} disabled={catalogOperation !== null}>{catalogOperation === `path-${item.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}选择路径</Button>}
                {item.removable && <Button aria-label={`移除 ${item.displayName}`} size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => void removeSoftware(item.id)} disabled={catalogOperation !== null}>{catalogOperation === `remove-${item.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</Button>}
                <Switch aria-label={`${item.displayName} 接入状态`} checked={item.enabled} onCheckedChange={(checked) => void setSoftwareEnabled(item.id, checked)} disabled={catalogOperation !== null} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">重新识别或修改内置模块路径前，请先停止对应软件。关闭接入不会强制结束外部程序。</p>
        </CardContent>}
      </Card>

      <ManualLibrarySettingsCard />

      <Card className="border-red-400/20 bg-red-500/[0.025]"><CardContent className="flex flex-wrap items-center gap-4 p-5"><div className="flex size-10 items-center justify-center rounded-xl bg-red-500/10 ring-1 ring-red-400/20"><Trash2 className="size-5 text-red-400" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-red-300">清除所有设置与缓存</p><p className="mt-1 text-xs text-muted-foreground">恢复 DCSHUB 首次运行状态并自动重新启动</p></div><Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>清除缓存</Button></CardContent></Card>

      <Dialog open={resetOpen} onOpenChange={(next) => { if (!resetting) setResetOpen(next) }}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-red-300"><CircleAlert className="size-5" />确认清除全部 DCSHUB 数据？</DialogTitle><DialogDescription>这会删除软件路径、软件预设、模组管理状态、超级手册索引、API Key、主题和语言等设置，然后自动重启。不会删除用户手册原文件、模组仓库、游戏文件或备份目录中的文件。</DialogDescription></DialogHeader><DialogFooter className="mt-6 gap-2"><Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>取消</Button><Button variant="destructive" onClick={() => void resetAllUserData()} disabled={resetting}>{resetting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}清除并重新启动</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
