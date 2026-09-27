import { create } from 'zustand'
import { toSettings } from '@shared/settings'
import { pinOf } from '@shared/actionLayer'
import { type WalkerPin, DEFAULT_SETTINGS, type MidirSettings, type ThemeName } from '@shared/types'

/**
 * The pins, read through `pinOf`, whatever shape they arrive in.
 *
 * Main normalises the pins it loads, so this is a second reading of a value
 * that should already be right. It is here because the Walker page reads
 * `pin.destination` on every render: a pin in the older one-string form took
 * the whole page down with "Cannot read properties of undefined", four times
 * in one day of a main process that had not restarted on the new code. A value
 * this store cannot read is dropped, not rendered.
 */
function pins(value: unknown): WalkerPin[] {
  if (!Array.isArray(value)) return []
  return value.map((held) => pinOf(held)).filter((held): held is WalkerPin => held !== null)
}

interface SettingsActions {
  setTheme: (name: ThemeName) => void
  setCaptureDevice: (device: string) => void
  setAutoStartCapture: (value: boolean) => void
  setRecordSessions: (value: boolean) => void
  setRecordingCapMb: (value: number) => void
  setShowDiagnostics: (value: boolean) => void
  setDarkAgesPath: (value: string | undefined) => void
  setAssistStopHotkey: (value: string) => void
  setSpeakerToggleHotkey: (value: string) => void
  setAssistStopOnFocusLoss: (value: boolean) => void
  setSpeakerLines: (value: string[]) => void
  setSpeakerIntervalMs: (value: number) => void
  setSpeakerRepeat: (value: boolean) => void
  setWalkerPinnedDestinations: (value: WalkerPin[]) => void
  setWalkerRightClick: (value: boolean) => void
  setHideUnseenDays: (value: number) => void
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
  setCaptureDevice: (device) => set({ captureDevice: device }),
  setAutoStartCapture: (value) => set({ autoStartCapture: value }),
  setRecordSessions: (value) => set({ recordSessions: value }),
  setRecordingCapMb: (value) => set({ recordingCapMb: value }),
  setShowDiagnostics: (value) => set({ showDiagnostics: value }),
  // An empty pick clears the folder, which turns icons off.
  setDarkAgesPath: (value) => set({ darkAgesPath: value === '' ? undefined : value }),
  setAssistStopHotkey: (value) => set({ assistStopHotkey: value }),
  setSpeakerToggleHotkey: (value) => set({ speakerToggleHotkey: value }),
  setAssistStopOnFocusLoss: (value) => set({ assistStopOnFocusLoss: value }),
  setSpeakerLines: (value) => set({ speakerLines: value }),
  setSpeakerIntervalMs: (value) => set({ speakerIntervalMs: value }),
  setSpeakerRepeat: (value) => set({ speakerRepeat: value }),
  setWalkerPinnedDestinations: (value) => set({ walkerPinnedDestinations: value }),
  setWalkerRightClick: (value) => set({ walkerRightClick: value }),
  setHideUnseenDays: (value) => set({ hideUnseenDays: value }),

  hydrate: async () => {
    const loaded = await window.api.settings.load()
    // Order matters: mark hydrated BEFORE set() so the subscription's hydrated
    // gate lets this write through to be consumed by suppressNextSave (rather
    // than blocked outright, which would leave suppressNextSave armed and eat
    // the user's first real change).
    suppressNextSave = true
    hydrated = true
    set({ ...loaded, walkerPinnedDestinations: pins(loaded.walkerPinnedDestinations) })
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
    window.api.settings.save(toSettings(state)).catch((err) =>
      // Main owns the log. A failure here is exactly the one a packaged
      // build used to lose, because the renderer has no console either.
      window.api.diagnostics.report({
        source: 'settings',
        message: `The save over IPC failed: ${err instanceof Error ? err.message : String(err)}`
      })
    )
  }, 200)
})
