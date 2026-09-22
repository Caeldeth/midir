import { describe, expect, it } from 'vitest'
import { createWalker } from '../walker'
import { createRouteGraph, type RouteNode } from '../route/graph'
import { buildMapGrid, type Collision, type MapGrid } from '../route/mapGrid'
import type { ActionLayer, LiveConnection } from '../actionLayer'
import type { ActionTarget } from '../../shared/actionLayer'
import type { MapProvider } from '../route/mapSource'
import type { Position } from '../model/position'
import type { FieldMapState } from '../model/fieldMap'
import type { DialogState } from '../model/dialog'
import type { ExchangeState } from '../model/exchange'
import type { NoticeState } from '../model/notice'
import type { Gate, Passport } from '../route/access'
import type { FieldMap } from '../protocol/decode/fieldMap'
import type { PursuitMessage } from '../protocol/decode/pursuit'
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
  /**
   * World-map tiles: key `${x},${y}` -> the pane that opens on the step, or
   * null for a tile whose pane never opens.
   */
  panes: Map<string, FieldMap | null>
}

function fakeMap(
  rows: string[],
  warps: FakeMap['warps'] = new Map(),
  panes: FakeMap['panes'] = new Map()
): FakeMap {
  return { rows, width: rows[0].length, height: rows.length, warps, panes }
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
  /** Tiles a creature blocks that the grid still calls open, keyed `${x},${y}`. */
  dynamicBlock = new Set<string>()
  /** Tiles one valid press advances, to model batched confirmations under lag. */
  stride = 1
  /** Called after each successful move, for a test to intervene. */
  afterMove?: (world: World) => void
  /** The world map on screen, as the capture service would report it. */
  fieldMap: FieldMapState | null = null
  /** Every click the walker posted, in order. */
  clicks: { x: number; y: number }[] = []
  /** Ignore the next N clicks on the pane, to model a release that missed. */
  missClicks = 0
  /** A hop the server has yet to complete: applied on the next tick, after the client's answer. */
  pendingHop: { mapId: number; x: number; y: number } | null = null
  /** The dialog on screen. A dialog up holds the character still, as in the game. */
  dialog: DialogState | null = null
  /**
   * Maps that admit only a registered citizen of a town (WP32): a step onto a
   * warp into one does not fire, and the gate's own refusal arrives instead.
   */
  gatedMaps = new Map<number, string>()
  /** The newest server notice, as the capture service would report it. */
  notice: NoticeState | null = null
  /** What the character carries to a gate. Null models a record not yet identified. */
  passport: Passport | null = null
  /**
   * The exchange window, or the alert it left. An open window holds the
   * character still, and so does the alert until it is dismissed.
   */
  exchange: ExchangeState | null = null
  alertBlocks = false
  /** Whether a pane honours the posted gesture. Off models a click that misses or a key unread. */
  buttonsWork = true
  /** Every key the walker posted that was not an arrow. */
  otherKeys: number[] = []
  /** Every click on the dialog's Close button. */
  closeClicks = 0

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
    // A popup holds the character still until it is cleared.
    if (this.dialog !== null) return
    if (this.exchange?.kind === 'open') return
    if (this.exchange?.kind === 'alert' && this.alertBlocks) return
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
    const map = this.maps.get(this.position.mapId)!
    // A warp tile is enterable even when the rows draw it as a wall: a
    // doorway's static tile carries the closed door's collision, and the game
    // opens the door as the character steps in.
    const blocks = (x: number, y: number): boolean =>
      y < 0 ||
      x < 0 ||
      y >= map.height ||
      x >= map.width ||
      (map.rows[y][x] === '#' && !map.warps.has(`${x},${y}`)) ||
      this.dynamicBlock.has(`${x},${y}`)

    if (blocks(this.position.x + delta[0], this.position.y + delta[1])) return
    // A press in a new direction only turns the character, then the next press
    // in that direction steps.
    if (this.turnThenMove && direction !== this.position.facing) {
      this.position = { ...this.position, facing: direction, asOfMs: ++this.clock }
      return
    }
    // A valid press advances up to `stride` tiles, so a test can model several
    // of the walker's own steps confirming in one batch under lag.
    let cx = this.position.x
    let cy = this.position.y
    for (let i = 0; i < this.stride; i++) {
      const nx = cx + delta[0]
      const ny = cy + delta[1]
      if (blocks(nx, ny)) break
      const warp = map.warps.get(`${nx},${ny}`)
      if (warp !== undefined) {
        const town = this.gatedMaps.get(warp.toMap)
        if (town !== undefined) {
          // The gate refuses: the character stays, and the notice says why.
          this.notice = {
            packet: {
              kind: 'systemMessage',
              messageType: 3,
              text: `Only a ${town} citizen may enter here`
            },
            asOfMs: ++this.clock
          }
          return
        }
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
        this.afterMove?.(this)
        return
      }
      cx = nx
      cy = ny
    }
    if (cx === this.position.x && cy === this.position.y) return
    this.position = {
      ...this.position,
      x: cx,
      y: cy,
      facing: direction,
      asOfMs: ++this.clock,
      confidence: this.moveConfidence
    }
    // A world-map tile opens the pane instead of changing the map.
    const pane = map.panes.get(`${cx},${cy}`)
    if (pane !== undefined && pane !== null) {
      this.fieldMap = { packet: pane, asOfMs: ++this.clock }
    }
    this.afterMove?.(this)
  }

  /**
   * A click on the pane: the client answers with its 0x3F for the point under
   * the pointer, then the server moves the character there. A click on the
   * dialog's Close button closes a dialog instead.
   */
  click(x: number, y: number): void {
    if (x === 589 && y === 461) {
      this.closeClicks++
      if (this.buttonsWork) this.dialog = null
      return
    }
    this.clicks.push({ x, y })
    if (this.fieldMap === null) return
    if (this.missClicks > 0) {
      this.missClicks--
      return
    }
    const point = this.fieldMap.packet.points.find((p) => p.screenX === x && p.screenY === y)
    if (point === undefined) return
    const dest = this.maps.get(point.mapId)
    if (dest === undefined) return
    this.fieldMap = {
      ...this.fieldMap,
      click: {
        packet: { kind: 'fieldMapClick', checksum: 0, mapId: point.mapId, x: point.x, y: point.y },
        asOfMs: ++this.clock
      }
    }
    this.pendingHop = { mapId: point.mapId, x: point.x, y: point.y }
  }

  /** Time passes: the server completes a hop the client asked for. */
  tick(): void {
    if (this.pendingHop === null) return
    const { mapId, x, y } = this.pendingHop
    this.pendingHop = null
    const dest = this.maps.get(mapId)!
    this.fieldMap = null
    this.position = {
      mapId,
      mapWidth: dest.width,
      mapHeight: dest.height,
      x,
      y,
      facing: this.position.facing,
      asOfMs: ++this.clock,
      confidence: 'confirmed'
    }
  }
}

interface Harness {
  walker: ReturnType<typeof createWalker>
  world: World
  layer: { stopped: boolean; disarmed: string[]; armed: string[] }
}

function harness(world: World, graphNodes: RouteNode[], seedGates: Gate[] = []): Harness {
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
      if (direction >= 0) world.press(direction)
      else world.otherKeys.push(_key)
      // Escape is the exchange window's own cancel: the client sends it, and
      // the server's cancel closes the window into its alert, which holds the
      // character until its own Escape.
      if (_key === 0x1b && world.buttonsWork) {
        if (world.exchange?.kind === 'open') {
          world.exchange = { kind: 'alert', message: 'Exchange cancelled.', asOfMs: ++world.clock }
          world.alertBlocks = true
        } else if (world.exchange?.kind === 'alert') {
          world.alertBlocks = false
        }
      }
      return null
    },
    click: async (_t: ActionTarget, x: number, y: number): Promise<null | string> => {
      if (layerState.stopped) return 'stopped'
      world.click(x, y)
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
    fieldMapFor: (id: string): FieldMapState | null => (id === CID ? world.fieldMap : null),
    dialogFor: (id: string): DialogState | null => (id === CID ? world.dialog : null),
    exchangeFor: (id: string): ExchangeState | null => (id === CID ? world.exchange : null),
    noticeFor: (id: string): NoticeState | null => (id === CID ? world.notice : null),
    passportFor: (id: string): Passport | null => (id === CID ? world.passport : null),
    gates: seedGates,
    maps,
    graph: createRouteGraph(graphNodes),
    log: noop,
    now: () => world.clock,
    sleep: async (ms: number): Promise<void> => {
      world.clock += ms
      world.tick()
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

  it('takes a turn from the wire at once, without waiting out the step time', async () => {
    // The fake world turns on a press in a new direction and reports the new
    // facing, as the client's CChangeDirection does. Each turn used to cost the
    // whole step timeout; now it costs one poll.
    const maps = new Map<number, FakeMap>([[1, fakeMap(['...', '...', '...'])]])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    world.turnThenMove = true
    const { walker } = harness(world, [{ mapId: 1, name: 'Room', exits: [] }])
    const start = world.clock
    const outcome = await walker.go({
      connectionId: CID,
      destination: 1,
      tile: { x: 2, y: 2 },
      arrive: 'on'
    })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position).toMatchObject({ x: 2, y: 2 })
    // Two turns (East, then South) and four steps: well under one step timeout
    // per turn, which is what a blind wait would have cost.
    expect(world.clock - start).toBeLessThan(1200)
  })

  it('routes around a tile the cache calls open but the server blocks', async () => {
    // A 3x3 open map with a creature at (1,1) the grid cannot see. The straight
    // path North is blocked there; the walker learns it and goes around.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['...', '...', '...'], new Map([['1,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 1, y: 2 })
    world.dynamicBlock.add('1,1') // the creature the walker must route around
    const graph: RouteNode[] = [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 1, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [{ toMapId: 1, x: 0, y: 0 }] }
    ]
    const { walker } = harness(world, graph)
    const outcome = await walker.go({ connectionId: CID, destination: 2 })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(2)
  })

  it('accepts delayed multi-tile progress along the pressed direction', async () => {
    // The server confirms two of the walker's own steps in one batch, so the
    // position jumps two tiles along the pressed direction. That is progress.
    const world = lineWorld()
    world.stride = 2
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(3)
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

// A single open 5x5 room, one graph node, for the tile-goal approach phase.
function roomWorld(start: { x: number; y: number }, rows?: string[]): World {
  const maps = new Map<number, FakeMap>([
    [1, fakeMap(rows ?? ['.....', '.....', '.....', '.....', '.....'])]
  ])
  return new World(maps, { mapId: 1, x: start.x, y: start.y })
}

const roomGraph: RouteNode[] = [{ mapId: 1, name: 'Room', exits: [] }]

describe('walker tile goal', () => {
  it('steps to a tile beside the NPC and arrives', async () => {
    const world = roomWorld({ x: 0, y: 0 })
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({ connectionId: CID, destination: 1, tile: { x: 2, y: 2 } })
    expect(outcome).toEqual({ kind: 'arrived' })
    // Beside the NPC tile, never on it.
    const distance = Math.abs(world.position.x - 2) + Math.abs(world.position.y - 2)
    expect(distance).toBe(1)
    expect(world.presses).toBeGreaterThan(0)
  })

  it('steps onto the tile itself when asked to arrive on it', async () => {
    // A spot to stand on, in front of a counter: the walk ends on the tile.
    const world = roomWorld({ x: 0, y: 0 })
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({
      connectionId: CID,
      destination: 1,
      tile: { x: 2, y: 2 },
      arrive: 'on'
    })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position).toMatchObject({ x: 2, y: 2 })
  })

  it('settles for a tile beside a spot it cannot reach', async () => {
    // The spot (2,2) is a wall in the cache, as a taken tile reads; the walk
    // ends next to it instead, so the NPC click can still be made.
    const world = roomWorld({ x: 0, y: 0 }, ['.....', '.....', '..#..', '.....', '.....'])
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({
      connectionId: CID,
      destination: 1,
      tile: { x: 2, y: 2 },
      arrive: 'on'
    })
    expect(outcome).toEqual({ kind: 'arrived' })
    const distance = Math.abs(world.position.x - 2) + Math.abs(world.position.y - 2)
    expect(distance).toBe(1)
  })

  it('still stops when neither the spot nor a tile beside it can be reached', async () => {
    const world = roomWorld({ x: 0, y: 0 }, ['.....', '.###.', '.###.', '.###.', '.....'])
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({
      connectionId: CID,
      destination: 1,
      tile: { x: 2, y: 2 },
      arrive: 'on'
    })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
  })

  it('arrives with no steps when already on the tile it was asked to stand on', async () => {
    const world = roomWorld({ x: 2, y: 2 })
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({
      connectionId: CID,
      destination: 1,
      tile: { x: 2, y: 2 },
      arrive: 'on'
    })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.presses).toBe(0)
  })

  it('arrives with no steps when already beside the NPC', async () => {
    const world = roomWorld({ x: 2, y: 1 }) // one tile north of (2,2)
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({ connectionId: CID, destination: 1, tile: { x: 2, y: 2 } })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.presses).toBe(0)
  })

  it('stops blocked when no tile beside the NPC is reachable', async () => {
    // The NPC at (2,2) is walled in on every side.
    const world = roomWorld(
      { x: 0, y: 0 },
      ['.....', '..#..', '.#N#.', '..#..', '.....'].map((r) => r.replace('N', '.'))
    )
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({ connectionId: CID, destination: 1, tile: { x: 2, y: 2 } })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
  })

  it('stops lostPosition when something else changes the map mid-approach', async () => {
    const world = roomWorld({ x: 0, y: 0 })
    world.hijackToMap = 9 // the next press lands on a map nobody asked for
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({ connectionId: CID, destination: 1, tile: { x: 4, y: 4 } })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'lostPosition' })
  })
})

// --- WP34: a popup mid-walk ------------------------------------------------

function pursuit(overrides: Partial<PursuitMessage> = {}): PursuitMessage {
  return {
    kind: 'pursuitMessage',
    dialogType: 0,
    dialogKind: 'text',
    objectType: 1,
    sourceId: 0x1f6f,
    npcName: 'Eduardo',
    pursuit: 588,
    step: 1,
    hasPrevious: false,
    hasNext: false,
    isProtected: false,
    text: 'You give political support to Arachne for these Temuairan four days.',
    ...overrides
  }
}

/** A notice pops up after the second step, as a clout verdict does. */
function popupAfterTwoSteps(world: World, packet: PursuitMessage): void {
  let moves = 0
  world.afterMove = (w): void => {
    moves++
    if (moves === 2) w.dialog = { packet, asOfMs: ++w.clock }
  }
}

describe('walker and a popup mid-walk (WP34)', () => {
  it('clicks Close on a plain notice and walks on, with no stall counted', async () => {
    // Acceptance criterion 1: a notice that blocks the walk is closed, and the
    // walk continues. The close is a click; a posted key does nothing on a
    // pane (live, 2026-09-21).
    const world = lineWorld()
    popupAfterTwoSteps(world, pursuit())
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.closeClicks).toBe(1)
    expect(world.otherKeys).toEqual([])
    expect(world.dialog).toBeNull()
  })

  it('clicks once and then stops with dialog when the click did not close it', async () => {
    // No loop on a popup the client keeps up, and a reason that names it.
    const world = lineWorld()
    world.buttonsWork = false
    popupAfterTwoSteps(world, pursuit())
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'dialog' })
    expect(world.closeClicks).toBe(1)
  })

  it('closes a menu pushed on the character, and never chooses a row', async () => {
    // Acceptance criterion 2: the prayer invite of the live try (2026-09-21):
    // "Evenue is praying to Ceannlaidir." with No, Assist, and a curse. A
    // close chooses none of them; the walk goes on.
    const world = lineWorld()
    popupAfterTwoSteps(
      world,
      pursuit({
        dialogType: 2,
        dialogKind: 'options',
        objectType: 4,
        pursuit: 548,
        step: 135,
        hasNext: true,
        text: 'Evenue is praying to Ceannlaidir.',
        options: [{ text: 'No' }, { text: 'Assist' }, { text: 'A curse on you for bothering me!' }]
      })
    )
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.closeClicks).toBe(1)
    // No row click, no key into the pane.
    expect(world.clicks).toEqual([])
    expect(world.otherKeys).toEqual([])
  })

  it('closes a text field the same way', async () => {
    const world = lineWorld()
    popupAfterTwoSteps(world, pursuit({ dialogType: 4, dialogKind: 'textInput' }))
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.closeClicks).toBe(1)
    expect(world.otherKeys).toEqual([])
  })

  it('stops with protected at the credential pane, before any click', async () => {
    // Acceptance criterion 3: a dialogType-9 pane is never closed and always
    // stops the run.
    const world = lineWorld()
    let pressesAtPopup = 0
    let moves = 0
    world.afterMove = (w): void => {
      moves++
      if (moves !== 2) return
      w.dialog = {
        packet: pursuit({ dialogType: 9, dialogKind: 'protected', isProtected: true }),
        asOfMs: ++w.clock
      }
      pressesAtPopup = w.presses
    }
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'protected' })
    expect(world.closeClicks).toBe(0)
    expect(world.otherKeys).toEqual([])
    // One step was posted before the walker could know the pane was up: the
    // step whose miss revealed it. Nothing followed.
    expect(world.presses).toBe(pressesAtPopup + 1)
  })

  it('cancels an exchange window with Escape, clears its alert the same way, and walks on', async () => {
    // The popup Sabrael can make on demand: another player drags an item
    // onto the character. SExchange 0x42, not a dialog. Escape is its own
    // cancel, and the "Exchange cancelled." alert takes Escape too; OK is
    // never touched.
    const world = lineWorld()
    let moves = 0
    world.afterMove = (w): void => {
      moves++
      if (moves === 2) {
        w.exchange = { kind: 'open', partnerName: 'Pandsala', asOfMs: ++w.clock, accepted: [] }
      }
    }
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
    // One Escape for the window, one for the alert it left.
    expect(world.otherKeys).toEqual([0x1b, 0x1b])
    expect(world.clicks).toEqual([])
    expect(world.closeClicks).toBe(0)
    expect(world.exchange?.kind).toBe('alert')
    expect(world.alertBlocks).toBe(false)
  })

  it('posts one Escape at an exchange the client keeps open, then stops with dialog', async () => {
    const world = lineWorld()
    world.buttonsWork = false
    let moves = 0
    world.afterMove = (w): void => {
      moves++
      if (moves === 2) {
        w.exchange = { kind: 'open', partnerName: 'Pandsala', asOfMs: ++w.clock, accepted: [] }
      }
    }
    const { walker } = harness(world, lineGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'dialog' })
    expect(world.otherKeys).toEqual([0x1b])
  })

  it('clears a notice on the way to a tile as well', async () => {
    // The within-map approach shares the check.
    const world = roomWorld({ x: 0, y: 0 })
    popupAfterTwoSteps(world, pursuit())
    const { walker } = harness(world, roomGraph)
    const outcome = await walker.go({ connectionId: CID, destination: 1, tile: { x: 4, y: 4 } })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.closeClicks).toBe(1)
  })
})

// --- WP32: gated maps ---------------------------------------------------------

describe('walker and a gated map (WP32)', () => {
  // Town(1) -> Field(2) -> Cave(3): Field is the Mileth Commons of this world.
  const FIELD_GATE: Gate = { mapId: 2, town: 'Mileth', admits: ['Mileth', 'Loures'], name: 'Field' }

  it('stops an unregistered character before it moves, and says which gate', async () => {
    // Acceptance criterion 1.
    const world = lineWorld()
    world.passport = { registered: false, citizenship: 4 }
    const { walker } = harness(world, lineGraph(), [FIELD_GATE])
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'gated' })
    expect(world.presses).toBe(0)
  })

  it('stops a citizen of another town the same way', async () => {
    const world = lineWorld()
    world.passport = { registered: true, citizenship: 6 }
    const { walker } = harness(world, lineGraph(), [FIELD_GATE])
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'gated' })
    expect(world.presses).toBe(0)
  })

  it('walks a Loures citizen through, and stops a citizen of nowhere', async () => {
    // Each Commons admits its own town and Loures; nation 0 is a known fact
    // once SelfLook has been seen, and bars.
    const loures = lineWorld()
    loures.passport = { registered: true, citizenship: 3 }
    expect(
      await harness(loures, lineGraph(), [FIELD_GATE]).walker.go({
        connectionId: CID,
        destination: 'Cave'
      })
    ).toEqual({ kind: 'arrived' })
    const nowhere = lineWorld()
    nowhere.passport = { registered: true, citizenship: 0 }
    expect(
      await harness(nowhere, lineGraph(), [FIELD_GATE]).walker.go({
        connectionId: CID,
        destination: 'Cave'
      })
    ).toEqual({ kind: 'stopped', reason: 'gated' })
    expect(nowhere.presses).toBe(0)
  })

  it('walks a registered citizen of the gate town through', async () => {
    // Acceptance criterion 2.
    const world = lineWorld()
    world.passport = { registered: true, citizenship: 4 }
    const { walker } = harness(world, lineGraph(), [FIELD_GATE])
    const outcome = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(outcome).toEqual({ kind: 'arrived' })
  })

  it('treats a character with no signal as one that may pass', async () => {
    // Acceptance criterion 3: silence proves nothing, and a wrong "may pass"
    // costs one refused walk at most.
    const world = lineWorld()
    world.passport = {}
    const { walker } = harness(world, lineGraph(), [FIELD_GATE])
    expect(await walker.go({ connectionId: CID, destination: 'Cave' })).toEqual({
      kind: 'arrived'
    })
    world.position = { ...world.position, mapId: 1, x: 0, y: 0 }
    world.passport = null
    expect(await walker.go({ connectionId: CID, destination: 'Cave' })).toEqual({
      kind: 'arrived'
    })
  })

  it('learns a gate from its own refusal, and does not walk into it again', async () => {
    // Acceptance criterion 5: the refusal, not the stall, is the proof. No
    // seed here; the world's gate refuses at the warp.
    const world = lineWorld()
    world.gatedMaps.set(2, 'Mileth')
    world.passport = { registered: true, citizenship: 6 }
    const { walker } = harness(world, lineGraph())
    const first = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(first).toEqual({ kind: 'stopped', reason: 'gated' })
    // It reached the warp and was refused there: no three-stall grind.
    const pressesToTheGate = world.presses
    expect(world.position).toMatchObject({ mapId: 1 })

    const second = await walker.go({ connectionId: CID, destination: 'Cave' })
    expect(second).toEqual({ kind: 'stopped', reason: 'gated' })
    expect(world.presses).toBe(pressesToTheGate)
  })

  it('learns the gate even for a character whose byte says it is a citizen', async () => {
    // A stale citizenship byte: the gate's word wins for the session.
    const world = lineWorld()
    world.gatedMaps.set(2, 'Mileth')
    world.passport = { registered: true, citizenship: 4 }
    const { walker } = harness(world, lineGraph())
    expect(await walker.go({ connectionId: CID, destination: 'Cave' })).toEqual({
      kind: 'stopped',
      reason: 'gated'
    })
    const presses = world.presses
    expect(await walker.go({ connectionId: CID, destination: 'Cave' })).toEqual({
      kind: 'stopped',
      reason: 'gated'
    })
    expect(world.presses).toBe(presses)
  })

  it('reports noRoute, not gated, when no route exists at all', async () => {
    const world = lineWorld()
    world.passport = { registered: false }
    const { walker } = harness(world, lineGraph(), [FIELD_GATE])
    const outcome = await walker.go({ connectionId: CID, destination: 99 })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'noRoute' })
  })
})

describe('the destination picker', () => {
  it('offers the named maps and nothing else: the end tile is its own field', () => {
    const world = lineWorld()
    const walker = createWalker({
      actionLayer: { stopped: false } as unknown as ActionLayer,
      liveConnections: () => [],
      positionFor: () => world.position,
      maps: { gridFor: async () => null },
      graph: createRouteGraph(lineGraph()),
      log: noop
    })
    expect(walker.destinations().map((d) => d.name)).toEqual(['Cave', 'Field', 'Town'])
  })
})

describe('a warp tile the map cache calls a wall', () => {
  it('routes into it anyway, because the graph says a warp is there', async () => {
    // Piet Storage's door: the doorway static carries the closed door's
    // collision, so the cache says wall, and the game opens it on the step.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['....#'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const { walker } = harness(world, [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
      { mapId: 2, name: 'Storage', exits: [] }
    ])
    const outcome = await walker.go({ connectionId: CID, destination: 'Storage' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(2)
  })

  it('still refuses a wall that is not a warp', async () => {
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['..#..'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const { walker } = harness(world, [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
      { mapId: 2, name: 'Storage', exits: [] }
    ])
    const outcome = await walker.go({ connectionId: CID, destination: 'Storage' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
  })
})

describe('a warp one tile past the graph', () => {
  it('steps one tile further the way it came, and warps', async () => {
    // The graph names (3,0), the hand-made way; the world warps at (4,0). The
    // walker stands on (3,0), sees nothing fire, steps East once more.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['.....'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const { walker } = harness(world, [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 3, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [] }
    ])
    const outcome = await walker.go({ connectionId: CID, destination: 'Field' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(2)
  })

  it('does not step past the map edge', async () => {
    // The graph's tile is the last one in the row, so there is no "further".
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['.....'])],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const { walker } = harness(world, [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [] }
    ])
    const outcome = await walker.go({ connectionId: CID, destination: 'Field' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    expect(world.position).toMatchObject({ mapId: 1, x: 4, y: 0 })
  })
})

describe('a warp that never fires', () => {
  it('stops as blocked instead of waiting on the tile for ever', async () => {
    // Town's only warp is at (4,0), and the fake world never fires it. The
    // walker stands on it, counts its stalls, learns the tile, and then has no
    // warp left to aim at. Before the fix it chose the tile it stood on again.
    const maps = new Map<number, FakeMap>([
      [1, fakeMap(['.....'])],
      [2, fakeMap(['.....'])]
    ])
    const world = new World(maps, { mapId: 1, x: 0, y: 0 })
    const { walker } = harness(world, [
      { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
      { mapId: 2, name: 'Field', exits: [] }
    ])
    const outcome = await walker.go({ connectionId: CID, destination: 'Field' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    expect(world.position).toMatchObject({ mapId: 1, x: 4, y: 0 })
  })
})

// --- The world map ----------------------------------------------------------

// Town(1) --> Gateway(2), whose east tile opens the world map. The pane lists
// Abel Outskirts(3) at (306, 77) and Loures(4) at (344, 250). Town and Gateway
// are one open row of five tiles.
const PANE: FieldMap = {
  kind: 'fieldMap',
  fieldName: 'field001',
  currentIndex: 0,
  points: [
    { screenX: 218, screenY: 99, name: 'Mileth', checksum: 0, mapId: 2, x: 4, y: 0 },
    { screenX: 306, screenY: 77, name: 'Abel', checksum: 0, mapId: 3, x: 0, y: 0 },
    { screenX: 344, screenY: 250, name: 'Loures', checksum: 0, mapId: 4, x: 0, y: 0 }
  ]
}

function fieldGraph(recordedClick = { screenX: 306, screenY: 77 }): RouteNode[] {
  return [
    { mapId: 1, name: 'Town', exits: [{ toMapId: 2, x: 4, y: 0 }] },
    {
      mapId: 2,
      name: 'Gateway',
      exits: [
        { toMapId: 1, x: 0, y: 0 },
        { toMapId: 3, x: 4, y: 0, via: { kind: 'fieldMap', ...recordedClick } },
        { toMapId: 4, x: 4, y: 0, via: { kind: 'fieldMap', screenX: 344, screenY: 250 } }
      ]
    },
    { mapId: 3, name: 'Abel Outskirts', exits: [] },
    { mapId: 4, name: 'Loures', exits: [] }
  ]
}

function fieldWorld(pane: FieldMap | null = PANE): World {
  const maps = new Map<number, FakeMap>([
    [1, fakeMap(['.....'], new Map([['4,0', { toMap: 2, ax: 0, ay: 0 }]]))],
    [
      2,
      fakeMap(['.....'], new Map([['0,0', { toMap: 1, ax: 4, ay: 0 }]]), new Map([['4,0', pane]]))
    ],
    [3, fakeMap(['.....'])],
    [4, fakeMap(['.....'])]
  ])
  return new World(maps, { mapId: 1, x: 0, y: 0 })
}

describe('walker across the world map', () => {
  it('steps onto the gateway tile, clicks the wire point for the next map, and arrives', async () => {
    const { walker, world } = harness(fieldWorld(), fieldGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(3)
    expect(world.clicks).toEqual([{ x: 306, y: 77 }])
    expect(world.fieldMap).toBeNull()
  })

  it('picks the point by map id, not by the imported position', async () => {
    // The imported click is stale: the wire says Abel is at (306, 77).
    const { walker, world } = harness(fieldWorld(), fieldGraph({ screenX: 10, screenY: 10 }))
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.clicks).toEqual([{ x: 306, y: 77 }])
  })

  it('reaches a different destination through the same tile by a different click', async () => {
    const { walker, world } = harness(fieldWorld(), fieldGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Loures' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.position.mapId).toBe(4)
    expect(world.clicks).toEqual([{ x: 344, y: 250 }])
  })

  it('falls back to the imported position when the pane has no point for the map', async () => {
    const pane: FieldMap = { ...PANE, points: PANE.points.filter((p) => p.mapId !== 3) }
    const world = fieldWorld(pane)
    // The fake pane lands the click only on a listed point, so the fallback
    // click cannot warp here. What is under test is which position it clicks.
    const { walker } = harness(world, fieldGraph({ screenX: 306, screenY: 77 }))
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(world.clicks[0]).toEqual({ x: 306, y: 77 })
    expect(outcome.kind).toBe('stopped')
  })

  it('clicks again when the client does not answer, and hops on the retry', async () => {
    const world = fieldWorld()
    world.missClicks = 1
    const { walker } = harness(world, fieldGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(world.clicks).toEqual([
      { x: 306, y: 77 },
      { x: 306, y: 77 }
    ])
  })

  it('gives up on the tile after three unanswered clicks', async () => {
    const world = fieldWorld()
    world.missClicks = 100
    const { walker } = harness(world, fieldGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    // Three tries per stand on the tile, three stands before the tile is
    // learned as blocked.
    expect(world.clicks.length).toBe(9)
    expect(world.position.mapId).toBe(2)
  })

  it('stops as blocked when the pane never opens, rather than waiting forever', async () => {
    const { walker, world } = harness(fieldWorld(null), fieldGraph())
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    expect(world.clicks).toEqual([])
    expect(world.position.mapId).toBe(2)
  })

  it('does not click when the global stop is in force', async () => {
    const world = fieldWorld()
    const { walker, layer } = harness(world, fieldGraph())
    world.afterMove = (w) => {
      if (w.fieldMap !== null) layer.stopped = true
    }
    const outcome = await walker.go({ connectionId: CID, destination: 'Abel Outskirts' })
    expect(outcome.kind).toBe('stopped')
    expect(world.clicks).toEqual([])
  })
})
