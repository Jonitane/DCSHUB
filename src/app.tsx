import { lazy, Suspense } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RefreshCw } from 'lucide-react'
import Layout from '@/components/Layout'
import { useModuleContext } from '@/modules/ModuleContext'
import { useI18n } from '@/lib/i18n'

const DashboardPage = lazy(() => import('@/pages/DashboardPage/DashboardPage'))
const GenericModulePage = lazy(() => import('@/pages/GenericModulePage/GenericModulePage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage/SettingsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const ModManagerPage = lazy(() => import('@/pages/ModManagerPage/ModManagerPage'))
const ManualLibraryPage = lazy(() => import('@/pages/ManualLibraryPage/ManualLibraryPage'))
const OverlayPage = lazy(() => import('@/pages/OverlayPage/OverlayPage'))

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
  const { t } = useI18n()
  if (!modules.some((module) => module.id === moduleId)) {
    if (loading && modules.length === 0) {
      return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />{t('app.loadingModules')}</div>
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

function PageFallback() {
  const { t } = useI18n()
  return <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 size-4 animate-spin" />{t('app.loading')}</div>
}

export default function App() {
  if (isOverlayMode()) {
    return <Suspense fallback={<PageFallback />}><OverlayPage /></Suspense>
  }

  return (
    <div>
      <Toaster position="top-left" toastOptions={{ style: { width: '14rem' }, classNames: TOAST_CLASSES }} />
      <Suspense fallback={<PageFallback />}>
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
      </Suspense>
    </div>
  )
}
