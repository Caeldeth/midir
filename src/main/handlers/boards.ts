import type { BrowserWindow as BrowserWindowType, Dialog, IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { BoardExport, BoardRecord, BoardSummary } from '../../shared/boards'
import type { CaptureService } from '../captureService'
import { summarize, type BoardStore } from '../store/boardStore'

/**
 * The board archive IPC (WP36): the list for the Boards tab, one board with
 * its posts, and an export in the shape the Brigid prototype wrote.
 */

export interface BoardHandlerContext {
  boardStore: BoardStore
  captureService: CaptureService
}

const keySchema = z.string().min(1)

/** Every board and mailbox the archive knows, most recently seen first. */
export async function listBoards(ctx: BoardHandlerContext): Promise<BoardSummary[]> {
  return summarize(await ctx.boardStore.load())
}

/** One board with every post, or null. */
export async function getBoard(
  ctx: BoardHandlerContext,
  key: unknown
): Promise<BoardRecord | null> {
  const parsed = keySchema.safeParse(key)
  if (!parsed.success) return null
  const file = await ctx.boardStore.load()
  return file.boards[parsed.data] ?? null
}

/** The export of one board: the prototype's shape, posts newest first. */
export function exportOf(board: BoardRecord, nowMs: number): BoardExport {
  const posts = Object.values(board.posts).sort((a, b) => b.postId - a.postId)
  return {
    boardId: board.id,
    boardName: board.name,
    ...(board.owner !== undefined ? { owner: board.owner } : {}),
    capturedUtc: new Date(nowMs).toISOString(),
    postCount: posts.length,
    posts: posts.map((p) => ({
      postId: p.postId,
      author: p.author,
      month: p.month,
      day: p.day,
      subject: p.subject,
      body: p.body ?? null,
      highlighted: p.highlighted
    }))
  }
}

/** A file name for a board's export, safe on every file system. */
export function exportFileName(board: BoardRecord, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = (board.mail ? `mail-${board.owner ?? ''}` : board.name || `board-${board.id}`)
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${name}-${stamp}.json`
}

/**
 * Export one board to a file the user picks. Returns the path written, or
 * null when the user cancels or the board is unknown. Anything still waiting
 * for the next write is flushed first, so the export is complete.
 */
export async function exportBoard(
  ctx: BoardHandlerContext,
  dialog: Dialog,
  window: BrowserWindowType | null,
  key: unknown,
  nowMs = Date.now()
): Promise<string | null> {
  const board = await getBoard(ctx, key)
  if (board === null) return null
  await ctx.captureService.flush()
  const fresh = (await getBoard(ctx, key)) ?? board
  const options = {
    title: `Export ${fresh.mail ? `${fresh.owner ?? ''}'s mail` : fresh.name || `board ${fresh.id}`}`,
    defaultPath: exportFileName(fresh, nowMs),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result =
    window !== null
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
  if (result.canceled || result.filePath === undefined || result.filePath === '') return null
  await writeFile(result.filePath, JSON.stringify(exportOf(fresh, nowMs), null, 2), 'utf-8')
  return result.filePath
}

export function registerBoardHandlers(
  ipcMain: IpcMain,
  dialog: Dialog,
  BrowserWindow: typeof BrowserWindowType,
  ctx: BoardHandlerContext
): void {
  ipcMain.handle('boards:list', () => listBoards(ctx))
  ipcMain.handle('boards:get', (_, key) => getBoard(ctx, key))
  ipcMain.handle('boards:export', (event, key) =>
    exportBoard(ctx, dialog, BrowserWindow.fromWebContents(event.sender), key)
  )
}

/** The channel main uses to say the archive changed. */
export const BOARDS_CHANGED_CHANNEL = 'boards:changed'
