import type { BoardRecord, BoardSummary } from '@shared/types'
import { create } from 'zustand'

/**
 * The board archive, mirrored from main (WP36).
 *
 * Main owns the file. The renderer asks for the list and for one board, and
 * asks again when main says the archive changed, so a board fills while the
 * player browses it.
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
  refresh: () => Promise<void>
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

  subscribe: () =>
    window.api.boards.onChanged(() => {
      void get().refresh()
    })
}))
