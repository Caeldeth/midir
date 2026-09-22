import { describe, expect, it } from 'vitest'
import { HIDE_UNSEEN_DAY_CHOICES, isUnseen, newestSeenMs, splitUnseen } from '../unseen'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

const records = [
  { name: 'today', lastSeenMs: NOW },
  { name: 'lastWeek', lastSeenMs: NOW - 8 * DAY },
  { name: 'lastMonth', lastSeenMs: NOW - 40 * DAY },
  { name: 'lastYear', lastSeenMs: NOW - 400 * DAY }
]

describe('the hide-unseen filter (WP25)', () => {
  it('counts back from the newest sighting, not the wall clock', () => {
    expect(newestSeenMs(records)).toBe(NOW)
    // A record set replayed from an old evening still keeps its own newest.
    const old = records.map((r) => ({ ...r, lastSeenMs: r.lastSeenMs - 3000 * DAY }))
    expect(splitUnseen(old, 30).hidden.map((r) => r.name)).toEqual(['lastMonth', 'lastYear'])
  })

  it('0 days is off: nothing is hidden', () => {
    expect(splitUnseen(records, 0).hidden).toEqual([])
    expect(isUnseen(records[3], 0, NOW)).toBe(false)
  })

  it('hides what was last seen more than the threshold before the newest', () => {
    expect(splitUnseen(records, 7).hidden.map((r) => r.name)).toEqual([
      'lastWeek',
      'lastMonth',
      'lastYear'
    ])
    expect(splitUnseen(records, 30).shown.map((r) => r.name)).toEqual(['today', 'lastWeek'])
    expect(splitUnseen(records, 365).hidden.map((r) => r.name)).toEqual(['lastYear'])
  })

  it('shows a record again when the threshold grows', () => {
    expect(splitUnseen(records, 30).hidden.map((r) => r.name)).toContain('lastMonth')
    expect(splitUnseen(records, 90).hidden.map((r) => r.name)).not.toContain('lastMonth')
  })

  it('a record exactly at the threshold is shown', () => {
    const edge = [{ lastSeenMs: NOW }, { lastSeenMs: NOW - 7 * DAY }]
    expect(splitUnseen(edge, 7).hidden).toEqual([])
  })

  it('keeps every record: shown plus hidden is the input', () => {
    const { shown, hidden } = splitUnseen(records, 30)
    expect(shown.length + hidden.length).toBe(records.length)
  })

  it('the choices start at off and rise', () => {
    expect(HIDE_UNSEEN_DAY_CHOICES[0]).toBe(0)
    expect([...HIDE_UNSEEN_DAY_CHOICES]).toEqual([...HIDE_UNSEEN_DAY_CHOICES].sort((a, b) => a - b))
  })
})
