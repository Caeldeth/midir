import { describe, expect, it } from 'vitest'
import { builtinErrands, findErrand } from '../errands'

describe('built-in errands', () => {
  it('lists the six clout NPCs and the five labor NPCs', () => {
    const names = builtinErrands().map((errand) => errand.name)
    expect(names.filter((name) => name.startsWith('Clout —'))).toHaveLength(6)
    expect(names.filter((name) => name.startsWith('Labor —'))).toHaveLength(5)
  })

  it('names an NPC and a destination for every errand', () => {
    for (const errand of builtinErrands()) {
      expect(errand.npcName).not.toBe('')
      expect(errand.destination).not.toBe('')
    }
  })

  it('finds an errand by name', () => {
    const first = builtinErrands()[0]!
    expect(findErrand(first.name)).toBe(first)
  })

  it('returns undefined for an unknown name', () => {
    expect(findErrand('no such errand')).toBeUndefined()
  })
})
