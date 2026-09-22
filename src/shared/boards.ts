/**
 * The board archive (WP36): every bulletin-board post and every mail the
 * player has seen, off the wire, in a store of its own.
 *
 * Pure TypeScript. No Electron or Node imports.
 */

/** One post as the archive holds it. */
export interface PostRecord {
  postId: number
  author: string
  /** The month and day the server shows; the server sends no year. */
  month: number
  day: number
  subject: string
  /** True for a post the player highlighted, or unread mail, when last listed. */
  highlighted: boolean
  /** The body, once the post has been opened. Absent for a post seen only in a list. */
  body?: string
  /** When the header was last seen, in capture time. */
  seenAtMs: number
  /** When the body was read, in capture time. Absent with `body`. */
  bodyAtMs?: number
  /** The character who was logged in when the post was seen. */
  seenBy: string
  /**
   * Set when another post took this post's id on the board. A board's ids
   * are not unique over time: a post that leaves the board frees its id
   * for the next, so a listed id whose author, date, or subject differ
   * from the post held is a new post, and the old one is kept under a key
   * of its own with this stamp, never overwritten.
   */
  displacedAtMs?: number
}

/** One board, or one character's mailbox. */
export interface BoardRecord {
  /** `${id}` for a board, `mail:${owner}` for a mailbox. */
  key: string
  /** The board id on the wire; 0 for a mailbox. */
  id: number
  name: string
  /** True for a mailbox. */
  mail: boolean
  /** The character whose mailbox this is. Absent for a board. */
  owner?: string
  /**
   * Posts by post id, as a string key, for the post the board shows under
   * that id now; a post the id was taken from is under `${id}~${seenAtMs}`.
   */
  posts: Record<string, PostRecord>
  /** When the board was last seen on the wire, in capture time. */
  seenAtMs: number
}

/** What the Boards tab lists. */
export interface BoardSummary {
  key: string
  id: number
  name: string
  mail: boolean
  owner?: string
  /** Posts the archive holds a header for. */
  postCount: number
  /** Posts the archive holds a body for. */
  bodyCount: number
  seenAtMs: number
}

/** The key of a board or a mailbox in the archive. */
export function boardKey(id: number, mail: boolean, owner: string): string {
  return mail ? `mail:${owner}` : String(id)
}

/** The export's shape: what the Brigid prototype wrote, and what its readers expect. */
export interface BoardExport {
  boardId: number
  boardName: string
  /** The mailbox's owner, for a mailbox export. */
  owner?: string
  capturedUtc: string
  postCount: number
  posts: {
    postId: number
    author: string
    month: number
    day: number
    subject: string
    body: string | null
    highlighted: boolean
    /** True for a post whose id another post took since; the board no longer shows it. */
    displaced?: boolean
  }[]
}

/**
 * Which boards the poll reads: every board in the client's list and the
 * mailbox; the board whose list is open on screen now (a board in the world
 * is opened by a click on it and is not in the list); or named boards from
 * the list, the mailbox as id 0.
 */
export type BoardPollScope = 'all' | 'open' | { boardIds: number[] }

/** What the poll is asked to do (WP36 PR2). */
export interface BoardPollRequest {
  connectionId: string
  scope: BoardPollScope
  /**
   * Skip every post whose body the archive already holds. On by default: a
   * post never changes once written, so a second poll of the same board only
   * needs the posts it has not read.
   */
  onlyUnread: boolean
}

/** Why the poll stopped short of the end. */
export type BoardPollStopReason =
  /** The user stopped it, with the button or the global stop. */
  | 'user'
  /** The character logged off, or the game window closed. */
  | 'lostCharacter'
  /** A gesture got no reply within its wait. */
  | 'timeout'
  /** The client showed another board or post than the poll asked for, too many times. */
  | 'lost'
  /** A dialog the poll did not open came up. The poll touches no dialog. */
  | 'dialog'

export type BoardPollOutcome =
  | { kind: 'done'; boardsRead: number; postsRead: number }
  | { kind: 'stopped'; reason: BoardPollStopReason; boardsRead: number; postsRead: number }

/** What one poll is doing now. Pushed on every change. */
export interface BoardPollState {
  connectionId: string
  running: boolean
  /** What the poll is on now, ready to show the user. */
  doing?: string
  /** The board being read, once one is. */
  boardName?: string
  boardsDone: number
  boardsTotal: number
  postsRead: number
  /** Why the poll ended, when it ended for a reason worth showing. */
  reason?: string
}

/** A message worth showing the user for each stop reason. */
export function boardPollStopMessage(reason: BoardPollStopReason): string {
  switch (reason) {
    case 'user':
      return 'You stopped the poll.'
    case 'lostCharacter':
      return 'The character logged off or the window closed.'
    case 'timeout':
      return 'The poll waited for the client and nothing came.'
    case 'lost':
      return 'The client showed a different board or post than the poll asked for, and the poll stopped rather than guess.'
    case 'dialog':
      return 'A dialog came up that the poll did not open, and the poll stopped.'
  }
}
