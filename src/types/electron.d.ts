import type { ModuleBridge } from '@/shared/module-contracts'
import type { ModManagerBridge } from '@/shared/mod-manager-contracts'
import type { DcsBridge } from '@/shared/dcs-contracts'
import type { SoftwareCatalogBridge } from '@/shared/software-catalog-contracts'
import type { WindowControlsBridge } from '@/shared/window-contracts'
import type { ManualLibraryBridge } from '@/shared/manual-library-contracts'

export {}

declare global {
  interface Window {
    electronAPI?: {
      modules: ModuleBridge
      modManager: ModManagerBridge
      dcs: DcsBridge
      softwareCatalog: SoftwareCatalogBridge
      manualLibrary: ManualLibraryBridge
      windowControls: WindowControlsBridge
    }
  }
}
