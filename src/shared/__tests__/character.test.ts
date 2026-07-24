import { describe, expect, it } from 'vitest'
import { emptyCharacter, summariseGold, type CharacterRecord } from '../character'

/** A record with a set gold value and last-seen time. */
function withGold(name: string, gold: number, lastSeenMs = 1000): CharacterRecord {
  const record = emptyCharacter(name, lastSeenMs)
  return { ...record, lastSeenMs, stats: { ...record.stats, gold } }
}

describe('summariseGold', () => {
  it('is zero for no characters', () => {
    expect(summariseGold([])).toEqual({ total: 0, contributions: [] })
  })

  it('adds the gold across characters', () => {
    const summary = summariseGold([withGold('Sabrael', 100), withGold('Fintan', 250)])
    expect(summary.total).toBe(350)
  })

  it('orders the contributions with the most gold first', () => {
    const summary = summariseGold([
      withGold('Low', 10),
      withGold('High', 900),
      withGold('Mid', 300)
    ])
    expect(summary.contributions.map((c) => c.name)).toEqual(['High', 'Mid', 'Low'])
  })

  it('holds a total past 2^31 without loss', () => {
    const summary = summariseGold([
      withGold('Rich', 3_000_000_000),
      withGold('Also', 1_000_000_000)
    ])
    expect(summary.total).toBe(4_000_000_000)
  })
})
