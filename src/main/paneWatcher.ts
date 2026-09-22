import type { PointerState } from 'da-pcap'
import type { ActionTarget } from '../shared/actionLayer'
import { GAME_HEIGHT, GAME_WIDTH, type LiveConnection } from './actionLayer'
import type { Logger } from './log'
import type { DialogAnswer, DialogState } from './model/dialog'
import type { ExchangeState } from './model/exchange'
import type { FieldMapState } from './model/fieldMap'
import type { Position } from './model/position'
import type { BoardState } from './model/board'
import { centreFromClick, tileAtPoint, type Tile } from './laborer/view'

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
  /** The client's newest dialog answer, from the capture service. Absent in older tests. */
  answerFor?: (connectionId: string) => DialogAnswer | null
  /** The character's position, from the capture service. Absent in older tests. */
  positionFor?: (connectionId: string) => Position | null
  /** The exchange window on screen, from the capture service. Absent in older tests. */
  exchangeFor?: (connectionId: string) => ExchangeState | null
  /** The NPC tiles the errands know, to turn a hand click on an NPC into the view centre. */
  knownNpcs?: () => { npcName: string; mapId: number; tile: Tile }[]
  /** The boards as the client shows them, from the capture service. Absent in older tests (WP36). */
  boardFor?: (connectionId: string) => BoardState | null
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
  /** Capture time of the last exchange cancel or accept written to the log. */
  lastExchangeSentAt?: number
  /** The last hand click on the world with no dialog up, and where the character stood. */
  worldClick?: { gameX: number; gameY: number; atMs: number; own: Tile; mapId: number }
  /** The right button's state at the last tick, to see a release. */
  rightDown?: boolean
  /**
   * A hand right-click on the world, watched until the character stops: the
   * tile it stops on against the tile the projection named is the check of
   * the projection the walker's own right-click uses (WP35).
   */
  rightWalk?: { aim: Tile; gameX: number; gameY: number; own: Tile; last: Position; atMs: number }
  /** The last hand click with a board pane up, for pairing with the client's next 0x3B (WP36). */
  boardClick?: { gameX: number; gameY: number; atMs: number; view: string }
  /** Capture time of the last board request written to the log. */
  lastBoardRequestAt?: number
  /** Capture time of the dialog last seen, to notice a new one. */
  lastDialogAt?: number
}

/** How long after a hand click on the world a dialog that opens is credited to it. */
const OPEN_WINDOW_MS = 2500
/** How long the character may stand still after a hand right-click before its walk is over. */
const RIGHT_WALK_SETTLE_MS = 2500
/**
 * How long after its last packet a board pane is taken to be up. The client
 * sends nothing when the pane is closed with Quit, so a hand click is logged
 * as a board click while the board state is this fresh.
 */
const BOARD_PANE_FRESH_MS = 5 * 60 * 1000

/** Name the row a client answer chose, from the dialog it answered. */
function describeAnswer(answered: DialogAnswer): string {
  const answer = answered.packet
  const shown = answered.dialog
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
  const answerFor = options.answerFor ?? ((): null => null)
  const positionFor = options.positionFor ?? ((): null => null)
  const exchangeFor = options.exchangeFor ?? ((): null => null)
  const knownNpcs = options.knownNpcs ?? ((): [] => [])
  const boardFor = options.boardFor ?? ((): null => null)
  const now = options.now ?? Date.now
  const watched = new Map<string, Watched>()
  const watchedDialogs = new Map<string, WatchedDialog>()
  let timer: NodeJS.Timeout | undefined

  /**
   * The dialog side. A hand release on the game window while a dialog is up
   * is logged in game coordinates, and the client's answer that follows is
   * paired with it: that pair is where the row is. The answer is read from
   * its own fact, because the dialog it answered is usually gone by the next
   * look here: the server's reply follows within tens of milliseconds and the
   * capture delivers both in one batch.
   */
  function tickDialog(connectionId: string): void {
    const state = watchedDialogs.get(connectionId) ?? { leftDown: false }
    watchedDialogs.set(connectionId, state)

    const answer = answerFor(connectionId)
    if (answer !== null && answer.asOfMs !== state.lastAnsweredAt) {
      state.lastAnsweredAt = answer.asOfMs
      const hand = state.lastClick
      const what = describeAnswer(answer)
      // The client acts on the press, so its answer can be captured a few
      // milliseconds before the release is seen here; the window runs both ways.
      if (hand !== undefined && Math.abs(answer.asOfMs - hand.atMs) <= PAIR_WINDOW_MS) {
        log.info(
          'pane',
          `The client answered the dialog with ${what}, ${answer.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}).`
        )
        state.lastClick = undefined
      } else {
        log.info(
          'pane',
          `The client answered the dialog with ${what} with no hand click before it.`
        )
      }
    }

    const dialog = dialogFor(connectionId)

    // A dialog that opened just after a hand click on the world: that click
    // was on the NPC, and with the NPC's tile known it measures the view
    // centre the Laborer's own NPC click needs.
    if (dialog !== null && dialog.asOfMs !== state.lastDialogAt) {
      state.lastDialogAt = dialog.asOfMs
      const hand = state.worldClick
      if (hand !== undefined && Math.abs(dialog.asOfMs - hand.atMs) <= OPEN_WINDOW_MS) {
        state.worldClick = undefined
        const shown = dialog.packet
        const npc = knownNpcs().find((n) => n.npcName === shown.npcName && n.mapId === hand.mapId)
        const centre =
          npc !== undefined
            ? centreFromClick({ x: hand.gameX, y: hand.gameY }, hand.own, npc.tile)
            : undefined
        log.info(
          'pane',
          `The dialog from ${shown.npcName || 'an NPC'} opened ${dialog.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}) with the character at (${hand.own.x}, ${hand.own.y}) on map ${hand.mapId}${npc !== undefined ? `; the NPC stands on (${npc.tile.x}, ${npc.tile.y}), so the view centre is (${centre!.x}, ${centre!.y})` : ''}.`
        )
      }
    }

    // The exchange side: the client's cancel or accept, paired with the hand
    // click before it. That pair is where the button is, which the layout
    // does not say (`dialogScreen.ts`).
    const exchange = exchangeFor(connectionId)
    const sent = exchange?.sent
    if (sent !== undefined && sent.asOfMs !== state.lastExchangeSentAt) {
      state.lastExchangeSentAt = sent.asOfMs
      const hand = state.lastClick
      if (hand !== undefined && Math.abs(sent.asOfMs - hand.atMs) <= PAIR_WINDOW_MS) {
        log.info(
          'pane',
          `The client sent the exchange's ${sent.action}, ${sent.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}).`
        )
        state.lastClick = undefined
      } else {
        log.info(
          'pane',
          `The client sent the exchange's ${sent.action} with no hand click before it.`
        )
      }
    }

    const target = resolveTarget(connectionId)
    if (target === null) return
    const pointer = pointerIn(target.windowHandle)
    if (pointer === null) return

    if (dialog === null && exchange !== null) {
      // An exchange window, or the alert it left, is up: a release is a click
      // on it, logged so the button's place is measured.
      if (state.leftDown && !pointer.leftDown && pointer.inside) {
        const gameX = Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width))
        const gameY = Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height))
        state.lastClick = { gameX, gameY, atMs: now() }
        log.info(
          'pane',
          exchange.kind === 'open'
            ? `Hand click released at game (${gameX}, ${gameY}) on the exchange with ${exchange.partnerName}.`
            : `Hand click released at game (${gameX}, ${gameY}) with the exchange's closing alert ("${exchange.message}") up.`
        )
      }
      state.leftDown = pointer.leftDown
      return
    }

    if (dialog === null && watchBoard(connectionId, state, pointer)) {
      state.leftDown = pointer.leftDown
      return
    }

    if (dialog === null) {
      watchRightWalk(connectionId, state, pointer)
      // No dialog up: a release on the world is remembered, in case a dialog
      // follows it.
      if (state.leftDown && !pointer.leftDown && pointer.inside) {
        const position = positionFor(connectionId)
        if (position !== null) {
          state.worldClick = {
            gameX: Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width)),
            gameY: Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height)),
            atMs: now(),
            own: { x: position.x, y: position.y },
            mapId: position.mapId
          }
        }
      }
      state.leftDown = pointer.leftDown
      return
    }

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

  /** A short name for what the board pane shows, for the log. */
  function boardView(board: BoardState): string {
    const { request, post, open } = board
    const newest = Math.max(request?.asOfMs ?? 0, post?.asOfMs ?? 0, open?.asOfMs ?? 0)
    if (post !== undefined && post.asOfMs === newest) {
      return `${post.mail ? 'mail' : 'post'} ${post.postId} of board ${post.boardId}`
    }
    if (open !== undefined && open.asOfMs === newest) {
      return `${open.mail ? 'the mailbox' : `board ${open.boardId} (${open.boardName})`}, ${open.rows.length} rows held`
    }
    return 'the board list'
  }

  /** One 0x3B, in a line. */
  function describeRequest(request: NonNullable<BoardState['request']>): string {
    switch (request.action) {
      case 'listBoards':
        return 'list boards'
      case 'listPosts':
        return `list board ${request.boardId} from ${request.startPostId} by ${request.navOffset}`
      case 'readPost':
        return `read post ${request.postId} of board ${request.boardId} (offset ${request.navOffset})`
      default:
        return `${request.action} on board ${request.boardId}`
    }
  }

  /**
   * The board side (WP36): while a board pane is up, a hand click is logged
   * in game coordinates with what the pane showed, and the client's next
   * 0x3B is paired with it. That pair is where the row or the button is,
   * which the layouts do not say (the pane's own place on screen is not in
   * them), and it is what the poll clicks. Returns true when a board pane
   * is up, so the click is not read as one on the world.
   */
  function watchBoard(connectionId: string, state: WatchedDialog, pointer: PointerState): boolean {
    const board = boardFor(connectionId)
    if (board === null || now() - board.asOfMs > BOARD_PANE_FRESH_MS) return false

    const request = board.request
    if (request !== undefined && request.asOfMs !== state.lastBoardRequestAt) {
      state.lastBoardRequestAt = request.asOfMs
      const hand = state.boardClick
      if (hand !== undefined && Math.abs(request.asOfMs - hand.atMs) <= PAIR_WINDOW_MS) {
        log.info(
          'pane',
          `The client sent ${describeRequest(request)}, ${request.asOfMs - hand.atMs} ms after the hand click at game (${hand.gameX}, ${hand.gameY}) on ${hand.view}.`
        )
        state.boardClick = undefined
      } else {
        log.info(
          'pane',
          `The client sent ${describeRequest(request)} with no hand click before it.`
        )
      }
    }

    if (state.leftDown && !pointer.leftDown && pointer.inside) {
      const gameX = Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width))
      const gameY = Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height))
      const view = boardView(board)
      state.boardClick = { gameX, gameY, atMs: now(), view }
      log.info('pane', `Hand click released at game (${gameX}, ${gameY}) on ${view}.`)
    }
    return true
  }

  /**
   * The right-click side, with no dialog up: a hand right-click on the
   * world is a walk, and where the character stops is where the click
   * landed. The log pairs the two with the tile the projection named, so the
   * walker's own right-click (WP35) is measured the way every other screen
   * position was.
   */
  function watchRightWalk(connectionId: string, state: WatchedDialog, pointer: PointerState): void {
    const position = positionFor(connectionId)
    const walk = state.rightWalk
    if (walk !== undefined && position !== null) {
      if (position.mapId !== walk.last.mapId) {
        log.info(
          'pane',
          `The map changed to ${position.mapId} after the hand right-click at game (${walk.gameX}, ${walk.gameY}).`
        )
        state.rightWalk = undefined
      } else if (position.x !== walk.last.x || position.y !== walk.last.y) {
        walk.last = position
        walk.atMs = now()
      } else if (now() - walk.atMs > RIGHT_WALK_SETTLE_MS) {
        const moved = position.x !== walk.own.x || position.y !== walk.own.y
        const hit = position.x === walk.aim.x && position.y === walk.aim.y
        log.info(
          'pane',
          moved
            ? `The character stopped on (${position.x}, ${position.y}) after the hand right-click at game (${walk.gameX}, ${walk.gameY}) from (${walk.own.x}, ${walk.own.y}); the projection named (${walk.aim.x}, ${walk.aim.y})${hit ? ', which agrees' : ', which differs'}.`
            : `The character did not move after the hand right-click at game (${walk.gameX}, ${walk.gameY}) from (${walk.own.x}, ${walk.own.y}); the projection named (${walk.aim.x}, ${walk.aim.y}).`
        )
        state.rightWalk = undefined
      }
    }
    const wasDown = state.rightDown ?? false
    state.rightDown = pointer.rightDown
    if (!(wasDown && !pointer.rightDown && pointer.inside) || position === null) return
    const gameX = Math.round((pointer.x * GAME_WIDTH) / Math.max(1, pointer.width))
    const gameY = Math.round((pointer.y * GAME_HEIGHT) / Math.max(1, pointer.height))
    const own = { x: position.x, y: position.y }
    const aim = tileAtPoint(own, { x: gameX, y: gameY })
    log.info(
      'pane',
      `Hand right-click released at game (${gameX}, ${gameY}) with the character at (${own.x}, ${own.y}) on map ${position.mapId}; the projection names tile (${aim.x}, ${aim.y}).`
    )
    state.rightWalk = { aim, gameX, gameY, own, last: position, atMs: now() }
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
