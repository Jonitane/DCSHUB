import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { LayoutDashboard, Settings, Monitor, Gamepad2, Eye, Package, Rocket, PackageOpen, Plus, LoaderCircle, LogOut, BookOpenText } from 'lucide-react'
import { toast } from 'sonner'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Image } from '@/components/ui/image'
import { useModuleContext } from '@/modules/ModuleContext'
import { APP_VERSION } from '@/shared/app-meta'
import { useI18n } from '@/lib/i18n'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Monitor, Gamepad2, Eye, Package, Rocket,
}

const navItemClass = (active: boolean, prominent = false) => `relative flex items-center overflow-hidden border transition-all duration-300 ${prominent ? 'gap-2 rounded-xl px-2 py-2' : 'gap-1.5 rounded-lg px-1.5 py-1'} ${active
  ? "border-primary/25 bg-gradient-to-r from-primary/[0.14] via-primary/[0.055] to-transparent font-semibold text-sidebar-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_6px_16px_rgba(0,0,0,0.14)] before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
  : 'border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent/45'
}`

const navIconClass = (active: boolean, prominent = false) => `relative z-10 flex shrink-0 items-center justify-center border transition-all duration-300 ${prominent ? 'size-8 rounded-lg' : 'size-6 rounded-md'} ${active
  ? 'border-primary/20 bg-primary/10 text-primary'
  : 'border-transparent text-primary/65'
}`

export default function AppSidebar() {
  const { language, toggleLanguage } = useI18n()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { modules, refresh } = useModuleContext()
  const [addingSoftware, setAddingSoftware] = useState(false)
  const [exiting, setExiting] = useState(false)

  const addSoftware = async () => {
    const before = new Set(modules.map((module) => module.id))
    setAddingSoftware(true)
    try {
      const overview = await window.electronAPI?.softwareCatalog.chooseAndAdd()
      const added = overview?.items.find((item) => item.kind === 'custom' && item.enabled && !before.has(item.id))
      if (added) {
        await refresh()
        toast.success(`${added.displayName} 已添加`)
        navigate(`/module/${added.id}`)
      }
    } catch (reason) {
      toast.error('添加软件失败', { description: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setAddingSoftware(false)
    }
  }

  const exitApplication = () => {
    setExiting(true)
    window.electronAPI?.windowControls.quit()
  }

  return (
    <Sidebar collapsible="icon" className="z-[60] border-r border-sidebar-border" style={{ '--sidebar-width': '17rem' } as React.CSSProperties}>
      <SidebarHeader className="app-drag-region border-b border-sidebar-border">
        <div className="relative flex items-center gap-2.5 px-2 py-3.5 group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:px-0">
          <div className="flex size-11 shrink-0 items-center justify-center bg-transparent group-data-[state=collapsed]:size-9">
            <Image src="/images/dcshub-mark.png" alt="Dcs Hub" className="size-full bg-transparent object-contain [background-image:none]" />
          </div>
          <div className="min-w-0 flex-1 group-data-[state=collapsed]:hidden">
            <div className="truncate text-base font-bold tracking-tight text-sidebar-foreground">Dcs Hub</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Flight Sim</div>
          </div>
          <div className="app-no-drag flex shrink-0 flex-col items-end gap-1 group-data-[state=collapsed]:absolute group-data-[state=collapsed]:bottom-1 group-data-[state=collapsed]:right-0">
            <button
              type="button"
              className="flex h-7 items-center gap-1 overflow-hidden rounded-md border border-sidebar-border/75 bg-sidebar-accent/55 px-1.5 text-[9px] font-semibold text-sidebar-foreground/75 shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary group-data-[state=collapsed]:size-5 group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:p-0"
              aria-label={language === 'zh-CN' ? '切换到英文' : 'Switch to Chinese'}
              title={language === 'zh-CN' ? 'English' : '中文'}
              onClick={toggleLanguage}
            >
              <Image src={language === 'zh-CN' ? '/flags/cn.svg' : '/flags/us.svg'} alt="" className="h-3.5 w-5 rounded-[2px] object-cover group-data-[state=collapsed]:h-2.5 group-data-[state=collapsed]:w-4" />
              <span className="group-data-[state=collapsed]:hidden">{language === 'zh-CN' ? '中' : 'EN'}</span>
            </button>
            <span className="rounded border border-sidebar-border/65 bg-sidebar-accent/35 px-1.5 py-0.5 text-[8px] font-semibold leading-none text-sidebar-foreground/60 group-data-[state=collapsed]:hidden">{APP_VERSION}</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="p-1.5">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem className="mb-1.5 border-b border-sidebar-border/70 pb-1.5">
              <NavLink to="/" end className={navItemClass(pathname === '/', true)}>
                <span className={navIconClass(pathname === '/', true)}><LayoutDashboard className="size-[19px]" /></span>
                <span className="relative z-10 text-base font-semibold group-data-[state=collapsed]:hidden">仪表板</span>
              </NavLink>
            </SidebarMenuItem>
            {modules.map((module) => {
              const route = `/module/${module.id}`
              const Icon = ICON_MAP[module.icon || ''] || Package
              const active = pathname === route
              return (
                <SidebarMenuItem key={module.id}>
                  <NavLink to={route} className={`${navItemClass(active)} w-full min-w-0`}>
                    <span className={navIconClass(active)}>
                      {module.brandLogo
                        ? <Image src={module.brandLogo} alt={module.displayName} className="size-[17px] object-contain" />
                        : <Icon className="size-[15px]" />}
                    </span>
                    <span className="relative z-10 min-w-0 flex-1 truncate text-sm font-medium group-data-[state=collapsed]:hidden">{module.displayName}</span>
                  </NavLink>
                </SidebarMenuItem>
              )
            })}
            <SidebarMenuItem className="mt-1 border-t border-sidebar-border/60 pt-1.5">
              <button type="button" className={`${navItemClass(false)} w-full`} onClick={() => void addSoftware()} disabled={addingSoftware}>
                <span className={navIconClass(false)}>{addingSoftware ? <LoaderCircle className="size-[15px] animate-spin" /> : <Plus className="size-[15px]" />}</span>
                <span className="relative z-10 text-sm font-medium group-data-[state=collapsed]:hidden">添加软件</span>
              </button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarGroup className="p-1.5">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <NavLink to="/manual-library" className={navItemClass(pathname.startsWith('/manual-library'))}>
                <span className={navIconClass(pathname.startsWith('/manual-library'))}><BookOpenText className="size-[15px]" /></span>
                <span className="relative z-10 text-sm font-medium group-data-[state=collapsed]:hidden">超级手册</span>
              </NavLink>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <NavLink to="/mod-manager" className={navItemClass(pathname.startsWith('/mod-manager'))}>
                <span className={navIconClass(pathname.startsWith('/mod-manager'))}><PackageOpen className="size-[15px]" /></span>
                <span className="relative z-10 text-sm font-medium group-data-[state=collapsed]:hidden">模组管理器</span>
              </NavLink>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <NavLink to="/settings" className={navItemClass(pathname.startsWith('/settings'))}>
                <span className={navIconClass(pathname.startsWith('/settings'))}><Settings className="size-[15px]" /></span>
                <span className="relative z-10 text-sm font-medium group-data-[state=collapsed]:hidden">设置</span>
              </NavLink>
            </SidebarMenuItem>
            <SidebarMenuItem className="mt-1 border-t border-red-400/15 pt-1.5">
              <button type="button" aria-label="退出 DCSHUB" title="退出 DCSHUB" className="flex w-full items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 text-red-400 transition-colors hover:border-red-400/25 hover:bg-red-500/10 disabled:opacity-60" onClick={exitApplication} disabled={exiting}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-red-400/20 bg-red-500/10">{exiting ? <LoaderCircle className="size-[15px] animate-spin" /> : <LogOut className="size-[15px]" />}</span>
                <span className="text-sm font-semibold group-data-[state=collapsed]:hidden">退出</span>
              </button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  )
}
