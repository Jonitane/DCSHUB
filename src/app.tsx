import { Route, Routes, useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import Layout from '@/components/Layout'
import DashboardPage from '@/pages/DashboardPage/DashboardPage'
import GenericModulePage from '@/pages/GenericModulePage/GenericModulePage'
import SettingsPage from '@/pages/SettingsPage/SettingsPage'
import NotFoundPage from '@/pages/NotFoundPage'
import ModManagerPage from '@/pages/ModManagerPage/ModManagerPage'
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
  const { modules } = useModuleContext()
  if (!modules.some((module) => module.id === moduleId)) return <NotFoundPage />
  return <GenericModulePage moduleId={moduleId} />
}

export default function App() {
  return (
    <div>
      <Toaster position="top-left" toastOptions={{ style: { width: '14rem' }, classNames: TOAST_CLASSES }} />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="module/:moduleId" element={<ModuleRoute />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="mod-manager" element={<ModManagerPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </div>
  )
}
