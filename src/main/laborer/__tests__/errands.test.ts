import { describe, expect, it } from 'vitest'
import { builtinErrands, findErrand } from '../errands'

describe('built-in errands', () => {
  it('lists the built-in errands', () => {
    expect(builtinErrands().length).toBeGreaterThan(0)
  })

  it('finds an errand by name', () => {
    const first = builtinErrands()[0]!
    expect(findErrand(first.name)).toBe(first)
  })

  it('returns undefined for an unknown name', () => {
    expect(findErrand('no such errand')).toBeUndefined()
  })
})
