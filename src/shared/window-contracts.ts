export interface WindowControlsBridge {
  quit: () => void
  openUpdatePage: () => Promise<void>
}
