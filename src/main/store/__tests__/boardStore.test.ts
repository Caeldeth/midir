import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BOARDS_FILE,
  createBoardStore,
  emptyBoardFile,
  summarize,
  withBoardList,
  withPost,
  withPostList,
  type BoardFile
} from '../boardStore'

/** The board archive (WP36). */

const row = (postId: number, subject = `Post ${postId}`, highlighted = false) => ({
  highlighted,
  postId,
  author: 'Ari',
  month: 7,
  day: 15,
  subject
})

function page(
  file: BoardFile,
  rows: ReturnType<typeof row>[],
  seenAtMs = 1000,
  mail = false
): BoardFile {
  return withPostList(file, {
    boardId: mail ? 0 : 10,
    boardName: mail ? 'Mail' : 'Public',
    mail,
    rows,
    seenAtMs,
    seenBy: 'Sabrael'
  })
}

function opened(file: BoardFile, postId: number, seenAtMs = 2000, mail = false): BoardFile {
  return withPost(file, {
    boardId: mail ? 0 : 10,
    mail,
    postId,
    author: 'Ari',
    month: 7,
    day: 15,
    subject: `Post ${postId}`,
    body: `Body of ${postId}`,
    seenAtMs,
    seenBy: 'Sabrael'
  })
}

describe('the board archive', () => {
  it('names a board from the list before any post is seen', () => {
    const file = withBoardList(emptyBoardFile(), [{ id: 10, name: 'Public' }], 500)
    expect(file.boards['10']).toMatchObject({
      key: '10',
      id: 10,
      name: 'Public',
      mail: false,
      posts: {}
    })
  })

  it('keeps every header a page lists, and a body once a post is opened', () => {
    let file = page(emptyBoardFile(), [row(50), row(49)])
    expect(Object.keys(file.boards['10']!.posts).sort()).toEqual(['49', '50'])
    expect(file.boards['10']!.posts['50']!.body).toBeUndefined()
    file = opened(file, 50)
    expect(file.boards['10']!.posts['50']).toMatchObject({ body: 'Body of 50', bodyAtMs: 2000 })
  })

  it('never replaces a body with a header, and lets a header update the rest', () => {
    let file = opened(page(emptyBoardFile(), [row(50)]), 50)
    file = page(file, [row(50, 'Edited', true)], 3000)
    expect(file.boards['10']!.posts['50']).toMatchObject({
      body: 'Body of 50',
      subject: 'Edited',
      highlighted: true,
      seenAtMs: 3000
    })
    // A post opened again keeps its highlight from the list.
    file = opened(file, 50, 4000)
    expect(file.boards['10']!.posts['50']).toMatchObject({ highlighted: true, bodyAtMs: 4000 })
  })

  it('keeps the mailbox under the character who owns it, apart from every board', () => {
    let file = page(emptyBoardFile(), [row(3)], 1000, true)
    file = opened(file, 3, 2000, true)
    expect(Object.keys(file.boards)).toEqual(['mail:Sabrael'])
    expect(file.boards['mail:Sabrael']).toMatchObject({ id: 0, mail: true, owner: 'Sabrael' })
    expect(file.boards['mail:Sabrael']!.posts['3']!.body).toBe('Body of 3')
  })

  it('keeps a post for a board that was never listed, and names the board when the list comes', () => {
    let file = opened(emptyBoardFile(), 7)
    expect(file.boards['10']).toMatchObject({ name: '', posts: { '7': { body: 'Body of 7' } } })
    file = withBoardList(file, [{ id: 10, name: 'Public' }], 5000)
    expect(file.boards['10']).toMatchObject({
      name: 'Public',
      posts: { '7': { body: 'Body of 7' } }
    })
  })

  it('summarizes every board, most recently seen first', () => {
    let file = page(emptyBoardFile(), [row(50), row(49)], 1000)
    file = opened(file, 50, 1500)
    file = page(file, [row(3)], 2000, true)
    expect(summarize(file)).toEqual([
      {
        key: 'mail:Sabrael',
        id: 0,
        name: 'Mail',
        mail: true,
        owner: 'Sabrael',
        postCount: 1,
        bodyCount: 0,
        seenAtMs: 2000
      },
      { key: '10', id: 10, name: 'Public', mail: false, postCount: 2, bodyCount: 1, seenAtMs: 1500 }
    ])
  })

  it('does not change the file it was given', () => {
    const file = page(emptyBoardFile(), [row(50)])
    const before = JSON.stringify(file)
    opened(file, 50)
    page(file, [row(49)])
    expect(JSON.stringify(file)).toBe(before)
  })
})

describe('the board store on disk', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-boards-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('starts empty, and writes a board back readable', async () => {
    const store = createBoardStore(directory)
    expect(await store.load()).toEqual({ boards: {} })
    await store.update((file) => opened(page(file, [row(50)]), 50))
    const raw = JSON.parse(await readFile(join(directory, BOARDS_FILE), 'utf-8'))
    expect(raw.boards['10'].posts['50'].body).toBe('Body of 50')
    const reopened = createBoardStore(directory)
    expect((await reopened.load()).boards['10']!.posts['50']!.bodyAtMs).toBe(2000)
  })

  it('keeps the mailbox owner across a restart', async () => {
    const store = createBoardStore(directory)
    await store.update((file) => page(file, [row(3)], 1000, true))
    const reopened = createBoardStore(directory)
    expect((await reopened.load()).boards['mail:Sabrael']?.owner).toBe('Sabrael')
  })
})
