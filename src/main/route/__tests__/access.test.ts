import { describe, expect, it } from 'vitest'
import { gateBars, gateBarText, seededGates, type Gate } from '../access'

const MILETH: Gate = {
  mapId: 3025,
  town: 'Mileth',
  admits: ['Mileth', 'Loures'],
  name: 'Mileth Commons'
}

describe('gateBars', () => {
  it('bars an unregistered character whatever its citizenship', () => {
    expect(gateBars(MILETH, { registered: false, citizenship: 4 })).toBe('registration')
  })

  it('bars a citizen of another town, and a citizen of nowhere', () => {
    expect(gateBars(MILETH, { registered: true, citizenship: 6 })).toBe('citizenship')
    // Nation 0 is a fact once SelfLook has been seen (Sabrael: it bars the
    // Commons and clout).
    expect(gateBars(MILETH, { registered: true, citizenship: 0 })).toBe('citizenship')
  })

  it('admits a registered citizen of any town the gate lists', () => {
    expect(gateBars(MILETH, { registered: true, citizenship: 4 })).toBeNull()
    expect(gateBars(MILETH, { registered: true, citizenship: 3 })).toBeNull()
  })

  it('admits only the gate town when it lists none', () => {
    const gate: Gate = { mapId: 3048, town: 'Rucesion' }
    expect(gateBars(gate, { citizenship: 6 })).toBeNull()
    expect(gateBars(gate, { citizenship: 3 })).toBe('citizenship')
  })

  it('never bars on what it does not know', () => {
    // Registration unknown, citizenship not yet seen: a wrong "may pass"
    // costs one refused walk, which the refusal then teaches.
    expect(gateBars(MILETH, {})).toBeNull()
    expect(gateBars(MILETH, { registered: true })).toBeNull()
    expect(gateBars(MILETH, { citizenship: 4 })).toBeNull()
  })

  it('bars a map whose gate refused this character, whatever the byte says', () => {
    // The gate's own word wins over a stale citizenship.
    expect(gateBars(MILETH, { citizenship: 4, refusedMaps: new Set([3025]) })).toBe('citizenship')
  })

  it('bars nothing for a gate of a town the table does not know, unless refused or unregistered', () => {
    const gate: Gate = { mapId: 9, town: 'Elsewhere' }
    expect(gateBars(gate, { registered: true, citizenship: 6 })).toBeNull()
    expect(gateBars(gate, { registered: false })).toBe('registration')
  })
})

describe('gateBarText', () => {
  it('names the place and the condition', () => {
    expect(gateBarText(MILETH, 'registration')).toBe(
      'Mileth Commons admits only a registered character'
    )
    expect(gateBarText(MILETH, 'citizenship')).toBe(
      'Mileth Commons admits only a citizen of Mileth or Loures'
    )
    expect(gateBarText({ mapId: 9, town: 'Elsewhere' }, 'citizenship')).toBe(
      'map 9 admits only a citizen of Elsewhere'
    )
  })
})

describe('seededGates', () => {
  it('holds the two Commons, each admitting its town and Loures, and nothing else', () => {
    const gates = seededGates()
    expect(gates).toContainEqual({
      mapId: 3025,
      town: 'Mileth',
      admits: ['Mileth', 'Loures'],
      name: 'Mileth Commons'
    })
    expect(gates).toContainEqual({
      mapId: 3048,
      town: 'Rucesion',
      admits: ['Rucesion', 'Loures'],
      name: 'Rucesion Commons'
    })
    expect(gates).toHaveLength(2)
  })
})
