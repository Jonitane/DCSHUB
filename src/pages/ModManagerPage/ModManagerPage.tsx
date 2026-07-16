import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Bookmark, Boxes, CheckCircle2, CircleAlert, FolderOpen, Gamepad2, HardDrive, Import, PackageCheck, PackageMinus, Play, Plus, RefreshCw, Save, Settings2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/lib/i18n'
import type { ModManagerOverview, ModManagerSettings, ModPackage } from '@/shared/mod-manager-contracts'

const emptySettings: ModManagerSettings = {
  gameDirectories: [{ id: 'dcs-main', name: 'DCS World', path: '', modsPath: '' }],
  activeGameDirectoryId: 'dcs-main',
  backupPath: '',
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

function formatBackupDate(value: string | null | undefined): string {
  if (!value) return '尚未备份'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未备份'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export default function ModManagerPage() {
  const { t } = useI18n()
  const [overview, setOverview] = useState<ModManagerOverview | null>(null)
  const [selectedModId, setSelectedModId] = useState<string | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [presetNameOpen, setPresetNameOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [settings, setSettings] = useState<ModManagerSettings>(emptySettings)

  const refresh = useCallback(async () => {
    const bridge = window.electronAPI?.modManager
    if (!bridge) {
      setOverview({ configured: false, settings: null, mods: [], enabledCount: 0, totalModCount: 0, totalEnabledCount: 0, enabledModKeys: [], activeGameDirectory: null, presets: [], activePresetId: null, lastConfigBackupAt: null })
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await bridge.overview()
      setOverview(next)
      setSelectedPresetId((current) => next.presets.some((preset) => preset.id === current) ? current : next.activePresetId || next.presets[0]?.id || '')
      setSettings(next.settings || emptySettings)
      setSelectedModId((current) => current && next.mods.some((mod) => mod.id === current) ? current : next.mods[0]?.id || null)
    } catch (reason) {
      toast.error('模组管理器加载失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const selectedMod = useMemo(() => overview?.mods.find((mod) => mod.id === selectedModId) || null, [overview, selectedModId])

  const chooseBackupDirectory = async () => {
    const selected = await window.electronAPI?.modManager.chooseDirectory(t('选择原文件备份目录'))
    if (selected) setSettings((current) => ({ ...current, backupPath: selected }))
  }

  const chooseGameDirectory = async (index: number, field: 'path' | 'modsPath', title: string) => {
    const selected = await window.electronAPI?.modManager.chooseDirectory(t(title))
    if (!selected) return
    setSettings((current) => ({
      ...current,
      gameDirectories: current.gameDirectories.map((directory, itemIndex) => itemIndex === index ? { ...directory, [field]: selected } : directory),
    }))
  }

  const updateGameDirectory = (index: number, field: 'name' | 'path' | 'modsPath', value: string) => {
    setSettings((current) => ({
      ...current,
      gameDirectories: current.gameDirectories.map((directory, itemIndex) => itemIndex === index ? { ...directory, [field]: value } : directory),
    }))
  }

  const addGameDirectory = () => {
    const id = `game-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setSettings((current) => ({
      ...current,
      gameDirectories: [...current.gameDirectories, { id, name: `游戏目录 ${current.gameDirectories.length + 1}`, path: '', modsPath: '' }],
    }))
  }

  const removeGameDirectory = (index: number) => {
    setSettings((current) => {
      if (current.gameDirectories.length === 1) return current
      const removed = current.gameDirectories[index]
      const gameDirectories = current.gameDirectories.filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        gameDirectories,
        activeGameDirectoryId: current.activeGameDirectoryId === removed.id ? gameDirectories[0].id : current.activeGameDirectoryId,
      }
    })
  }

  const selectGameDirectory = async (gameDirectoryId: string) => {
    setOperation('switch-directory')
    try {
      const next = await window.electronAPI?.modManager.selectGameDirectory(gameDirectoryId)
      if (next) {
        setOverview(next)
        setSettings(next.settings || emptySettings)
        setSelectedModId(next.mods[0]?.id || null)
      }
    } catch (reason) {
      toast.error('切换游戏目录失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const applyPreset = async (presetId: string) => {
    setOperation('preset')
    try {
      const next = await window.electronAPI?.modManager.applyPreset(presetId)
      if (next) {
        setOverview(next)
        setSelectedPresetId(presetId)
        setSettings(next.settings || emptySettings)
        setSelectedModId(next.mods[0]?.id || null)
        toast.success('模组预设已应用')
      }
    } catch (reason) {
      toast.error('应用模组预设失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const createPreset = async () => {
    const name = presetName.trim()
    if (!name) return
    setOperation('preset')
    try {
      const next = await window.electronAPI?.modManager.createPreset(name)
      if (next) {
        setOverview(next)
        setSelectedPresetId(next.activePresetId || next.presets[0]?.id || '')
      }
      setPresetNameOpen(false)
      setPresetName('')
      toast.success('已用当前模组状态创建预设')
    } catch (reason) {
      toast.error('创建预设失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally { setOperation(null) }
  }

  const updatePreset = async () => {
    if (!selectedPresetId) return
    setOperation('preset')
    try {
      const next = await window.electronAPI?.modManager.updatePreset(selectedPresetId)
      if (next) {
        setOverview(next)
        setSelectedPresetId(selectedPresetId)
      }
      toast.success('已保存当前所有目录的 Mod 选择')
    } catch (reason) {
      toast.error('保存预设失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally { setOperation(null) }
  }

  const deletePreset = async () => {
    if (!selectedPresetId || !window.confirm('确定删除当前模组预设吗？')) return
    setOperation('preset')
    try {
      const next = await window.electronAPI?.modManager.deletePreset(selectedPresetId)
      if (next) {
        setOverview(next)
        setSelectedPresetId(next.activePresetId || next.presets[0]?.id || '')
      }
      toast.success('模组预设已删除')
    } catch (reason) {
      toast.error('删除预设失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally { setOperation(null) }
  }

  const saveSettings = async () => {
    setOperation('settings')
    try {
      const next = await window.electronAPI?.modManager.saveSettings(settings)
      if (next) setOverview(next)
      setSettingsOpen(false)
      toast.success('模组管理目录已保存')
    } catch (reason) {
      toast.error('保存失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const backupSavedGamesConfig = async () => {
    const backupPath = settings.backupPath.trim()
    if (!backupPath) {
      toast.error('请先设置备份目录')
      return
    }

    setOperation('config-backup')
    try {
      const result = await window.electronAPI?.modManager.backupSavedGamesConfig(backupPath)
      if (!result?.ok) {
        toast.error(result?.message || 'DCS Config 备份失败')
        return
      }
      if (result.backedUpAt) {
        setOverview((current) => current ? { ...current, lastConfigBackupAt: result.backedUpAt || null } : current)
      }
      toast.success(result.message || 'DCS Config 已完成备份', { description: result.destinationPath })
    } catch (reason) {
      toast.error('DCS Config 备份失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const importArchives = async () => {
    setOperation('import')
    try {
      const result = await window.electronAPI?.modManager.importArchives()
      if (result?.ok) {
        toast.success(result.message || '模组包已导入')
        await refresh()
      } else if (result?.message && result.message !== '已取消导入') toast.error(result.message)
    } catch (reason) {
      toast.error('导入失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const toggleMod = async (mod: ModPackage) => {
    let allowConflicts = false
    if (!mod.enabled && mod.conflicts.length > 0) {
      allowConflicts = window.confirm(`“${mod.name}”会覆盖以下已启用模组的文件：\n\n${mod.conflicts.join('\n')}\n\n是否仍要启用？`)
      if (!allowConflicts) return
    }
    setOperation(mod.id)
    try {
      const result = await window.electronAPI?.modManager.setModEnabled(mod.id, !mod.enabled, allowConflicts)
      if (result?.ok) {
        toast.success(result.message || (mod.enabled ? '模组已停用' : '模组已启用'))
        await refresh()
      } else toast.error(result?.message || '模组操作失败')
    } catch (reason) {
      toast.error('模组操作失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const toggleAll = async (enabled: boolean) => {
    if (enabled && !window.confirm('将按当前列表顺序启用全部模组。存在冲突时，后启用的模组会覆盖前面的文件。是否继续？')) return
    setOperation(enabled ? 'all-on' : 'all-off')
    try {
      const result = await window.electronAPI?.modManager.setAllModsEnabled(enabled)
      if (result?.ok) {
        toast.success(result.message || '操作完成')
        await refresh()
      } else toast.error(result?.message || '批量操作失败')
    } catch (reason) {
      toast.error('批量操作失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setOperation(null)
    }
  }

  const openSettings = () => {
    setSettings(overview?.settings || emptySettings)
    setSettingsOpen(true)
  }

  if (loading && !overview) return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />正在扫描模组仓库…</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">DCS 模组管理器</h1>
          <p className="mt-1 text-sm text-muted-foreground">本地模组启用、备份与恢复</p>
        </div>
        <div className="flex items-center gap-2">
          {overview?.configured && overview.settings && (
            <Select value={overview.settings.activeGameDirectoryId} onValueChange={(value) => void selectGameDirectory(value)}>
              <SelectTrigger className="w-56 border-emerald-400/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20 focus:ring-emerald-400/50" disabled={operation !== null}>
                <SelectValue><span className="flex items-center gap-2"><Gamepad2 className="size-4" />{overview.activeGameDirectory?.name || '选择游戏目录'}</span></SelectValue>
              </SelectTrigger>
              <SelectContent className="w-72">
                {overview.settings.gameDirectories.map((directory) => <SelectItem key={directory.id} value={directory.id}><div><p className="font-medium">{directory.name}</p><p className="max-w-60 truncate text-[10px] text-muted-foreground">{directory.path}</p></div></SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || operation !== null}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>
          <Button variant="outline" size="sm" onClick={openSettings} disabled={operation !== null}><Settings2 className="size-4" />目录设置</Button>
        </div>
      </div>

      {!overview?.configured ? (
        <Card className="border-primary/25 bg-card/70">
          <CardContent className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/25"><Boxes className="size-8 text-primary" /></div>
            <h2 className="text-lg font-semibold">配置 DCS 模组管理目录</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">添加一个或多个游戏与模组目标目录，为每个目标分别指定本地模组仓库，再选择原文件备份目录。</p>
            <Button className="mt-6" onClick={openSettings}><Settings2 className="size-4" />开始配置</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-border/40 bg-card/60"><CardContent className="flex items-center gap-4 p-5"><Archive className="size-7 text-primary" /><div><p className="text-2xl font-semibold">{overview.totalModCount}</p><p className="text-xs text-muted-foreground">全部目录本地 Mod</p></div></CardContent></Card>
            <Card className="border-border/40 bg-card/60"><CardContent className="flex items-center gap-4 p-5"><PackageCheck className="size-7 text-emerald-400" /><div><p className="text-2xl font-semibold">{overview.totalEnabledCount}</p><p className="text-xs text-muted-foreground">全部目录已启用</p></div></CardContent></Card>
            <Card className="border-border/40 bg-card/60"><CardContent className="min-w-0 p-5"><p className="truncate text-sm font-medium">{overview.activeGameDirectory?.path}</p><p className="mt-1 text-xs text-muted-foreground">{overview.activeGameDirectory?.name || '当前游戏目录'}</p></CardContent></Card>
          </div>

          <Card className="border-border/40 bg-card/70">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">模组列表</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void importArchives()} disabled={operation !== null}><Import className="size-4" />导入 ZIP</Button>
                <Button size="sm" onClick={() => void toggleAll(true)} disabled={operation !== null || overview.mods.length === 0}><CheckCircle2 className="size-4" />全部启用</Button>
                <Button size="sm" variant="destructive" onClick={() => void toggleAll(false)} disabled={operation !== null || overview.enabledCount === 0}><PackageMinus className="size-4" />全部停用</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid min-h-[460px] gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
                <div className="space-y-2 overflow-hidden rounded-xl border border-border/40 bg-background/35 p-2">
                  {overview.mods.length === 0 ? (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center text-center text-sm text-muted-foreground"><Archive className="mb-3 size-9 opacity-50" /><p>模组仓库中没有可用模组</p><p className="mt-1 text-xs">放入文件夹模组，或点击“导入 ZIP”</p></div>
                  ) : overview.mods.map((mod) => (
                    <button key={mod.id} type="button" onClick={() => setSelectedModId(mod.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${selectedModId === mod.id ? 'border-primary/35 bg-primary/8' : 'border-transparent hover:bg-accent/45'}`}>
                      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${mod.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{mod.kind === 'archive' ? <Archive className="size-4" /> : <FolderOpen className="size-4" />}</div>
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{mod.name}</p>{mod.version && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">v{mod.version}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{mod.kind === 'archive' ? 'ZIP 模组包' : '文件夹模组'} · {formatSize(mod.size)}</p></div>
                      {mod.conflicts.length > 0 && <CircleAlert className="size-4 shrink-0 text-amber-400" />}
                      <Badge variant="outline" className={mod.enabled ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300' : 'border-border text-muted-foreground'}>{mod.enabled ? '已启用' : '未启用'}</Badge>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-violet-400/25 bg-violet-500/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold"><Bookmark className="size-4 text-violet-300" />模组预设</div>
                    <div className="mt-3 flex items-center gap-2"><div className="min-w-0 flex-1"><Select value={selectedPresetId} onValueChange={setSelectedPresetId}><SelectTrigger className="border-violet-400/25 bg-background/65" disabled={operation !== null}><SelectValue>{overview.presets.find((preset) => preset.id === selectedPresetId)?.name || '选择预设'}</SelectValue></SelectTrigger><SelectContent>{overview.presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name} · {preset.entries.length} 个 Mod</SelectItem>)}</SelectContent></Select></div><Button size="sm" className="h-10 shrink-0 bg-violet-500 text-white hover:bg-violet-400" onClick={() => void applyPreset(selectedPresetId)} disabled={!selectedPresetId || operation !== null}><Play className="size-3.5" />应用</Button></div>
                    <div className="mt-3 grid grid-cols-3 gap-2"><Button size="sm" variant="outline" onClick={() => { setPresetName(''); setPresetNameOpen(true) }} disabled={operation !== null}><Plus className="size-3.5" />新建</Button><Button size="sm" variant="outline" onClick={() => void updatePreset()} disabled={operation !== null}><Save className="size-3.5" />保存当前</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void deletePreset()} disabled={operation !== null || overview.presets.length <= 1}><Trash2 className="size-3.5" />删除</Button></div>
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">预设包含全部游戏目录中的模组选择，切换后会立即应用。</p>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background/35 p-4">
                  {selectedMod ? (
                    <div className="flex h-full flex-col">
                      <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{selectedMod.name}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedMod.fileName}</p></div><Badge variant="outline" className={selectedMod.enabled ? 'border-emerald-400/35 text-emerald-300' : ''}>{selectedMod.enabled ? '已启用' : '未启用'}</Badge></div>
                      <div className="mt-3 flex items-center gap-2"><Button className="flex-1" variant={selectedMod.enabled ? 'destructive' : 'default'} onClick={() => void toggleMod(selectedMod)} disabled={operation !== null}>{operation === selectedMod.id ? <RefreshCw className="size-4 animate-spin" /> : selectedMod.enabled ? <PackageMinus className="size-4" /> : <PackageCheck className="size-4" />}{selectedMod.enabled ? '停用模组' : '启用模组'}</Button><Button variant="outline" onClick={() => void window.electronAPI?.modManager.revealMod(selectedMod.id)}><FolderOpen className="size-4" />打开原文件</Button></div>
                      <div className="mt-5 grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-muted/45 p-3"><p className="text-muted-foreground">类型</p><p className="mt-1 font-medium">{selectedMod.kind === 'archive' ? 'ZIP 模组包' : '文件夹'}</p></div><div className="rounded-lg bg-muted/45 p-3"><p className="text-muted-foreground">大小</p><p className="mt-1 font-medium">{formatSize(selectedMod.size)}</p></div></div>
                      {selectedMod.conflicts.length > 0 && <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/8 p-3 text-xs text-amber-200"><div className="flex items-center gap-1.5 font-semibold"><CircleAlert className="size-3.5" />文件覆盖关系</div><p className="mt-1.5 leading-5 text-amber-200/75">{selectedMod.conflicts.join('、')}</p></div>}
                      <div className="mt-4 min-h-0 flex-1"><p className="text-xs font-semibold text-muted-foreground">说明</p><div data-i18n-ignore="true" className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs leading-5 text-foreground/80">{selectedMod.description || '该模组没有 description.txt 或 readme.txt。'}</div></div>
                    </div>
                  ) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个模组查看详情</div>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={presetNameOpen} onOpenChange={setPresetNameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>新建模组预设</DialogTitle><DialogDescription>输入预设名称。新预设会保存当前所有游戏目录中已启用的模组。</DialogDescription></DialogHeader>
          <div className="mt-4 space-y-2"><Label htmlFor="preset-name">预设名称</Label><Input id="preset-name" autoFocus maxLength={40} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="例如：VR 飞行" onKeyDown={(event) => { if (event.key === 'Enter' && presetName.trim()) void createPreset() }} /></div>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setPresetNameOpen(false)}>取消</Button><Button onClick={() => void createPreset()} disabled={!presetName.trim() || operation !== null}>{operation === 'preset' && <RefreshCw className="size-4 animate-spin" />}创建预设</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>DCS 模组管理目录</DialogTitle><DialogDescription>目录变更前必须先停用所有游戏目录中的全部模组，确保原文件能够正确恢复。</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between"><div><Label>游戏与模组目标目录</Label><p className="mt-1 text-xs text-muted-foreground">可以加入 DCS 安装目录、Saved Games 或其他模组替换位置。</p></div><Button size="sm" variant="outline" onClick={addGameDirectory}><Plus className="size-4" />添加目录</Button></div>
              <div className="space-y-3">
                {settings.gameDirectories.map((directory, index) => (
                  <div key={directory.id} className="rounded-lg border border-border/50 bg-background/35 p-3">
                    <div className="mb-3 flex items-center gap-2"><Input className="max-w-56 font-medium" value={directory.name} onChange={(event) => updateGameDirectory(index, 'name', event.target.value)} placeholder="目录名称" /><div className="flex-1" /><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="删除目录" disabled={settings.gameDirectories.length === 1} onClick={() => removeGameDirectory(index)}><Trash2 className="size-4" /></Button></div>
                    <div className="grid gap-3">
                      <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center"><Label className="text-xs text-muted-foreground">替换目标目录</Label><Input value={directory.path} onChange={(event) => updateGameDirectory(index, 'path', event.target.value)} placeholder="DCS 安装目录、Saved Games 或其他目标" /><Button variant="outline" onClick={() => void chooseGameDirectory(index, 'path', '选择游戏或模组目标目录')}><FolderOpen className="size-4" />选择</Button></div>
                      <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center"><Label className="text-xs text-muted-foreground">对应本地仓库</Label><Input value={directory.modsPath} onChange={(event) => updateGameDirectory(index, 'modsPath', event.target.value)} placeholder="仅供这个目标目录使用的模组仓库" /><Button variant="outline" onClick={() => void chooseGameDirectory(index, 'modsPath', '选择对应的本地模组仓库')}><FolderOpen className="size-4" />选择</Button></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2"><Label>原文件备份目录</Label><div className="flex gap-2"><Input value={settings.backupPath} onChange={(event) => setSettings((current) => ({ ...current, backupPath: event.target.value }))} placeholder="建议放在空间充足、独立于游戏的目录" /><Button variant="outline" onClick={() => void chooseBackupDirectory()}><FolderOpen className="size-4" />选择</Button></div></div>
            <div className="space-y-1.5">
              <Button variant="outline" className="gap-2" onClick={() => void backupSavedGamesConfig()} disabled={operation !== null || !settings.backupPath.trim()}>
                {operation === 'config-backup' ? <RefreshCw className="size-4 animate-spin" /> : <Archive className="size-4" />}
                按键备份
              </Button>
              <p className="text-[11px] text-muted-foreground">上次备份：{formatBackupDate(overview?.lastConfigBackupAt)}</p>
              <p className="text-[11px] text-muted-foreground/80">备份 Saved Games\DCS\Config，并按时间保留独立快照。</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground"><HardDrive className="mr-1 inline size-3.5 text-primary" />DCS Hub 只会修改启用模组涉及的文件，并在修改前保存原文件。请勿让其他模组管理器同时管理同一批文件。</div>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button onClick={() => void saveSettings()} disabled={operation !== null || settings.gameDirectories.some((directory) => !directory.name.trim() || !directory.path.trim() || !directory.modsPath.trim()) || !settings.backupPath}>{operation === 'settings' && <RefreshCw className="size-4 animate-spin" />}保存设置</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
