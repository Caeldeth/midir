import type { ElectronAPI } from '@electron-toolkit/preload'
import type { MidirApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: MidirApi
  }
}

export {}
