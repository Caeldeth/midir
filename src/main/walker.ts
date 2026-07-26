import type {
  ActionTarget,
  WalkerDestination,
  WalkerPosition,
  WalkerState,
  WalkOutcome,
  WalkRequest,
  WalkStopReason
} from '../shared/actionLayer'
import type { ActionLayer, LiveConnection } from './actionLayer'
import type { Logger } from './log'
import type { Position } from './model/position'
import type { RouteGraph } from './route/graph'
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
  /** The source of a map's passability. */
  maps: MapProvider
  /** The between-maps route graph. */
  graph: RouteGraph
  log: Logger
  /** Called whenever a walker changes, so main can push it. */
  onState?: (state: WalkerState) => void
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
}

/** The key for one tile in the run's learned-blocked set. */
function tileKey(mapId: number, x: number, y: number): string {
  return `${mapId}:${x}:${y}`
}

/**
 * Wrap a map grid so it also refuses a move into a tile the walker learned is
 * impassable this run.
 *
 * The disk map cache does not see a creature standing in a doorway, or a tile
 * the server blocks though the cache calls it open. When a step stalls at one
 * tile, the walker adds that tile here and re-plans around it.
 */
function gridWithBlocks(grid: MapGrid, mapId: number, blocked: Set<string>): MapGrid {
  return {
    width: grid.width,
    height: grid.height,
    inBounds: grid.inBounds,
    canMove: (x, y, direction) => {
      if (!grid.canMove(x, y, direction)) return false
      const delta = DIRECTION_DELTA[direction]
      if (delta === undefined) return false
      return !blocked.has(tileKey(mapId, x + delta[0], y + delta[1]))
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
      // Route around the tiles this run has learned it cannot get through.
      const grid = gridWithBlocks(rawGrid, position.mapId, blocked)

      // Pick the nearest warp tile the character can actually path to.
      let best: { warp: { x: number; y: number }; path: PathStep[] } | null = null
      for (const warp of leg.warps) {
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
        // Standing on the warp tile, but the map has not changed yet. Wait for
        // the warp to take, then let the next iteration see the new map.
        const warped = await waitFor(
          run.connectionId,
          (p) => p !== null && p.mapId === leg.toMapId && p.confidence === 'confirmed',
          WARP_CONFIRM_MS
        )
        if (warped !== null) {
          stalls = 0
          continue
        }
        // The warp did not take. After a few tries give up on this warp tile so
        // A* routes to another warp for the same leg, or stops if there is none.
        ;({ stalls, stallKey } = bumpStall(stalls, stallKey, before))
        if (stalls >= MAX_STALLS) {
          blocked.add(tileKey(before.mapId, before.x, before.y))
          log.info('walker', `Warp tile (${before.x}, ${before.y}) did not fire; routing around.`)
          stalls = 0
          stallKey = ''
        }
        continue
      }

      const step = best.path[0]
      const isWarpStep = step.x === best.warp.x && step.y === best.warp.y
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
      // or a jump of more than one tile.
      const timeout = isWarpStep ? WARP_CONFIRM_MS : STEP_CONFIRM_MS
      const after = await waitFor(
        run.connectionId,
        (p) =>
          p !== null &&
          p.asOfMs > beforeAt &&
          (p.mapId !== before.mapId ||
            (p.x === step.x && p.y === step.y) ||
            Math.abs(p.x - before.x) + Math.abs(p.y - before.y) > 1),
        timeout
      )

      if (after === null) {
        // The tile did not change. A press in a new direction only turned the
        // character, which is not a stall: the next press in this direction
        // steps. A press in the way it already faces that does not move is a
        // real stall — a wall, a door, a creature, a freeze (WP15 decision 3).
        if (isTurn) {
          facing = step.direction
          log.info(
            'walker',
            `Turned to face ${DIRECTION_NAME[step.direction]} at (${before.x}, ${before.y}); will step next.`
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
      return graph.destinations()
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
