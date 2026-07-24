import { create } from 'zustand'
import type { AssistWindow, SpeakerConfig, SpeakerState } from '@shared/types'
import { useSettingsStore } from './settingsStore'

/**
 * The driving assistants, mirrored from the main process.
 *
 * Main owns the truth: the open game windows, whether a stop is in force, and
 * which Speakers run. The renderer asks once, then listens for pushes. The
 * selected window lives here, not in the page, so the global toggle hotkey acts
 * on it from any view.
 */

interface SpeakerStoreState {
  /** The open game windows the user can pick to drive. */
  windows: AssistWindow[]
  /** The connection id of the window the user picked to drive. */
  selected: string
  /** True while a stop is in force. */
  stopped: boolean
  /** Why the last stop fired, ready to show the user. */
  stopReason?: string
  /** The Speakers running now, by connection id. */
  running: Record<string, SpeakerState>
  /** True while a start or stop is in flight. */
  busy: boolean
  /** The last failure to report to the user. */
  error: string | null
  setSelected: (connectionId: string) => void
  refreshWindows: () => Promise<void>
  refresh: () => Promise<void>
  start: (config: SpeakerConfig) => Promise<void>
  stop: (connectionId: string) => Promise<void>
  /** Start or stop the Speaker on the selected window. Used by the hotkey. */
  toggle: () => void
  stopAll: () => Promise<void>
  clearStop: () => Promise<void>
  clearError: () => void
  /** Begin mirroring pushes from main. The result stops mirroring. */
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  const text = String(error)
  const marker = "Error invoking remote method '"
  const at = text.indexOf(marker)
  return at < 0 ? text : text.split(': ').slice(1).join(': ') || text
}

export const useSpeakerStore = create<SpeakerStoreState>((set, get) => ({
  windows: [],
  selected: '',
  stopped: false,
  running: {},
  busy: false,
  error: null,

  setSelected: (connectionId) => set({ selected: connectionId }),

  refreshWindows: async () => {
    set({ windows: await window.api.assist.windows() })
  },

  refresh: async () => {
    const [windows, assist, speakers] = await Promise.all([
      window.api.assist.windows(),
      window.api.assist.state(),
      window.api.speaker.state()
    ])
    const running: Record<string, SpeakerState> = {}
    for (const state of speakers) if (state.running) running[state.connectionId] = state
    set({
      windows,
      stopped: assist.stopped,
      stopReason: assist.reason,
      running
    })
  },

  start: async (config) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      await window.api.speaker.start(config)
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  stop: async (connectionId) => {
    set({ busy: true })
    try {
      await window.api.speaker.stop(connectionId)
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  toggle: () => {
    const { selected, running } = get()
    if (selected === '') return
    if (running[selected]?.running) {
      void get().stop(selected)
      return
    }
    const s = useSettingsStore.getState()
    void get().start({
      lines: s.speakerLines,
      intervalMs: s.speakerIntervalMs,
      repeat: s.speakerRepeat,
      connectionId: selected
    })
  },

  stopAll: async () => {
    await window.api.assist.stopAll()
  },

  clearStop: async () => {
    // Clear at once, so the banner goes on the click; the push confirms it.
    set({ stopped: false, stopReason: undefined })
    await window.api.assist.clearStop()
  },

  clearError: () => set({ error: null }),

  subscribe: () => {
    const stopAssist = window.api.assist.onState((state) =>
      set({ stopped: state.stopped, stopReason: state.reason })
    )
    const stopSpeaker = window.api.speaker.onState((state) => {
      const running = { ...get().running }
      if (state.running) running[state.connectionId] = state
      else delete running[state.connectionId]
      set({ running })
    })
    const stopToggle = window.api.speaker.onToggle(() => get().toggle())
    return () => {
      stopAssist()
      stopSpeaker()
      stopToggle()
    }
  }
}))
