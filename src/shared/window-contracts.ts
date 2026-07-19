export interface WindowControlsBridge {
  quit: () => void
  openUpdatePage: () => Promise<void>
  resetAllUserData: () => Promise<void>
}
