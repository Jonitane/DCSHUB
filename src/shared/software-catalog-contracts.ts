import type { ModuleInstallState } from './module-contracts'

export interface SoftwareCatalogItem {
  id: string
  displayName: string
  kind: 'builtin' | 'custom'
  enabled: boolean
  silentLaunch: boolean
  removable: boolean
  executablePath: string | null
  icon: string | null
  installState: ModuleInstallState
}

export interface SoftwareCatalogOverview {
  items: SoftwareCatalogItem[]
  needsInitialSetup: boolean
}

export interface SoftwareCatalogBridge {
  overview: () => Promise<SoftwareCatalogOverview>
  chooseAndAdd: () => Promise<SoftwareCatalogOverview | null>
  useAutomaticDetection: () => Promise<SoftwareCatalogOverview>
  chooseBuiltinExecutable: (id: string) => Promise<SoftwareCatalogOverview | null>
  setSilentLaunch: (id: string, silent: boolean) => Promise<SoftwareCatalogOverview>
  setEnabled: (id: string, enabled: boolean) => Promise<SoftwareCatalogOverview>
  remove: (id: string) => Promise<SoftwareCatalogOverview>
  completeInitialSetup: (enabledIds: string[]) => Promise<SoftwareCatalogOverview>
}
