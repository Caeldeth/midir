import type {
  ActionTarget,
  WalkerDestination,
  WalkerPosition,
  WalkerState,
  WalkOutcome,
  WalkRequest,
  WalkStopReason
} from '../shared/actionLayer'
import { VK_SPACE, type ActionLayer, type LiveConnection } from './actionLayer'
import type { Logger } from './log'
import type { FieldMapState } from './model/fieldMap'
import type { Position } from './model/position'
import type { RouteGraph, RouteHop, RouteLeg, RouteWarp } from './route/graph'
import type { MapProvider } from './route/mapSource'
import type { MapGrid } from './route/mapGrid'
import { findPath, type PathStep } from './route/pathfind'
import { DIRECTION_DELTA } from './protocol/decode'

/**
 * The Walker: name a place, and the character walks there, across maps, by the
 * route the world allows. It replaces DA Walker, and it reads where the legacy
 * tool read memory (WP14) and drives where the legacy tool drove (WP13).
 *
 * The one rule that shapes it is step-and-confirm. The legacy tool presses a
 * key and assumes the step happened; every failure mode of a walker is the same
 * failure, a step that did not land while the walker keeps counting. Midir reads
 * both directions, so every step waits for WP14 to move the position and
 * re-plans when it does not. A step that does not land is the normal case, not
 * an error, so the loop never chains more keys than the confirmations it has.
 *
 * Two levels of planning, as the legacy tool has: the between-maps graph gives
 * the warps to take, and the within-map A* gets to each warp tile around walls.
 * They fail differently and stay apart. The action layer, the position feed, the
 * map source, and the graph are all injected, so the whole walker runs against a
 * fake action layer and a scripted position with no game.
 *
 * A warp that needs more than the step is a hop (route/graph.ts `RouteHop`).
 * The world map is the one that matters: a town's gateway tiles open the
 * SFieldMap 0x2E pane, and the walk continues only when a point on it is
 * clicked. The walker reads the pane off the wire, picks the point whose map id
 * is the next map of the route, clicks it, and waits for the map change: the
 * same step-and-confirm rule, with a click for the step.
 */

/** The Win32 virtual keys the client reads as the four walk directions. */
const VK_LEFT = 0x25
const VK_UP = 0x26
const VK_RIGHT = 0x27
const VK_DOWN = 0x28

/**
 * The walk key for each direction index: 0 North, 1 East, 2 South, 3 West.
 *
 * Kept in one place so a live correction is a one-line change. The retail client
 * moves on the arrow keys; this is the GUI check that proves the walker.
 */
const DIRECTION_KEY = [VK_UP, VK_RIGHT, VK_DOWN, VK_LEFT]

/** A readable name for each direction index, for the log. */
const DIRECTION_NAME = ['North', 'East', 'South', 'West']

/** How often to read the position while waiting, in milliseconds. */
const POLL_MS = 40
/**
 * How long to wait for a step to land, in milliseconds.
 *
 * The client draws its own step at once, so a landed step shows as a predicted
 * move within a few tenths of a second. A press that draws nothing in this
 * window was a turn or a block, not a slow step.
 */
const STEP_CONFIRM_MS = 1200
/** How long to wait for a map change to confirm, in milliseconds. A cache miss downloads the map. */
const WARP_CONFIRM_MS = 8000
/**
 * How long to wait for a plain warp to fire after the step onto its tile, in
 * milliseconds, before the walker tries one tile further.
 *
 * A warp fires within a moment of the step. What takes long is the map load
 * after it, which WARP_CONFIRM_MS covers once the map id has changed.
 */
const WARP_FIRE_MS = 2500
/** How long to wait for the world map pane to open after the step onto its tile, in milliseconds. */
const FIELD_MAP_OPEN_MS = 3000
/** A settle after the pane opens, before the click. DA Walker waits a second. */
const PANE_SETTLE_MS = 600
/**
 * How long to wait for the client's own 0x3F after a click, in milliseconds.
 *
 * The pane sends it after its marker animation. The docs say 0.5 to 4 s; the
 * live check of 2026-09-21 measured about 7 s, so this is generous.
 */
const CLICK_ACK_MS = 10000
/** How many times to click a point that the client did not answer. */
const CLICK_TRIES = 3
/**
 * How long to wait for the map change after the client answered a hop, in
 * milliseconds. The destination may need a download.
 */
const HOP_CONFIRM_MS = 15000
/**
 * How far apart the wire's point and DA Walker's recorded click may be before
 * the walker logs the difference, in pixels. The live check reads that log.
 */
const CLICK_MISMATCH_PX = 8
/** How long to wait for the position to become known, in milliseconds. */
const WAIT_KNOWN_MS = 4000
/** A settle after a landed step, so the next key does not fall mid-step. */
const INTER_STEP_MS = 90
/** How many stalls at one tile before the walker gives up on that tile. */
const MAX_STALLS = 3
/**
 * The most tiles of delayed own-progress to accept as one confirmation.
 *
 * Under server lag the confirmations for several of the walker's own steps
 * arrive together, so the position jumps more than one tile along the pressed
 * direction. That is progress, not something else moving the character.
 */
const MAX_CATCHUP = 5

export interface WalkerOptions {
  actionLayer: ActionLayer
  /** The connections that carry a live character now. From the capture service. */
  liveConnections: () => LiveConnection[]
  /** Where a character stands, from the capture service. */
  positionFor: (connectionId: string) => Position | null
  /** The world map on screen, from the capture service. Absent means never. */
  fieldMapFor?: (connectionId: string) => FieldMapState | null
  /** The source of a map's passability. */
  maps: MapProvider
  /** The between-maps route graph. */
  graph: RouteGraph
  log: Logger
  /** Called whenever a walker changes, so main can push it. */
  onState?: (state: WalkerState) => void
  /**
   * Named spots on maps, offered beside the map names in the destination
   * picker as `Place @ x,y`: an errand's stand tile, for example.
   */
  spots?: () => { destination: string | number; tile: { x: number; y: number } }[]
  /** The clock. Injected by tests. */
  now?: () => number
  /** Sleep for a number of milliseconds. Injected by tests. */
  sleep?: (ms: number) => Promise<void>
}

export interface Walker {
  /** Every place the walker can be sent to, for the destination picker. */
  destinations(): WalkerDestination[]
  /** Walk a character to a place. Resolves with how the walk ended. */
  go(request: WalkRequest): Promise<WalkOutcome>
  /** Stop the walker on one connection. */
  stop(connectionId: string): void
  /** Every walker running now. */
  states(): WalkerState[]
  /** Stop every walker quietly. Called on shutdown. */
  dispose(): void
}

interface Run {
  connectionId: string
  destination: string
  running: boolean
  stopReason?: WalkStopReason
  stepsTaken: number
  lastPosition?: Position
  nextWarp?: { toMapId: number; x: number; y: number }
  /** Capture time of the last world map pane written to the log, so a retry does not repeat it. */
  loggedPaneAt?: number
}

/** The key for one tile in the run's learned-blocked set. */
function tileKey(mapId: number, x: number, y: number): string {
  return `${mapId}:${x}:${y}`
}

/**
 * Wrap a map grid so it also refuses a move into a tile the walker learned is
 * impassable this run, and allows a move into a tile the graph vouches for.
 *
 * The disk map cache does not see a creature standing in a doorway, or a tile
 * the server blocks though the cache calls it open. When a step stalls at one
 * tile, the walker adds that tile to `blocked` and re-plans around it.
 *
 * The cache is wrong the other way too. A doorway's static tile carries the
 * closed door's collision, so the cache (and the client's own Tab map) calls
 * the tile impassable, and the game opens the door as the character steps in.
 * A warp tile is entered by definition — the graph says a warp is there — so
 * a move into one of `allowed` is permitted whatever the cache says. The
 * live check of 2026-09-21 found Piet Storage's door (50,13) this way.
 */
function gridWithBlocks(
  grid: MapGrid,
  mapId: number,
  blocked: Set<string>,
  allowed: Set<string> = new Set()
): MapGrid {
  return {
    width: grid.width,
    height: grid.height,
    inBounds: grid.inBounds,
    canMove: (x, y, direction) => {
      const delta = DIRECTION_DELTA[direction]
      if (delta === undefined) return false
      const nx = x + delta[0]
      const ny = y + delta[1]
      const into = tileKey(mapId, nx, ny)
      if (blocked.has(into)) return false
      if (allowed.has(into)) return grid.inBounds(nx, ny)
      return grid.canMove(x, y, direction)
    }
  }
}

/** A trimmed position, safe to send to the renderer. */
function toWalkerPosition(position: Position): WalkerPosition {
  return {
    mapId: position.mapId,
    ...(position.mapName !== undefined ? { mapName: position.mapName } : {}),
    x: position.x,
    y: position.y,
    confidence: position.confidence
  }
}

/**
 * Classify a stop reason from the action layer's own words.
 *
 * The layer stops for the window closing, the connection ending, focus loss, or
 * the stop hotkey. A closed window means the character is gone; everything else
 * is the user's own stop.
 */
function classifyLayerStop(reason: string): WalkStopReason {
  return reason.includes('window closed') ? 'lostCharacter' : 'user'
}

export function createWalker(options: WalkerOptions): Walker {
  const { actionLayer, liveConnections, positionFor, maps, graph, log, onState } = options
  const fieldMapFor = options.fieldMapFor ?? ((): FieldMapState | null => null)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const runs = new Map<string, Run>()

  function hasLiveCharacter(connectionId: string): boolean {
    return liveConnections().some((c) => c.connectionId === connectionId)
  }

  function publish(run: Run, reason?: string): void {
    onState?.({
      connectionId: run.connectionId,
      running: run.running,
      destination: run.destination,
      ...(run.lastPosition !== undefined ? { position: toWalkerPosition(run.lastPosition) } : {}),
      ...(run.nextWarp !== undefined ? { nextWarp: run.nextWarp } : {}),
      stepsTaken: run.stepsTaken,
      ...(reason !== undefined ? { reason } : {})
    })
  }

  /** Poll the position until a predicate holds or the deadline passes. */
  async function waitFor(
    connectionId: string,
    predicate: (position: Position | null) => boolean,
    timeoutMs: number
  ): Promise<Position | null> {
    const deadline = now() + timeoutMs
    for (;;) {
      const position = positionFor(connectionId)
      if (predicate(position)) return position
      if (now() >= deadline) return null
      await sleep(POLL_MS)
    }
  }

  /** Wait for a known position, so the walker never plans on a gap or a fresh map. */
  function waitKnown(connectionId: string, timeoutMs: number): Promise<Position | null> {
    return waitFor(connectionId, (p) => p !== null && p.confidence !== 'unknown', timeoutMs)
  }

  /** Wait for the map to change to `mapId` and the position on it to be confirmed. */
  function waitWarped(
    connectionId: string,
    mapId: number,
    timeoutMs: number
  ): Promise<Position | null> {
    return waitFor(
      connectionId,
      (p) => p !== null && p.mapId === mapId && p.confidence === 'confirmed',
      timeoutMs
    )
  }

  /** Poll `read` until it returns a value or the deadline passes. */
  async function pollFor<T>(read: () => T | null, timeoutMs: number): Promise<T | null> {
    const deadline = now() + timeoutMs
    for (;;) {
      const value = read()
      if (value !== null) return value
      if (now() >= deadline) return null
      await sleep(POLL_MS)
    }
  }

  /** Map an action-layer refusal to what the hop does next. */
  function refuse(run: Run, refusal: string): { kind: 'failed' } | WalkOutcome {
    if (refusal === 'stopped') return { kind: 'stopped', reason: run.stopReason ?? 'user' }
    if (refusal === 'rateLimited') return { kind: 'failed' }
    return { kind: 'stopped', reason: 'lostCharacter' }
  }

  /**
   * Perform a hop: the gesture a warp tile needs beyond the step onto it.
   *
   * The character stands on the tile. Returns `done` once the map changed to
   * the leg's destination, `failed` when the gesture did not take (the caller
   * counts a stall, as for a plain warp that did not fire), or a stop.
   */
  async function performHop(
    run: Run,
    target: ActionTarget,
    leg: RouteLeg,
    warp: RouteWarp,
    via: RouteHop,
    before: Position
  ): Promise<{ kind: 'done' } | { kind: 'failed' } | WalkOutcome> {
    if (via.kind === 'dialog') {
      // The planner never routes through one. Stop rather than guess.
      log.warn('walker', `Warp (${warp.x}, ${warp.y}) needs an NPC dialog; not a walk.`)
      return { kind: 'stopped', reason: 'noRoute' }
    }

    if (via.kind === 'prompt') {
      log.info('walker', `Warp (${warp.x}, ${warp.y}) asks a prompt; accepting it.`)
      const refusal = await actionLayer.pressKey(target, VK_SPACE)
      if (refusal !== null) return refuse(run, refusal)
      const warped = await waitWarped(run.connectionId, leg.toMapId, HOP_CONFIRM_MS)
      return warped !== null ? { kind: 'done' } : { kind: 'failed' }
    }

    // The world map. Wait for the pane the tile opens, then find the point.
    const pane = await pollFor(() => {
      const state = fieldMapFor(run.connectionId)
      return state !== null && state.asOfMs >= before.asOfMs ? state : null
    }, FIELD_MAP_OPEN_MS)
    if (pane === null) {
      log.info(
        'walker',
        `World map did not open at (${warp.x}, ${warp.y}) within ${FIELD_MAP_OPEN_MS} ms.`
      )
      return { kind: 'failed' }
    }

    // Write the pane out once. The log then says what the wire offered, which
    // is what a failed hop needs to be understood.
    if (run.loggedPaneAt !== pane.asOfMs) {
      run.loggedPaneAt = pane.asOfMs
      const listing = pane.packet.points
        .map((p) => `${p.name} (${p.screenX}, ${p.screenY}) -> map ${p.mapId} at (${p.x}, ${p.y})`)
        .join('; ')
      log.info(
        'walker',
        `World map ${pane.packet.fieldName} open with ${pane.packet.points.length} points, marker on ${pane.packet.currentIndex}: ${listing}.`
      )
    }

    // The wire's point for the next map is the click target. DA Walker's
    // recorded position is the fallback, and the check when both exist.
    const point = pane.packet.points.find((p) => p.mapId === leg.toMapId)
    let click: { x: number; y: number }
    if (point !== undefined) {
      click = { x: point.screenX, y: point.screenY }
      const dx = Math.abs(point.screenX - via.screenX)
      const dy = Math.abs(point.screenY - via.screenY)
      if (dx > CLICK_MISMATCH_PX || dy > CLICK_MISMATCH_PX) {
        log.warn(
          'walker',
          `World map point "${point.name}" for map ${leg.toMapId} is at (${point.screenX}, ${point.screenY}) on the wire and (${via.screenX}, ${via.screenY}) in the imported graph. Using the wire.`
        )
      }
      log.info(
        'walker',
        `Clicking "${point.name}" at (${click.x}, ${click.y}) for map ${leg.toMapId}.`
      )
    } else {
      click = { x: via.screenX, y: via.screenY }
      log.warn(
        'walker',
        `World map has no point for map ${leg.toMapId}; clicking the imported position (${click.x}, ${click.y}).`
      )
    }

    // Let the pane finish drawing before the first click.
    await sleep(PANE_SETTLE_MS)

    // Click, then wait for the client's own 0x3F: the proof the release landed
    // on the point. Without it the click missed, and a wait for the map change
    // would be a wait for nothing. Retry a few times before calling it a stall.
    for (let attempt = 1; attempt <= CLICK_TRIES; attempt++) {
      if (!run.running || actionLayer.stopped) {
        return { kind: 'stopped', reason: run.stopReason ?? 'user' }
      }
      const clickedAt = now()
      const refusal = await actionLayer.click(target, click.x, click.y)
      if (refusal !== null) return refuse(run, refusal)

      const answered = await pollFor(() => {
        const state = fieldMapFor(run.connectionId)
        if (state?.click !== undefined && state.click.asOfMs >= clickedAt) return state.click
        // The pane is gone and the map is the destination: the answer was
        // missed on the wire, but the hop plainly took.
        const p = positionFor(run.connectionId)
        return p !== null && p.mapId === leg.toMapId ? { packet: null, asOfMs: p.asOfMs } : null
      }, CLICK_ACK_MS)

      if (answered === null) {
        log.info(
          'walker',
          `The client did not answer the click at (${click.x}, ${click.y}) within ${CLICK_ACK_MS} ms (try ${attempt}/${CLICK_TRIES}).`
        )
        continue
      }
      if (answered.packet !== null) {
        const sent = answered.packet
        if (sent.mapId !== leg.toMapId) {
          log.warn(
            'walker',
            `The client sent a click for map ${sent.mapId}, not the ${leg.toMapId} asked for.`
          )
        } else {
          log.info(
            'walker',
            `The client answered: map ${sent.mapId} at (${sent.x}, ${sent.y}), ${answered.asOfMs - clickedAt} ms after the click.`
          )
        }
      }
      const warped = await waitWarped(run.connectionId, leg.toMapId, HOP_CONFIRM_MS)
      return warped !== null ? { kind: 'done' } : { kind: 'failed' }
    }
    log.warn(
      'walker',
      `No click selected the world map point for map ${leg.toMapId}; giving up on this tile.`
    )
    return { kind: 'failed' }
  }

  /**
   * Run the walk. Returns the outcome. The loop re-plans from the current
   * position every step, so a missed step, a warp, and a wrong turn are all just
   * the next iteration reading a fresh position.
   */
  async function runLoop(run: Run, destMapId: number, target: ActionTarget): Promise<WalkOutcome> {
    let stalls = 0
    let stallKey = ''
    // The direction the walker believes the character faces. A step in a new
    // direction turns the character first and moves on the next press (the Dark
    // Ages turn-then-move rule), so a turn is not a stall.
    let facing = -1
    // Tiles the walker learned it cannot get through this run, though the map
    // cache calls them open — a creature in the way, or a cache that disagrees
    // with the server. A* routes around these.
    const blocked = new Set<string>()
    // How many times each warp tile was stood on without firing. Kept apart
    // from the step stalls, which a landed step resets.
    const warpTries = new Map<string, number>()

    for (;;) {
      if (!run.running) return { kind: 'stopped', reason: run.stopReason ?? 'user' }
      if (actionLayer.stopped) return { kind: 'stopped', reason: run.stopReason ?? 'user' }
      if (!hasLiveCharacter(run.connectionId)) return { kind: 'stopped', reason: 'lostCharacter' }

      // A known position, or the walker waits (WP15 decision 4). Predicted is
      // known enough to plan on: it is the client's own accepted step, and the
      // reducer snaps it to the server's word when that arrives. Only `unknown`
      // (a gap or a fresh map) makes the walker wait.
      let position = positionFor(run.connectionId)
      if (position === null || position.confidence === 'unknown') {
        position = await waitKnown(run.connectionId, WAIT_KNOWN_MS)
        if (position === null) {
          log.warn(
            'walker',
            'No known position. Is capture running, and was Midir up before the login?'
          )
          return { kind: 'stopped', reason: 'lostPosition' }
        }
      }
      if (facing === -1) facing = position.facing
      run.lastPosition = position

      // Arrived: the destination is a place, and the place is a map.
      if (position.mapId === destMapId) {
        publish(run)
        return { kind: 'arrived' }
      }

      // The grid needs the map's size, which rides in with SMapSize 0x15.
      if (position.mapWidth === undefined || position.mapHeight === undefined) {
        return { kind: 'stopped', reason: 'lostPosition' }
      }

      // Plan the route from where the character is now.
      const plan = graph.planRoute(position.mapId, destMapId)
      if (plan === null) return { kind: 'stopped', reason: 'noRoute' }
      if (plan.legs.length === 0) {
        // Same map as the destination is handled above; an empty plan here means
        // the graph put us on the destination without a warp, so we are there.
        return { kind: 'arrived' }
      }
      const leg = plan.legs[0]

      const rawGrid = await maps.gridFor(position.mapId, position.mapWidth, position.mapHeight)
      if (rawGrid === null) return { kind: 'stopped', reason: 'blocked' }
      // Route around the tiles this run has learned it cannot get through, and
      // into the leg's warp tiles whatever the cache says of them.
      const warpTiles = new Set(leg.warps.map((w) => tileKey(position.mapId, w.x, w.y)))
      const grid = gridWithBlocks(rawGrid, position.mapId, blocked, warpTiles)

      // Pick the nearest warp tile the character can actually path to. A warp
      // tile this run learned does not fire is skipped here too: standing on it
      // is a path of no steps, and A* would choose it for ever.
      let best: { warp: RouteWarp; path: PathStep[] } | null = null
      for (const warp of leg.warps) {
        if (blocked.has(tileKey(position.mapId, warp.x, warp.y))) continue
        const path = findPath(grid, { x: position.x, y: position.y }, warp)
        if (path !== null && (best === null || path.length < best.path.length)) {
          best = { warp, path }
        }
      }
      // No path to any warp, even around the blocked tiles: this is the real stop.
      if (best === null) {
        log.warn(
          'walker',
          `No route to a warp on map ${position.mapId} from (${position.x}, ${position.y}); blocked.`
        )
        return { kind: 'stopped', reason: 'blocked' }
      }

      run.nextWarp = { toMapId: leg.toMapId, x: best.warp.x, y: best.warp.y }
      publish(run)

      const before = position
      const beforeAt = before.asOfMs

      if (best.path.length === 0) {
        // Standing on the warp tile, but the map has not changed yet. A hop
        // needs its gesture now; a plain warp needs a wait for it to take.
        // Either way the next iteration sees the new map.
        if (best.warp.via !== undefined) {
          const hop = await performHop(run, target, leg, best.warp, best.warp.via, before)
          if (hop.kind === 'stopped') return hop
          if (hop.kind === 'done') {
            run.stepsTaken++
            stalls = 0
            log.info('walker', `Hopped to map ${leg.toMapId}.`)
            publish(run)
            continue
          }
        } else {
          const fired = await waitFor(
            run.connectionId,
            (p) => p !== null && p.mapId !== before.mapId,
            WARP_FIRE_MS
          )
          if (fired !== null) {
            const warped = await waitWarped(run.connectionId, leg.toMapId, WARP_CONFIRM_MS)
            if (warped !== null) stalls = 0
            continue
          }
          // The tile did not fire. The imported graph is hand-made and is
          // sometimes one tile short of the real warp, in the direction the
          // character came from (the live check of 2026-09-21 found two in
          // Rucesion Commons). One more step the same way finds it when it is.
          const beyond = await stepBeyond(run, target, grid, before, facing, leg.toMapId)
          if (beyond === 'stopped') {
            return { kind: 'stopped', reason: run.stopReason ?? 'user' }
          }
          if (beyond === 'warped') {
            run.stepsTaken++
            stalls = 0
            continue
          }
        }
        // The warp did not take. After a few tries give up on this warp tile so
        // A* routes to another warp for the same leg, or stops if there is none.
        const key = tileKey(before.mapId, before.x, before.y)
        const tries = (warpTries.get(key) ?? 0) + 1
        warpTries.set(key, tries)
        if (tries >= MAX_STALLS) {
          blocked.add(key)
          log.info('walker', `Warp tile (${before.x}, ${before.y}) did not fire; routing around.`)
        }
        continue
      }

      const step = best.path[0]
      // A step onto a plain warp tile changes the map. A step onto a hop tile
      // only lands there, and the hop follows on the next iteration.
      const isWarpStep =
        step.x === best.warp.x && step.y === best.warp.y && best.warp.via === undefined
      // A step in a direction the character does not face turns it first.
      const isTurn = step.direction !== facing

      log.info(
        'walker',
        `On map ${position.mapId} at (${position.x}, ${position.y}); step ${DIRECTION_NAME[step.direction]} toward warp (${best.warp.x}, ${best.warp.y}) to map ${leg.toMapId}.`
      )

      const refusal = await actionLayer.pressKey(target, DIRECTION_KEY[step.direction]!)
      if (refusal !== null) {
        if (refusal === 'stopped') return { kind: 'stopped', reason: run.stopReason ?? 'user' }
        if (refusal === 'rateLimited') {
          await sleep(POLL_MS)
          continue
        }
        // noWindow, wrongProcess, or blocked: the window or character is gone.
        return { kind: 'stopped', reason: 'lostCharacter' }
      }

      // Wait for the step to resolve. The client draws its own step at once and
      // sends CWalk, so a `predicted` move to the aimed tile is a landed step —
      // the walker does not wait for the slower server word (WP14). A resolved
      // outcome is a move to the aimed tile, a warp, an unasked-for map change,
      // a jump of more than one tile, or — for a press in a new direction — the
      // turn itself, which the client sends as CChangeDirection the moment it
      // turns. A turn never changes the map, so a warp step that is a turn
      // waits only the step time.
      const timeout = isWarpStep && !isTurn ? WARP_CONFIRM_MS : STEP_CONFIRM_MS
      const after = await waitFor(
        run.connectionId,
        (p) =>
          p !== null &&
          p.asOfMs > beforeAt &&
          (p.mapId !== before.mapId ||
            (p.x === step.x && p.y === step.y) ||
            Math.abs(p.x - before.x) + Math.abs(p.y - before.y) > 1 ||
            (isTurn && p.facing === step.direction && p.x === before.x && p.y === before.y)),
        timeout
      )

      // The wire said the press was a turn. The next press in this direction steps.
      if (
        after !== null &&
        after.mapId === before.mapId &&
        after.x === before.x &&
        after.y === before.y
      ) {
        facing = step.direction
        run.lastPosition = after
        log.info(
          'walker',
          `Turned to face ${DIRECTION_NAME[step.direction]} at (${before.x}, ${before.y}); will step next.`
        )
        continue
      }

      if (after === null) {
        // The tile did not change. A press in a new direction only turned the
        // character, which is not a stall: the next press in this direction
        // steps. The wire usually says so at once (above); this is the case
        // where it did not. A press in the way it already faces that does not
        // move is a real stall — a wall, a door, a creature, a freeze (WP15
        // decision 3).
        if (isTurn) {
          facing = step.direction
          log.info(
            'walker',
            `Turned to face ${DIRECTION_NAME[step.direction]} at (${before.x}, ${before.y}) with no word from the wire; will step next.`
          )
          continue
        }
        ;({ stalls, stallKey } = bumpStall(stalls, stallKey, before))
        run.lastPosition = positionFor(run.connectionId) ?? before
        log.info(
          'walker',
          `Step ${DIRECTION_NAME[step.direction]} did not land within ${timeout} ms (stall ${stalls}/${MAX_STALLS}) at (${before.x}, ${before.y}).`
        )
        // The tile ahead will not let the character through — a creature, or a
        // cache that disagrees with the server. Learn it and route around it.
        if (stalls >= MAX_STALLS) {
          blocked.add(tileKey(before.mapId, step.x, step.y))
          log.info('walker', `Cannot pass (${step.x}, ${step.y}); routing around.`)
          stalls = 0
          stallKey = ''
        }
        continue
      }

      run.lastPosition = after

      // The warp took: the map changed to the leg's destination.
      if (after.mapId === leg.toMapId) {
        run.stepsTaken++
        stalls = 0
        facing = step.direction
        log.info('walker', `Warped to map ${after.mapId}.`)
        if (!isWarpStep) {
          // The step was aimed short of the graph's warp tile and fired
          // anyway: the real warp is where the step landed. Say so, so the
          // graph can be corrected.
          // Under lag two presses can land as one, so the aimed tile may be
          // one short of where the character stood when the warp fired.
          log.warn(
            'walker',
            `Warp to map ${after.mapId} fired on the step aimed at (${step.x}, ${step.y}); the graph names (${best.warp.x}, ${best.warp.y}).`
          )
        }
        publish(run)
        continue
      }

      // An unexpected map is something else moving the character (WP15 decision 5).
      if (after.mapId !== before.mapId) {
        log.warn(
          'walker',
          `Map changed to ${after.mapId}, not the ${leg.toMapId} asked for. Stopping.`
        )
        return { kind: 'stopped', reason: 'lostPosition' }
      }

      // The step landed where it was aimed.
      if (after.x === step.x && after.y === step.y) {
        run.stepsTaken++
        stalls = 0
        facing = step.direction
        log.info(
          'walker',
          `Step ${DIRECTION_NAME[step.direction]} landed at (${after.x}, ${after.y}).`
        )
        publish(run)
        // A short settle before the next key, so it does not land mid-step and
        // get dropped by the client's own step cadence.
        await sleep(INTER_STEP_MS)
        continue
      }

      // Same map, and it moved more than one tile. If the move is along the
      // pressed direction, these are the walker's own steps confirming in a
      // batch under lag — progress, not something else. Accept it and re-plan
      // from where the character actually is.
      const dx = after.x - before.x
      const dy = after.y - before.y
      const [sdx, sdy] = DIRECTION_DELTA[step.direction]!
      const alongStep =
        (sdx === 0 ? dx === 0 : Math.sign(dx) === sdx) &&
        (sdy === 0 ? dy === 0 : Math.sign(dy) === sdy)
      const magnitude = Math.abs(dx) + Math.abs(dy)
      if (alongStep && magnitude <= MAX_CATCHUP) {
        run.stepsTaken += magnitude
        stalls = 0
        facing = step.direction
        log.info(
          'walker',
          `Caught up ${magnitude} tiles ${DIRECTION_NAME[step.direction]} to (${after.x}, ${after.y}).`
        )
        publish(run)
        await sleep(INTER_STEP_MS)
        continue
      }

      // A move that is not along the pressed direction is something else moving
      // the character (WP15 decision 5).
      log.warn('walker', `Position jumped to (${after.x}, ${after.y}) without a step. Stopping.`)
      return { kind: 'stopped', reason: 'lostPosition' }
    }
  }

  /**
   * Walk the last stretch to `destTile` on the current map, or to a tile
   * beside it.
   *
   * The map walk stops on the destination map at whatever tile the route
   * reached. An errand needs the character at the NPC, and a user may name a
   * spot to stand on, so this steps the rest of the way. `arrive` says which:
   * `on` ends on the tile itself (a spot in front of a counter); `beside` ends
   * next to it (an NPC's own tile, which is occupied). It follows the same
   * step-and-confirm rule as the map walk: one key, one confirmation, re-plan
   * when a step does not land, and stop when something else moves the
   * character. It is simpler than the map walk because there is no warp.
   */
  async function approachTile(
    run: Run,
    target: ActionTarget,
    destMapId: number,
    destTile: { x: number; y: number },
    arrive: 'on' | 'beside'
  ): Promise<WalkOutcome> {
    let stalls = 0
    let stallKey = ''
    let facing = -1
    const blocked = new Set<string>()

    // Where the walk ends: the tile itself, or one of its four neighbours.
    const goals =
      arrive === 'on'
        ? [destTile]
        : [
            { x: destTile.x, y: destTile.y - 1 },
            { x: destTile.x + 1, y: destTile.y },
            { x: destTile.x, y: destTile.y + 1 },
            { x: destTile.x - 1, y: destTile.y }
          ]
    const isAdjacent = (x: number, y: number): boolean =>
      arrive === 'on'
        ? x === destTile.x && y === destTile.y
        : Math.abs(x - destTile.x) + Math.abs(y - destTile.y) === 1

    for (;;) {
      if (!run.running) return { kind: 'stopped', reason: run.stopReason ?? 'user' }
      if (actionLayer.stopped) return { kind: 'stopped', reason: run.stopReason ?? 'user' }
      if (!hasLiveCharacter(run.connectionId)) return { kind: 'stopped', reason: 'lostCharacter' }

      let position = positionFor(run.connectionId)
      if (position === null || position.confidence === 'unknown') {
        position = await waitKnown(run.connectionId, WAIT_KNOWN_MS)
        if (position === null) return { kind: 'stopped', reason: 'lostPosition' }
      }
      if (facing === -1) facing = position.facing
      run.lastPosition = position

      // Something else moved the character off the destination map.
      if (position.mapId !== destMapId) return { kind: 'stopped', reason: 'lostPosition' }

      // At the goal: done.
      if (isAdjacent(position.x, position.y)) {
        publish(run)
        return { kind: 'arrived' }
      }

      if (position.mapWidth === undefined || position.mapHeight === undefined) {
        return { kind: 'stopped', reason: 'lostPosition' }
      }

      const rawGrid = await maps.gridFor(position.mapId, position.mapWidth, position.mapHeight)
      if (rawGrid === null) return { kind: 'stopped', reason: 'blocked' }
      const grid = gridWithBlocks(rawGrid, position.mapId, blocked)

      // A* to the nearest reachable tile beside the NPC.
      let best: PathStep[] | null = null
      for (const goal of goals) {
        const path = findPath(grid, { x: position.x, y: position.y }, goal)
        if (path !== null && path.length > 0 && (best === null || path.length < best.length)) {
          best = path
        }
      }
      if (best === null) {
        log.warn('walker', `No route to a tile beside (${destTile.x}, ${destTile.y}); blocked.`)
        return { kind: 'stopped', reason: 'blocked' }
      }

      const step = best[0]!
      const isTurn = step.direction !== facing
      const before = position
      const beforeAt = before.asOfMs

      const refusal = await actionLayer.pressKey(target, DIRECTION_KEY[step.direction]!)
      if (refusal !== null) {
        if (refusal === 'stopped') return { kind: 'stopped', reason: run.stopReason ?? 'user' }
        if (refusal === 'rateLimited') {
          await sleep(POLL_MS)
          continue
        }
        return { kind: 'stopped', reason: 'lostCharacter' }
      }

      const after = await waitFor(
        run.connectionId,
        (p) =>
          p !== null &&
          p.asOfMs > beforeAt &&
          (p.mapId !== before.mapId ||
            (p.x === step.x && p.y === step.y) ||
            Math.abs(p.x - before.x) + Math.abs(p.y - before.y) > 1 ||
            (isTurn && p.facing === step.direction && p.x === before.x && p.y === before.y)),
        STEP_CONFIRM_MS
      )

      // The wire said the press was a turn.
      if (
        after !== null &&
        after.mapId === before.mapId &&
        after.x === before.x &&
        after.y === before.y
      ) {
        facing = step.direction
        run.lastPosition = after
        continue
      }

      if (after === null) {
        // A press in a new direction only turns the character, which is not a
        // stall. A press in the way it faces that does not move is a stall.
        if (isTurn) {
          facing = step.direction
          continue
        }
        ;({ stalls, stallKey } = bumpStall(stalls, stallKey, before))
        if (stalls >= MAX_STALLS) {
          blocked.add(tileKey(before.mapId, step.x, step.y))
          log.info('walker', `Cannot pass (${step.x}, ${step.y}); routing around.`)
          stalls = 0
          stallKey = ''
        }
        continue
      }

      run.lastPosition = after

      // Left the map without being asked to.
      if (after.mapId !== before.mapId) return { kind: 'stopped', reason: 'lostPosition' }

      const dx = after.x - before.x
      const dy = after.y - before.y
      const [sdx, sdy] = DIRECTION_DELTA[step.direction]!
      const alongStep =
        (sdx === 0 ? dx === 0 : Math.sign(dx) === sdx) &&
        (sdy === 0 ? dy === 0 : Math.sign(dy) === sdy)
      const magnitude = Math.abs(dx) + Math.abs(dy)
      if ((after.x === step.x && after.y === step.y) || (alongStep && magnitude <= MAX_CATCHUP)) {
        run.stepsTaken += Math.max(1, magnitude)
        stalls = 0
        facing = step.direction
        publish(run)
        await sleep(INTER_STEP_MS)
        continue
      }

      // A move that is not along the pressed direction is something else moving
      // the character.
      log.warn('walker', `Position jumped to (${after.x}, ${after.y}) without a step. Stopping.`)
      return { kind: 'stopped', reason: 'lostPosition' }
    }
  }

  /**
   * From a warp tile that did not fire, step one tile further the way the
   * character came, in case the real warp is there.
   *
   * Returns `warped` when the map changed to `toMapId`, `stayed` when the step
   * could not be taken or landed with no warp (the loop then re-plans), or
   * `stopped`.
   */
  async function stepBeyond(
    run: Run,
    target: ActionTarget,
    grid: MapGrid,
    at: Position,
    direction: number,
    toMapId: number
  ): Promise<'warped' | 'stayed' | 'stopped'> {
    const delta = DIRECTION_DELTA[direction]
    if (delta === undefined || !grid.canMove(at.x, at.y, direction)) return 'stayed'
    const nx = at.x + delta[0]
    const ny = at.y + delta[1]
    log.info(
      'walker',
      `Warp tile (${at.x}, ${at.y}) did not fire; trying one tile ${DIRECTION_NAME[direction]} at (${nx}, ${ny}).`
    )
    const refusal = await actionLayer.pressKey(target, DIRECTION_KEY[direction]!)
    if (refusal === 'stopped') return 'stopped'
    if (refusal !== null) return 'stayed'
    const after = await waitFor(
      run.connectionId,
      (p) =>
        p !== null &&
        p.asOfMs > at.asOfMs &&
        (p.mapId !== at.mapId || p.x !== at.x || p.y !== at.y),
      WARP_CONFIRM_MS
    )
    if (after === null) return 'stayed'
    run.lastPosition = after
    if (after.mapId === toMapId) {
      log.warn(
        'walker',
        `Warp to map ${toMapId} fired at (${nx}, ${ny}); the graph names (${at.x}, ${at.y}). Correct the graph.`
      )
      return 'warped'
    }
    return 'stayed'
  }

  /** Count a stall, resetting when the character has moved to a new place. */
  function bumpStall(
    stalls: number,
    stallKey: string,
    position: Position
  ): { stalls: number; stallKey: string } {
    const key = `${position.mapId}:${position.x}:${position.y}`
    if (key !== stallKey) return { stalls: 1, stallKey: key }
    return { stalls: stalls + 1, stallKey: key }
  }

  /** End a run: disarm the layer, publish the final state, and log it. */
  function finish(run: Run, outcome: WalkOutcome): void {
    run.running = false
    runs.delete(run.connectionId)
    actionLayer.disarm(run.connectionId)
    const reason =
      outcome.kind === 'arrived' ? 'the character arrived' : walkStopReasonText(outcome.reason)
    publish(run, reason)
    log.info('walker', `Walker on ${run.connectionId} ended: ${reason}.`)
  }

  async function go(request: WalkRequest): Promise<WalkOutcome> {
    const connectionId = request.connectionId
    const destMapId = graph.resolveDestination(request.destination)
    const destination = String(request.destination)

    // A run object exists as soon as the walk is asked for, so a stop mid-plan
    // still finds it.
    if (runs.has(connectionId)) stop(connectionId)
    const run: Run = { connectionId, destination, running: true, stepsTaken: 0 }
    runs.set(connectionId, run)

    if (destMapId === null) {
      const outcome: WalkOutcome = { kind: 'stopped', reason: 'noRoute' }
      finish(run, outcome)
      return outcome
    }
    if (!hasLiveCharacter(connectionId)) {
      const outcome: WalkOutcome = { kind: 'stopped', reason: 'lostCharacter' }
      finish(run, outcome)
      return outcome
    }

    const armed = actionLayer.arm(connectionId, (reason) => {
      run.stopReason = classifyLayerStop(reason)
      run.running = false
    })
    if (typeof armed === 'string') {
      const outcome: WalkOutcome = {
        kind: 'stopped',
        reason: armed === 'stopped' ? 'user' : 'lostCharacter'
      }
      finish(run, outcome)
      return outcome
    }

    log.info('walker', `Walker started on ${connectionId} to ${destination} (map ${destMapId}).`)
    publish(run)

    let outcome: WalkOutcome
    try {
      outcome = await runLoop(run, destMapId, armed)
      // Once on the destination map, step the last stretch to the NPC's tile.
      if (outcome.kind === 'arrived' && request.tile !== undefined) {
        outcome = await approachTile(
          run,
          armed,
          destMapId,
          request.tile,
          request.arrive ?? 'beside'
        )
      }
    } catch (error) {
      log.warn('walker', `Walker on ${connectionId} threw: ${String(error)}.`)
      outcome = { kind: 'stopped', reason: 'blocked' }
    }
    finish(run, outcome)
    return outcome
  }

  function stop(connectionId: string): void {
    const run = runs.get(connectionId)
    if (run === undefined) return
    run.stopReason = 'user'
    run.running = false
  }

  return {
    destinations(): WalkerDestination[] {
      const named = graph.destinations()
      // A spot is a map name with a tile, in the form the destination box
      // parses. It is offered once, even when several errands share it.
      const seen = new Set<string>()
      const spots: WalkerDestination[] = []
      for (const spot of options.spots?.() ?? []) {
        const mapId = graph.resolveDestination(spot.destination)
        if (mapId === null) continue
        const place = named.find((d) => d.mapId === mapId)?.name ?? String(spot.destination)
        const name = `${place} @ ${spot.tile.x},${spot.tile.y}`
        if (seen.has(name)) continue
        seen.add(name)
        spots.push({ mapId, name })
      }
      return [...named, ...spots].sort((a, b) => a.name.localeCompare(b.name))
    },
    go,
    stop,
    states(): WalkerState[] {
      return [...runs.values()].map((run) => ({
        connectionId: run.connectionId,
        running: run.running,
        destination: run.destination,
        ...(run.lastPosition !== undefined ? { position: toWalkerPosition(run.lastPosition) } : {}),
        ...(run.nextWarp !== undefined ? { nextWarp: run.nextWarp } : {}),
        stepsTaken: run.stepsTaken
      }))
    },
    dispose(): void {
      for (const connectionId of [...runs.keys()]) {
        const run = runs.get(connectionId)
        if (run !== undefined) run.running = false
        runs.delete(connectionId)
        actionLayer.disarm(connectionId)
      }
    }
  }
}

/** A short line for the final state's reason field. */
function walkStopReasonText(reason: WalkStopReason): string {
  switch (reason) {
    case 'user':
      return 'you stopped it'
    case 'lostCharacter':
      return 'the character logged off or the window closed'
    case 'lostPosition':
      return 'it lost track of the character'
    case 'blocked':
      return 'it could not get through'
    case 'noRoute':
      return 'there is no route there'
  }
}
