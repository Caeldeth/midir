import { emptyCharacter, type CharacterRecord } from '@shared/character'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findCharacter, useCharacterStore } from '../characterStore'

const sabrael = { ...emptyCharacter('Sabrael', 1000), lastSeenMs: 5000 }
const fintan = { ...emptyCharacter('Fintan', 1000), lastSeenMs: 1000 }

describe('useCharacterStore', () => {
  beforeEach(() => {
    useCharacterStore.setState({ characters: [], selected: null, loading: false })
  })

  it('reads the list from main', async () => {
    window.api.characters.list = vi.fn(async () => [sabrael, fintan])
    await useCharacterStore.getState().refresh()
    expect(useCharacterStore.getState().characters.map((c) => c.name)).toEqual([
      'Sabrael',
      'Fintan'
    ])
    expect(useCharacterStore.getState().loading).toBe(false)
  })

  it('replaces a character in place when main pushes a change', () => {
    // The sheet has to update while the player plays, without duplicating.
    useCharacterStore.setState({ characters: [sabrael, fintan] })

    let push: ((record: CharacterRecord) => void) | undefined
    window.api.characters.onChanged = vi.fn((handler) => {
      push = handler
      return () => undefined
    })

    const stop = useCharacterStore.getState().subscribe()
    push?.({ ...fintan, stats: { ...fintan.stats, level: 50 } })

    const { characters } = useCharacterStore.getState()
    expect(characters).toHaveLength(2)
    expect(characters[0]?.name).toBe('Fintan')
    expect(characters[0]?.stats.level).toBe(50)
    stop()
  })

  it('adds a character it has not seen before', () => {
    let push: ((record: CharacterRecord) => void) | undefined
    window.api.characters.onChanged = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    const stop = useCharacterStore.getState().subscribe()
    push?.(sabrael)
    expect(useCharacterStore.getState().characters.map((c) => c.name)).toEqual(['Sabrael'])
    stop()
  })

  it('removes a character and clears the selection when it was the one shown', async () => {
    useCharacterStore.setState({ characters: [sabrael, fintan], selected: 'Fintan' })
    window.api.characters.remove = vi.fn(async () => undefined)

    await useCharacterStore.getState().remove('Fintan')
    expect(useCharacterStore.getState().characters.map((c) => c.name)).toEqual(['Sabrael'])
    expect(useCharacterStore.getState().selected).toBeNull()
  })

  it('keeps the selection when another character is removed', async () => {
    useCharacterStore.setState({ characters: [sabrael, fintan], selected: 'Sabrael' })
    window.api.characters.remove = vi.fn(async () => undefined)
    await useCharacterStore.getState().remove('Fintan')
    expect(useCharacterStore.getState().selected).toBe('Sabrael')
  })
})

describe('findCharacter', () => {
  it('finds by name', () => {
    expect(findCharacter([sabrael, fintan], 'Fintan')?.name).toBe('Fintan')
  })

  it('returns nothing for a name that is absent, or for no name at all', () => {
    expect(findCharacter([sabrael], 'Nobody')).toBeNull()
    expect(findCharacter([sabrael], null)).toBeNull()
  })
})
