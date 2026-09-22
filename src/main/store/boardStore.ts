import { join } from 'node:path'
import { z } from 'zod'
import { boardKey, type BoardRecord, type BoardSummary, type PostRecord } from '../../shared/boards'
import type { PostHeader } from '../protocol/decode/board'
import { createJsonStore, type JsonStore, type JsonStoreFailure } from '../jsonStore'

/**
 * Where the board archive lives (WP36).
 *
 * A board is not a character and not an item, so it has a file of its own,
 * `boards.json`, beside `characters.json`, with the same care: a backup, and
 * a corrupt file moved aside rather than discarded. A board post is content
 * that exists nowhere else once the server drops it, so a reading seen once
 * stays.
 *
 * Two rules shape the merge. A header never replaces a body: a list carries
 * only headers, and a post opened once keeps its body through every later
 * page that lists it. And the mailbox is one board per character: board 0 is
 * whoever is logged in, so the mailbox's key is the character's name.
 */

export const BOARDS_FILE = 'boards.json'

const postSchema = z.object({
  postId: z.number(),
  author: z.string(),
  month: z.number(),
  day: z.number(),
  subject: z.string(),
  highlighted: z.boolean(),
  body: z.string().optional(),
  seenAtMs: z.number(),
  bodyAtMs: z.number().optional(),
  seenBy: z.string()
})

// A field missing from this schema is dropped on load, silently (WP11's rule).
const boardSchema = z.object({
  key: z.string().min(1),
  id: z.number(),
  name: z.string(),
  mail: z.boolean(),
  owner: z.string().optional(),
  posts: z.record(z.string(), postSchema),
  seenAtMs: z.number()
})

const fileSchema = z.object({
  boards: z.record(z.string(), boardSchema)
})

export interface BoardFile {
  boards: Record<string, BoardRecord>
}

export type BoardStore = JsonStore<BoardFile>

export function emptyBoardFile(): BoardFile {
  return { boards: {} }
}

/** Open the board store under `directory`. */
export function createBoardStore(
  directory: string,
  onFailure?: (failure: JsonStoreFailure) => void
): BoardStore {
  return createJsonStore<BoardFile>({
    path: join(directory, BOARDS_FILE),
    fallback: emptyBoardFile,
    normalize: (raw) => {
      const parsed = fileSchema.safeParse(raw)
      return parsed.success ? (parsed.data as BoardFile) : null
    },
    backup: true,
    quarantine: true,
    cacheReads: true,
    ...(onFailure !== undefined ? { onFailure } : {})
  })
}

/** A board's record, or a fresh one under `key`. */
function boardIn(
  file: BoardFile,
  key: string,
  id: number,
  name: string,
  mail: boolean,
  owner: string,
  seenAtMs: number
): BoardRecord {
  const existing = file.boards[key]
  return {
    key,
    id,
    // A board renamed on the server keeps the newer name; an empty name never replaces one.
    name: name !== '' ? name : (existing?.name ?? ''),
    mail,
    ...(mail ? { owner } : {}),
    posts: existing?.posts ?? {},
    seenAtMs: Math.max(seenAtMs, existing?.seenAtMs ?? 0)
  }
}

/**
 * Put the boards the server listed into `file`, so a board is known by name
 * before any of its posts are. The mailbox is not in the server's list.
 */
export function withBoardList(
  file: BoardFile,
  boards: { id: number; name: string }[],
  seenAtMs: number
): BoardFile {
  const next = { ...file.boards }
  for (const board of boards) {
    const key = boardKey(board.id, false, '')
    next[key] = boardIn(file, key, board.id, board.name, false, '', seenAtMs)
  }
  return { boards: next }
}

/** One page of a board's or a mailbox's index, as the wire gave it. */
export interface PostListSeen {
  boardId: number
  boardName: string
  mail: boolean
  rows: PostHeader[]
  seenAtMs: number
  seenBy: string
}

/**
 * Put a page of headers into `file`. A header updates the row's subject,
 * author, date, and highlight, and never touches a body the post already
 * has.
 */
export function withPostList(file: BoardFile, seen: PostListSeen): BoardFile {
  const key = boardKey(seen.boardId, seen.mail, seen.seenBy)
  const board = boardIn(
    file,
    key,
    seen.boardId,
    seen.boardName,
    seen.mail,
    seen.seenBy,
    seen.seenAtMs
  )
  const posts = { ...board.posts }
  for (const row of seen.rows) {
    const existing = posts[String(row.postId)]
    posts[String(row.postId)] = {
      ...(existing ?? {}),
      postId: row.postId,
      author: row.author,
      month: row.month,
      day: row.day,
      subject: row.subject,
      highlighted: row.highlighted,
      seenAtMs: seen.seenAtMs,
      seenBy: seen.seenBy
    }
  }
  return { boards: { ...file.boards, [key]: { ...board, posts } } }
}

/** One post opened, as the wire gave it, with the board it belongs to. */
export interface PostSeen {
  boardId: number
  mail: boolean
  postId: number
  author: string
  month: number
  day: number
  subject: string
  body: string
  seenAtMs: number
  seenBy: string
}

/**
 * Put an opened post into `file`, body and all. The board's name is what the
 * archive already knows, because a post does not carry it; a post for a board
 * never listed gets a nameless board that the next list names.
 */
export function withPost(file: BoardFile, seen: PostSeen): BoardFile {
  const key = boardKey(seen.boardId, seen.mail, seen.seenBy)
  const board = boardIn(file, key, seen.boardId, '', seen.mail, seen.seenBy, seen.seenAtMs)
  const existing = board.posts[String(seen.postId)]
  const post: PostRecord = {
    postId: seen.postId,
    author: seen.author,
    month: seen.month,
    day: seen.day,
    subject: seen.subject,
    highlighted: existing?.highlighted ?? false,
    body: seen.body,
    seenAtMs: Math.max(seen.seenAtMs, existing?.seenAtMs ?? 0),
    bodyAtMs: seen.seenAtMs,
    seenBy: seen.seenBy
  }
  return {
    boards: {
      ...file.boards,
      [key]: { ...board, posts: { ...board.posts, [String(seen.postId)]: post } }
    }
  }
}

/** What the Boards tab lists: every board, most recently seen first. */
export function summarize(file: BoardFile): BoardSummary[] {
  return Object.values(file.boards)
    .map((board) => {
      const posts = Object.values(board.posts)
      return {
        key: board.key,
        id: board.id,
        name: board.name,
        mail: board.mail,
        ...(board.owner !== undefined ? { owner: board.owner } : {}),
        postCount: posts.length,
        bodyCount: posts.filter((p) => p.body !== undefined).length,
        seenAtMs: board.seenAtMs
      }
    })
    .sort((a, b) => b.seenAtMs - a.seenAtMs)
}
