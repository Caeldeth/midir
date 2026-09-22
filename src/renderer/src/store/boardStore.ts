import type {
  AssistWindow,
  BoardPollOutcome,
  BoardPollScope,
  BoardPollState,
  BoardRecord,
  BoardSummary
} from '@shared/types'
import { boardPollStopMessage } from '@shared/types'
import { create } from 'zustand'

/**
 * The board archive, mirrored from main (WP36).
 *
 * Main owns the file. The renderer asks for the list and for one board, and
 * asks again when main says the archive changed, so a board fills while the
 * player browses it. The poll (WP36 PR2) runs in main; its state arrives on
 * a push, and the outcome is kept for the line under the button.
 */

interface BoardStoreState {
  boards: BoardSummary[]
  /** The key of the board on the page. */
  selected: string | null
  /** The selected board with its posts, once loaded. */
  board: BoardRecord | null
  loading: boolean
  /** The path of the last export, for the confirmation line. */
  exportedTo: string | null
  error: string | null
  /** The open game windows the poll can drive. */
  windows: AssistWindow[]
  /** The window picked for the poll. */
  pollWindow: string
  onlyUnread: boolean
  /** The poll on each window, by connection id, while one runs. */
  polls: Record<string, BoardPollState>
  /** How the last poll ended, for the line under the button. */
  lastPoll?: BoardPollOutcome
  pollError: string | null
  refresh: () => Promise<void>
  refreshWindows: () => Promise<void>
  setPollWindow: (connectionId: string) => void
  setOnlyUnread: (onlyUnread: boolean) => void
  /** Start the poll on the picked window: every board, the open board, or the boards named. */
  poll: (scope: BoardPollScope) => void
  stopPoll: (connectionId: string) => Promise<void>
  select: (key: string | null) => Promise<void>
  exportSelected: () => Promise<void>
  /** Begin mirroring pushes from main. The result stops mirroring. */
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useBoardStore = create<BoardStoreState>((set, get) => ({
  boards: [],
  selected: null,
  board: null,
  loading: false,
  exportedTo: null,
  error: null,
  windows: [],
  pollWindow: '',
  onlyUnread: true,
  polls: {},
  pollError: null,

  refreshWindows: async () => {
    try {
      const [windows, polls] = await Promise.all([
        window.api.assist.windows(),
        window.api.boards.pollState()
      ])
      const running: Record<string, BoardPollState> = {}
      for (const state of polls) if (state.running) running[state.connectionId] = state
      set({ windows, polls: running })
    } catch (error) {
      set({ pollError: messageOf(error) })
    }
  },

  setPollWindow: (connectionId) => set({ pollWindow: connectionId }),
  setOnlyUnread: (onlyUnread) => set({ onlyUnread }),

  poll: (scope) => {
    const { pollWindow, onlyUnread } = get()
    if (pollWindow === '') return
    set({ pollError: null, lastPoll: undefined })
    // The poll resolves when it ends, which may be many minutes. Do not await
    // it: the running state arrives on a push, and the outcome is kept.
    window.api.boards
      .poll({ connectionId: pollWindow, scope, onlyUnread })
      .then((outcome) => set({ lastPoll: outcome }))
      .catch((error) => set({ pollError: messageOf(error) }))
  },

  stopPoll: async (connectionId) => {
    try {
      await window.api.boards.stopPoll(connectionId)
    } catch (error) {
      set({ pollError: messageOf(error) })
    }
  },

  refresh: async () => {
    set({ loading: true })
    try {
      const boards = await window.api.boards.list()
      const selected = get().selected
      const board = selected === null ? null : await window.api.boards.get(selected)
      set({ boards, board })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ loading: false })
    }
  },

  select: async (key) => {
    set({ selected: key, exportedTo: null })
    if (key === null) {
      set({ board: null })
      return
    }
    try {
      set({ board: await window.api.boards.get(key) })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  exportSelected: async () => {
    const key = get().selected
    if (key === null) return
    try {
      const path = await window.api.boards.exportJson(key)
      set({ exportedTo: path })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  subscribe: () => {
    const stopChanged = window.api.boards.onChanged(() => {
      void get().refresh()
    })
    const stopPolls = window.api.boards.onPollState((state) => {
      const polls = { ...get().polls }
      if (state.running) polls[state.connectionId] = state
      else delete polls[state.connectionId]
      set({ polls })
    })
    return () => {
      stopChanged()
      stopPolls()
    }
  }
}))

/** The line under the button for a poll that ended. */
export function boardPollOutcomeMessage(outcome: BoardPollOutcome): string {
  const read = `${outcome.boardsRead} ${outcome.boardsRead === 1 ? 'board' : 'boards'} and ${outcome.postsRead} ${outcome.postsRead === 1 ? 'post' : 'posts'}`
  if (outcome.kind === 'done') return `The poll read ${read}.`
  return `${boardPollStopMessage(outcome.reason)} It had read ${read}.`
}
