import type { CharacterRecord } from '@shared/types'
import { create } from 'zustand'

/**
 * The characters Midir has recorded.
 *
 * The list is kept newest first, matching what main returns. A character that
 * changes while capture is running replaces its entry in place and moves to
 * the front, so the sheet updates while the player plays.
 */

interface CharacterState {
  characters: CharacterRecord[]
  /** The name shown on the character page. */
  selected: string | null
  loading: boolean
  refresh: () => Promise<void>
  select: (name: string | null) => void
  remove: (name: string) => Promise<void>
  /** Begin mirroring pushes from main. The result stops mirroring. */
  subscribe: () => () => void
}

/** Put `record` at the front and drop any earlier copy of the same name. */
function upsert(characters: CharacterRecord[], record: CharacterRecord): CharacterRecord[] {
  return [record, ...characters.filter((existing) => existing.name !== record.name)]
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  selected: null,
  loading: false,

  refresh: async () => {
    set({ loading: true })
    try {
      set({ characters: await window.api.characters.list() })
    } finally {
      set({ loading: false })
    }
  },

  select: (name) => set({ selected: name }),

  remove: async (name) => {
    await window.api.characters.remove(name)
    set((state) => ({
      characters: state.characters.filter((record) => record.name !== name),
      selected: state.selected === name ? null : state.selected
    }))
  },

  subscribe: () =>
    window.api.characters.onChanged((record) => {
      set({ characters: upsert(get().characters, record) })
    })
}))

/** Find one character by name. */
export function findCharacter(
  characters: CharacterRecord[],
  name: string | null
): CharacterRecord | null {
  if (name === null) return null
  return characters.find((record) => record.name === name) ?? null
}
