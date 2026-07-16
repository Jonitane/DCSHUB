export const APP_SETTINGS_KEY = '__dcs_control_hub_app_settings'
export const APP_SETTINGS_CHANGED_EVENT = 'dcs-hub-settings-changed'

export interface StartupProfile {
  id: string
  name: string
  moduleIds: string[]
}

export interface AppSettings {
  theme: 'dark' | 'light'
  dcsLaunchMode: 'vr' | 'desktop'
  startupProfiles: StartupProfile[]
  selectedStartupProfileId: string
}

export function applyTheme(theme: AppSettings['theme']): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

function readStoredSettings(): Partial<AppSettings> {
  try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') as Partial<AppSettings> }
  catch { return {} }
}

export function loadAppSettings(lifecycleModuleIds: string[] = []): AppSettings {
  const stored = readStoredSettings()
  const allowed = new Set(lifecycleModuleIds)
  const startupProfiles = Array.isArray(stored.startupProfiles) && stored.startupProfiles.length > 0
    ? stored.startupProfiles.map((profile, index) => ({
      id: typeof profile.id === 'string' && profile.id ? profile.id : `profile-${index + 1}`,
      name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : `配置 ${index + 1}`,
      moduleIds: Array.isArray(profile.moduleIds)
        ? profile.moduleIds.filter((id): id is string => typeof id === 'string' && (allowed.size === 0 || allowed.has(id)))
        : [],
    }))
    : [{ id: 'default', name: '默认配置', moduleIds: [...lifecycleModuleIds] }]
  const selectedStartupProfileId = startupProfiles.some((profile) => profile.id === stored.selectedStartupProfileId)
    ? stored.selectedStartupProfileId as string
    : startupProfiles[0].id
  return {
    theme: stored.theme === 'light' ? 'light' : 'dark',
    dcsLaunchMode: stored.dcsLaunchMode === 'desktop' ? 'desktop' : 'vr',
    startupProfiles,
    selectedStartupProfileId,
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  applyTheme(settings.theme)
  window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGED_EVENT))
}
