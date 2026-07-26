import { describe, expect, it } from 'vitest'
import { createWalker } from '../walker'
import { createRouteGraph, type RouteNode } from '../route/graph'
import { buildMapGrid, type Collision, type MapGrid } from '../route/mapGrid'
import type { ActionLayer, LiveConnection } from '../actionLayer'
import type { ActionTarget } from '../../shared/actionLayer'
import type { MapProvider } from '../route/mapSource'
import type { Position } from '../model/position'
import type { Logger } from '../log'

// --- Test doubles ---------------------------------------------------------

const CID = 'conn-1'
const TARGET: ActionTarget = { connectionId: CID, windowHandle: 1 }

const WALL = 100
const COLLISION: Collision = { collisionFor: (id) => (id === WALL ? 0x0f : 0) }

/** A MapGrid from ASCII rows: '#' is a wall, anything else is open. */
function asciiGrid(rows: string[]): MapGrid {
  const height = rows.length
  const width = rows[0].length
  const bytes = new Uint8Array(width * height * 6)
  const view = new DataView(bytes.buffer)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '#') view.setUint16((y * width + x) * 6 + 2, WALL, true)
    }
  }
  return buildMapGrid(bytes, width, height, COLLISION)
}

interface FakeMap {
  rows: string[]
  width: number
  height: number
  /** Warp tiles: key `${x},${y}` -> the map and tile it lands on. */
  warps: Map<string, { toMap: number; ax: number; ay: number }>
}

function fakeMap(rows: string[], warps: FakeMap['warps'] = new Map()): FakeMap {
  return { rows, width: rows[0].length, height: rows.length, warps }
}

const noop: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger

/** A whole tiny world: maps, the live position, and how a key press moves it. */
class World {
  position: Position
  clock = 1000
  presses = 0
  /** Drop the next N presses (no move), to model a transient missed step. */
  dropPresses = 0
  /** Flip to a map id the walker did not ask for, on the next press. */
  hijackToMap: number | null = null
  /** Model the Dark Ages turn-then-move rule: a press in a new direction turns. */
  turnThenMove = false
  /** The confidence a move lands with. 'predicted' models the client's own step. */
  moveConfidence: 'confirmed' | 'predicted' = 'confirmed'
  /** Called after each successful move, for a test to intervene. */
  afterMove?: (world: World) => void

  constructor(
    readonly maps: Map<number, FakeMap>,
    start: { mapId: number; x: number; y: number }
  ) {
    const m = maps.get(start.mapId)!
    this.position = {
      mapId: start.mapId,
      mapWidth: m.width,
      mapHeight: m.height,
      x: start.x,
      y: start.y,
      facing: 0,
      asOfMs: this.clock,
      confidence: 'confirmed'
    }
  }

  press(direction: number): void {
    this.presses++
    if (this.dropPresses > 0) {
      this.dropPresses--
      return
    }
    if (this.hijackToMap !== null) {
      const to = this.hijackToMap
      this.hijackToMap = null
      const m = this.maps.get(to)
      this.position = {
        mapId: to,
        mapWidth: m?.width ?? 5,
        mapHeight: m?.height ?? 5,
        x: 0,
        y: 0,
        facing: direction,
        asOfMs: ++this.clock,
        confidence: 'confirmed'
      }
      return
    }
    const delta = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ][direction]!
    const nx = this.position.x + delta[0]
    const ny = this.position.y + delta[1]
    const map = this.maps.get(this.position.mapId)!
    if (ny < 0 || nx < 0 || ny >= map.height || nx >= map.width) return
    if (map.rows[ny][nx] === '#') return
    // A press in a new direction only turns the character, then the next press
    // in that direction steps.
    if (this.turnThenMove && direction !== this.position.facing) {
      this.position = { ...this.position, facing: direction, asOfMs: ++this.clock }
      return
    }
    const warp = map.warps.get(`${nx},${ny}`)
    if (warp !== undefined) {
      const dest = this.maps.get(warp.toMap)!
      this.position = {
        mapId: warp.toMap,
        mapWidth: dest.width,
        mapHeight: dest.height,
        x: warp.ax,
        y: warp.ay,
        facing: direction,
        asOfMs: ++this.clock,
        confidence: 'confirmed'
      }
    } else {
      this.position = {
        ...this.position,
        x: nx,
        y: ny,
        facing: direction,
        asOfMs: ++this.clock,
        confidence: this.moveConfidence
      }
    }
    this.afterMove?.(this)
  }
}

interface Harness {
  walker: ReturnType<typeof createWalker>
  world: World
  layer: { stopped: boolean; disarmed: string[]; armed: string[] }
}

function harness(world: World, graphNodes: RouteNode[]): Harness {
  const layerState = { stopped: false, disarmed: [] as string[], armed: [] as string[] }

  const actionLayer = {
    resolveTarget: (id: string): ActionTarget | null => (id === CID ? TARGET : null),
    arm: (id: string): ActionTarget | string => {
      layerState.armed.push(id)
      return TARGET
    },
    disarm: (id: string): void => {
      layerState.disarmed.push(id)
    },
    pressKey: async (_t: ActionTarget, _key: number): Promise<null | string> => {
      if (layerState.stopped) return 'stopped'
      // The key encodes the direction through DIRECTION_KEY = [UP,RIGHT,DOWN,LEFT].
      const direction = [0x26, 0x27, 0x28, 0x25].indexOf(_key)
      world.press(direction)
      return null
    },
    get stopped(): boolean {
      return layerState.stopped
    }
  } as unknown as ActionLayer

  const maps: MapProvider = {
    gridFor: async (mapId: number): Promise<MapGrid | null> => {
      const m = world.maps.get(mapId)
      return m === undefined ? null : asciiGrid(m.rows)
    }
  }

  const liveConnections = (): LiveConnection[] => [{ connectionId: CID, name: 'Test' }]

  const walker = createWalker({
    actionLayer,
    liveConnections,
    positionFor: (id: string): Position | null => (id === CID ? world.position : null),
    maps,
    graph: createRouteGraph(graphNodes),
    log: noop,
    now: () => world.clock,
    sleep: async (ms: number): Promise<void> => {
      world.clock += ms
    }
  })

  return { walker, world, layer: layerState }
}

// A three-map line: Town(1) --> Field(2) --> Cave(3). Each map is one open row
// of five tiles, and the east end warps to the next map's west end.
function lineGraph(): RouteNode[] {
  return [
    { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
    {
      mapId: 2,
      name: 'Field',
      exits: [
        { toMapId: 1, x: 0, y: 0 },
        { toMapId: 3, x: 4, y: 0 }
      ]
    },
    { mapId: 3, name: 'Cave', exits: [{ toMapId: 2, x: 0, y: 0 }] }
  ]
}

function lineWorld(): World {
  const maps = new Map<number, FakeMap>([
    [1, fakeMap(['.....'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
    [
      2,
      fakeMap(
        ['.....'],
        new Map([
          ['0,0', { toMap: 1, ax: 4, ay: 0 }],
          ['4,0', { toMap: 3, ax: 0, ay: 0 }]
        ])
      )
    ],
    [3, fakeMap(['.....'])]
  ])
  return new World(maps, { mapId: 1, x: 0, y: 0 })
}

// --- Tests ----------------------------------------------------------------

describe('walker', () => {
  it('arrives at once when already on the destination map', async () => {
    // Acceptance criterion 1: a destination that is the current map.
    const { walker, world } = harness(lineWorld(), lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 1 })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.presses).toBe(0)
  })

  it('walks to an adjacent map through its warp', async () => {
    const { walker, world } = harness(lineWorld(), lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Field' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(2)
    expect(world.presses).toBeGreaterThan(0)
  })

  it('takes two warps in order and arrives two maps away', async () => {
    // Acceptance criterion 2.
    const { walker, world } = harness(lineWorld(), lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(3)
  })

  it('re-plans past a missed step and still arrives', async () => {
    // Acceptance criterion 3: a step that does not confirm is a re-plan, not a
    // stuck walker.
    const world = lineWorld()
    world.dropPresses = 1 // the first key is swallowed
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(3)
  })

  it('accepts the client predicted step, without waiting for the server word', async () => {
    // The client draws its own step at once (WP14). A walker that waited for the
    // slower server confirmation would stall on every step here.
    const world = lineWorld()
    world.moveConfidence = 'predicted'
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(3)
  })

  it('treats a direction change as a turn, not a stall, and still arrives', async () => {
    // An L-shaped map: North up the left column, then East to the warp. The bend
    // at (0,0) turns the character before it can step East.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['..W', '.#.', '...'], new Map([['2,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 2 })
    world.turnThenMove = true
    const graph: RouteNode[] = [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 2, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [{ toMapId: 1, x: 0, y: 0 }] }
    ]
    const { walker } = harness(world, graph)
    const outcome = await walker.go({ connectionId: CID, destination: 2 })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(2)
  })

  it('stops with blocked after three stalls in the same place', async () => {
    // Acceptance criterion 4: a wall for three tries stops, in place, no thrash.
    const world = lineWorld()
    world.dropPresses = Number.MAX_SAFE_INTEGER // every key is swallowed
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    // It never left the start tile.
    expect(world.position).toMatchObject({ mapId: 1, x: 0, y: 0 })
  })

  it('stops with blocked when no path reaches the warp', async () => {
    // A wall between the start and the only warp tile: A* finds nothing.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['.#...'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const graph: RouteNode[] = [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [{ toMapId: 1, x: 0, y: 0 }] }
    ]
    const { walker } = harness(world, graph)
    const outcome = await walker.go({ connectionId: CID, destination: 2 })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    expect(world.presses).toBe(0)
  })

  it('stops with lostPosition when something else moves the character', async () => {
    // Acceptance criterion 5: an unasked-for map change.
    const world = lineWorld()
    world.afterMove = (w) => {
      w.hijackToMap = 99 // after the first real step, jump to a map we did not ask for
      w.afterMove = undefined
    }
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'lostPosition' })
  })

  it('halts within one step when the global stop fires', async () => {
    // Acceptance criterion 6.
    const world = lineWorld()
    const built = harness(world, lineGraph())
    world.afterMove = () => {
      built.layer.stopped = true // the stop fires after the first confirmed step
    }
    const outcome = await built.walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'user' })
    expect(world.position.mapId).toBe(1) // it stopped before leaving the first map
  })

  it('fails with noRoute before moving when the destination is unknown', async () => {
    // Acceptance criterion 7.
    const world = lineWorld()
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Atlantis' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'noRoute' })
    expect(world.presses).toBe(0)
  })

  it('fails with lostCharacter when no character is live', async () => {
    const world = lineWorld()
    const built = harness(world, lineGraph())
    // Rebuild the walker with no live connections.
    const walker = createWalker({
      actionLayer: {
        resolveTarget: () => TARGET,
        arm: () => TARGET,
        disarm: () => undefined,
        pressKey: async () => null,
        get stopped() {
          return false
        }
      } as unknown as ActionLayer,
      liveConnections: () => [],
      positionFor: () => world.position,
      maps: { gridFor: async () => null },
      graph: createRouteGraph(lineGraph()),
      log: noop,
      now: () => world.clock,
      sleep: async () => undefined
    })
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'lostCharacter' })
    expect(built.world.presses).toBe(0)
  })

  it('disarms the action layer when a run ends', async () => {
    const { walker, layer } = harness(lineWorld(), lineGraph())
    await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(layer.disarmed).toContain(CID)
  })

  it('stop() ends a run with the user reason', async () => {
    // A walker on a frozen world runs until stopped; stop() ends it.
    const world = lineWorld()
    world.dropPresses = Number.MAX_SAFE_INTEGER
    const { walker } = harness(world, lineGraph())
    const running = walker.go({ connectionId: CID, destination: 'Cave' })
    // Give the loop a tick to start, then stop it.
    await Promise.resolve()
    walker.stop(CID)
    const outcome = await running
    expect(outcome.kind).toBe('stopped')
  })
})
