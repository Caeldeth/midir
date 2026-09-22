import { PacketReader } from '../reader'

/**
 * The bulletin boards and the mailbox (WP36).
 *
 * Two opcodes carry everything. SBulletin 0x31 is every view the server
 * sends: the list of boards, a page of a board's posts, one post, and the
 * same two shapes again for the mailbox, plus a one-line result after a
 * write. CBulletin 0x3B is every request the client makes: list the boards,
 * page a board, read a post, and the four writes (post, delete, send mail,
 * highlight), which Midir decodes for the record and never sends.
 *
 * The first body byte of 0x31 is the type, and the type selects both the wire
 * shape and the dialog the client opens, so it travels as its own field: the
 * board index (2) and the mail index (4) share one shape, the post (3) and
 * the mail (5) share one shape. Board 0 is the mailbox.
 *
 * The layouts are the document repo's, binary-verified against the USDA
 * client, read beside darkages-741-re's. The two disagree on the `u16` after
 * a post's two lead bytes (`postId` against `board_id`); the verified page
 * is followed, and the first live capture settles it. No recording on disk
 * held a 0x31 when this was written, so the first live browse is the proof.
 */

/** One row of a board's or the mailbox's index. */
export interface PostHeader {
  /** True for a post the player highlighted, or unread mail. */
  highlighted: boolean
  postId: number
  author: string
  month: number
  day: number
  subject: string
}

/** SBulletin 0x31. */
export type Bulletin =
  | {
      kind: 'boardList'
      /** The pane's heading, "Boards" on retail. */
      heading: string
      boards: { id: number; name: string }[]
    }
  | {
      kind: 'postList'
      /** True for the mailbox (type 4), false for a board (type 2). */
      mail: boolean
      /** 1 opened from the menu, 2 opened from a board in the world, 0 hides the close button. */
      subType: number
      boardId: number
      boardName: string
      /** Newest first, as the server sends them. */
      rows: PostHeader[]
    }
  | {
      kind: 'post'
      /** True for a mail (type 5), false for a board post (type 3). */
      mail: boolean
      subType: number
      /** 0 is the server's "no such post": the client shows an alert and no post. */
      postId: number
      author: string
      month: number
      day: number
      subject: string
      body: string
    }
  | {
      kind: 'boardResult'
      /** 6 after a post, 7 after a delete, 8 after a highlight. */
      type: number
      success: boolean
      message: string
    }

/** The type byte of each 0x31 shape. */
export const BULLETIN_TYPE = {
  boardList: 1,
  boardIndex: 2,
  boardPost: 3,
  mailIndex: 4,
  mailPost: 5,
  postResult: 6,
  deleteResult: 7,
  highlightResult: 8
} as const

/** The board id the client uses for the mailbox. */
export const MAILBOX_ID = 0

/**
 * Decode SBulletin 0x31, or return null for a type the client itself drops
 * (anything above 8).
 *
 * Body, by type:
 *   1: `[string8 heading][u8 count]` then `count` × `[u16 id][string8 name]`
 *   2, 4: `[u8 subType][u16 boardId][string8 boardName][u8 count]` then rows of
 *         `[u8 highlight][u16 postId][string8 author][u8 month][u8 day][string8 subject]`
 *   3, 5: `[u8 subType][u8 unused][u16 postId][string8 author][u8 month][u8 day]
 *         [string8 subject][string16 body]`
 *   6, 7, 8: `[u8 success][string8 message]`
 */
export function decodeBulletin(body: Uint8Array): Bulletin | null {
  const reader = new PacketReader(body, 1)
  const type = reader.u8()
  switch (type) {
    case BULLETIN_TYPE.boardList: {
      const heading = reader.string8()
      const count = reader.u8()
      const boards: { id: number; name: string }[] = []
      for (let i = 0; i < count; i++) boards.push({ id: reader.u16(), name: reader.string8() })
      return { kind: 'boardList', heading, boards }
    }
    case BULLETIN_TYPE.boardIndex:
    case BULLETIN_TYPE.mailIndex: {
      const subType = reader.u8()
      const boardId = reader.u16()
      const boardName = reader.string8()
      const count = reader.u8()
      const rows: PostHeader[] = []
      for (let i = 0; i < count; i++) {
        rows.push({
          highlighted: reader.u8() !== 0,
          postId: reader.u16(),
          author: reader.string8(),
          month: reader.u8(),
          day: reader.u8(),
          subject: reader.string8()
        })
      }
      return {
        kind: 'postList',
        mail: type === BULLETIN_TYPE.mailIndex,
        subType,
        boardId,
        boardName,
        rows
      }
    }
    case BULLETIN_TYPE.boardPost:
    case BULLETIN_TYPE.mailPost: {
      const subType = reader.u8()
      reader.skip(1) // read by the client and never shown; Hybrasyl writes the highlight here
      const postId = reader.u16()
      if (postId === 0) {
        // The server's "no such post": the client parses no further.
        return {
          kind: 'post',
          mail: type === BULLETIN_TYPE.mailPost,
          subType,
          postId,
          author: '',
          month: 0,
          day: 0,
          subject: '',
          body: ''
        }
      }
      return {
        kind: 'post',
        mail: type === BULLETIN_TYPE.mailPost,
        subType,
        postId,
        author: reader.string8(),
        month: reader.u8(),
        day: reader.u8(),
        subject: reader.string8(),
        body: reader.string16()
      }
    }
    case BULLETIN_TYPE.postResult:
    case BULLETIN_TYPE.deleteResult:
    case BULLETIN_TYPE.highlightResult:
      return { kind: 'boardResult', type, success: reader.u8() !== 0, message: reader.string8() }
    default:
      return null
  }
}

/** CBulletin 0x3B: what the client asked the boards for. */
export type BulletinRequest = { kind: 'bulletinRequest' } & (
  | { action: 'listBoards' }
  | {
      action: 'listPosts'
      boardId: number
      /** The post id to page from; 0x7FFF is the newest. */
      startPostId: number
      /** Negative pages older, positive newer; the client's first page is -16. */
      navOffset: number
    }
  | {
      action: 'readPost'
      boardId: number
      postId: number
      /** 0 for the row clicked, -1 and +1 for the Prev and Next buttons. */
      navOffset: number
    }
  | { action: 'post'; boardId: number; subject: string; body: string }
  | { action: 'delete'; boardId: number; postId: number }
  | { action: 'sendMail'; boardId: number; recipient: string; subject: string; body: string }
  | { action: 'highlight'; boardId: number; postId: number }
)

/** The first page's cursor and count, as the client's own first-page open sends them. */
export const NEWEST_POST_CURSOR = 0x7fff
export const PAGE_SIZE = 16

/**
 * Decode CBulletin 0x3B, or return null for an action the client does not
 * have. A delete has two wire lengths (6 and 7 bytes, the last a zero the
 * client sometimes appends); the trailing byte is not a field.
 */
export function decodeBulletinRequest(body: Uint8Array): BulletinRequest | null {
  const reader = new PacketReader(body, 1)
  const action = reader.u8()
  switch (action) {
    case 1:
      return { kind: 'bulletinRequest', action: 'listBoards' }
    case 2:
      return {
        kind: 'bulletinRequest',
        action: 'listPosts',
        boardId: reader.u16(),
        startPostId: reader.u16(),
        navOffset: reader.i8()
      }
    case 3:
      return {
        kind: 'bulletinRequest',
        action: 'readPost',
        boardId: reader.u16(),
        postId: reader.u16(),
        navOffset: reader.i8()
      }
    case 4:
      return {
        kind: 'bulletinRequest',
        action: 'post',
        boardId: reader.u16(),
        subject: reader.string8(),
        body: reader.string16()
      }
    case 5:
      return {
        kind: 'bulletinRequest',
        action: 'delete',
        boardId: reader.u16(),
        postId: reader.u16()
      }
    case 6:
      return {
        kind: 'bulletinRequest',
        action: 'sendMail',
        boardId: reader.u16(),
        recipient: reader.string8(),
        subject: reader.string8(),
        body: reader.string16()
      }
    case 7:
      return {
        kind: 'bulletinRequest',
        action: 'highlight',
        boardId: reader.u16(),
        postId: reader.u16()
      }
    default:
      return null
  }
}
