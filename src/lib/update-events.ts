import type { MajorUpdateInfo } from '@/shared/update-contracts'

export const UPDATE_AVAILABLE_EVENT = 'dcs-hub-update-available'

export function announceMajorUpdate(update: MajorUpdateInfo): void {
  window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, { detail: update }))
}
