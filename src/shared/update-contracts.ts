export interface UpdateSettings {
  automaticChecks: boolean
}

export interface MajorUpdateInfo {
  currentVersion: string
  latestVersion: string
  title: string
  releaseNotes: string
  publishedAt: string | null
  downloadUrl: string
}

export type UpdateCheckResult =
  | { status: 'disabled'; update: null }
  | { status: 'no-push-update'; update: null }
  | { status: 'available'; update: MajorUpdateInfo }

export interface UpdateBridge {
  settings: () => Promise<UpdateSettings>
  setAutomaticChecks: (enabled: boolean) => Promise<UpdateSettings>
  check: (force?: boolean) => Promise<UpdateCheckResult>
  openDownload: (url: string) => Promise<void>
}
