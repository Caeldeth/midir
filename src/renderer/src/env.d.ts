/// <reference types="vite/client" />

import type { MidirApi } from '@shared/types'

declare global {
  interface Window {
    api: MidirApi
  }
}

export {}
