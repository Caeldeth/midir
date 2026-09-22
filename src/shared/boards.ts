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
  /** Posts by post id, as a string key. */
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
  }[]
}
