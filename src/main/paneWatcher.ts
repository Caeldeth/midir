import type { PointerState } from 'da-pcap'
import type { ActionTarget } from '../shared/actionLayer'
import { GAME_HEIGHT, GAME_WIDTH, type LiveConnection } from './actionLayer'
import type { Logger } from './log'
import type { FieldMapState } from './model/fieldMap'

/**
 * The pane watcher: while a world map is open, write down where the user
 * clicks by hand, and pair each click with the point the client then sends.
 *
 * The wire says which point a click selected (CFieldMapClick 0x3F carries the
 * map id) but not where on the screen the click was. When the walker's own
 * click misses a point and the user takes over, the pair "released at (x, y);
 * the client sent map N" is what tells the next attempt where the point
 * really is. So this reads the real pointer and the real button through the
 * operating system (never the client's memory) and logs each release inside
 * the game window while a pane is open. A posted click moves nothing there,
 * so the walker's own clicks never show up here.
 *
 * It is a diagnostic. It drives nothing and changes no state but its own.
 */

/** How long after a hand click a 0x3F is still credited to it, in milliseconds. */
const PAIR_WINDOW_MS = 12000

export interface PaneWatcherOptions {
  /** The real pointer in a window. From the addon. */
  pointerIn: (handle: number) => PointerState | null
  /** The window a connection is driven through, or null. From the action layer. */
  resolveTarget: (connectionId: string) => ActionTarget | null
  /** The connections that carry a live character now. */
  liveConnections: () => LiveConnection[]
  /** The world map on screen, from the capture service. */
  fieldMapFor: (connectionId: string) => FieldMapState | null
  log: Logger
  /** The clock. Injected by tests. */
  now?: () => number
}

export interface PaneWatcher {
  /** One observation. Called on an interval by main, directly by tests. */
  tick(): void
  /** Start the interval. */
  start(intervalMs?: number): void
  /** Stop the interval. */
  stop(): void
}

interface Watched {
  /** The button state at the last tick, to see a release. */
  leftDown: boolean
  /** The last hand click's release, in window and in game coordinates, for the pairing. */
  lastClick?: { x: number; y: number; gameX: number; gameY: number; atMs: number }
  /** Capture time of the last 0x3F written to the log. */
  lastAnsweredAt?: number
}

/** How often to look while a pane is open, in milliseconds. A click lasts longer than this. */
const DEFAULT_INTERVAL_MS = 30

export function createPaneWatcher(options: PaneWatcherOptions): PaneWatcher {
  const { pointerIn, resolveTarget, liveConnections, fieldMapFor, log } = options
  const now = options.now ?? Date.now
  const watched = new Map<string, Watched>()
  let timer: NodeJS.Timeout | undefined

  function tick(): void {
    const live = new Set<string>()
    for (const { connectionId } of liveConnections()) {
      live.add(connectionId)
      const pane = fieldMapFor(connectionId)
      if (pane === null) {
        // The pane closed. When a hand click came just before, the map change
        // is its answer, even when the 0x3F fell between two looks here.
        const gone = watched.get(connectionId)
        const hand = gone?.lastClick
        if (hand !== undefined && gone?.lastAnsweredAt === undefined) {
          const age = now() - hand.atMs
          if (age <= PAIR_WINDOW_MS) {
            log.info(
              'pane',
              `The world map closed ${age} ms after the hand click at game (${hand.gameX}, ${hand.gameY}).`
            )
          }
        }
        watched.delete(connectionId)
        continue
      }
      const state = watched.get(connectionId) ?? { leftDown: false }
      watched.set(connectionId, state)

      // The client's answer, paired with the hand click before it when there
      // was one recent enough.
      const click = pane.click
      if (click !== undefined && click.asOfMs !== state.lastAnsweredAt) {
        state.lastAnsweredAt = click.asOfMs
        const sent = click.packet
        const hand = state.lastClick
        if (hand !== undefined && click.asOfMs - hand.atMs <= PAIR_WINDOW_MS) {
          log.info(
            'pane',
            `The client sent map ${sent.mapId} at (${sent.x}, ${sent.y}), ${click.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}).`
          )
        } else {
          log.info(
            'pane',
            `The client sent map ${sent.mapId} at (${sent.x}, ${sent.y}) with no hand click before it.`
          )
        }
      }

      const target = resolveTarget(connectionId)
      if (target === null) continue
      const pointer = pointerIn(target.windowHandle)
      if (pointer === null) continue
      // A release inside the client area is a hand click. The window may be
      // larger than the game's 640 x 480, so the release is also given in
      // game coordinates, which is what the pane's points are in.
      if (state.leftDown && !pointer.leftDown && pointer.inside) {
        const gameX = Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width))
        const gameY = Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height))
        state.lastClick = { x: pointer.x, y: pointer.y, gameX, gameY, atMs: now() }
        const under = pane.packet.points.find(
          (p) => Math.abs(p.screenX - gameX) <= 40 && Math.abs(p.screenY - gameY) <= 20
        )
        const scaled =
          pointer.width !== GAME_WIDTH || pointer.height !== GAME_HEIGHT
            ? ` = game (${gameX}, ${gameY}) in a ${pointer.width} x ${pointer.height} window`
            : ''
        log.info(
          'pane',
          `Hand click released at (${pointer.x}, ${pointer.y})${scaled} on the world map${under !== undefined ? `, near "${under.name}" (${under.screenX}, ${under.screenY}) for map ${under.mapId}` : ''}.`
        )
      }
      state.leftDown = pointer.leftDown
    }
    for (const id of [...watched.keys()]) if (!live.has(id)) watched.delete(id)
  }

  return {
    tick,
    start(intervalMs = DEFAULT_INTERVAL_MS): void {
      if (timer !== undefined) return
      timer = setInterval(tick, intervalMs)
    },
    stop(): void {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }
  }
}
