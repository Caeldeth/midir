import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dialog, IpcMain } from 'electron'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { CaptureService } from '../../captureService'
import { createBoardStore, withPost, withPostList } from '../../store/boardStore'
import {
  exportBoard,
  exportFileName,
  exportOf,
  getBoard,
  listBoards,
  registerBoardHandlers
} from '../boards'

/** The board archive IPC (WP36). */

const dir = mkdtempSync(join(tmpdir(), 'midir-boards-ipc-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const row = (postId: number, subject: string) => ({
  highlighted: false,
  postId,
  author: 'Ari',
  month: 7,
  day: 15,
  subject
})

async function context(): Promise<Parameters<typeof listBoards>[0] & { flushed: number }> {
  const boardStore = createBoardStore(dir)
  await boardStore.update((file) => {
    const listed = withPostList(file, {
      boardId: 10,
      boardName: 'Public',
      mail: false,
      rows: [row(42, 'Hello'), row(41, 'Older')],
      seenAtMs: 1000,
      seenBy: 'Sabrael'
    })
    return withPost(listed, {
      boardId: 10,
      mail: false,
      postId: 42,
      author: 'Ari',
      month: 7,
      day: 15,
      subject: 'Hello',
      body: 'Welcome!',
      seenAtMs: 2000,
      seenBy: 'Sabrael'
    })
  })
  const counter = { flushed: 0 }
  const captureService = {
    flush: async () => {
      counter.flushed++
    }
  } as unknown as CaptureService
  return {
    boardStore,
    captureService,
    get flushed() {
      return counter.flushed
    }
  }
}

describe('the board handlers', () => {
  it('lists the boards and returns one with its posts', async () => {
    const ctx = await context()
    expect(await listBoards(ctx)).toEqual([
      { key: '10', id: 10, name: 'Public', mail: false, postCount: 2, bodyCount: 1, seenAtMs: 2000 }
    ])
    expect((await getBoard(ctx, '10'))?.posts['42']?.body).toBe('Welcome!')
    expect(await getBoard(ctx, 'nope')).toBeNull()
    expect(await getBoard(ctx, 42)).toBeNull()
  })

  it("exports in the prototype's shape, newest first, with a null body for an unread post", async () => {
    const ctx = await context()
    const board = (await getBoard(ctx, '10'))!
    expect(exportOf(board, 5000)).toEqual({
      boardId: 10,
      boardName: 'Public',
      capturedUtc: new Date(5000).toISOString(),
      postCount: 2,
      posts: [
        {
          postId: 42,
          author: 'Ari',
          month: 7,
          day: 15,
          subject: 'Hello',
          body: 'Welcome!',
          highlighted: false
        },
        {
          postId: 41,
          author: 'Ari',
          month: 7,
          day: 15,
          subject: 'Older',
          body: null,
          highlighted: false
        }
      ]
    })
    expect(exportFileName(board, Date.UTC(2026, 8, 21, 12, 0, 0))).toBe(
      'Public-2026-09-21T12-00-00.json'
    )
    expect(
      exportFileName(
        { ...board, mail: true, owner: 'Sabrael', name: 'Mail' },
        Date.UTC(2026, 8, 21)
      )
    ).toMatch(/^mail-Sabrael-/)
  })

  it('flushes, then writes the export where the user chose', async () => {
    const ctx = await context()
    const target = join(dir, 'out.json')
    const dialog = {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: target }))
    } as unknown as Dialog
    expect(await exportBoard(ctx, dialog, null, '10', 5000)).toBe(target)
    expect(ctx.flushed).toBe(1)
    expect(JSON.parse(readFileSync(target, 'utf-8')).postCount).toBe(2)
  })

  it('writes nothing when the user cancels or the board is unknown', async () => {
    const ctx = await context()
    const dialog = {
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined }))
    } as unknown as Dialog
    expect(await exportBoard(ctx, dialog, null, '10')).toBeNull()
    expect(await exportBoard(ctx, dialog, null, 'nope')).toBeNull()
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
  })

  it('registers the three channels', async () => {
    const ctx = await context()
    const handle = vi.fn()
    registerBoardHandlers(
      { handle } as unknown as IpcMain,
      {} as Dialog,
      { fromWebContents: () => null } as never,
      ctx
    )
    expect(handle.mock.calls.map((c) => c[0])).toEqual([
      'boards:list',
      'boards:get',
      'boards:export'
    ])
  })
})
