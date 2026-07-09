import type { DeepcutsApi } from './index'

declare global {
  interface Window {
    deepcuts: DeepcutsApi
  }
}

export {}
