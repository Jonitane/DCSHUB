import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import Header from "@/components/Header";
import { APP_SETTINGS_CHANGED_EVENT, applyTheme, loadAppSettings } from '@/lib/app-settings';
import InitialSoftwareSetup from '@/components/InitialSoftwareSetup';
import UpdatePrompt from '@/components/UpdatePrompt';

export default function Layout() {
  useEffect(() => {
    const synchronizeSettings = () => {
      const settings = loadAppSettings()
      applyTheme(settings.theme)
      void window.electronAPI?.overlay.setDisplayMode(settings.dcsLaunchMode)
    }
    synchronizeSettings()
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, synchronizeSettings)
    window.addEventListener('storage', synchronizeSettings)
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, synchronizeSettings)
      window.removeEventListener('storage', synchronizeSettings)
    }
  }, []);

  return (
    <SidebarProvider>
      <InitialSoftwareSetup />
      <UpdatePrompt />
      <AppSidebar />
      <SidebarInset className="flex h-screen flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden px-6 lg:px-8 py-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export { Layout };
