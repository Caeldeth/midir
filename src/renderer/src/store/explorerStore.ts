import { create } from 'zustand'
import type { ExplorerOutcome, ExplorerScope, ExplorerState } from '@shared/types'
import { DEFAULT_EXPLORER_BUDGET, DEFAULT_STALE_DAYS, explorerStopMessage } from '@shared/types'

/**
 * The explorer, mirrored from the main process (WP41).
 *
 * Main owns the truth: which runs are going, what each one is walking to, and
 * what it has counted. The renderer asks once and then listens for pushes. The
 * budget the user typed lives here, because it is this page's own state.
 *
 * A run is a long request: `window.api.explorer.start` resolves only when the
 * run ends. The store never awaits it to know a run is going — the pushed state
 * says that — but it keeps the outcome so the page can say how it ended.
 *
 * The window to drive, the one stop, and the stop-everything button belong to
 * the Walker page, which this card sits on.
 */

interface ExplorerStoreState {
  /** The runs going now, by connection id. */
  running: Record<string, ExplorerState>
  /** The budget as typed: each field is empty or a number. */
  maps: string
  minutes: string
  /** Whether to keep out of the maps that hold monsters. On by default. */
  avoidHostile: boolean
  /** Which maps a run goes looking for. */
  scope: ExplorerScope
  /** For a stale run: how old a reading may be, as typed. */
  staleDays: string
  /** How the last run ended, for the status line. */
  lastOutcome?: ExplorerOutcome
  busy: boolean
  error: string | null
  setBudget: (maps: string, minutes: string) => void
  setAvoidHostile: (value: boolean) => void
  setScope: (scope: ExplorerScope) => void
  setStaleDays: (days: string) => void
  refresh: () => Promise<void>
  start: (connectionId: string) => void
  stop: (connectionId: string) => Promise<void>
  clearError: () => void
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  const text = String(error)
  return text.split(': ').slice(1).join(': ') || text
}

/** A short line for how a run ended, ready to show the user. */
export function runMessage(outcome: ExplorerOutcome): string {
  return explorerStopMessage(outcome.reason)
}

export const useExplorerStore = create<ExplorerStoreState>((set, get) => ({
  running: {},
  maps: String(DEFAULT_EXPLORER_BUDGET.maps),
  minutes: String(DEFAULT_EXPLORER_BUDGET.minutes),
  avoidHostile: true,
  scope: 'unread',
  staleDays: String(DEFAULT_STALE_DAYS),
  busy: false,
  error: null,

  setBudget: (maps, minutes) => set({ maps, minutes }),

  setAvoidHostile: (value) => set({ avoidHostile: value }),

  setScope: (scope) => set({ scope }),

  setStaleDays: (staleDays) => set({ staleDays }),

  refresh: async () => {
    const states = await window.api.explorer.state()
    const running: Record<string, ExplorerState> = {}
    for (const state of states) if (state.running) running[state.connectionId] = state
    set({ running })
  },

  start: (connectionId) => {
    if (connectionId === '') return
    set({ error: null, lastOutcome: undefined })
    // A blank field means "use the default", and the explorer bounds whatever
    // it is given, so the page never has to.
    const maps = Number(get().maps)
    const minutes = Number(get().minutes)
    const budget = {
      ...(Number.isFinite(maps) && maps > 0 ? { maps } : {}),
      ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {})
    }
    // The run resolves when it ends, which may be many minutes. Do not await it:
    // the state arrives on a push, and the outcome is kept for the status line.
    window.api.explorer
      .start({
        connectionId,
        ...(Object.keys(budget).length > 0 ? { budget } : {}),
        avoidHostile: get().avoidHostile,
        scope: get().scope,
        // Only a stale run reads it, and the explorer holds it to a sane floor.
        ...(get().scope === 'stale' && Number(get().staleDays) > 0
          ? { staleDays: Number(get().staleDays) }
          : {})
      })
      .then((outcome) => set({ lastOutcome: outcome }))
      .catch((error) => set({ error: messageOf(error) }))
  },

  stop: async (connectionId) => {
    set({ busy: true })
    try {
      await window.api.explorer.stop(connectionId)
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  clearError: () => set({ error: null }),

  subscribe: () =>
    window.api.explorer.onState((state) => {
      const running = { ...get().running }
      if (state.running) running[state.connectionId] = state
      else delete running[state.connectionId]
      set({ running })
    })
}))
