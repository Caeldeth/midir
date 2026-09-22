import { describe, expect, it } from 'vitest'
import {
  gateFromNotice,
  hasUnregisteredMark,
  NATION_OF_TOWN,
  registrationFromNotice
} from '../access'
import type { LegendMark } from '../../../shared/character'

const mark = (key: string, text: string): LegendMark => ({ icon: 0, color: 16, key, text })

describe('registrationFromNotice', () => {
  it('reads the login line of a registered account, as captured 2026-07-24', () => {
    expect(registrationFromNotice('Your expiration date is 8-22')).toBe(true)
  })

  it('reads both register-first refusals, as captured 2026-09-21', () => {
    expect(
      registrationFromNotice("(( Register first: www.darkages.com -> Click 'Register' ))")
    ).toBe(false)
    expect(registrationFromNotice('((Register at www.DarkAges.com for full benefits))')).toBe(false)
  })

  it('says nothing about any other notice', () => {
    expect(registrationFromNotice('Only a Mileth citizen may enter here')).toBeUndefined()
    expect(registrationFromNotice('You were distracted')).toBeUndefined()
    expect(registrationFromNotice('')).toBeUndefined()
  })
})

describe('gateFromNotice', () => {
  it('names the town of the gate that refused', () => {
    expect(gateFromNotice('Only a Mileth citizen may enter here')).toEqual({ town: 'Mileth' })
    expect(gateFromNotice('Only a Rucesion citizen may enter here')).toEqual({
      town: 'Rucesion'
    })
  })

  it('is null for the register line that follows it, and for anything else', () => {
    expect(gateFromNotice('((Register at www.DarkAges.com for full benefits))')).toBeNull()
    expect(gateFromNotice('Your expiration date is 8-22')).toBeNull()
  })
})

describe('hasUnregisteredMark', () => {
  it('finds the mark by its text or its key, and nothing in a citizen legend', () => {
    expect(hasUnregisteredMark([mark('x', 'Fragile Chrysalis ((Unregistered))')])).toBe(true)
    expect(
      hasUnregisteredMark([
        mark('PolN2-1', 'Rucesion Citizen by oath of Sabrael - Deoch 152, Winter'),
        mark('Pol-2', 'Respected Citizen by  (1) - Deoch 153, Fall')
      ])
    ).toBe(false)
  })
})

describe('NATION_OF_TOWN', () => {
  it('has the two gated towns at the values the recordings show', () => {
    // Gabrael, a Mileth citizen, is nation 4; every Rucesion citizen is 6.
    expect(NATION_OF_TOWN.Mileth).toBe(4)
    expect(NATION_OF_TOWN.Rucesion).toBe(6)
  })
})
