import type { ActionRefusal, ActionTarget } from '../shared/types'
import {
  boardKey,
  boardPollStopMessage,
  type BoardPollOutcome,
  type BoardPollRequest,
  type BoardPollScope,
  type BoardPollState,
  type BoardPollStopReason
} from '../shared/boards'
import type { ActionLayer, LiveConnection } from './actionLayer'
import type { BoardState, OpenBoard } from './model/board'
import type { DialogState } from './model/dialog'
import type { Logger } from './log'
import { MAILBOX_ID, PAGE_SIZE } from './protocol/decode/board'

/**
 * The board poll (WP36 PR2): read every board and the mailbox end to end,
 * through the client's own board pane.
 *
 * The passive archive keeps what the player reads; this reads it all. It
 * clicks the client's board button for the board list (a posted `W`, the
 * hotkey, opened nothing on the first live run), and for each board in the
 * list it clicks the row, clicks View, scrolls the list to its oldest post
 * with the scrollbar's down arrow (a click at the bottom is what asks the
 * client for the next page), then opens every post from its own row and
 * goes back Up. Every gesture waits for the packet that answers it, and the
 * post id in that packet is the check on the poll's picture of the list: it
 * keeps which row is at the top, the server's reply proves it or corrects
 * it, and a picture that is wrong too often stops the poll rather than let
 * it guess.
 *
 * Every gesture is a click, from a closed set: the board button, a visible
 * row, the scrollbar's two arrows, View, Up, and Quit. No key: a posted `W`
 * opened nothing and a posted Down moved no selection on the first live
 * runs (2026-09-22), while every click the watcher measured was answered.
 * New, Reply, Delete, and Hilight are never clicked, by construction: no
 * button below View on a list is a point this file knows. Delete has no
 * confirm.
 *
 * The positions are measured, not taken from the layouts alone: the pane
 * watcher paired Sabrael's hand clicks with the client's requests on
 * 2026-09-22 (see `docs/plans/36-board-archive.md`), and every point here
 * fits a 581 x 290 pane at game (30, 0).
 */

export interface BoardPollOptions {
  actionLayer: ActionLayer
  /** The connections that carry a live character now. From the capture service. */
  liveConnections: () => LiveConnection[]
  /** The boards as the client shows them on a connection. From the capture service. */
  boardFor: (connectionId: string) => BoardState | null
  /** The NPC dialog on screen, which the poll never opened: a stop. */
  dialogFor: (connectionId: string) => DialogState | null
  /** The post ids the archive holds a body for, by board key. For `onlyUnread`. */
  readBodies: (key: string) => Promise<Set<number>>
  log: Logger
  /** Called whenever a poll changes, so main can push it. */
  onState?: (state: BoardPollState) => void
  /** The clock. Injected by tests. */
  now?: () => number
  /** Build an interruptible sleep. Injected by tests. */
  sleep?: (ms: number) => Sleeper
}

export interface BoardPoll {
  /** Read every board on one connection. Resolves with how the poll ended. */
  run(request: BoardPollRequest): Promise<BoardPollOutcome>
  /** Stop the poll on one connection. */
  stop(connectionId: string): void
  /** Every poll running now. */
  states(): BoardPollState[]
  /** Stop every poll quietly. Called on shutdown. */
  dispose(): void
}

/** An interruptible sleep. `cancel` resolves the promise at once. */
export interface Sleeper {
  promise: Promise<void>
  cancel: () => void
}

/**
 * The board pane on the game's 640 x 480 screen.
 *
 * The client's layouts (`_nbdlist.txt`, `_narlist.txt`, `_narti.txt`,
 * `_nmaill.txt`, `_nmailr.txt` in `setoa.dat`) give a 581 x 290 pane with its
 * list in 19 to 499 by 18 to 273 and its buttons in 507 to 568, and not
 * where the pane sits. The hand browse of 2026-09-22 04:33Z placed it: View
 * clicked at game (562, 51), Next at (562, 96), Prev at (570, 69), Up at
 * (573, 228), Close at (555, 259), the top row at (319, 29). All of them fit
 * the pane at x 30 (centred across the width) and y 0, and no other offset.
 */
export const PANE = { x: 30, y: 0 }
/** The list's rows: 18 px from pane y 18, fourteen on screen. */
export const ROW_TOP = 18
export const ROW_PITCH = 18
export const VISIBLE_ROWS = 14
/** Where a row is clicked: well inside the list, clear of the scrollbar at pane x 500. */
const ROW_X = 260
/**
 * The list's scrollbar arrows, in game coordinates: the hand browse clicked
 * the up arrow fifteen times at (529, 26) to (529, 30) and the down arrow
 * fifteen times at (530, 266) to (532, 265), one row each, and the down
 * arrow at the bottom asked the client for the next page.
 */
export const SCROLL_UP = { x: 530, y: 27 }
export const SCROLL_DOWN = { x: 531, y: 265 }
/** The buttons' column centre: 507 to 568. */
const BUTTON_X = 537

/** A pane-relative button's centre row, from its layout rect. */
const BUTTON_Y = {
  /** View on the board list and on a board's post list (35 to 57). */
  view: 46,
  /** View on the mail list (61 to 83). The board list's View row is Prev on a post. */
  viewMail: 72,
  /** Up on a board's post list and on every post pane (218 to 240). Quit on the mail list. */
  up: 229,
  /** Up on the mail list, Quit on the board list, Close on a post list (245 to 267). */
  upMail: 256
} as const

/**
 * The client's own board button, outside the pane, which opens the board
 * list from nothing. Measured from two hand clicks that the watcher paired
 * with `listBoards`: game (621, 246) on 2026-09-22 04:33Z and (630, 249) at
 * 05:06Z. A posted `W` with its character was not answered (05:06Z, five
 * tries), so the button is the opener.
 */
export const BOARD_BUTTON = { x: 626, y: 248 }

/** A point on the pane, as a game coordinate. */
export function panePoint(x: number, y: number): { x: number; y: number } {
  return { x: PANE.x + x, y: PANE.y + y }
}

/** The centre of a visible row, zero-based from the top of the list. */
export function rowPoint(visibleRow: number): { x: number; y: number } {
  return panePoint(ROW_X, ROW_TOP + ROW_PITCH * visibleRow + ROW_PITCH / 2)
}

/** The buttons the poll clicks, and no other. */
export const BUTTONS = {
  /** View: opens the selected row. */
  view: (mail: boolean) => panePoint(BUTTON_X, mail ? BUTTON_Y.viewMail : BUTTON_Y.view),
  /** Up on a post: back to its list. The same place on a board's post and on a mail. */
  upFromPost: () => panePoint(BUTTON_X, BUTTON_Y.up),
  /** Up on a list: back to the board list. Different on the mail list, where that row is Quit. */
  upFromList: (mail: boolean) => panePoint(BUTTON_X, mail ? BUTTON_Y.upMail : BUTTON_Y.up),
  /** Quit on the board list: closes the pane. */
  quit: () => panePoint(BUTTON_X, BUTTON_Y.upMail)
} as const

/**
 * How long to wait for the packet that answers a gesture, in milliseconds.
 *
 * The server answered every board request of the live browses within a
 * second (most within 700 ms). The wait is generous, and a gesture with no
 * answer in it stops the poll.
 */
export const REPLY_WAIT_MS = 4000
/** The gap between two scrollbar clicks, so each is its own click to the client. */
export const SCROLL_GAP_MS = 120
/** How long the pane takes to go back to the list after Up, which sends nothing. */
export const UP_SETTLE_MS = 350
/**
 * How long to wait after a row click for the client's own request, which a
 * double click on the row would send. The layer clicks a row once, so this
 * is normally silence, and then View is clicked.
 */
export const ROW_SETTLE_MS = 400
/** How often to poll the board feed while waiting. */
const POLL_MS = 40
/**
 * How many times, on one board, the client may show another post than the
 * poll asked for before the poll stops as lost. Each miss re-syncs the
 * poll's picture of the list from the reply and tries again.
 */
export const MAX_MISSES = 4

/**
 * The poll's picture of a list: which row is at the top of the fourteen on
 * screen, and how many rows one scrollbar click moves. The top row starts
 * at zero when a list opens; every click on an arrow moves it; and the post
 * the server answers with says whether the picture was right, since the
 * poll clicked a visible row and the reply names the row's post.
 */
export interface ListPicture {
  topRow: number
  rowsPerClick: number
  /**
   * True once a reply has shown that Up from a post puts the list back at
   * the top. Not known before the first live run; learned from the first
   * miss that fits it, and the picture goes to the top after every Up
   * from then on.
   */
  upResets?: boolean
  /** The last scroll made for a row click, for learning from a miss. */
  lastScroll?: { fromTop: number; clicks: number; down: boolean }
}
/** How many times a board row is tried when the client opens another board. */
export const OPEN_TRIES = 2
/**
 * How long after its last packet an open list is taken to be still on
 * screen, for reading the open board. The client sends nothing when the
 * pane is closed; the pane watcher uses the same window.
 */
export const OPEN_BOARD_FRESH_MS = 5 * 60 * 1000

/** The scope, for the log. */
function describeScope(scope: BoardPollScope): string {
  if (scope === 'all') return 'every board'
  if (scope === 'open') return 'the open board'
  return `boards ${scope.boardIds.join(', ')}`
}

interface Run {
  connectionId: string
  running: boolean
  stopReason?: BoardPollStopReason
  cancelWait?: () => void
  boardsDone: number
  boardsTotal: number
  postsRead: number
  boardName?: string
  doing?: string
}

/** The poll ended before its end. Thrown inside the run and caught at the top. */
class Stop extends Error {
  constructor(readonly reason: BoardPollStopReason) {
    super(reason)
  }
}

function defaultSleep(ms: number): Sleeper {
  let timer: NodeJS.Timeout
  let resolveNow: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolveNow = resolve
    timer = setTimeout(resolve, ms)
  })
  return {
    promise,
    cancel: () => {
      clearTimeout(timer)
      resolveNow()
    }
  }
}

export function createBoardPoll(options: BoardPollOptions): BoardPoll {
  const { actionLayer, liveConnections, boardFor, dialogFor, readBodies, log, onState } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const runs = new Map<string, Run>()

  function publish(run: Run, reason?: string): void {
    onState?.({
      connectionId: run.connectionId,
      running: run.running,
      ...(run.doing !== undefined ? { doing: run.doing } : {}),
      ...(run.boardName !== undefined ? { boardName: run.boardName } : {}),
      boardsDone: run.boardsDone,
      boardsTotal: run.boardsTotal,
      postsRead: run.postsRead,
      ...(reason !== undefined ? { reason } : {})
    })
  }

  function doing(run: Run, what: string): void {
    run.doing = what
    publish(run)
  }

  /** A refusal from the action layer is the end of the run. */
  function refused(run: Run, refusal: ActionRefusal | null): void {
    if (refusal === null) return
    if (!run.running) throw new Stop(run.stopReason ?? 'user')
    throw new Stop(refusal === 'stopped' ? 'user' : 'lostCharacter')
  }

  /** The checks between two gestures: the stop, the character, and a dialog the poll did not open. */
  function check(run: Run, startMs: number): void {
    if (!run.running || actionLayer.stopped) throw new Stop(run.stopReason ?? 'user')
    if (!liveConnections().some((c) => c.connectionId === run.connectionId)) {
      throw new Stop('lostCharacter')
    }
    const dialog = dialogFor(run.connectionId)
    if (dialog !== null && dialog.asOfMs > startMs) {
      log.warn('boards', `A dialog came up during the poll; stopping without touching it.`)
      throw new Stop('dialog')
    }
  }

  async function pause(run: Run, ms: number): Promise<void> {
    const sleeper = sleep(ms)
    run.cancelWait = sleeper.cancel
    await sleeper.promise
    run.cancelWait = undefined
  }

  /**
   * Wait until the board feed satisfies `ready`, or the wait runs out. The
   * run's checks are made on every poll, so a stop or a dialog ends the wait
   * at once. Returns what `ready` returned, or null on the timeout.
   */
  async function waitFor<T>(
    run: Run,
    startMs: number,
    timeoutMs: number,
    ready: (board: BoardState | null) => T | null
  ): Promise<T | null> {
    const deadline = now() + timeoutMs
    for (;;) {
      check(run, startMs)
      const found = ready(boardFor(run.connectionId))
      if (found !== null) return found
      if (now() >= deadline) return null
      await pause(run, POLL_MS)
    }
  }

  /** The newest page's arrival time, for waiting on the next. */
  function openAfter(board: BoardState | null, afterMs: number): OpenBoard | null {
    const open = board?.open
    return open !== undefined && open.asOfMs > afterMs ? open : null
  }

  /** Click a scrollbar arrow `clicks` times, each its own click. */
  async function scroll(
    run: Run,
    target: ActionTarget,
    startMs: number,
    down: boolean,
    clicks: number
  ): Promise<void> {
    const point = down ? SCROLL_DOWN : SCROLL_UP
    for (let i = 0; i < clicks; i++) {
      check(run, startMs)
      refused(run, await actionLayer.click(target, point.x, point.y, { once: true }))
      await pause(run, SCROLL_GAP_MS)
    }
  }

  /**
   * Bring row `index` of a list of `rows` rows on screen, by the picture,
   * and return the visible row it is on. The scrollbar moves the top row by
   * `rowsPerClick` a click, and never past the last page.
   */
  async function bringIntoView(
    run: Run,
    target: ActionTarget,
    startMs: number,
    picture: ListPicture,
    index: number,
    rows: number
  ): Promise<number> {
    const lastTop = Math.max(0, rows - VISIBLE_ROWS)
    let wantedTop = picture.topRow
    if (index < picture.topRow) wantedTop = index
    else if (index >= picture.topRow + VISIBLE_ROWS) wantedTop = index - VISIBLE_ROWS + 1
    wantedTop = Math.min(Math.max(0, wantedTop), lastTop)
    const delta = wantedTop - picture.topRow
    picture.lastScroll = { fromTop: picture.topRow, clicks: 0, down: delta > 0 }
    if (delta !== 0) {
      const clicks = Math.ceil(Math.abs(delta) / picture.rowsPerClick)
      log.info(
        'boards',
        `Scrolling ${delta > 0 ? 'down' : 'up'} ${clicks} ${clicks === 1 ? 'click' : 'clicks'} so row ${index} is on screen (top row ${picture.topRow} to ${wantedTop}).`
      )
      picture.lastScroll.clicks = clicks
      await scroll(run, target, startMs, delta > 0, clicks)
      picture.topRow = Math.min(
        Math.max(0, picture.topRow + Math.sign(delta) * clicks * picture.rowsPerClick),
        lastTop
      )
    }
    return index - picture.topRow
  }

  /**
   * Learn from a miss what the picture had wrong. The reply put the top row
   * at `actualTop`; the last scroll went `clicks` clicks from `fromTop`. Two
   * things can be wrong, and each miss fits one: Up put the list back at
   * the top before the scroll (the top is where `clicks` from zero would
   * put it), or a click moves more rows than believed (the move from
   * `fromTop` is a whole number of rows a click).
   */
  function learn(picture: ListPicture, actualTop: number): string {
    const last = picture.lastScroll
    if (last === undefined) return 'no scroll to learn from'
    const direction = last.down ? 1 : -1
    if (last.clicks === 0) {
      if (actualTop === 0 && last.fromTop > 0 && picture.upResets !== true) {
        picture.upResets = true
        return 'Up puts the list back at the top'
      }
      return 'the list moved with no scroll'
    }
    const fromZero = direction * last.clicks * picture.rowsPerClick
    if (picture.upResets !== true && actualTop === Math.max(0, fromZero)) {
      picture.upResets = true
      return 'Up puts the list back at the top'
    }
    const moved = (actualTop - (picture.upResets === true ? 0 : last.fromTop)) * direction
    if (moved > 0 && moved % last.clicks === 0 && moved / last.clicks !== picture.rowsPerClick) {
      picture.rowsPerClick = moved / last.clicks
      return `a click scrolls ${picture.rowsPerClick} rows`
    }
    return 'nothing more than the top row'
  }

  /**
   * Correct the picture from a reply that named another row than the poll
   * clicked: the row the poll clicked was visible row `visibleRow`, and the
   * reply says it was row `actual` of the list.
   */
  function resync(picture: ListPicture, visibleRow: number, actual: number, rows: number): void {
    const lastTop = Math.max(0, rows - VISIBLE_ROWS)
    picture.topRow = Math.min(Math.max(0, actual - visibleRow), lastTop)
  }

  /**
   * Bring row `index` on screen, click it, then View. A double click that
   * landed on the row anyway opens it without View: the client's own
   * request in the row settle says so. Returns the visible row clicked.
   */
  async function openRow(
    run: Run,
    target: ActionTarget,
    startMs: number,
    picture: ListPicture,
    index: number,
    rows: number,
    mail: boolean,
    what: string
  ): Promise<number> {
    const visibleRow = await bringIntoView(run, target, startMs, picture, index, rows)
    const point = rowPoint(visibleRow)
    const before = boardFor(run.connectionId)?.request?.asOfMs ?? 0
    log.info(
      'boards',
      `Clicking row ${index} on visible row ${visibleRow} at game (${point.x}, ${point.y}) for ${what}.`
    )
    refused(run, await actionLayer.click(target, point.x, point.y, { once: true }))
    await pause(run, ROW_SETTLE_MS)
    const request = boardFor(run.connectionId)?.request
    if (request !== undefined && request.asOfMs > before) {
      log.info('boards', `The row click opened ${what} by itself; View is not needed.`)
      return visibleRow
    }
    const view = BUTTONS.view(mail)
    log.info('boards', `Clicking View at game (${view.x}, ${view.y}) for ${what}.`)
    refused(run, await actionLayer.click(target, view.x, view.y, { once: true }))
    return visibleRow
  }

  /**
   * Scroll the list to its oldest post. The scrollbar's down arrow at the
   * bottom asks the client for the next page; the poll clicks until the
   * request goes out, waits for its reply, and stops when a page is short
   * or adds nothing. The picture ends with the last page on screen.
   */
  async function pageToEnd(
    run: Run,
    target: ActionTarget,
    startMs: number,
    picture: ListPicture,
    boardId: number,
    mail: boolean
  ): Promise<void> {
    for (;;) {
      const open = boardFor(run.connectionId)?.open
      if (open === undefined || open.boardId !== boardId || open.mail !== mail) {
        throw new Stop('lost')
      }
      if (open.lastPageRows < PAGE_SIZE || open.lastPageAdded === 0) {
        log.info(
          'boards',
          `${run.boardName}: ${open.rows.length} rows held; the last page carried ${open.lastPageRows} and added ${open.lastPageAdded}, so the oldest post is reached.`
        )
        return
      }
      doing(run, `paging ${run.boardName}, ${open.rows.length} rows so far`)
      const rowsBefore = open.rows.length
      const lastTop = Math.max(0, rowsBefore - VISIBLE_ROWS)
      const pageAt = open.asOfMs
      // A click per row to the bottom, and a few past it: the request goes
      // out when the list cannot scroll further.
      const clicks = Math.ceil((lastTop - picture.topRow) / picture.rowsPerClick) + 3
      let requested = false
      for (let i = 0; i < clicks; i++) {
        check(run, startMs)
        const sentBefore = boardFor(run.connectionId)?.request?.asOfMs ?? 0
        refused(run, await actionLayer.click(target, SCROLL_DOWN.x, SCROLL_DOWN.y, { once: true }))
        picture.topRow = Math.min(picture.topRow + picture.rowsPerClick, lastTop)
        await pause(run, SCROLL_GAP_MS)
        const request = boardFor(run.connectionId)?.request
        if (
          request !== undefined &&
          request.asOfMs > sentBefore &&
          request.action === 'listPosts' &&
          request.boardId === boardId
        ) {
          requested = true
          log.info(
            'boards',
            `The down arrow at the bottom asked the client for the page from ${request.startPostId}.`
          )
          break
        }
      }
      if (!requested) {
        log.warn(
          'boards',
          `${clicks} clicks on the down arrow asked for no page on ${run.boardName}; taking ${rowsBefore} rows as all of it.`
        )
        return
      }
      // One request in flight, and nothing clicked until its reply lands:
      // the client re-sends the same cursor for every click at the bottom.
      const page = await waitFor(run, startMs, REPLY_WAIT_MS, (b) => openAfter(b, pageAt))
      if (page === null) throw new Stop('timeout')
    }
  }

  /**
   * Open every post of the open board from its own row, newest first, and
   * read the body off the wire. The picture says which visible row a post
   * is on; the reply's post id is the proof, and a miss re-syncs the
   * picture from the reply and tries the post again.
   */
  async function readPosts(
    run: Run,
    target: ActionTarget,
    startMs: number,
    picture: ListPicture,
    boardId: number,
    mail: boolean,
    owner: string,
    onlyUnread: boolean
  ): Promise<void> {
    const open = boardFor(run.connectionId)?.open
    if (open === undefined || open.boardId !== boardId || open.mail !== mail) throw new Stop('lost')
    const rows = open.rows
    const held = onlyUnread ? await readBodies(boardKey(boardId, mail, owner)) : new Set<number>()
    const wanted = rows.map((_, i) => i).filter((i) => !held.has(rows[i]!.postId))
    log.info(
      'boards',
      `${run.boardName}: ${rows.length} posts listed, ${wanted.length} to open${onlyUnread ? ` (${rows.length - wanted.length} already read)` : ''}.`
    )
    let misses = 0
    for (let n = 0; n < wanted.length;) {
      const index = wanted[n]!
      const expected = rows[index]!.postId
      doing(run, `reading ${run.boardName}, post ${n + 1} of ${wanted.length}`)
      const postAt = boardFor(run.connectionId)?.post?.asOfMs ?? 0
      const visibleRow = await openRow(
        run,
        target,
        startMs,
        picture,
        index,
        rows.length,
        mail,
        `post ${expected}`
      )
      const post = await waitFor(run, startMs, REPLY_WAIT_MS, (b) =>
        b?.post !== undefined && b.post.asOfMs > postAt ? b.post : null
      )
      if (post === null) {
        log.warn('boards', `No post came for post ${expected} within ${REPLY_WAIT_MS} ms.`)
        throw new Stop('timeout')
      }
      if (post.postId === expected) {
        run.postsRead++
        misses = 0
        n++
      } else {
        misses++
        const at = rows.findIndex((r) => r.postId === post.postId)
        log.warn(
          'boards',
          `Asked for post ${expected} at row ${index} and the client showed ${post.postId}${at >= 0 ? ` (row ${at})` : ''}; miss ${misses} of ${MAX_MISSES}.`
        )
        if (misses >= MAX_MISSES) throw new Stop('lost')
        if (at >= 0) {
          resync(picture, visibleRow, at, rows.length)
          const learned = learn(picture, picture.topRow)
          log.info('boards', `The top row is ${picture.topRow} by the reply; learned: ${learned}.`)
        }
      }
      // Up on the post pane: back to the list, with no packet to wait for.
      const up = BUTTONS.upFromPost()
      log.info('boards', `Clicking Up at game (${up.x}, ${up.y}).`)
      refused(run, await actionLayer.click(target, up.x, up.y, { once: true }))
      await pause(run, UP_SETTLE_MS)
      if (picture.upResets === true) picture.topRow = 0
    }
  }

  /** Up on a list: back to the board list, which the client asks for again. */
  async function backToBoardList(
    run: Run,
    target: ActionTarget,
    startMs: number,
    mail: boolean
  ): Promise<void> {
    const up = BUTTONS.upFromList(mail)
    const relistAt = boardFor(run.connectionId)?.boardsAtMs ?? 0
    log.info('boards', `Clicking Up on the list at game (${up.x}, ${up.y}).`)
    refused(run, await actionLayer.click(target, up.x, up.y, { once: true }))
    const relisted = await waitFor(run, startMs, REPLY_WAIT_MS, (b) =>
      (b?.boardsAtMs ?? 0) > relistAt ? true : null
    )
    if (relisted === null) {
      log.warn('boards', 'No board list came after Up; going on regardless.')
    }
  }

  /**
   * Read the board whose list is on screen now, and leave the pane as it is.
   * A board in the world is opened by a click on it and is not in the board
   * list, so this is the way to read one; the list may already be scrolled
   * by the player, which the first reply corrects.
   */
  async function runOpenBoard(
    run: Run,
    target: ActionTarget,
    startMs: number,
    owner: string,
    onlyUnread: boolean
  ): Promise<void> {
    const open = boardFor(run.connectionId)?.open
    if (open === undefined) throw new Stop('lost')
    const mail = open.mail
    run.boardName = mail ? `${owner}'s mail` : open.boardName
    run.boardsTotal = 1
    publish(run)
    log.info('boards', `Reading the open list: ${run.boardName}, ${open.rows.length} rows held.`)
    // The client's own second page may still be on its way.
    if (open.lastPageRows === PAGE_SIZE && open.rows.length === PAGE_SIZE) {
      await waitFor(run, startMs, REPLY_WAIT_MS, (b) => openAfter(b, open.asOfMs))
    }
    const picture: ListPicture = { topRow: 0, rowsPerClick: 1 }
    await pageToEnd(run, target, startMs, picture, open.boardId, mail)
    await readPosts(run, target, startMs, picture, open.boardId, mail, owner, onlyUnread)
    run.boardsDone = 1
    publish(run)
  }

  async function runPoll(
    run: Run,
    target: ActionTarget,
    scope: BoardPollScope,
    onlyUnread: boolean
  ): Promise<void> {
    const startMs = now()
    const owner = liveConnections().find((c) => c.connectionId === run.connectionId)?.name ?? ''
    if (scope === 'open') {
      await runOpenBoard(run, target, startMs, owner, onlyUnread)
      return
    }

    // The board button: the board list. The client answers with the list of
    // every board it may read, the mailbox first as board 0.
    doing(run, 'opening the board list')
    const listAt = boardFor(run.connectionId)?.boardsAtMs ?? 0
    log.info(
      'boards',
      `Clicking the board button at game (${BOARD_BUTTON.x}, ${BOARD_BUTTON.y}) for the board list.`
    )
    refused(run, await actionLayer.click(target, BOARD_BUTTON.x, BOARD_BUTTON.y, { once: true }))
    const boards = await waitFor(run, startMs, REPLY_WAIT_MS, (b) =>
      b?.boards !== undefined && (b.boardsAtMs ?? 0) > listAt ? b.boards : null
    )
    if (boards === null) {
      log.warn('boards', 'No board list came after the board button.')
      throw new Stop('timeout')
    }
    // The rows to read: every one, or the ones named, in the list's order.
    const wanted =
      scope === 'all'
        ? boards.map((_, i) => i)
        : boards.flatMap((b, i) => (scope.boardIds.includes(b.id) ? [i] : []))
    if (scope !== 'all') {
      const missing = scope.boardIds.filter((id) => !boards.some((b) => b.id === id))
      if (missing.length > 0) {
        log.warn(
          'boards',
          `Not in the board list, so not read: ${missing.join(', ')}. A board in the world is read by opening it and choosing the open board.`
        )
      }
    }
    run.boardsTotal = wanted.length
    publish(run)
    // The board list's own picture. Up from a board asks the client for the
    // list again, which is taken to start at the top; a wrong board opened
    // re-syncs it.
    const boardList: ListPicture = { topRow: 0, rowsPerClick: 1 }
    log.info(
      'boards',
      `The board list holds ${boards.length}: ${boards.map((b) => `${b.id} ${b.name}`).join(', ')}.`
    )

    for (let n = 0; n < wanted.length; n++) {
      const i = wanted[n]!
      const board = boards[i]!
      const mail = board.id === MAILBOX_ID
      run.boardName = mail ? `${owner}'s mail` : board.name
      doing(run, `opening ${run.boardName}`)

      // The row and View: the first page, and the client's own second page
      // when the first was full. A wrong board is one more try after Up, and
      // then a stop: the board list is rebuilt by Up, so the second try is
      // from the top row again.
      let first: OpenBoard | null = null
      for (let attempt = 1; first === null; attempt++) {
        const openAt = boardFor(run.connectionId)?.open?.asOfMs ?? 0
        const visibleRow = await openRow(
          run,
          target,
          startMs,
          boardList,
          i,
          boards.length,
          false,
          run.boardName
        )
        const opened = await waitFor(run, startMs, REPLY_WAIT_MS, (b) => openAfter(b, openAt))
        if (opened === null) {
          log.warn('boards', `No list came for ${run.boardName}.`)
          throw new Stop('timeout')
        }
        if (opened.boardId === board.id && opened.mail === mail) {
          first = opened
          break
        }
        const at = boards.findIndex((b) => b.id === opened.boardId)
        log.warn(
          'boards',
          `Asked for ${run.boardName} at row ${i} and the client opened ${opened.mail ? 'the mailbox' : `board ${opened.boardId} (${opened.boardName})`}${at >= 0 ? ` (row ${at})` : ''}; try ${attempt} of ${OPEN_TRIES}.`
        )
        if (attempt >= OPEN_TRIES) throw new Stop('lost')
        if (at >= 0) resync(boardList, visibleRow, at, boards.length)
        await backToBoardList(run, target, startMs, opened.mail)
      }
      if (first.lastPageRows === PAGE_SIZE) {
        await waitFor(run, startMs, REPLY_WAIT_MS, (b) => openAfter(b, first.asOfMs))
      }

      // A fresh list starts at the top.
      const picture: ListPicture = { topRow: 0, rowsPerClick: 1 }
      await pageToEnd(run, target, startMs, picture, board.id, mail)
      await readPosts(run, target, startMs, picture, board.id, mail, owner, onlyUnread)

      await backToBoardList(run, target, startMs, mail)
      boardList.topRow = 0
      run.boardsDone = n + 1
      publish(run)
    }

    const quit = BUTTONS.quit()
    log.info('boards', `Clicking Quit at game (${quit.x}, ${quit.y}).`)
    refused(run, await actionLayer.click(target, quit.x, quit.y, { once: true }))
  }

  function finish(run: Run, outcome: BoardPollOutcome): BoardPollOutcome {
    run.running = false
    run.cancelWait?.()
    runs.delete(run.connectionId)
    actionLayer.disarm(run.connectionId)
    const reason =
      outcome.kind === 'done'
        ? `read ${outcome.boardsRead} boards and ${outcome.postsRead} posts`
        : boardPollStopMessage(outcome.reason)
    run.doing = undefined
    publish(run, reason)
    log.info('boards', `The poll on ${run.connectionId} ended: ${reason}.`)
    return outcome
  }

  async function run(request: BoardPollRequest): Promise<BoardPollOutcome> {
    const { connectionId } = request
    if (!liveConnections().some((c) => c.connectionId === connectionId)) {
      throw new Error('No character is logged in on the selected window.')
    }
    if (request.scope === 'open') {
      const open = boardFor(connectionId)?.open
      if (open === undefined || now() - open.asOfMs > OPEN_BOARD_FRESH_MS) {
        throw new Error('No board list is open on that window. Open one in the game first.')
      }
    }
    if (runs.has(connectionId)) stop(connectionId)
    const state: Run = {
      connectionId,
      running: true,
      boardsDone: 0,
      boardsTotal: 0,
      postsRead: 0
    }
    runs.set(connectionId, state)
    const armed = actionLayer.arm(connectionId, (reason) => {
      state.stopReason = reason.includes('window closed') ? 'lostCharacter' : 'user'
      state.running = false
      state.cancelWait?.()
    })
    if (typeof armed === 'string') {
      return finish(state, {
        kind: 'stopped',
        reason: armed === 'stopped' ? 'user' : 'lostCharacter',
        boardsRead: 0,
        postsRead: 0
      })
    }
    log.info(
      'boards',
      `The poll started on ${connectionId} (${describeScope(request.scope)})${request.onlyUnread ? ', unread posts only' : ''}.`
    )
    try {
      await runPoll(state, armed, request.scope, request.onlyUnread)
      return finish(state, {
        kind: 'done',
        boardsRead: state.boardsDone,
        postsRead: state.postsRead
      })
    } catch (error) {
      const reason: BoardPollStopReason =
        error instanceof Stop ? error.reason : (state.stopReason ?? 'user')
      if (!(error instanceof Stop)) {
        log.error(
          'boards',
          `The poll failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return finish(state, {
        kind: 'stopped',
        reason: state.running ? reason : (state.stopReason ?? reason),
        boardsRead: state.boardsDone,
        postsRead: state.postsRead
      })
    }
  }

  function stop(connectionId: string): void {
    const state = runs.get(connectionId)
    if (state === undefined) return
    state.stopReason = 'user'
    state.running = false
    state.cancelWait?.()
  }

  function states(): BoardPollState[] {
    return [...runs.values()].map((run) => ({
      connectionId: run.connectionId,
      running: run.running,
      ...(run.doing !== undefined ? { doing: run.doing } : {}),
      ...(run.boardName !== undefined ? { boardName: run.boardName } : {}),
      boardsDone: run.boardsDone,
      boardsTotal: run.boardsTotal,
      postsRead: run.postsRead
    }))
  }

  return {
    run,
    stop,
    states,
    dispose: () => {
      for (const id of [...runs.keys()]) stop(id)
    }
  }
}
