import { Route, Routes, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RefreshCw } from 'lucide-react'
import Layout from '@/components/Layout'
import DashboardPage from '@/pages/DashboardPage/DashboardPage'
import GenericModulePage from '@/pages/GenericModulePage/GenericModulePage'
import SettingsPage from '@/pages/SettingsPage/SettingsPage'
import NotFoundPage from '@/pages/NotFoundPage'
import ModManagerPage from '@/pages/ModManagerPage/ModManagerPage'
import ManualLibraryPage from '@/pages/ManualLibraryPage/ManualLibraryPage'
import OverlayPage from '@/pages/OverlayPage/OverlayPage'
import { useModuleContext } from '@/modules/ModuleContext'

const TOAST_CLASSES = {
  toast: 'bg-background border border-border/50 text-foreground shadow-lg',
  title: 'font-semibold text-sm',
  description: 'text-xs text-muted-foreground',
  success: 'border-success/30',
  error: 'border-destructive/30',
  info: 'border-primary/30',
} as const

function ModuleRoute() {
  const { moduleId = '' } = useParams()
  const { modules, loading } = useModuleContext()
  if (!modules.some((module) => module.id === moduleId)) {
    if (loading && modules.length === 0) {
      return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />正在加载模块…</div>
    }
    return <NotFoundPage />
  }
  return <GenericModulePage moduleId={moduleId} />
}

function isOverlayMode(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('overlay') === '1'
}

export default function App() {
  if (isOverlayMode()) {
    return <OverlayPage />
  }

  return (
    <div>
      <Toaster position="top-left" toastOptions={{ style: { width: '14rem' }, classNames: TOAST_CLASSES }} />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="module/:moduleId" element={<ModuleRoute />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="mod-manager" element={<ModManagerPage />} />
          <Route path="manual-library" element={<ManualLibraryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </div>
  )
}
