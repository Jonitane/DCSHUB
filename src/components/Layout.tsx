import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import Header from "@/components/Header";
import { APP_SETTINGS_CHANGED_EVENT, applyTheme, loadAppSettings } from '@/lib/app-settings';
import InitialSoftwareSetup from '@/components/InitialSoftwareSetup';

export default function Layout() {
  useEffect(() => {
    const synchronizeTheme = () => applyTheme(loadAppSettings().theme)
    synchronizeTheme()
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, synchronizeTheme)
    window.addEventListener('storage', synchronizeTheme)
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, synchronizeTheme)
      window.removeEventListener('storage', synchronizeTheme)
    }
  }, []);

  return (
    <SidebarProvider>
      <InitialSoftwareSetup />
      <AppSidebar />
      <SidebarInset className="flex flex-col min-w-0 overflow-x-hidden">
        <Header />
        <main className="flex-1 w-full overflow-y-auto px-6 lg:px-8 py-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export { Layout };
