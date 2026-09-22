import { describe, expect, it } from 'vitest'
import { gateBars, gateBarText, seededGates, type Gate } from '../access'

const MILETH: Gate = { mapId: 3025, town: 'Mileth', name: 'Mileth Commons' }

describe('gateBars', () => {
  it('bars an unregistered character whatever its citizenship', () => {
    expect(gateBars(MILETH, { registered: false, nation: 4 })).toBe('registration')
  })

  it('bars a citizen of another town', () => {
    expect(gateBars(MILETH, { registered: true, nation: 6 })).toBe('citizenship')
  })

  it('admits a registered citizen of the gate town', () => {
    expect(gateBars(MILETH, { registered: true, nation: 4 })).toBeNull()
  })

  it('never bars on what it does not know', () => {
    // Registration unknown, nation unknown, nation 0 (none, and the empty
    // record's default): a wrong "may pass" costs one refused walk, which
    // the refusal then teaches.
    expect(gateBars(MILETH, {})).toBeNull()
    expect(gateBars(MILETH, { registered: true })).toBeNull()
    expect(gateBars(MILETH, { registered: true, nation: 0 })).toBeNull()
    expect(gateBars(MILETH, { nation: 4 })).toBeNull()
  })

  it('bars a town whose gate refused this character, whatever the byte says', () => {
    // The gate's own word wins over a stale citizenship.
    expect(gateBars(MILETH, { nation: 4, refusedTowns: new Set(['Mileth']) })).toBe('citizenship')
  })

  it('bars nothing for a gate of a town the table does not know, unless refused', () => {
    const gate: Gate = { mapId: 9, town: 'Elsewhere' }
    expect(gateBars(gate, { registered: true, nation: 6 })).toBeNull()
    expect(gateBars(gate, { registered: false })).toBe('registration')
  })
})

describe('gateBarText', () => {
  it('names the place and the condition', () => {
    expect(gateBarText(MILETH, 'registration')).toBe(
      'Mileth Commons admits only a registered character'
    )
    expect(gateBarText(MILETH, 'citizenship')).toBe(
      'Mileth Commons admits only a citizen of Mileth'
    )
    expect(gateBarText({ mapId: 9, town: 'Elsewhere' }, 'citizenship')).toBe(
      'map 9 admits only a citizen of Elsewhere'
    )
  })
})

describe('seededGates', () => {
  it('holds the two Commons with their towns', () => {
    const gates = seededGates()
    expect(gates).toContainEqual({ mapId: 3025, town: 'Mileth', name: 'Mileth Commons' })
    expect(gates).toContainEqual({ mapId: 3048, town: 'Rucesion', name: 'Rucesion Commons' })
  })
})
