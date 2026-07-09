import { create } from 'zustand'

export type AppMode = 'library' | 'editor'

const KEY = 'deepcuts.appMode.v1'

function loadInitial(): AppMode {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
  return v === 'editor' ? 'editor' : 'library'
}

interface AppStore {
  appMode: AppMode
  setAppMode(mode: AppMode): void
  toggleAppMode(): void
}

export const useAppStore = create<AppStore>((set, get) => ({
  appMode: loadInitial(),
  setAppMode(mode) {
    localStorage.setItem(KEY, mode)
    set({ appMode: mode })
  },
  toggleAppMode() {
    get().setAppMode(get().appMode === 'editor' ? 'library' : 'editor')
  },
}))
