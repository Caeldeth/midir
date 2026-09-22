import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createTransitionStore,
  edgeKey,
  emptyTransitionFile,
  PROMOTION_OBSERVATIONS,
  promotedEdges,
  TRANSITIONS_FILE,
  withCuration,
  withObservation
} from '../transitionStore'
import type { TransitionObservation } from '../../model/transitions'

/** The learned edges (WP29). */

const crossing = (
  atMs: number,
  over: Partial<TransitionObservation> = {}
): TransitionObservation => ({
  fromMapId: 3048,
  x: 4,
  y: 6,
  toMapId: 3049,
  arrivalX: 6,
  arrivalY: 14,
  atMs,
  ...over
})

describe('withObservation', () => {
  it('files a first crossing as a candidate of one', () => {
    const file = withObservation(emptyTransitionFile(), crossing(1000))
    expect(file.edges[edgeKey(crossing(0))]).toEqual({
      fromMapId: 3048,
      x: 4,
      y: 6,
      toMapId: 3049,
      arrivalX: 6,
      arrivalY: 14,
      observations: 1,
      firstSeenMs: 1000,
      lastSeenMs: 1000
    })
    expect(promotedEdges(file)).toEqual([])
  })

  it('counts a second crossing and promotes the edge', () => {
    const file = withObservation(
      withObservation(emptyTransitionFile(), crossing(1000)),
      crossing(5000)
    )
    const edge = file.edges[edgeKey(crossing(0))]!
    expect(edge.observations).toBe(2)
    expect(edge.firstSeenMs).toBe(1000)
    expect(edge.lastSeenMs).toBe(5000)
    expect(PROMOTION_OBSERVATIONS).toBe(2)
    expect(promotedEdges(file)).toEqual([edge])
  })

  it('a newer crossing brings its arrival; an older one only counts', () => {
    const first = withObservation(emptyTransitionFile(), crossing(5000))
    const older = withObservation(first, crossing(1000, { arrivalX: 1, arrivalY: 1 }))
    expect(older.edges[edgeKey(crossing(0))]).toMatchObject({
      arrivalX: 6,
      arrivalY: 14,
      observations: 2,
      firstSeenMs: 1000,
      lastSeenMs: 5000
    })
    const newer = withObservation(first, crossing(9000, { arrivalX: 7, arrivalY: 14 }))
    expect(newer.edges[edgeKey(crossing(0))]).toMatchObject({ arrivalX: 7, arrivalY: 14 })
  })

  it('keeps a known arrival through a crossing that read none', () => {
    const first = withObservation(emptyTransitionFile(), crossing(1000))
    const blind = withObservation(
      first,
      crossing(2000, { arrivalX: undefined, arrivalY: undefined })
    )
    expect(blind.edges[edgeKey(crossing(0))]).toMatchObject({ arrivalX: 6, arrivalY: 14 })
  })

  it('keys a world-map hop apart by destination and keeps its point', () => {
    const hop = crossing(1000, {
      fromMapId: 3079,
      x: 2,
      y: 0,
      toMapId: 3014,
      via: { kind: 'fieldMap', screenX: 306, screenY: 77 }
    })
    const other = crossing(1100, {
      fromMapId: 3079,
      x: 2,
      y: 0,
      toMapId: 449,
      via: { kind: 'fieldMap', screenX: 218, screenY: 99 }
    })
    const file = withObservation(withObservation(emptyTransitionFile(), hop), other)
    expect(Object.keys(file.edges).sort()).toEqual(['3079:2,0>3014', '3079:2,0>449'])
    expect(file.edges['3079:2,0>3014']?.via).toEqual({
      kind: 'fieldMap',
      screenX: 306,
      screenY: 77
    })
  })

  it('promotes one destination per plain tile, the one seen most; hops stand each on their own', () => {
    let file = emptyTransitionFile()
    for (let i = 0; i < 5; i++) file = withObservation(file, crossing(1000 + i))
    for (let i = 0; i < 2; i++) file = withObservation(file, crossing(2000 + i, { toMapId: 3079 }))
    expect(promotedEdges(file).map((e) => e.toMapId)).toEqual([3049])
    // A world-map hop's tile reaches many maps by click: every destination stands.
    const via = { kind: 'fieldMap' as const, screenX: 1, screenY: 1 }
    let hops = emptyTransitionFile()
    for (let i = 0; i < 2; i++) hops = withObservation(hops, crossing(i, { via, toMapId: 3014 }))
    for (let i = 0; i < 2; i++) hops = withObservation(hops, crossing(i, { via, toMapId: 449 }))
    expect(
      promotedEdges(hops)
        .map((e) => e.toMapId)
        .sort()
    ).toEqual([3014, 449])
  })

  it('a file from before the edit loads with no curations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'midir-transitions-'))
    await writeFile(
      join(directory, TRANSITIONS_FILE),
      JSON.stringify(withObservation(emptyTransitionFile(), crossing(1)), (k, v) =>
        k === 'curations' ? undefined : v
      )
    )
    const store = createTransitionStore(directory)
    expect(Object.keys((await store.load()).edges)).toEqual(['3048:4,6>3049'])
    expect((await store.load()).curations).toEqual({})
    await rm(directory, { recursive: true, force: true })
  })

  it('never changes the file it was given', () => {
    const file = withObservation(emptyTransitionFile(), crossing(1000))
    const frozen = JSON.stringify(file)
    withObservation(file, crossing(2000))
    expect(JSON.stringify(file)).toBe(frozen)
  })
})

describe('createTransitionStore', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-transitions-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes the file and reads it back whole', async () => {
    const store = createTransitionStore(directory)
    await store.update((file) => withObservation(file, crossing(1000)))
    const raw = JSON.parse(await readFile(join(directory, TRANSITIONS_FILE), 'utf-8'))
    expect(Object.keys(raw.edges)).toEqual(['3048:4,6>3049'])
    const reopened = createTransitionStore(directory)
    expect((await reopened.load()).edges['3048:4,6>3049']?.observations).toBe(1)
  })

  it('falls back to no edges when the file does not parse', async () => {
    await writeFile(join(directory, TRANSITIONS_FILE), '{"edges": {"a": {"x": "no"}}}')
    const failures: string[] = []
    const store = createTransitionStore(directory, (failure) => failures.push(failure.stage))
    expect(await store.load()).toEqual({ edges: {}, curations: {} })
    expect(failures).toContain('parse')
  })
})

describe('withCuration (WP30)', () => {
  const edge = { fromMapId: 3048, x: 4, y: 6, toMapId: 3049 }

  it('accepts a candidate into the promoted set whatever its count, and a rejection takes one out', () => {
    const one = withObservation(emptyTransitionFile(), crossing(1000))
    expect(promotedEdges(one)).toEqual([])
    const accepted = withCuration(one, { action: 'accept', ...edge }, 50)
    expect(promotedEdges(accepted).map((e) => e.observations)).toEqual([1])
    expect(accepted.curations['3048:4,6>3049']).toEqual({ ...edge, verdict: 'accepted', atMs: 50 })

    const many = withObservation(withObservation(emptyTransitionFile(), crossing(1)), crossing(2))
    const rejected = withCuration(many, { action: 'reject', ...edge }, 60)
    expect(promotedEdges(rejected)).toEqual([])
    expect(promotedEdges(withCuration(rejected, { action: 'restore', ...edge }, 70))).toHaveLength(
      1
    )
  })

  it('a placed warp is accepted, and the one it replaces rejected, keeping a hop', () => {
    const via = { kind: 'fieldMap' as const, screenX: 306, screenY: 77 }
    const moved = withCuration(
      emptyTransitionFile(),
      { action: 'place', ...edge, x: 5, replace: { x: 4, y: 6, toMapId: 3049 } },
      80,
      via
    )
    expect(moved.curations).toEqual({
      '3048:4,6>3049': { ...edge, verdict: 'rejected', via, atMs: 80 },
      '3048:5,6>3049': { ...edge, x: 5, verdict: 'accepted', via, atMs: 80 }
    })
    // Placed on its own tile again: only the acceptance.
    const same = withCuration(
      emptyTransitionFile(),
      { action: 'place', ...edge, replace: { x: 4, y: 6, toMapId: 3049 } },
      1
    )
    expect(Object.keys(same.curations)).toEqual(['3048:4,6>3049'])
    // Placed fresh, replacing nothing.
    const fresh = withCuration(emptyTransitionFile(), { action: 'place', ...edge }, 2)
    expect(fresh.curations['3048:4,6>3049']?.verdict).toBe('accepted')
  })
})
