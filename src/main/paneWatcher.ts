import type { PointerState } from 'da-pcap'
import type { ActionTarget } from '../shared/actionLayer'
import { GAME_HEIGHT, GAME_WIDTH, type LiveConnection } from './actionLayer'
import type { Logger } from './log'
import type { DialogState } from './model/dialog'
import type { FieldMapState } from './model/fieldMap'

/**
 * The pane watcher: while a world map or an NPC dialog is open, write down
 * where the user clicks by hand, and pair each click with what the client
 * then sends.
 *
 * The wire says which point a click selected (CFieldMapClick 0x3F carries the
 * map id; CMerchant 0x39 and CPursuit 0x3A carry the row) but not where on
 * the screen the click was. When the walker's own click misses a point and
 * the user takes over, or when the Laborer needs to learn where a dialog's
 * rows are, the pair "released at (x, y); the client sent N" is what tells
 * the next attempt where the target really is. So this reads the real pointer
 * and the real button through the operating system (never the client's
 * memory) and logs each release inside the game window while a pane is open.
 * A posted click moves nothing there, so Midir's own clicks never show up
 * here.
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
  /** The NPC dialog on screen, from the capture service. Absent in older tests. */
  dialogFor?: (connectionId: string) => DialogState | null
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

/** The same, for the NPC dialog on a connection. */
interface WatchedDialog {
  leftDown: boolean
  lastClick?: { gameX: number; gameY: number; atMs: number }
  /** Capture time of the last 0x39 or 0x3A written to the log. */
  lastAnsweredAt?: number
}

/** Name the row a client answer chose, from the dialog it answered. */
function describeAnswer(dialog: DialogState): string {
  const answer = dialog.answer!.packet
  const shown = dialog.packet
  if (answer.kind === 'merchantResponse') {
    if (shown.kind === 'npcMenu') {
      const index = shown.options.findIndex((o) => o.pursuit === answer.pursuit)
      if (index >= 0) return `row ${index + 1} "${shown.options[index]!.text}" (${answer.pursuit})`
    }
    return `pursuit ${answer.pursuit}`
  }
  if (answer.choice !== undefined) {
    const text =
      shown.kind === 'pursuitMessage' ? shown.options?.[answer.choice - 1]?.text : undefined
    return `choice ${answer.choice}${text !== undefined ? ` "${text}"` : ''}`
  }
  if (answer.text !== undefined) return `text "${answer.text}"`
  return `step ${answer.step}`
}

/** How often to look while a pane is open, in milliseconds. A click lasts longer than this. */
const DEFAULT_INTERVAL_MS = 30

export function createPaneWatcher(options: PaneWatcherOptions): PaneWatcher {
  const { pointerIn, resolveTarget, liveConnections, fieldMapFor, log } = options
  const dialogFor = options.dialogFor ?? ((): null => null)
  const now = options.now ?? Date.now
  const watched = new Map<string, Watched>()
  const watchedDialogs = new Map<string, WatchedDialog>()
  let timer: NodeJS.Timeout | undefined

  /**
   * The dialog side. A hand release on the game window while a dialog is up
   * is logged in game coordinates, and the client's answer that follows is
   * paired with it: that pair is where the row is.
   */
  function tickDialog(connectionId: string): void {
    const dialog = dialogFor(connectionId)
    if (dialog === null) {
      watchedDialogs.delete(connectionId)
      return
    }
    const state = watchedDialogs.get(connectionId) ?? { leftDown: false }
    watchedDialogs.set(connectionId, state)

    const answer = dialog.answer
    if (answer !== undefined && answer.asOfMs !== state.lastAnsweredAt) {
      state.lastAnsweredAt = answer.asOfMs
      const hand = state.lastClick
      const what = describeAnswer(dialog)
      if (hand !== undefined && answer.asOfMs - hand.atMs <= PAIR_WINDOW_MS) {
        log.info(
          'pane',
          `The client answered the dialog with ${what}, ${answer.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}).`
        )
      } else {
        log.info(
          'pane',
          `The client answered the dialog with ${what} with no hand click before it.`
        )
      }
    }

    const target = resolveTarget(connectionId)
    if (target === null) return
    const pointer = pointerIn(target.windowHandle)
    if (pointer === null) return
    if (state.leftDown && !pointer.leftDown && pointer.inside) {
      const gameX = Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width))
      const gameY = Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height))
      state.lastClick = { gameX, gameY, atMs: now() }
      const shown = dialog.packet
      const rows = shown.kind === 'npcMenu' ? shown.options.length : (shown.options?.length ?? 0)
      log.info(
        'pane',
        `Hand click released at game (${gameX}, ${gameY}) on the dialog from ${shown.npcName || 'an NPC'} (${rows} rows).`
      )
    }
    state.leftDown = pointer.leftDown
  }

  function tick(): void {
    const live = new Set<string>()
    for (const { connectionId } of liveConnections()) {
      live.add(connectionId)
      tickDialog(connectionId)
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
    for (const id of [...watchedDialogs.keys()]) if (!live.has(id)) watchedDialogs.delete(id)
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
