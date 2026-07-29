import { create } from 'zustand'
import type { AssistWindow, Errand, ErrandOutcome, LaborerState } from '@shared/types'
import { errandStopMessage } from '@shared/types'

/**
 * The Laborer, mirrored from the main process.
 *
 * Main owns the truth: the open windows, whether a stop is in force, and which
 * Laborers run. The renderer asks once, then listens for pushes. The selected
 * window and the chosen errand live here so the page stays simple.
 *
 * An errand is a long request: `window.api.laborer.run` resolves only when the
 * errand ends. The store does not await it to know one is running — the pushed
 * state says that — but it keeps the final outcome to show the user how it ended.
 */

interface LaborerStoreState {
  windows: AssistWindow[]
  /** The built-in errands, for the picker. */
  errands: Errand[]
  /** The connection id of the window the user picked to drive. */
  selected: string
  /** The name of the errand the user chose. */
  errand: string
  /** True while a stop is in force. */
  stopped: boolean
  stopReason?: string
  /** The Laborers running now, by connection id. */
  running: Record<string, LaborerState>
  /** How the last errand ended, for the status line. */
  lastOutcome?: ErrandOutcome
  busy: boolean
  error: string | null
  setSelected: (connectionId: string) => void
  setErrand: (errand: string) => void
  refreshWindows: () => Promise<void>
  refresh: () => Promise<void>
  run: (connectionId: string, errand: string) => void
  stop: (connectionId: string) => Promise<void>
  stopAll: () => Promise<void>
  clearStop: () => Promise<void>
  clearError: () => void
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  const text = String(error)
  const marker = "Error invoking remote method '"
  const at = text.indexOf(marker)
  return at < 0 ? text : text.split(': ').slice(1).join(': ') || text
}

/** A short line for how an errand ended, ready to show the user. */
export function errandOutcomeMessage(outcome: ErrandOutcome): string {
  if (outcome.kind === 'done') return 'The errand finished.'
  const base = errandStopMessage(outcome.reason)
  return outcome.saw !== undefined ? `${base} (${outcome.saw})` : base
}

export const useLaborerStore = create<LaborerStoreState>((set, get) => ({
  windows: [],
  errands: [],
  selected: '',
  errand: '',
  stopped: false,
  running: {},
  busy: false,
  error: null,

  setSelected: (connectionId) => set({ selected: connectionId }),
  setErrand: (errand) => set({ errand }),

  refreshWindows: async () => {
    set({ windows: await window.api.assist.windows() })
  },

  refresh: async () => {
    const [windows, assist, laborers, errands] = await Promise.all([
      window.api.assist.windows(),
      window.api.assist.state(),
      window.api.laborer.state(),
      window.api.laborer.list()
    ])
    const running: Record<string, LaborerState> = {}
    for (const state of laborers) if (state.running) running[state.connectionId] = state
    set({ windows, stopped: assist.stopped, stopReason: assist.reason, running, errands })
  },

  run: (connectionId, errand) => {
    if (connectionId === '' || errand === '') return
    set({ error: null, lastOutcome: undefined })
    // The errand resolves when it ends, which may be minutes. Do not await it:
    // the running state arrives on a push, and the outcome is kept for the line.
    window.api.laborer
      .run({ connectionId, errand })
      .then((outcome) => set({ lastOutcome: outcome }))
      .catch((error) => set({ error: messageOf(error) }))
  },

  stop: async (connectionId) => {
    set({ busy: true })
    try {
      await window.api.laborer.stop(connectionId)
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  stopAll: async () => {
    await window.api.assist.stopAll()
  },

  clearStop: async () => {
    set({ stopped: false, stopReason: undefined })
    await window.api.assist.clearStop()
  },

  clearError: () => set({ error: null }),

  subscribe: () => {
    const stopAssist = window.api.assist.onState((state) =>
      set({ stopped: state.stopped, stopReason: state.reason })
    )
    const stopLaborer = window.api.laborer.onState((state) => {
      const running = { ...get().running }
      if (state.running) running[state.connectionId] = state
      else delete running[state.connectionId]
      set({ running })
    })
    return () => {
      stopAssist()
      stopLaborer()
    }
  }
}))
