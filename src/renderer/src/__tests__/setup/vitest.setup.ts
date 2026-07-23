import '@testing-library/jest-dom/vitest'
import { vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS, STOPPED_STATUS, type MidirApi } from '@shared/types'

// jsdom has no preload bridge; give every renderer test a fresh window.api
// mock so components can call it and tests can assert on it.
export function createMockApi(): MidirApi {
  return {
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    getAppVersion: vi.fn(async () => '0.0.0-test'),
    appReady: vi.fn(),
    settings: {
      load: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
      save: vi.fn(async () => undefined)
    },
    capture: {
      availability: vi.fn(async () => ({ available: true, devices: [] })),
      start: vi.fn(async () => ({ ...STOPPED_STATUS })),
      stop: vi.fn(async () => ({ ...STOPPED_STATUS })),
      status: vi.fn(async () => ({ ...STOPPED_STATUS })),
      onStatus: vi.fn(() => () => undefined)
    },
    characters: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      remove: vi.fn(async () => undefined),
      onChanged: vi.fn(() => () => undefined)
    }
  }
}

beforeEach(() => {
  window.api = createMockApi()
})
