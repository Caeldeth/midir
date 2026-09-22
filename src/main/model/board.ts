import type { DecodedPacket } from '../protocol/decode'
import type { BulletinRequest, PostHeader } from '../protocol/decode/board'
import { MAILBOX_ID } from '../protocol/decode/board'

/**
 * The boards as the client shows them now, per connection (WP36).
 *
 * A pure reducer like the dialog's. It holds three live facts and nothing
 * the archive keeps: the board list the server last sent, the board or
 * mailbox whose index is open (with every page of it seen so far, so the
 * poll can tell whether a page added anything), the post on screen, and the
 * client's newest request. The request is what attributes a post to its
 * board: a post on the wire carries its own id and not its board's, so the
 * board is the one the client asked for.
 *
 * A new map or a loss clears nothing here: the board pane survives neither
 * on the client, but the archive has already taken what it needs, and a
 * stale open board only mis-attributes a post that the next request
 * re-attributes.
 */

export interface OpenBoard {
  boardId: number
  boardName: string
  mail: boolean
  /** Every row seen on this board since it was opened, newest first, one per post id. */
  rows: PostHeader[]
  /** How many rows the newest page added. Zero means the oldest post is reached. */
  lastPageAdded: number
  /** How many rows the newest page carried. Fewer than a full page means the oldest post is on it. */
  lastPageRows: number
  asOfMs: number
}

export interface BoardState {
  /** The boards the server listed last, in its order. */
  boards?: { id: number; name: string }[]
  /** When the board list arrived. The poll waits for a list newer than its key press. */
  boardsAtMs?: number
  /** The board or mailbox whose index is open. */
  open?: OpenBoard
  /** The post on screen. `postId` 0 is the server's "no such post". */
  post?: {
    boardId: number
    mail: boolean
    postId: number
    author: string
    month: number
    day: number
    subject: string
    body: string
    asOfMs: number
  }
  /** The client's newest request. */
  request?: BulletinRequest & { asOfMs: number }
  /** A result after a write, the newest. */
  result?: { type: number; success: boolean; message: string; asOfMs: number }
  asOfMs: number
}

export interface BoardInput {
  packet: DecodedPacket
  timestampMs: number
}

/** Apply one packet. Returns a new state and never changes the old one. Null while nothing has been seen. */
export function reduceBoard(state: BoardState | null, input: BoardInput): BoardState | null {
  const { packet, timestampMs } = input
  if (packet.kind === 'bulletinRequest') {
    return { ...(state ?? {}), request: { ...packet, asOfMs: timestampMs }, asOfMs: timestampMs }
  }
  switch (packet.kind) {
    case 'boardList':
      return {
        ...(state ?? {}),
        boards: packet.boards,
        boardsAtMs: timestampMs,
        asOfMs: timestampMs
      }
    case 'postList': {
      const open = state?.open
      const sameBoard =
        open !== undefined && open.boardId === packet.boardId && open.mail === packet.mail
      const known = new Set(sameBoard ? open.rows.map((r) => r.postId) : [])
      const added = packet.rows.filter((r) => !known.has(r.postId))
      const rows = sameBoard ? [...open.rows] : []
      // A row seen again carries the newer highlight and subject.
      for (const row of packet.rows) {
        const at = rows.findIndex((r) => r.postId === row.postId)
        if (at >= 0) rows[at] = row
        else rows.push(row)
      }
      rows.sort((a, b) => b.postId - a.postId)
      return {
        ...(state ?? {}),
        open: {
          boardId: packet.boardId,
          boardName: packet.boardName,
          mail: packet.mail,
          rows,
          lastPageAdded: added.length,
          lastPageRows: packet.rows.length,
          asOfMs: timestampMs
        },
        asOfMs: timestampMs
      }
    }
    case 'post':
      return {
        ...(state ?? {}),
        post: {
          boardId: boardOfPost(state, packet.mail),
          mail: packet.mail,
          postId: packet.postId,
          author: packet.author,
          month: packet.month,
          day: packet.day,
          subject: packet.subject,
          body: packet.body,
          asOfMs: timestampMs
        },
        asOfMs: timestampMs
      }
    case 'boardResult':
      return {
        ...(state ?? {}),
        result: {
          type: packet.type,
          success: packet.success,
          message: packet.message,
          asOfMs: timestampMs
        },
        asOfMs: timestampMs
      }
    default:
      return state
  }
}

/**
 * The board a post on the wire belongs to: the one the client's newest
 * read asked for, else the board whose index is open. A mail is always the
 * mailbox. -1 when nothing says.
 */
export function boardOfPost(state: BoardState | null, mail: boolean): number {
  if (mail) return MAILBOX_ID
  const request = state?.request
  if (request !== undefined && request.action === 'readPost') return request.boardId
  if (state?.open !== undefined && !state.open.mail) return state.open.boardId
  return -1
}
