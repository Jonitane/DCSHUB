export type DcsInstallationSource = 'manual' | 'registry' | 'steam' | 'default' | 'not-found'

export interface DcsInstallationStatus {
  configuredPath: string | null
  installPath: string | null
  executablePath: string | null
  source: DcsInstallationSource
}

export interface DcsOperationResult {
  ok: boolean
  message?: string
}

export interface DcsBridge {
  status: () => Promise<DcsInstallationStatus>
  chooseInstallDirectory: () => Promise<DcsInstallationStatus | null>
  useAutomaticDetection: () => Promise<DcsInstallationStatus>
  launch: (mode: 'vr' | 'desktop') => Promise<DcsOperationResult>
  launchLauncher: () => Promise<DcsOperationResult>
}
