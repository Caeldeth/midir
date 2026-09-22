import { describe, expect, it } from 'vitest'
import { boardOfPost, reduceBoard, type BoardState } from '../board'
import type { DecodedPacket } from '../../protocol/decode'
import type { PostHeader } from '../../protocol/decode/board'

/** The boards as the client shows them (WP36). */

const row = (postId: number, subject = `Post ${postId}`): PostHeader => ({
  highlighted: false,
  postId,
  author: 'Ari',
  month: 7,
  day: 15,
  subject
})
const list = (boardId: number, rows: PostHeader[], mail = false): DecodedPacket => ({
  kind: 'postList',
  mail,
  subType: 1,
  boardId,
  boardName: mail ? 'Mail' : 'Public',
  rows
})
const post = (postId: number, mail = false): DecodedPacket => ({
  kind: 'post',
  mail,
  subType: 0,
  postId,
  author: 'Ari',
  month: 7,
  day: 15,
  subject: `Post ${postId}`,
  body: 'Welcome!'
})
const read = (boardId: number, postId: number): DecodedPacket => ({
  kind: 'bulletinRequest',
  action: 'readPost',
  boardId,
  postId,
  navOffset: 0
})

let clock = 1000
const feed = (state: BoardState | null, packet: DecodedPacket): BoardState | null =>
  reduceBoard(state, { packet, timestampMs: ++clock })

describe('the boards on screen (WP36)', () => {
  it('keeps the board list', () => {
    const state = feed(null, {
      kind: 'boardList',
      heading: 'Boards',
      boards: [{ id: 10, name: 'Public' }]
    })
    expect(state?.boards).toEqual([{ id: 10, name: 'Public' }])
  })

  it('accumulates the pages of one board, deduped, newest first, and says what each page added', () => {
    let state = feed(null, list(10, [row(50), row(49), row(48)]))
    expect(state?.open?.lastPageAdded).toBe(3)
    // The scroll-back page includes the cursor post: the overlap adds nothing.
    state = feed(state, list(10, [row(48), row(47)]))
    expect(state?.open?.rows.map((r) => r.postId)).toEqual([50, 49, 48, 47])
    expect(state?.open?.lastPageAdded).toBe(1)
    // The same page again adds nothing: the oldest post is reached.
    state = feed(state, list(10, [row(48), row(47)]))
    expect(state?.open?.lastPageAdded).toBe(0)
    // A row seen again carries the newer subject.
    state = feed(state, list(10, [row(50, 'Edited')]))
    expect(state?.open?.rows[0]?.subject).toBe('Edited')
    expect(state?.open?.rows).toHaveLength(4)
  })

  it('starts over when another board opens', () => {
    let state = feed(null, list(10, [row(50)]))
    state = feed(state, list(11, [row(7)]))
    expect(state?.open).toMatchObject({ boardId: 11, rows: [row(7)], lastPageAdded: 1 })
    // The mailbox is its own board, even when its id collides with nothing.
    state = feed(state, list(0, [row(3)], true))
    expect(state?.open).toMatchObject({ boardId: 0, mail: true, rows: [row(3)] })
  })

  it("attributes a post to the board the client's read asked for, else the open board", () => {
    let state = feed(null, list(10, [row(50)]))
    expect(boardOfPost(state, false)).toBe(10)
    state = feed(state, read(11, 7))
    expect(boardOfPost(state, false)).toBe(11)
    state = feed(state, post(7))
    expect(state?.post).toMatchObject({ boardId: 11, postId: 7, body: 'Welcome!' })
    // A mail is always the mailbox.
    expect(boardOfPost(state, true)).toBe(0)
    expect(feed(state, post(3, true))?.post).toMatchObject({ boardId: 0, mail: true })
    // Nothing open and nothing asked: unknown.
    expect(boardOfPost(null, false)).toBe(-1)
  })

  it('keeps the newest request and the newest result', () => {
    let state = feed(null, read(10, 42))
    expect(state?.request).toMatchObject({ action: 'readPost', boardId: 10, postId: 42 })
    state = feed(state, { kind: 'boardResult', type: 7, success: true, message: 'Deleted.' })
    expect(state?.result).toMatchObject({ type: 7, success: true })
  })

  it('ignores a packet that is not a board', () => {
    const state = feed(null, list(10, [row(50)]))
    expect(feed(state, { kind: 'removeInventory', slot: 3 })).toBe(state)
    expect(feed(null, { kind: 'removeInventory', slot: 3 })).toBeNull()
  })
})
