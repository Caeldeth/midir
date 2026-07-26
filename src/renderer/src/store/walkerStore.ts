import { create } from 'zustand'
import type { AssistWindow, WalkerDestination, WalkerState, WalkOutcome } from '@shared/types'
import { walkStopMessage } from '@shared/types'

/**
 * The Walker, mirrored from the main process.
 *
 * Main owns the truth: the open windows, whether a stop is in force, and which
 * walkers run. The renderer asks once, then listens for pushes. The selected
 * window and the destination live here so the page stays simple.
 *
 * A walk is a long request: `window.api.walker.go` resolves only when the walk
 * ends. The store does not await it to know a walk is running — the pushed state
 * says that — but it keeps the final outcome to show the user how it ended.
 */

interface WalkerStoreState {
  windows: AssistWindow[]
  /** The places the walker can be sent to, for the picker. */
  destinations: WalkerDestination[]
  /** The connection id of the window the user picked to drive. */
  selected: string
  /** The place the user asked to walk to. */
  destination: string
  /** True while a stop is in force. */
  stopped: boolean
  stopReason?: string
  /** The walkers running now, by connection id. */
  running: Record<string, WalkerState>
  /** How the last walk ended, for the status line. */
  lastOutcome?: WalkOutcome
  busy: boolean
  error: string | null
  setSelected: (connectionId: string) => void
  setDestination: (destination: string) => void
  refreshWindows: () => Promise<void>
  refresh: () => Promise<void>
  go: (connectionId: string, destination: string) => void
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

/** A short line for how a walk ended, ready to show the user. */
export function outcomeMessage(outcome: WalkOutcome): string {
  return outcome.kind === 'arrived' ? 'Arrived.' : walkStopMessage(outcome.reason)
}

export const useWalkerStore = create<WalkerStoreState>((set, get) => ({
  windows: [],
  destinations: [],
  selected: '',
  destination: '',
  stopped: false,
  running: {},
  busy: false,
  error: null,

  setSelected: (connectionId) => set({ selected: connectionId }),
  setDestination: (destination) => set({ destination }),

  refreshWindows: async () => {
    set({ windows: await window.api.assist.windows() })
  },

  refresh: async () => {
    const [windows, assist, walkers, destinations] = await Promise.all([
      window.api.assist.windows(),
      window.api.assist.state(),
      window.api.walker.state(),
      window.api.walker.destinations()
    ])
    const running: Record<string, WalkerState> = {}
    for (const state of walkers) if (state.running) running[state.connectionId] = state
    set({ windows, stopped: assist.stopped, stopReason: assist.reason, running, destinations })
  },

  go: (connectionId, destination) => {
    if (connectionId === '' || destination.trim() === '') return
    set({ error: null, lastOutcome: undefined })
    // The walk resolves when it ends, which may be minutes. Do not await it: the
    // running state arrives on a push, and the outcome is kept for the status.
    window.api.walker
      .go({ connectionId, destination })
      .then((outcome) => set({ lastOutcome: outcome }))
      .catch((error) => set({ error: messageOf(error) }))
  },

  stop: async (connectionId) => {
    set({ busy: true })
    try {
      await window.api.walker.stop(connectionId)
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
    const stopWalker = window.api.walker.onState((state) => {
      const running = { ...get().running }
      if (state.running) running[state.connectionId] = state
      else delete running[state.connectionId]
      set({ running })
    })
    return () => {
      stopAssist()
      stopWalker()
    }
  }
}))
