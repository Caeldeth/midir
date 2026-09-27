import {
  DEFAULT_EXPLORER_BUDGET,
  DEFAULT_STALE_DAYS,
  explorerStopMessage,
  MAX_EXPLORER_MAPS,
  MAX_EXPLORER_MINUTES,
  type ExplorerBudget,
  type ExplorerOutcome,
  type ExplorerRequest,
  type ExplorerScope,
  type ExplorerState,
  type ExplorerStopReason,
  type WalkStopReason
} from '../shared/actionLayer'
import { messageOf, type Logger } from './log'
import type { Position } from './model/position'
import type { RouteGraph } from './route/graph'
import type { Walker } from './walker'

/**
 * The explorer: a queue in front of the walker (WP41).
 *
 * It is a scheduler and a stop policy, and nothing else. Every step it takes is
 * the walker's own `go`, so it posts what the walker posts, through the same
 * action layer, and it sends no packet. What it collects, it collects by
 * arriving: the map's own name, its size, its music track (WP40), and the
 * crossing of a warp the world XML only proposed (WP24).
 *
 * **It confirms edges and does not discover them.** The frontier is what the
 * graph can already reach, so a map behind a warp nobody has crossed stays out
 * of reach. Walking a map's tiles to find an unknown warp is a different
 * feature with a different cost, and it is not here.
 *
 * **The stop policy is the load-bearing part.** The walker stops for the window
 * closing, focus loss, the stop hotkey, and a dialog it cannot close, and each
 * of those arrives here as a walk outcome. On top of them, a run stops of its
 * own accord when the character loses health, when it spends its budget of maps
 * or of minutes, and when the frontier empties. There is no unattended mode:
 * the budget is small by default, and MAX_EXPLORER_MINUTES bounds what a caller
 * may ask for.
 *
 * Retail maps hold monsters, and a character that walks into a hunting ground
 * will be attacked. The health stop and the skip list are what that costs.
 */

export interface ExplorerOptions {
  walker: Walker
  /** The route graph. Read at every pick, so an edge learned mid-run counts. */
  graph: () => RouteGraph
  /**
   * The maps the stores hold a reading for, and when each was read. Read at
   * every pick; the time is what a `stale` run works from.
   */
  readings: () => Promise<Map<number, number>>
  /**
   * The maps that hold monsters (`route/hostile.ts`). Read at every pick, so a
   * name the wire corrects mid-run counts. Absent means none are known, and then
   * `avoidHostile` has nothing to avoid.
   */
  hostileMaps?: () => Set<number>
  /** Where a character stands, from the capture service. */
  positionFor: (connectionId: string) => Position | null
  /**
   * The character's health, from the capture service. Absent, or null for a
   * connection, means unknown, and unknown health stops nothing: the run then
   * leans on the walker's own stops.
   */
  healthFor?: (connectionId: string) => { current: number; max: number } | null
  log: Logger
  /** Called whenever a run changes, so main can push it. */
  onState?: (state: ExplorerState) => void
  /** The clock. Injected by tests. */
  now?: () => number
}

export interface Explorer {
  /** Explore from where a character stands. Resolves with how the run ended. */
  run(request: ExplorerRequest): Promise<ExplorerOutcome>
  /** Stop the run on one connection. */
  stop(connectionId: string): void
  /** Every run now in progress. */
  states(): ExplorerState[]
  /** Stop every run quietly. Called on shutdown. */
  dispose(): void
}

/**
 * Whether a walk that did not arrive costs one map or the whole run.
 *
 * Blocked, no route, and a gate's refusal are facts about one map. Every other
 * reason is a fact about the session, and the run ends on it.
 */
function skipOnly(reason: WalkStopReason): boolean {
  return reason === 'blocked' || reason === 'noRoute' || reason === 'gated'
}

/** The run-ending reason one of the walker's own stops maps to. */
function endReason(reason: WalkStopReason): ExplorerStopReason {
  switch (reason) {
    case 'lostCharacter':
      return 'lostCharacter'
    case 'lostPosition':
      return 'lostPosition'
    case 'dialog':
      return 'dialog'
    case 'protected':
      return 'protected'
    default:
      return 'user'
  }
}

/** Hold a caller's budget inside what one run is allowed to spend. */
export function boundBudget(budget?: Partial<ExplorerBudget>): ExplorerBudget {
  const maps = budget?.maps ?? DEFAULT_EXPLORER_BUDGET.maps
  const minutes = budget?.minutes ?? DEFAULT_EXPLORER_BUDGET.minutes
  return {
    maps: Math.max(1, Math.min(MAX_EXPLORER_MAPS, Math.floor(maps))),
    minutes: Math.max(1, Math.min(MAX_EXPLORER_MINUTES, Math.floor(minutes)))
  }
}

/** The next map to visit, or the fact that there is none. */
interface Target {
  mapId: number
  name: string
  /** How many unread maps the graph can still reach, this one included. */
  remaining: number
  /** How many maps in the whole graph have no reading, in reach or not. */
  unread: number
  /** Unread maps on the way there, the target itself included. */
  onPath: number
  /** Map changes to get there. */
  hops: number
}

interface Run {
  connectionId: string
  running: boolean
  budget: ExplorerBudget
  /** Whether this run keeps out of the maps that hold monsters. */
  avoidHostile: boolean
  /** What this run is looking for. */
  scope: ExplorerScope
  /** For a `stale` run: how old a reading may be before it goes back. */
  staleDays: number
  /**
   * Maps this run has already been sent to. A scope that goes back over read
   * ground would otherwise circle one map for its whole budget: an arrival does
   * not always change what made the map a target, and nothing else would stop it
   * being the nearest one again.
   */
  reached: Set<number>
  startedAtMs: number
  /** Maps read since the run began, however they came to be read. */
  visited: number
  remaining: number
  skipped: Set<number>
  /**
   * The read maps as the previous pick saw them. The difference at the next pick
   * is what this run learned, which counts the maps it crossed on the way and not
   * only the ones it was aiming at.
   */
  readSeen?: Set<number>
  target?: { mapId: number; name: string }
  reason?: ExplorerStopReason
  /** The lowest health seen so far, so a drop reads as a drop and not a recovery. */
  health?: number
  /** Set by `stop`, read between hops. */
  stopping: boolean
}

export function createExplorer(options: ExplorerOptions): Explorer {
  const runs = new Map<string, Run>()
  const now = options.now ?? Date.now

  function toState(run: Run): ExplorerState {
    return {
      connectionId: run.connectionId,
      running: run.running,
      visited: run.visited,
      remaining: run.remaining,
      skipped: run.skipped.size,
      budget: run.budget,
      avoidingHostile: run.avoidHostile,
      scope: run.scope,
      ...(run.target !== undefined ? { target: run.target } : {}),
      ...(run.reason !== undefined ? { reason: explorerStopMessage(run.reason) } : {})
    }
  }

  function publish(run: Run): void {
    options.onState?.(toState(run))
  }

  function nameOf(graph: RouteGraph, mapId: number): string {
    const node = graph.node(mapId)
    if (node === null) return String(mapId)
    if (node.gameName !== undefined && node.gameName !== '') return node.gameName
    if (node.name !== '') return node.name
    return String(mapId)
  }

  /**
   * The nearest map with no reading, from where the character stands now.
   *
   * Only a map the stores have never held is a target. A map that was visited
   * and stayed silent is not: the server sends a music track only when the
   * track changes, so a second visit teaches nothing and the run would circle
   * it for as long as its budget lasted.
   *
   * The sweep counts the edges the world XML only proposes, because the walker
   * plans over them too and crossing one is what confirms it (WP24). Without
   * them a run strands itself: from Mileth 224 maps are in reach, and 485 with
   * them.
   *
   * **The order is unread maps per walk, not distance.** Every map entry sends
   * its own `SMapSize 0x15`, so a map crossed on the way is read for free, and a
   * four-hop walk through four unread maps teaches four times what a one-hop dart
   * teaches. Distance is the tie-break, then the map id so a run repeats.
   *
   * Returns null when there is no position to start from, and a target with
   * `remaining` 0 when nothing unread is in reach — which `unread` then tells
   * apart: everything read, or stranded on a map with no known way on.
   */
  /**
   * The maps whose only way in is a warp the world XML proposed (WP24).
   *
   * It is a fact about the edges and not about where the character stands: a map
   * with no confirmed edge into it is one that no walk has ever entered by a way
   * Midir trusts, wherever the run happens to be. Reading it from the position
   * instead was wrong — once the character moved, every map behind it looked
   * unconfirmed, and a run that had finished reported itself stranded.
   */
  function unconfirmedMaps(graph: RouteGraph): Set<number> {
    const confirmed = new Set<number>()
    const proposed = new Set<number>()
    for (const node of graph.nodes()) {
      for (const exit of node.exits) confirmed.add(exit.toMapId)
      for (const exit of node.candidates ?? []) proposed.add(exit.toMapId)
    }
    const only = new Set<number>()
    for (const mapId of proposed) if (!confirmed.has(mapId)) only.add(mapId)
    return only
  }

  /** Whether this run wants this map, by its scope. */
  function wanted(
    run: Run,
    mapId: number,
    readings: Map<number, number>,
    unconfirmed: Set<number> | null
  ): boolean {
    if (run.reached.has(mapId) || run.skipped.has(mapId)) return false
    const seenAtMs = readings.get(mapId)
    switch (run.scope) {
      case 'unread':
        return seenAtMs === undefined
      case 'stale':
        return seenAtMs === undefined || now() - seenAtMs > run.staleDays * 86_400_000
      case 'unconfirmed':
        return unconfirmed !== null && unconfirmed.has(mapId)
    }
  }

  function pick(run: Run, readings: Map<number, number>): Target | null {
    const position = options.positionFor(run.connectionId)
    if (position === null) return null
    const graph = options.graph()
    // A hostile map is neither a target nor a crossing, so it leaves the sweep
    // at the same point the walker's own plan leaves it.
    const hostile = hostileFor(run)
    const passable = hostile.size > 0 ? { passable: (mapId: number) => !hostile.has(mapId) } : {}
    const paths = graph.pathsFrom(position.mapId, { useCandidates: true, ...passable })
    const unconfirmed = run.scope === 'unconfirmed' ? unconfirmedMaps(graph) : null

    // Unread maps along each map's own shortest path, the map included. The
    // sweep is in breadth-first order, so a map's predecessor is always counted
    // before the map itself and one pass is enough.
    const onPath = new Map<number, number>()
    const isWanted = (mapId: number): boolean => wanted(run, mapId, readings, unconfirmed)
    let best: { mapId: number; onPath: number; hops: number } | null = null
    let remaining = 0
    for (const [mapId, step] of paths) {
      const before = step.previous === undefined ? 0 : (onPath.get(step.previous) ?? 0)
      onPath.set(mapId, before + (isWanted(mapId) ? 1 : 0))
      if (mapId === position.mapId || !isWanted(mapId)) continue
      remaining += 1
      const here = { mapId, onPath: onPath.get(mapId) ?? 1, hops: step.distance }
      // Most unread maps per walk, then the nearest, then the lower map id so a
      // run is repeatable.
      if (
        best === null ||
        here.onPath > best.onPath ||
        (here.onPath === best.onPath && here.hops < best.hops) ||
        (here.onPath === best.onPath && here.hops === best.hops && mapId < best.mapId)
      ) {
        best = here
      }
    }
    // Unread anywhere in the graph, in reach or not. It is what separates a run
    // that finished from one that is stranded.
    let unread = 0
    for (const node of graph.nodes()) {
      if (hostile.has(node.mapId)) continue
      if (isWanted(node.mapId)) unread += 1
    }
    if (best === null) return { mapId: -1, name: '', remaining: 0, unread, onPath: 0, hops: 0 }
    return {
      mapId: best.mapId,
      name: nameOf(graph, best.mapId),
      remaining,
      unread,
      onPath: best.onPath,
      hops: best.hops
    }
  }

  /**
   * Count what the run has learned since the last turn, and remember the set.
   *
   * A map crossed on the way to somewhere else sends its own `SMapSize 0x15` and
   * is read as truly as the one the run aimed at, so what counts against the
   * budget is the store's own growth and not the number of arrivals.
   */
  function count(run: Run, read: Set<number>): void {
    if (run.readSeen === undefined) {
      run.readSeen = new Set(read)
      return
    }
    for (const mapId of read) {
      if (run.readSeen.has(mapId)) continue
      run.readSeen.add(mapId)
      run.visited += 1
    }
  }

  /** The maps this run keeps out of. Empty when it was told not to avoid any. */
  function hostileFor(run: Run): Set<number> {
    if (!run.avoidHostile) return new Set()
    return options.hostileMaps?.() ?? new Set()
  }

  /**
   * True when the character has lost health since the run last looked.
   *
   * The run remembers the lowest reading, so healing between hops does not hide
   * an earlier hit, and a character that started the run already hurt is not
   * stopped for the health it was missing when it began.
   */
  function hurt(run: Run): boolean {
    const health = options.healthFor?.(run.connectionId) ?? null
    if (health === null || health.max <= 0) return false
    const seen = run.health
    run.health = seen === undefined ? health.current : Math.min(seen, health.current)
    if (seen === undefined) return false
    return health.current < seen
  }

  function finish(run: Run, reason: ExplorerStopReason): ExplorerOutcome {
    run.running = false
    run.reason = reason
    delete run.target
    publish(run)
    runs.delete(run.connectionId)
    options.log.info(
      'explorer',
      `the run on ${run.connectionId} ended (${reason}) after ${run.visited} ` +
        `map${run.visited === 1 ? '' : 's'}, with ${run.skipped.size} set aside`
    )
    return { kind: 'ended', reason }
  }

  async function loop(run: Run): Promise<ExplorerOutcome> {
    for (;;) {
      if (run.stopping) return finish(run, 'user')
      if (now() - run.startedAtMs >= run.budget.minutes * 60_000) return finish(run, 'budget')
      if (hurt(run)) return finish(run, 'hurt')

      // One read of the store a turn: it says what the last walk taught, transit
      // included, and it is what the pick works from. The budget is checked after
      // the count, not before it.
      const readings = await options.readings()
      count(run, new Set(readings.keys()))
      const next = pick(run, readings)
      if (next === null) return finish(run, run.visited === 0 ? 'noPosition' : 'lostCharacter')
      if (next.remaining === 0) {
        // Nothing unread is in reach. Whether that is finished or stranded
        // depends on whether unread maps exist at all: a run that walks into a
        // map with no known way on used to report this as `done`.
        return finish(run, next.unread === 0 ? 'done' : 'stuck')
      }
      if (run.visited >= run.budget.maps) return finish(run, 'budget')

      run.target = { mapId: next.mapId, name: next.name }
      run.remaining = next.remaining
      publish(run)
      options.log.info(
        'explorer',
        `walking to ${next.name} (${next.mapId}), ${next.hops} map change` +
          `${next.hops === 1 ? '' : 's'} away and reading ${next.onPath} unread on the way; ` +
          `${next.remaining} unread and reachable`
      )

      const hostile = hostileFor(run)
      const outcome = await options.walker.go({
        connectionId: run.connectionId,
        destination: next.mapId,
        ...(hostile.size > 0 ? { avoid: [...hostile] } : {})
      })

      if (run.stopping) return finish(run, 'user')
      if (outcome.kind === 'arrived') {
        // What was learned is counted at the next pick, off the store, because
        // the maps crossed on the way were read as truly as the one aimed at.
        // The map itself is struck off here: a scope that goes back over read
        // ground has no other reason to stop asking for it.
        run.reached.add(next.mapId)
        publish(run)
        continue
      }
      if (!skipOnly(outcome.reason)) return finish(run, endReason(outcome.reason))

      // A `blocked` stop with no step taken is about the map the character
      // stands on, not the one it was sent to: nothing could leave. Setting the
      // target aside would condemn a good map and then the next, and the next —
      // one unwalkable map cost 13 of them in a third of a second (2026-09-27).
      if (outcome.reason === 'blocked' && (outcome.stepsTaken ?? 0) === 0) {
        options.log.warn(
          'explorer',
          `no step left the current map on the way to ${next.name} (${next.mapId}); the run stops` +
            ' rather than blaming the maps it was sent to'
        )
        return finish(run, 'stuck')
      }

      // One map the walker could not deliver. Set it aside and carry on: this
      // is the only way a run learns which maps it cannot have.
      run.skipped.add(next.mapId)
      options.log.warn(
        'explorer',
        `${next.name} (${next.mapId}) set aside, the walk stopped (${outcome.reason})`
      )
      publish(run)
    }
  }

  return {
    async run(request: ExplorerRequest): Promise<ExplorerOutcome> {
      if (runs.has(request.connectionId)) {
        throw new Error('The explorer is already running on this window.')
      }
      const run: Run = {
        connectionId: request.connectionId,
        running: true,
        budget: boundBudget(request.budget),
        // Avoiding is the default: a run cannot fight, so the cheapest way not
        // to die is not to go.
        avoidHostile: request.avoidHostile !== false,
        scope: request.scope ?? 'unread',
        staleDays: Math.max(1, Math.floor(request.staleDays ?? DEFAULT_STALE_DAYS)),
        reached: new Set<number>(),
        startedAtMs: now(),
        visited: 0,
        remaining: 0,
        skipped: new Set<number>(),
        stopping: false
      }
      runs.set(run.connectionId, run)
      publish(run)
      try {
        return await loop(run)
      } catch (error) {
        options.log.error('explorer', `the run on ${run.connectionId} failed: ${messageOf(error)}`)
        return finish(run, 'user')
      }
    },

    stop(connectionId: string): void {
      const run = runs.get(connectionId)
      if (run === undefined) return
      run.stopping = true
      // The walk in flight is what holds the character. Stopping it returns the
      // loop, which then reads `stopping` and ends the run.
      options.walker.stop(connectionId)
    },

    states(): ExplorerState[] {
      return [...runs.values()].map(toState)
    },

    dispose(): void {
      for (const run of [...runs.values()]) {
        run.stopping = true
        options.walker.stop(run.connectionId)
      }
    }
  }
}
