import { describe, expect, it } from 'vitest'
import { decodeBulletin, decodeBulletinRequest, NEWEST_POST_CURSOR } from '../decode/board'
import { decodeClientPacket, decodeServerPacket } from '../decode'

/**
 * The boards and the mailbox (WP36). No recording on disk held a 0x31 when
 * these were written, so the bytes are built from the document repo's
 * binary-verified layouts and darkages-741-re's worked example (the "Public"
 * board, Ari's "Hello"). The first live browse is the proof against retail.
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const str8 = (text: string): number[] => [text.length, ...[...text].map((c) => c.charCodeAt(0))]
const str16 = (text: string): number[] => [
  text.length >> 8,
  text.length & 0xff,
  ...[...text].map((c) => c.charCodeAt(0))
]
const u16 = (n: number): number[] => [n >> 8, n & 0xff]

describe('decodeBulletin 0x31', () => {
  it('reads the board list', () => {
    const packet = decodeBulletin(
      bytes(
        0x31,
        0x01,
        ...str8('Boards'),
        0x02,
        ...u16(10),
        ...str8('Public'),
        ...u16(11),
        ...str8('Help')
      )
    )
    expect(packet).toEqual({
      kind: 'boardList',
      heading: 'Boards',
      boards: [
        { id: 10, name: 'Public' },
        { id: 11, name: 'Help' }
      ]
    })
  })

  it('reads a page of a board and a page of the mailbox with one shape', () => {
    const row = [0x01, ...u16(42), ...str8('Ari'), 7, 15, ...str8('Hello')]
    const body = [0x02, ...u16(10), ...str8('Public'), 0x01, ...row]
    expect(decodeBulletin(bytes(0x31, 0x02, ...body))).toEqual({
      kind: 'postList',
      mail: false,
      subType: 2,
      boardId: 10,
      boardName: 'Public',
      rows: [{ highlighted: true, postId: 42, author: 'Ari', month: 7, day: 15, subject: 'Hello' }]
    })
    const mail = decodeBulletin(bytes(0x31, 0x04, 0x01, ...u16(0), ...str8('Mail'), 0x01, ...row))
    expect(mail).toMatchObject({ kind: 'postList', mail: true, boardId: 0 })
  })

  it('reads a post and a mail with one shape, and the empty-post canary', () => {
    const body = [
      0x00,
      0x00,
      ...u16(42),
      ...str8('Ari'),
      7,
      15,
      ...str8('Hello'),
      ...str16('Welcome!')
    ]
    expect(decodeBulletin(bytes(0x31, 0x03, ...body))).toEqual({
      kind: 'post',
      mail: false,
      subType: 0,
      postId: 42,
      author: 'Ari',
      month: 7,
      day: 15,
      subject: 'Hello',
      body: 'Welcome!'
    })
    expect(decodeBulletin(bytes(0x31, 0x05, ...body))).toMatchObject({ kind: 'post', mail: true })
    // Post id 0 is "no such post": the client parses nothing after it.
    expect(decodeBulletin(bytes(0x31, 0x03, 0x00, 0x00, 0x00, 0x00))).toMatchObject({
      kind: 'post',
      postId: 0,
      body: ''
    })
  })

  it('reads the three results, and drops a type the client drops', () => {
    expect(decodeBulletin(bytes(0x31, 0x08, 0x01, ...str8('Posted.')))).toEqual({
      kind: 'boardResult',
      type: 8,
      success: true,
      message: 'Posted.'
    })
    expect(decodeBulletin(bytes(0x31, 0x09, 0x01))).toBeNull()
  })

  it('accepts a body longer than its fields', () => {
    expect(decodeBulletin(bytes(0x31, 0x01, ...str8('Boards'), 0x00, 0xaa, 0xbb))).toMatchObject({
      kind: 'boardList',
      boards: []
    })
  })

  it('is registered for the server opcode', () => {
    expect(decodeServerPacket(bytes(0x31, 0x01, ...str8('Boards'), 0x00))?.kind).toBe('boardList')
  })
})

describe('decodeBulletinRequest 0x3B', () => {
  it("reads the client's first-page open, a scroll-back page, and a read", () => {
    expect(decodeBulletinRequest(bytes(0x3b, 0x01))).toEqual({
      kind: 'bulletinRequest',
      action: 'listBoards'
    })
    expect(decodeBulletinRequest(bytes(0x3b, 0x02, ...u16(10), 0x7f, 0xff, 0xf0))).toEqual({
      kind: 'bulletinRequest',
      action: 'listPosts',
      boardId: 10,
      startPostId: NEWEST_POST_CURSOR,
      navOffset: -16
    })
    expect(decodeBulletinRequest(bytes(0x3b, 0x03, ...u16(10), ...u16(42), 0xff))).toEqual({
      kind: 'bulletinRequest',
      action: 'readPost',
      boardId: 10,
      postId: 42,
      navOffset: -1
    })
  })

  it('reads the four writes, and both lengths of a delete', () => {
    expect(
      decodeBulletinRequest(
        bytes(0x3b, 0x04, ...u16(10), ...str8('Meeting'), ...str16('Meet at the inn.'))
      )
    ).toEqual({
      kind: 'bulletinRequest',
      action: 'post',
      boardId: 10,
      subject: 'Meeting',
      body: 'Meet at the inn.'
    })
    const del = { kind: 'bulletinRequest', action: 'delete', boardId: 10, postId: 42 }
    expect(decodeBulletinRequest(bytes(0x3b, 0x05, ...u16(10), ...u16(42)))).toEqual(del)
    expect(decodeBulletinRequest(bytes(0x3b, 0x05, ...u16(10), ...u16(42), 0x00))).toEqual(del)
    expect(
      decodeBulletinRequest(
        bytes(0x3b, 0x06, ...u16(0), ...str8('Bran'), ...str8('Hi'), ...str16('Hello Bran'))
      )
    ).toEqual({
      kind: 'bulletinRequest',
      action: 'sendMail',
      boardId: 0,
      recipient: 'Bran',
      subject: 'Hi',
      body: 'Hello Bran'
    })
    expect(decodeBulletinRequest(bytes(0x3b, 0x07, ...u16(10), ...u16(42)))).toEqual({
      kind: 'bulletinRequest',
      action: 'highlight',
      boardId: 10,
      postId: 42
    })
    expect(decodeBulletinRequest(bytes(0x3b, 0x08))).toBeNull()
  })

  it('is registered for the client opcode', () => {
    expect(decodeClientPacket(bytes(0x3b, 0x01))?.kind).toBe('bulletinRequest')
  })
})
