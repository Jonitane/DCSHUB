import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Package } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Image } from '@/components/ui/image'
import { Switch } from '@/components/ui/switch'
import { useModuleContext } from '@/modules/ModuleContext'
import type { SoftwareCatalogOverview } from '@/shared/software-catalog-contracts'

export default function InitialSoftwareSetup() {
  const { refresh } = useModuleContext()
  const [catalog, setCatalog] = useState<SoftwareCatalogOverview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.electronAPI?.softwareCatalog.overview().then((overview) => {
      setCatalog(overview)
      setSelected(new Set(overview.items.filter((item) => item.kind === 'builtin').map((item) => item.id)))
    }).catch(() => undefined)
  }, [])

  if (!catalog?.needsInitialSetup) return null
  const builtinItems = catalog.items.filter((item) => item.kind === 'builtin')

  const complete = async () => {
    setSaving(true)
    try {
      const next = await window.electronAPI?.softwareCatalog.completeInitialSetup([...selected])
      if (next) setCatalog(next)
      await refresh()
    } catch (reason) {
      toast.error('保存软件选择失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 p-6 backdrop-blur-xl">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-2xl">
        <div className="border-b border-border/40 px-6 py-5">
          <p className="text-lg font-semibold">选择要接入的软件</p>
          <p className="mt-1.5 text-sm text-muted-foreground">这些模块已经包含在 DCS Hub 中。未选择的软件不会加载，之后仍可在设置中开启。</p>
        </div>
        <div className="grid gap-2 p-6 sm:grid-cols-2">
          {builtinItems.map((item) => {
            const checked = selected.has(item.id)
            return (
              <div key={item.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${checked ? 'border-primary/35 bg-primary/10' : 'border-border/40 bg-background/35'}`}>
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/70">{item.icon ? <Image src={item.icon} alt="" className="size-7 object-contain" /> : <Package className="size-5" />}</div>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.displayName}</span>
                <Switch aria-label={`${item.displayName} 接入状态`} checked={checked} onCheckedChange={(nextChecked) => setSelected((current) => {
                  const next = new Set(current)
                  if (nextChecked) next.add(item.id)
                  else next.delete(item.id)
                  return next
                })} />
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t border-border/40 bg-background/25 px-6 py-4">
          <span className="text-xs text-muted-foreground">已选择 {selected.size} 个模块</span>
          <Button className="gap-2" onClick={() => void complete()} disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}开始使用</Button>
        </div>
      </div>
    </div>
  )
}
