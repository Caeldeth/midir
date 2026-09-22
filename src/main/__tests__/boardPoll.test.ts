import { describe, expect, it } from 'vitest'
import {
  BOARD_BUTTON,
  BUTTONS,
  createBoardPoll,
  MAX_MISSES,
  OPEN_TRIES,
  PANE,
  rowPoint,
  type BoardPollOptions,
  type Sleeper
} from '../boardPoll'
import { VK_DOWN, VK_UP, type ActionLayer } from '../actionLayer'
import type { ActionRefusal, ActionTarget } from '../../shared/types'
import type { BoardPollState } from '../../shared/boards'
import { reduceBoard, type BoardState } from '../model/board'
import type { DialogState } from '../model/dialog'
import type { Bulletin, BulletinRequest, PostHeader } from '../protocol/decode/board'
import { NEWEST_POST_CURSOR, PAGE_SIZE } from '../protocol/decode/board'
import type { Logger } from '../log'

/**
 * The board poll (WP36 PR2), run whole against a fake client with no game.
 *
 * The fake client is the retail client as the live browses of 2026-09-22
 * showed it: the board button lists the boards, a row and View open a board with its first
 * page and, when that was full, a second page on its own; Down walks the
 * selection and a press past the last row asks for the next page (the same
 * cursor again for every press until the reply); View on a post list reads
 * the selected post; Up on a post goes back with no packet; Up on a list asks
 * for the board list again. Every reply goes through the real reducer, so
 * the poll sees exactly what the capture service would give it.
 */

const CID = 'conn-1'
const TARGET: ActionTarget = { connectionId: CID, windowHandle: 1 }

const noop: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger

/** A clock and an interruptible sleep that advances it. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Sleeper } {
  let clock = 1000
  return {
    now: () => clock,
    sleep: (ms: number): Sleeper => {
      let resolveNow: () => void = () => undefined
      const promise = new Promise<void>((resolve) => {
        resolveNow = resolve
      }).then(() => {
        clock += ms
      })
      queueMicrotask(resolveNow)
      return { promise, cancel: resolveNow }
    }
  }
}

interface FakeBoard {
  id: number
  name: string
  /** Post ids, any order; the client lists them newest first. */
  posts: number[]
}

type Pane =
  | { kind: 'closed' }
  | { kind: 'boardList'; selected: number }
  | { kind: 'postList'; board: FakeBoard; rows: number[]; selected: number; exhausted: boolean }
  | { kind: 'post'; board: FakeBoard; rows: number[]; selected: number; exhausted: boolean }

interface FakeClient {
  layer: ActionLayer
  state: () => BoardState | null
  /** Every request the client sent, in order. */
  requests: BulletinRequest[]
  /** Every button clicked, as a name, in order. */
  clicked: string[]
  keys: number[]
  pane: () => Pane
  setRefusal: (refusal: ActionRefusal | null) => void
  /** Make the next post read answer with this id instead of the selection. */
  misreadNext: (postId: number) => void
  /** Make the next board open show this board instead of the selection. */
  misopenNext: (boardId: number) => void
  fireStop: (reason: string) => void
  stopped: { value: boolean }
}

function header(postId: number): PostHeader {
  return { highlighted: false, postId, author: 'Ari', month: 7, day: 1, subject: `Post ${postId}` }
}

/**
 * A retail-shaped client over `boards`. Each gesture is answered with the
 * packets the live browses showed, through the real reducer.
 */
function fakeClient(boards: FakeBoard[], clock: { now: () => number }): FakeClient {
  let state: BoardState | null = null
  let pane: Pane = { kind: 'closed' }
  const requests: BulletinRequest[] = []
  const clicked: string[] = []
  const keys: number[] = []
  let refusal: ActionRefusal | null = null
  let misread: number | null = null
  let misopen: number | null = null
  let onStop: ((reason: string) => void) | undefined
  const stopped = { value: false }

  const feed = (packet: Bulletin | BulletinRequest): void => {
    state = reduceBoard(state, { packet, timestampMs: clock.now() })
  }
  const send = (request: { action: BulletinRequest['action'] } & Record<string, unknown>): void => {
    const full = { kind: 'bulletinRequest', ...request } as BulletinRequest
    requests.push(full)
    feed(full)
  }
  const listing = (board: FakeBoard): number[] => [...board.posts].sort((a, b) => b - a)
  const mailOf = (board: FakeBoard): boolean => board.id === 0

  /** The server's page from `cursor`: up to 16 posts older than it, newest first. */
  const page = (board: FakeBoard, cursor: number): number[] =>
    listing(board)
      .filter((id) => id <= cursor)
      .slice(0, PAGE_SIZE)

  /** The client asks for a page and the server answers it. */
  const requestPage = (board: FakeBoard, cursor: number): number[] => {
    send({ action: 'listPosts', boardId: board.id, startPostId: cursor, navOffset: -16 })
    const rows = page(board, cursor)
    feed({
      kind: 'postList',
      mail: mailOf(board),
      subType: mailOf(board) ? 4 : 2,
      boardId: board.id,
      boardName: board.name,
      rows: rows.map(header)
    })
    return rows
  }

  const openBoard = (board: FakeBoard): void => {
    const first = requestPage(board, NEWEST_POST_CURSOR)
    let rows = first
    let exhausted = first.length < PAGE_SIZE
    // The client fetches a second page on its own after a full first page.
    if (!exhausted) {
      const second = requestPage(board, first[first.length - 1]! - 1)
      rows = [...rows, ...second]
      exhausted = second.length < PAGE_SIZE
    }
    pane = { kind: 'postList', board, rows, selected: -1, exhausted }
  }

  const listBoards = (): void => {
    send({ action: 'listBoards' })
    feed({
      kind: 'boardList',
      heading: '',
      boards: boards.map((b) => ({ id: b.id, name: b.name }))
    })
    pane = { kind: 'boardList', selected: -1 }
  }

  const buttonName = (x: number, y: number): string => {
    if (x === rowPoint(0).x && y === rowPoint(0).y) return 'row0'
    if (x === BOARD_BUTTON.x && y === BOARD_BUTTON.y) return 'boardButton'
    const at = (p: { x: number; y: number }): boolean => p.x === x && p.y === y
    if (at(BUTTONS.view(false))) return 'view'
    if (at(BUTTONS.view(true))) return 'viewMail'
    if (at(BUTTONS.upFromPost())) return 'up'
    // Up on the mail list and Quit on the board list share one row of the pane.
    if (at(BUTTONS.upFromList(true))) return pane.kind === 'boardList' ? 'quit' : 'upMail'
    return `?(${x},${y})`
  }

  const click = async (
    _t: ActionTarget,
    x: number,
    y: number,
    options?: { once?: boolean }
  ): Promise<ActionRefusal | null> => {
    const name = buttonName(x, y)
    clicked.push(name + (options?.once === true ? '' : '×2'))
    if (refusal !== null) return refusal
    if (name === 'boardButton' && pane.kind === 'closed') listBoards()
    switch (pane.kind) {
      case 'boardList':
        if (name === 'row0') pane.selected = 0
        else if (name === 'view' && pane.selected >= 0) {
          const chosen =
            misopen !== null ? boards.find((b) => b.id === misopen)! : boards[pane.selected]!
          misopen = null
          openBoard(chosen)
        } else if (name === 'quit') pane = { kind: 'closed' }
        break
      case 'postList': {
        const mail = mailOf(pane.board)
        const viewName = mail ? 'viewMail' : 'view'
        // The list's View row and Up row differ between a board and the mailbox.
        const upName = mail ? 'upMail' : 'up'
        if (name === 'row0') pane.selected = 0
        else if (name === viewName && pane.selected >= 0) {
          const id = misread ?? pane.rows[pane.selected]!
          misread = null
          send({ action: 'readPost', boardId: pane.board.id, postId: id, navOffset: 0 })
          feed({
            kind: 'post',
            mail,
            subType: mail ? 5 : 3,
            postId: id,
            author: 'Ari',
            month: 7,
            day: 1,
            subject: `Post ${id}`,
            body: `Body of ${id}`
          })
          pane = { ...pane, kind: 'post' }
        } else if (name === upName) listBoards()
        else if (name === (mail ? 'up' : 'upMail')) pane = { kind: 'closed' }
        break
      }
      case 'post':
        if (name === 'up') pane = { ...pane, kind: 'postList' }
        break
      case 'closed':
        break
    }
    return null
  }

  const pressKey = async (_t: ActionTarget, key: number): Promise<ActionRefusal | null> => {
    keys.push(key)
    if (refusal !== null) return refusal
    if (pane.kind === 'boardList') {
      if (key === VK_DOWN) pane.selected = Math.min(pane.selected + 1, boards.length - 1)
      if (key === VK_UP) pane.selected = Math.max(pane.selected - 1, 0)
    }
    if (pane.kind === 'postList') {
      if (key === VK_UP) pane.selected = Math.max(pane.selected - 1, 0)
      if (key === VK_DOWN) {
        if (pane.selected < pane.rows.length - 1) pane.selected++
        else if (!pane.exhausted) {
          // Past the last row: the next page, from the oldest held id minus one.
          const more = requestPage(pane.board, pane.rows[pane.rows.length - 1]! - 1)
          pane.rows = [...pane.rows, ...more]
          if (more.length < PAGE_SIZE) pane.exhausted = true
        } else {
          // The trap: an exhausted list re-sends the same cursor.
          requestPage(pane.board, pane.rows[pane.rows.length - 1]! - 1)
        }
      }
    }
    return null
  }

  const layer = {
    resolveTarget: (id: string): ActionTarget | null => (id === CID ? TARGET : null),
    arm: (_id: string, cb?: (reason: string) => void): ActionTarget | ActionRefusal => {
      onStop = cb
      return TARGET
    },
    disarm: (): void => undefined,
    click,
    pressKey,
    get stopped(): boolean {
      return stopped.value
    }
  } as unknown as ActionLayer

  return {
    layer,
    state: () => state,
    requests,
    clicked,
    keys,
    pane: () => pane,
    setRefusal: (r) => {
      refusal = r
    },
    misreadNext: (id) => {
      misread = id
    },
    misopenNext: (id) => {
      misopen = id
    },
    fireStop: (reason) => {
      stopped.value = true
      onStop?.(reason)
    },
    stopped
  }
}

interface Harness {
  client: FakeClient
  poll: ReturnType<typeof createBoardPoll>
  states: BoardPollState[]
  bodies: Map<string, Set<number>>
  dialog: { current: DialogState | null }
}

function harness(
  boards: FakeBoard[],
  options: { bodies?: Record<string, number[]>; live?: boolean } = {}
): Harness {
  const clock = fakeClock()
  const client = fakeClient(boards, clock)
  const states: BoardPollState[] = []
  const bodies = new Map(
    Object.entries(options.bodies ?? {}).map(([key, ids]) => [key, new Set(ids)])
  )
  const dialog = { current: null as DialogState | null }
  const pollOptions: BoardPollOptions = {
    actionLayer: client.layer,
    liveConnections: () => (options.live === false ? [] : [{ connectionId: CID, name: 'Evenue' }]),
    boardFor: () => client.state(),
    dialogFor: () => dialog.current,
    readBodies: async (key) => bodies.get(key) ?? new Set(),
    log: noop,
    onState: (s) => states.push(s),
    now: clock.now,
    sleep: clock.sleep
  }
  return { client, poll: createBoardPoll(pollOptions), states, bodies, dialog }
}

/** Twenty posts, two pages; the ids have a gap, as retail's do. */
const PUBLIC: FakeBoard = {
  id: 10,
  name: 'Public',
  posts: [...Array(21).keys()].slice(1).filter((id) => id !== 13)
}
const MAIL: FakeBoard = { id: 0, name: 'Mail', posts: [3, 2] }
const EMPTY: FakeBoard = { id: 11, name: 'Law', posts: [] }

describe('the board poll (WP36 PR2)', () => {
  it('reads every board and the mailbox end to end, and quits the pane', async () => {
    const h = harness([MAIL, PUBLIC, EMPTY])
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toEqual({ kind: 'done', boardsRead: 3, postsRead: 21 })
    // Every post of every board was read, from its own row.
    const reads = h.client.requests.filter((r) => r.action === 'readPost')
    expect(
      reads.map((r) => (r.action === 'readPost' ? r.postId : 0)).sort((a, b) => a - b)
    ).toEqual([...MAIL.posts, ...PUBLIC.posts].sort((a, b) => a - b))
    expect(reads.every((r) => r.action === 'readPost' && r.navOffset === 0)).toBe(true)
    // The mailbox was read through its own View and Up rows.
    expect(h.client.clicked).toContain('viewMail')
    expect(h.client.clicked).toContain('upMail')
    // Nothing but the closed set was clicked, and every click was a single one.
    expect(new Set(h.client.clicked)).toEqual(
      new Set(['boardButton', 'row0', 'view', 'viewMail', 'up', 'upMail', 'quit'])
    )
    expect(h.client.keys.every((k) => k === VK_DOWN || k === VK_UP)).toBe(true)
    // The pane is closed at the end.
    expect(h.client.pane().kind).toBe('closed')
    const last = h.states[h.states.length - 1]
    expect(last).toMatchObject({ running: false, boardsDone: 3, boardsTotal: 3, postsRead: 21 })
    expect(last?.reason).toContain('3 boards and 21 posts')
  })

  it('pages to the oldest post with one request in flight, and never re-sends an exhausted cursor', async () => {
    const h = harness([PUBLIC])
    await h.poll.run({ connectionId: CID, onlyUnread: true })
    const pages = h.client.requests.filter((r) => r.action === 'listPosts')
    // The open (two pages, the second by the client itself) and nothing more:
    // the second page was short, so the poll pressed no further.
    expect(pages.map((r) => (r.action === 'listPosts' ? r.startPostId : 0))).toEqual([
      NEWEST_POST_CURSOR,
      3
    ])
  })

  it('asks for the next page by Down past the last row, and stops when a page adds nothing', async () => {
    // Exactly 32 posts: two full pages, then a page from 0 that is empty.
    const board: FakeBoard = { id: 12, name: 'Full', posts: [...Array(33).keys()].slice(1) }
    const h = harness([board])
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toEqual({ kind: 'done', boardsRead: 1, postsRead: 32 })
    const cursors = h.client.requests
      .filter((r) => r.action === 'listPosts')
      .map((r) => (r.action === 'listPosts' ? r.startPostId : 0))
    expect(cursors).toEqual([NEWEST_POST_CURSOR, 16, 0])
  })

  it('skips the posts whose body the archive holds, and reads them all when asked', async () => {
    const h = harness([PUBLIC], { bodies: { '10': [20, 19, 18] } })
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toMatchObject({ kind: 'done', postsRead: 16 })
    const read = h.client.requests
      .filter((r) => r.action === 'readPost')
      .map((r) => (r.action === 'readPost' ? r.postId : 0))
    expect(read).not.toContain(20)
    expect(read).toContain(17)

    const all = harness([PUBLIC], { bodies: { '10': [20, 19, 18] } })
    const everything = await all.poll.run({ connectionId: CID, onlyUnread: false })
    expect(everything).toMatchObject({ kind: 'done', postsRead: 19 })
  })

  it('re-syncs the selection from a wrong post and tries the row again', async () => {
    const h = harness([PUBLIC])
    // The first read shows post 18 (row 2) when row 0 (post 20) was asked for.
    h.client.misreadNext(18)
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toEqual({ kind: 'done', boardsRead: 1, postsRead: 19 })
    const read = h.client.requests
      .filter((r) => r.action === 'readPost')
      .map((r) => (r.action === 'readPost' ? r.postId : 0))
    // 18 was shown by mistake, then 20 on the retry, and every post follows.
    expect(read.slice(0, 3)).toEqual([18, 20, 19])
  })

  it('stops as lost when the client keeps showing another post', async () => {
    const h = harness([PUBLIC])
    const original = h.client.layer.click
    let calls = 0
    // Every View answers with post 5, whatever row is selected.
    h.client.layer.click = async (t, x, y, o) => {
      if (x === BUTTONS.view(false).x && y === BUTTONS.view(false).y && calls++ < MAX_MISSES + 2) {
        h.client.misreadNext(5)
      }
      return original(t, x, y, o)
    }
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'lost' })
  })

  it('tries a board row once more when another board opened, then stops as lost', async () => {
    const h = harness([MAIL, PUBLIC, EMPTY])
    h.client.misopenNext(11)
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    // The first open showed Law in place of the mailbox; Up and the second try got it right.
    expect(outcome).toMatchObject({ kind: 'done', boardsRead: 3 })

    const twice = harness([MAIL, PUBLIC])
    const original = twice.client.layer.click
    let opens = 0
    twice.client.layer.click = async (t, x, y, o) => {
      if (
        twice.client.pane().kind === 'boardList' &&
        x === BUTTONS.view(false).x &&
        y === BUTTONS.view(false).y
      ) {
        if (opens++ < OPEN_TRIES) twice.client.misopenNext(10)
      }
      return original(t, x, y, o)
    }
    expect(await twice.poll.run({ connectionId: CID, onlyUnread: true })).toMatchObject({
      kind: 'stopped',
      reason: 'lost',
      boardsRead: 0
    })
  })

  it('stops on the global stop, on a refusal, and when the character is gone', async () => {
    const stopped = harness([PUBLIC])
    let presses = 0
    const original = stopped.client.layer.pressKey
    stopped.client.layer.pressKey = async (t, k) => {
      if (++presses === 3) stopped.client.fireStop('hotkey')
      return original(t, k)
    }
    expect(await stopped.poll.run({ connectionId: CID, onlyUnread: true })).toMatchObject({
      kind: 'stopped',
      reason: 'user'
    })

    const refused = harness([PUBLIC])
    refused.client.setRefusal('noWindow')
    expect(await refused.poll.run({ connectionId: CID, onlyUnread: true })).toMatchObject({
      kind: 'stopped',
      reason: 'lostCharacter'
    })

    const gone = harness([PUBLIC], { live: false })
    await expect(gone.poll.run({ connectionId: CID, onlyUnread: true })).rejects.toThrow(
      'No character is logged in'
    )
  })

  it('stops when a dialog it did not open comes up, and touches nothing', async () => {
    const h = harness([PUBLIC])
    const original = h.client.layer.click
    h.client.layer.click = async (t, x, y, o) => {
      const result = await original(t, x, y, o)
      if (h.client.pane().kind === 'post') {
        h.dialog.current = {
          packet: { kind: 'npcMenu' } as never,
          asOfMs: Number.MAX_SAFE_INTEGER
        }
      }
      return result
    }
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'dialog' })
    // No click at the dialog's Close, no key to it: the last gesture was the poll's own.
    expect(h.client.clicked.filter((c) => c.startsWith('?'))).toEqual([])
  })

  it('stops with a timeout when the board button brings no board list', async () => {
    const h = harness([PUBLIC])
    h.client.layer.click = async () => null
    const outcome = await h.poll.run({ connectionId: CID, onlyUnread: true })
    expect(outcome).toMatchObject({ kind: 'stopped', reason: 'timeout' })
  })

  it('can be stopped from the tab while it runs', async () => {
    const h = harness([PUBLIC])
    const original = h.client.layer.pressKey
    let presses = 0
    h.client.layer.pressKey = async (t, k) => {
      if (++presses === 2) h.poll.stop(CID)
      return original(t, k)
    }
    expect(await h.poll.run({ connectionId: CID, onlyUnread: true })).toMatchObject({
      kind: 'stopped',
      reason: 'user'
    })
    expect(h.poll.states()).toEqual([])
  })

  it('names the pane where the hand browse measured it', () => {
    expect(PANE).toEqual({ x: 30, y: 0 })
    expect(BOARD_BUTTON).toEqual({ x: 626, y: 248 })
    expect(rowPoint(0)).toEqual({ x: 290, y: 27 })
    expect(BUTTONS.view(false)).toEqual({ x: 567, y: 46 })
    expect(BUTTONS.view(true)).toEqual({ x: 567, y: 72 })
    expect(BUTTONS.upFromPost()).toEqual({ x: 567, y: 229 })
    expect(BUTTONS.upFromList(false)).toEqual({ x: 567, y: 229 })
    expect(BUTTONS.upFromList(true)).toEqual({ x: 567, y: 256 })
    expect(BUTTONS.quit()).toEqual({ x: 567, y: 256 })
  })
})
