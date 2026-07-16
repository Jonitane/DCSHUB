import { NavLink, useLocation } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useModuleContext } from '@/modules/ModuleContext'
import { getRunStatePresentation } from '@/modules/run-state'

export default function Header() {
  const { pathname } = useLocation()
  const { modules, snapshots } = useModuleContext()

  return (
    <header className="app-drag-region sticky top-0 z-20 w-full border-b border-border/30 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 items-center justify-between px-4 md:px-6">
        {pathname === '/' ? (
          <div className="min-w-0 leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-foreground">仪表板</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">模块运行与编排中心</p>
          </div>
        ) : <div />}
        <div className="app-no-drag flex items-center gap-3">
          {modules.map((module) => {
            const snapshot = snapshots[module.id]
            const runState = getRunStatePresentation(snapshot?.runState)
            const route = `/module/${module.id}`
            return (
              <NavLink key={module.id} to={route} title={runState.label} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${pathname === route ? 'bg-primary/10 text-primary ring-1 ring-primary/20' : 'text-muted-foreground hover:text-foreground'}`}>
                <Package className="size-3 shrink-0" />
                <span className="hidden sm:inline">{module.displayName}</span>
                <span className={`ml-0.5 block size-2 shrink-0 rounded-full ${runState.dotClassName}`} />
              </NavLink>
            )
          })}
        </div>
      </div>
    </header>
  )
}
