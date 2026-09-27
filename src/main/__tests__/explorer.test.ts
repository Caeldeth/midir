import { describe, expect, it, vi } from 'vitest'
import { boundBudget, createExplorer } from '../explorer'
import { fakeLogger } from './handlers.test'
import { createRouteGraph, type RouteNode } from '../route/graph'
import type { Position } from '../model/position'
import type { Walker } from '../walker'
import type { WalkOutcome } from '../../shared/actionLayer'
import { DEFAULT_EXPLORER_BUDGET, MAX_EXPLORER_MINUTES } from '../../shared/actionLayer'

/**
 * The explorer (WP41): a queue in front of a fake walker. No game, no window,
 * and no packets — the scheduler and the stop policy are the whole subject.
 *
 * The map graph is one town: 1 leads to 2 and to 4, 2 leads on to 3. So from
 * map 1 the distances are 2 and 4 at one hop and 3 at two.
 */

const CID = 'world'

const NODES: RouteNode[] = [
  {
    mapId: 1,
    name: 'Rucesion Village',
    exits: [
      { toMapId: 2, x: 5, y: 0 },
      { toMapId: 4, x: 0, y: 5 }
    ]
  },
  {
    mapId: 2,
    name: 'Rucesion Hall',
    exits: [
      { toMapId: 1, x: 5, y: 9 },
      { toMapId: 3, x: 9, y: 5 }
    ]
  },
  { mapId: 3, name: 'Rucesion Inn', exits: [{ toMapId: 2, x: 0, y: 5 }] },
  { mapId: 4, name: 'Abel Port', exits: [{ toMapId: 1, x: 9, y: 5 }] }
]

interface World {
  position: Position | null
  /**
   * The health readings the run will see, in order. The last one sticks, so a
   * short list is a steady state. Empty means the health is unknown.
   */
  healths: { current: number; max: number }[]
  read: Set<number>
  clock: number
  /** How far the clock moves for each walk. */
  stepMs: number
  /** Each destination the walker was asked for, in order. */
  requests: number[]
  /** The avoid list each walk carried, in order. */
  avoids: (number[] | undefined)[]
  /** Outcomes to return, in order. An empty queue arrives. */
  outcomes: WalkOutcome[]
  /** How many times the walker was told to stop. */
  stopped: number
  /** When set, a walk waits for it before it returns. */
  hold?: Promise<void>
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    position: { mapId: 1, x: 5, y: 5, facing: 0, asOfMs: 0, confidence: 'confirmed' },
    healths: [],
    read: new Set([1]),
    clock: 1000,
    stepMs: 1000,
    requests: [],
    avoids: [],
    outcomes: [],
    stopped: 0,
    ...over
  }
}

/**
 * A walker that arrives unless the test says otherwise. Arriving moves the
 * character and adds the map to the store, which is what the capture service
 * does on a real arrival: the map's `0x15` names and sizes it.
 */
function fakeWalker(world: World): Walker {
  return {
    destinations: () => [],
    go: async (request) => {
      const mapId = Number(request.destination)
      world.requests.push(mapId)
      world.avoids.push(request.avoid)
      if (world.hold !== undefined) await world.hold
      const outcome = world.outcomes.shift() ?? { kind: 'arrived' as const }
      world.clock += world.stepMs
      if (outcome.kind === 'arrived') {
        world.read.add(mapId)
        if (world.position !== null) world.position = { ...world.position, mapId }
      }
      return outcome
    },
    stop: () => {
      world.stopped += 1
    },
    states: () => [],
    dispose: () => undefined
  }
}

function build(world: World, nodes: RouteNode[] = NODES, hostile = new Set<number>()) {
  const log = fakeLogger()
  const states: ReturnType<typeof explorer.states>[number][] = []
  const explorer = createExplorer({
    walker: fakeWalker(world),
    graph: () => createRouteGraph(nodes),
    readMaps: async () => new Set(world.read),
    hostileMaps: () => hostile,
    positionFor: (id) => (id === CID ? world.position : null),
    healthFor: (id) => {
      if (id !== CID || world.healths.length === 0) return null
      return world.healths.length === 1 ? world.healths[0]! : world.healths.shift()!
    },
    log,
    now: () => world.clock,
    onState: (state) => states.push(state)
  })
  return { explorer, log, states }
}

describe('the explorer (WP41)', () => {
  it('visits the nearest unread map first, and the lower map id breaks a tie', async () => {
    const world = makeWorld()
    const { explorer } = build(world)
    expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
    // 2 and 4 are both one hop from 1, so 2 goes first; 3 is then one hop from 2.
    expect(world.requests).toEqual([2, 3, 4])
  })

  it('leaves out a map the stores already hold a reading for', async () => {
    const world = makeWorld({ read: new Set([1, 2, 3]) })
    const { explorer } = build(world)
    await explorer.run({ connectionId: CID })
    expect(world.requests).toEqual([4])
  })

  it('never walks to the map the character stands on', async () => {
    // With nothing read at all, map 1 is still a target once the character has
    // left it. What the pick never does is send a character to where it is.
    const world = makeWorld({ read: new Set() })
    const { explorer } = build(world)
    await explorer.run({ connectionId: CID })
    expect(world.requests[0]).not.toBe(1)
    expect(world.requests[0]).toBe(2)
  })

  it('ends as done when every reachable map has been read', async () => {
    const world = makeWorld({ read: new Set([1, 2, 3, 4]) })
    const { explorer } = build(world)
    expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
    expect(world.requests).toEqual([])
  })

  it('will not start without a character on the window', async () => {
    const world = makeWorld({ position: null })
    const { explorer } = build(world)
    expect(await explorer.run({ connectionId: CID })).toEqual({
      kind: 'ended',
      reason: 'noPosition'
    })
  })

  it('ends as lostCharacter when the character goes away mid-run', async () => {
    // Hold the first walk, take the character away, then let it finish: the
    // next pick has nowhere to start from.
    let release: (() => void) | undefined
    const world = makeWorld()
    world.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { explorer } = build(world)
    const run = explorer.run({ connectionId: CID })
    await vi.waitFor(() => expect(world.requests.length).toBe(1))
    world.position = null
    delete world.hold
    release?.()
    expect(await run).toEqual({ kind: 'ended', reason: 'lostCharacter' })
  })

  describe('the budget', () => {
    it('stops after the map count it was given', async () => {
      const world = makeWorld()
      const { explorer } = build(world)
      const outcome = await explorer.run({ connectionId: CID, budget: { maps: 2 } })
      expect(outcome).toEqual({ kind: 'ended', reason: 'budget' })
      expect(world.requests).toEqual([2, 3])
    })

    it('stops when the minutes run out', async () => {
      // Each walk moves the clock 40 s, so the second one crosses one minute.
      const world = makeWorld({ stepMs: 40_000 })
      const { explorer } = build(world)
      const outcome = await explorer.run({ connectionId: CID, budget: { minutes: 1 } })
      expect(outcome).toEqual({ kind: 'ended', reason: 'budget' })
      expect(world.requests).toEqual([2, 3])
    })

    it('holds a caller inside what a run may spend, and has no unattended mode', () => {
      expect(boundBudget()).toEqual(DEFAULT_EXPLORER_BUDGET)
      expect(boundBudget({ minutes: 10_000 }).minutes).toBe(MAX_EXPLORER_MINUTES)
      expect(boundBudget({ maps: 0 }).maps).toBe(1)
      expect(boundBudget({ maps: 5.7 }).maps).toBe(5)
    })
  })

  describe('a walk that does not arrive', () => {
    it('sets one map aside and carries on, and never asks for it again', async () => {
      const world = makeWorld()
      const { explorer } = build(world)
      world.outcomes = [{ kind: 'stopped', reason: 'blocked', stepsTaken: 4 }]
      const outcome = await explorer.run({ connectionId: CID })
      expect(outcome).toEqual({ kind: 'ended', reason: 'done' })
      // 2 was refused, so the run took 4, then reached 3 through 2 without
      // making 2 a target again. A map set aside is asked for exactly once.
      expect(world.requests).toEqual([2, 4, 3])
      expect(world.requests.filter((id) => id === 2)).toHaveLength(1)
    })

    it('stops the run when no step left the current map, rather than blaming the target', async () => {
      // One unwalkable map cost 13 good ones in a third of a second before this
      // rule: every target was set aside for a failure at the origin.
      const world = makeWorld()
      const { explorer } = build(world)
      world.outcomes = [{ kind: 'stopped', reason: 'blocked', stepsTaken: 0 }]
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'stuck' })
      expect(world.requests).toEqual([2])
    })

    it('treats a blocked walk with no step count as one that never moved', async () => {
      const world = makeWorld()
      const { explorer } = build(world)
      world.outcomes = [{ kind: 'stopped', reason: 'blocked' }]
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'stuck' })
    })

    it('sets a map aside for a gate refusal, because that is one map and not the session', async () => {
      const world = makeWorld()
      const { explorer } = build(world)
      world.outcomes = [{ kind: 'stopped', reason: 'gated' }]
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
      expect(world.requests[0]).toBe(2)
      expect(world.requests.length).toBeGreaterThan(1)
    })

    it('reports a map set aside in the log, so the run can be read afterwards', async () => {
      const world = makeWorld()
      const { explorer, log } = build(world)
      world.outcomes = [{ kind: 'stopped', reason: 'blocked', stepsTaken: 4 }]
      await explorer.run({ connectionId: CID })
      expect(log.entries.some((e) => e.level === 'warn' && e.message.includes('set aside'))).toBe(
        true
      )
    })

    it.each([
      ['lostCharacter', 'lostCharacter'],
      ['lostPosition', 'lostPosition'],
      ['dialog', 'dialog'],
      ['protected', 'protected'],
      ['user', 'user']
    ] as const)('ends the whole run on %s', async (reason, expected) => {
      const world = makeWorld()
      const { explorer } = build(world)
      world.outcomes = [{ kind: 'stopped', reason }]
      expect(await explorer.run({ connectionId: CID })).toEqual({
        kind: 'ended',
        reason: expected
      })
      expect(world.requests).toEqual([2])
    })
  })

  describe('the health stop', () => {
    it('ends the run when the character loses health, after the map it reached', async () => {
      // Full at the first look, down 20 at the second: something is hitting it.
      const world = makeWorld({
        healths: [
          { current: 100, max: 100 },
          { current: 80, max: 100 }
        ]
      })
      const { explorer } = build(world)
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'hurt' })
      expect(world.requests).toEqual([2])
    })

    it('does not stop a character that was already hurt when the run began', async () => {
      const world = makeWorld({ healths: [{ current: 20, max: 100 }] })
      const { explorer } = build(world)
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
    })

    it('does not read regeneration between hops as a hit', async () => {
      // 90, then 95 as it heals, then 92. Against the last reading that dip is
      // a hit; against the lowest seen it is not, which is why the run holds
      // the lowest.
      const world = makeWorld({
        healths: [
          { current: 90, max: 100 },
          { current: 95, max: 100 },
          { current: 92, max: 100 }
        ]
      })
      const { explorer } = build(world)
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
      expect(world.requests).toEqual([2, 3, 4])
    })

    it('stops nothing when the health is unknown', async () => {
      const world = makeWorld({ healths: [] })
      const { explorer } = build(world)
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
    })
  })

  describe('stopping', () => {
    it('stops the walk in flight and ends the run as the user', async () => {
      let release: (() => void) | undefined
      const world = makeWorld()
      world.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const { explorer } = build(world)
      const run = explorer.run({ connectionId: CID })
      await vi.waitFor(() => expect(world.requests.length).toBe(1))
      explorer.stop(CID)
      expect(world.stopped).toBe(1)
      release?.()
      expect(await run).toEqual({ kind: 'ended', reason: 'user' })
    })

    it('reports the run while it is going, and forgets it once it ends', async () => {
      let release: (() => void) | undefined
      const world = makeWorld()
      world.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const { explorer } = build(world)
      const run = explorer.run({ connectionId: CID })
      // Wait for the walk to be asked for: the target is set just before it.
      await vi.waitFor(() => expect(world.requests.length).toBe(1))
      expect(explorer.states()[0]).toMatchObject({
        connectionId: CID,
        running: true,
        visited: 0,
        target: { mapId: 2, name: 'Rucesion Hall' }
      })
      explorer.stop(CID)
      release?.()
      await run
      expect(explorer.states()).toEqual([])
    })

    it('refuses a second run on the same window', async () => {
      let release: (() => void) | undefined
      const world = makeWorld()
      world.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const { explorer } = build(world)
      const run = explorer.run({ connectionId: CID })
      await vi.waitFor(() => expect(explorer.states()).toHaveLength(1))
      await expect(explorer.run({ connectionId: CID })).rejects.toThrow('already running')
      explorer.stop(CID)
      release?.()
      await run
    })

    it('stops every run on dispose', async () => {
      let release: (() => void) | undefined
      const world = makeWorld()
      world.hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const { explorer } = build(world)
      const run = explorer.run({ connectionId: CID })
      await vi.waitFor(() => expect(world.requests.length).toBe(1))
      explorer.dispose()
      expect(world.stopped).toBe(1)
      release?.()
      expect(await run).toEqual({ kind: 'ended', reason: 'user' })
    })

    it('ignores a stop for a window with no run', () => {
      const world = makeWorld()
      const { explorer } = build(world)
      explorer.stop('nobody')
      expect(world.stopped).toBe(0)
    })
  })

  it('reports stuck, not done, when it strands itself on a map with no way on', async () => {
    // A run walked into the Wastelands and reported `done` with 185 maps unread,
    // because nothing was reachable from there (2026-09-27).
    const deadEnd: RouteNode[] = [
      { mapId: 1, name: 'Mileth', exits: [{ toMapId: 9, x: 5, y: 0 }] },
      { mapId: 9, name: 'Wastelands', exits: [] },
      { mapId: 50, name: 'Abel', exits: [] }
    ]
    const world = makeWorld()
    const { explorer } = build(world, deadEnd)
    expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'stuck' })
    // It got to the Wastelands, and Abel is still unread and out of reach.
    expect(world.requests).toEqual([9])
  })

  it('still reports done when every map in the graph has been read', async () => {
    const closed: RouteNode[] = [
      { mapId: 1, name: 'Mileth', exits: [{ toMapId: 2, x: 5, y: 0 }] },
      { mapId: 2, name: 'Mileth Inn', exits: [{ toMapId: 1, x: 5, y: 9 }] }
    ]
    const world = makeWorld()
    const { explorer } = build(world, closed)
    expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
    expect(world.requests).toEqual([2])
  })

  describe('keeping out of hostile maps', () => {
    it('makes no target of one, and asks the walker not to cross one either', async () => {
      const world = makeWorld()
      const { explorer } = build(world, NODES, new Set([2]))
      const outcome = await explorer.run({ connectionId: CID })
      // 2 is hostile, so the run takes 4; 3 sits behind 2 and is out of reach
      // while 2 is avoided, which leaves the run stranded rather than finished.
      expect(world.requests).toEqual([4])
      expect(world.avoids[0]).toEqual([2])
      expect(outcome).toEqual({ kind: 'ended', reason: 'stuck' })
    })

    it('visits them when the run is told not to avoid them', async () => {
      const world = makeWorld()
      const { explorer } = build(world, NODES, new Set([2]))
      await explorer.run({ connectionId: CID, avoidHostile: false })
      expect(world.requests).toEqual([2, 3, 4])
      expect(world.avoids[0]).toBeUndefined()
    })

    it('avoids by default, because a run cannot fight', async () => {
      const world = makeWorld()
      const { explorer, states } = build(world, NODES, new Set([2]))
      await explorer.run({ connectionId: CID })
      expect(states[0]).toMatchObject({ avoidingHostile: true })
    })

    it('reports done, not stuck, when everything left out of reach is hostile', async () => {
      // Nothing unread and safe is left, and the only unread map is hostile.
      const world = makeWorld({ read: new Set([1, 3, 4]) })
      const { explorer } = build(world, NODES, new Set([2]))
      expect(await explorer.run({ connectionId: CID })).toEqual({ kind: 'ended', reason: 'done' })
      expect(world.requests).toEqual([])
    })
  })

  it('pushes a state for each change, ending with the run stopped and its reason', async () => {
    const world = makeWorld({ read: new Set([1, 2, 3]) })
    const { explorer, states } = build(world)
    await explorer.run({ connectionId: CID })
    expect(states[0]).toMatchObject({ running: true, visited: 0 })
    const last = states[states.length - 1]
    expect(last).toMatchObject({ running: false, visited: 1 })
    expect(last?.reason).toContain('has been read')
    expect(last?.target).toBeUndefined()
  })

  it('counts what it visited and what it set aside', async () => {
    const world = makeWorld()
    const { explorer, states } = build(world)
    world.outcomes = [{ kind: 'stopped', reason: 'blocked', stepsTaken: 4 }]
    await explorer.run({ connectionId: CID })
    const last = states[states.length - 1]
    expect(last).toMatchObject({ visited: 2, skipped: 1 })
  })
})
