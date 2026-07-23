import { create } from 'zustand'
import { DEFAULT_SETTINGS, type MidirSettings, type ThemeName } from '@shared/types'

interface SettingsActions {
  setTheme: (name: ThemeName) => void
  hydrate: () => Promise<void>
}

type SettingsStore = MidirSettings & SettingsActions

// Used by hydrate() to suppress the save-on-change subscription for the
// single state-write that originated from disk. Otherwise hydrate would
// load → set → subscribe-fires → save back the exact same content,
// pointlessly bouncing settings.json on every launch.
let suppressNextSave = false

// Gate that blocks ALL persistence until the store has hydrated from disk at
// least once. Without it, any set() before hydrate completes — most commonly a
// dev-mode HMR reload that re-instantiates the store at DEFAULT_SETTINGS —
// would persist those defaults over the user's real settings.json (the main
// process treats an all-defaults file as valid and never falls back to the
// backup). Hard guard against that whole class of data-loss bug.
let hydrated = false

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  setTheme: (name) => set({ theme: name }),

  hydrate: async () => {
    const loaded = await window.api.settings.load()
    // Order matters: mark hydrated BEFORE set() so the subscription's hydrated
    // gate lets this write through to be consumed by suppressNextSave (rather
    // than blocked outright, which would leave suppressNextSave armed and eat
    // the user's first real change).
    suppressNextSave = true
    hydrated = true
    set({ ...loaded })
  }
}))

// Push state changes back to disk via main process. Debounced 200ms so a
// flurry of toggles collapses to one or two writes; the main-side queue
// (with .then(fn,fn) resilience) further serializes saves in submission
// order even if one fails.
let saveTimer: ReturnType<typeof setTimeout> | null = null

useSettingsStore.subscribe((state) => {
  // Never persist until the first disk load has landed (see `hydrated` above).
  if (!hydrated) return
  if (suppressNextSave) {
    suppressNextSave = false
    return
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (typeof window === 'undefined' || !window.api?.settings) return
    const { theme } = state
    window.api.settings
      .save({ theme })
      .catch((err) => console.error('[settings] save IPC failed:', err))
  }, 200)
})
