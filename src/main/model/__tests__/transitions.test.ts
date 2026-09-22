import { describe, expect, it } from 'vitest'
import {
  ACTION_WINDOW_MS,
  reduceTransitions,
  WALK_WINDOW_MS,
  type TransitionObservation,
  type TransitionState
} from '../transitions'
import type { DecodedPacket } from '../../protocol/decode'

/**
 * The transition learner (WP29). Every sequence here is the shape of a real
 * one from the recordings: the step, its acknowledgement, the map, the
 * arrival, and the ways a map changes with no step.
 */

const mapInfo = (mapId: number): DecodedPacket => ({
  kind: 'mapInfo',
  mapId,
  width: 20,
  height: 20,
  flags: 0,
  name: `Map ${mapId}`
})
const at = (x: number, y: number): DecodedPacket => ({ kind: 'userPosition', x, y })
const move = (direction: number, fromX: number, fromY: number): DecodedPacket => ({
  kind: 'userMove',
  direction,
  fromX,
  fromY
})
const walk = (direction: number, step = 1): DecodedPacket => ({ kind: 'walk', direction, step })
const ack: DecodedPacket = { kind: 'staticObjectState', records: [] }
const door: DecodedPacket = {
  kind: 'staticObjectState',
  records: [{ x: 1, y: 1, state: 0, side: 1 }]
}
const spell: DecodedPacket = { kind: 'useSpell', slot: 3 }
const item: DecodedPacket = { kind: 'useItem', slot: 12 }
const answer: DecodedPacket = {
  kind: 'pursuitResponse',
  objectType: 1,
  objectId: 2,
  pursuit: 587,
  step: 576
}
const pane: DecodedPacket = {
  kind: 'fieldMap',
  fieldName: 'field001',
  currentIndex: 0,
  points: [
    { screenX: 218, screenY: 99, name: 'Loures', checksum: 0, mapId: 449, x: 5, y: 5 },
    { screenX: 306, screenY: 77, name: 'Abel', checksum: 0, mapId: 3014, x: 14, y: 14 }
  ]
}
const click: DecodedPacket = { kind: 'fieldMapClick', checksum: 0, mapId: 3014, x: 14, y: 14 }

const N = 0
const E = 1
const S = 2

/** Run a timed sequence and collect what it observes. */
function run(
  steps: [number, DecodedPacket, boolean?][],
  from: TransitionState | null = null
): { state: TransitionState | null; observed: TransitionObservation[] } {
  let state = from
  const observed: TransitionObservation[] = []
  for (const [timestampMs, packet, sawLoss] of steps) {
    const next = reduceTransitions(state, { packet, timestampMs, sawLoss })
    state = next.state
    if (next.observed !== undefined) observed.push(next.observed)
  }
  return { state, observed }
}

/** On map 498 at (7,8), confirmed. The Rucesion Inn, whose door is at y 11. */
const inn: [number, DecodedPacket][] = [
  [0, mapInfo(498)],
  [0, at(7, 8)]
]

describe('reduceTransitions', () => {
  it('learns a walk-warp: the last confirmed tile plus the unanswered step', () => {
    const { observed } = run([
      ...inn,
      [1000, walk(S, 1)],
      [1200, ack],
      [1200, move(S, 7, 8)],
      [1500, walk(S, 2)],
      [1700, ack],
      [1700, move(S, 7, 9)],
      [2000, walk(S, 3)],
      [2200, ack],
      [2200, mapInfo(505)],
      [2200, at(43, 40)]
    ])
    expect(observed).toEqual([
      { fromMapId: 498, x: 7, y: 11, toMapId: 505, arrivalX: 43, arrivalY: 40, atMs: 2200 }
    ])
  })

  it('with two steps in flight, the oldest is the one the change answers', () => {
    // Rucesion Commons, 2026-09-21: the warp fired on (4,6), not the .dat's (5,6).
    const { observed } = run([
      [0, mapInfo(3048)],
      [0, at(3, 6)],
      [1000, walk(E, 74)],
      [1450, walk(E, 75)],
      [1500, ack],
      [1500, mapInfo(3049)],
      [1500, at(6, 14)]
    ])
    expect(observed).toEqual([
      { fromMapId: 3048, x: 4, y: 6, toMapId: 3049, arrivalX: 6, arrivalY: 14, atMs: 1500 }
    ])
  })

  it('a step the server already answered leaves nothing to learn from', () => {
    // Every walk confirmed, then the map changes: a teleport, a death, a trap.
    const { observed } = run([
      ...inn,
      [1000, walk(S)],
      [1200, ack],
      [1200, move(S, 7, 8)],
      [3000, mapInfo(505)],
      [3000, at(43, 40)]
    ])
    expect(observed).toEqual([])
  })

  it('a spell or an item just before the change makes it not a walk', () => {
    // Dachaidh from Abel Port Way, 2026-07-23: 0x0F, then the inn 73 ms later.
    const cast = run([
      ...inn,
      [1000, walk(S)],
      [1200, ack],
      [1300, spell],
      [1373, mapInfo(505)],
      [1373, at(43, 40)]
    ])
    expect(cast.observed).toEqual([])
    const used = run([...inn, [1000, walk(S)], [1200, ack], [1300, item], [1400, mapInfo(505)]])
    expect(used.observed).toEqual([])
    const talked = run([...inn, [1000, walk(S)], [1200, ack], [1300, answer], [1400, mapInfo(505)]])
    expect(talked.observed).toEqual([])
  })

  it('a spell long before the change does not taint a later walk', () => {
    const { observed } = run([
      ...inn,
      [1000, spell],
      [1000 + ACTION_WINDOW_MS, walk(S)],
      [1200 + ACTION_WINDOW_MS, ack],
      [1200 + ACTION_WINDOW_MS, mapInfo(505)],
      [1200 + ACTION_WINDOW_MS, at(43, 40)]
    ])
    expect(observed).toHaveLength(1)
  })

  it('a step the server has not acknowledged is not the step', () => {
    const { observed } = run([...inn, [1000, walk(S)], [1100, mapInfo(505)], [1100, at(43, 40)]])
    expect(observed).toEqual([])
  })

  it("a door's state acknowledges a step as the empty form does", () => {
    const { observed } = run([
      ...inn,
      [1000, walk(S)],
      [1200, door],
      [1200, mapInfo(505)],
      [1200, at(43, 40)]
    ])
    expect(observed).toHaveLength(1)
  })

  it('a lost packet before the change forgets the step', () => {
    const gapAtChange = run([
      ...inn,
      [1000, walk(S)],
      [1200, ack],
      [1200, mapInfo(505), true],
      [1200, at(43, 40)]
    ])
    expect(gapAtChange.observed).toEqual([])
    const gapBefore = run([
      ...inn,
      [1000, walk(S), true],
      [1200, ack],
      [1200, mapInfo(505)],
      [1200, at(43, 40)]
    ])
    expect(gapBefore.observed).toEqual([])
  })

  it('a tile never confirmed on the map gives no origin', () => {
    const { observed } = run([
      [0, mapInfo(498)],
      [1000, walk(S)],
      [1200, ack],
      [1200, mapInfo(505)],
      [1200, at(43, 40)]
    ])
    expect(observed).toEqual([])
  })

  it('a walk older than the window at the change got no reply and is skipped', () => {
    const { observed } = run([
      ...inn,
      [1000, walk(E)],
      [1000 + WALK_WINDOW_MS + 100, walk(S)],
      [1200 + WALK_WINDOW_MS + 100, ack],
      [1200 + WALK_WINDOW_MS + 100, ack],
      [1300 + WALK_WINDOW_MS + 100, mapInfo(505)],
      [1300 + WALK_WINDOW_MS + 100, at(43, 40)]
    ])
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ x: 7, y: 9 })
  })

  it('a correction from the server voids every step in flight', () => {
    const { state } = run([...inn, [1000, walk(S)], [1100, walk(S)], [1200, move(4, 7, 8)]])
    expect(state?.confirmed).toEqual({ x: 7, y: 8 })
    expect(state?.pending).toEqual([])
  })

  it('reports the arrival from the first 0x04 on the new map, or without one', () => {
    const { observed } = run([
      ...inn,
      [1000, walk(S)],
      [1200, ack],
      [1200, mapInfo(505)],
      // The next map arrives before any tile is confirmed: the first edge
      // goes out without an arrival, and the second has no origin.
      [1300, mapInfo(3010)],
      [1300, at(16, 14)]
    ])
    expect(observed).toEqual([{ fromMapId: 498, x: 7, y: 9, toMapId: 505, atMs: 1200 }])
  })

  it('the same map again is a refresh, not a change', () => {
    const { state, observed } = run([...inn, [1000, walk(S)], [1200, ack], [1300, mapInfo(498)]])
    expect(observed).toEqual([])
    expect(state?.pending).toHaveLength(1)
  })

  it('learns a world-map hop with the point the client clicked', () => {
    // Mileth Gateway to Abel Port Way, 2026-07-23: the step north onto the
    // edge, the pane, the click, the map.
    const { observed } = run([
      [0, mapInfo(3079)],
      [0, at(2, 1)],
      [1000, walk(N)],
      [1500, ack],
      [1500, pane],
      [3400, click],
      [3500, mapInfo(3014)],
      [3500, at(14, 14)]
    ])
    expect(observed).toEqual([
      {
        fromMapId: 3079,
        x: 2,
        y: 0,
        toMapId: 3014,
        via: { kind: 'fieldMap', screenX: 306, screenY: 77 },
        arrivalX: 14,
        arrivalY: 14,
        atMs: 3500
      }
    ])
  })

  it('a pane the player closed leads nowhere, and a later walk is a plain edge', () => {
    const { observed } = run([
      [0, mapInfo(3079)],
      [0, at(2, 1)],
      [1000, walk(N)],
      [1500, ack],
      [1500, pane],
      // Closed with no click; the character walks off the edge and on.
      [3000, walk(S)],
      [3200, ack],
      [3200, move(S, 2, 0)],
      [3500, walk(S)],
      [3700, ack],
      [3700, mapInfo(3006)],
      [3700, at(5, 5)]
    ])
    expect(observed).toEqual([
      { fromMapId: 3079, x: 2, y: 2, toMapId: 3006, arrivalX: 5, arrivalY: 5, atMs: 3700 }
    ])
  })

  it('a pane open at a change with no click learns nothing', () => {
    const { observed } = run([
      [0, mapInfo(3079)],
      [0, at(2, 1)],
      [1000, walk(N)],
      [1500, ack],
      [1500, pane],
      [3500, mapInfo(3014)],
      [3500, at(14, 14)]
    ])
    expect(observed).toEqual([])
  })

  it('never changes the state it was given', () => {
    const before = run(inn).state!
    const frozen = JSON.stringify(before)
    reduceTransitions(before, { packet: walk(S), timestampMs: 1000 })
    reduceTransitions(before, { packet: mapInfo(505), timestampMs: 1000 })
    expect(JSON.stringify(before)).toBe(frozen)
  })
})
