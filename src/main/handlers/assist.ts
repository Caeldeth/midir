import type { IpcMain } from 'electron'
import { z } from 'zod'
import type {
  AssistState,
  AssistWindow,
  SpeakerConfig,
  SpeakerState,
  WalkerDestination,
  WalkerState,
  WalkOutcome,
  WalkRequest
} from '../../shared/types'
import type { ActionLayer } from '../actionLayer'
import type { Speaker } from '../speaker'
import type { Walker } from '../walker'

/**
 * The IPC surface for the driving assistants: the window picker, the one stop,
 * the Speaker, and the Walker. The bodies are plain functions, so a test calls
 * them with a fake action layer, a fake Speaker, and a fake Walker and no game.
 */

export interface AssistHandlerContext {
  actionLayer: ActionLayer
  speaker: Speaker
  walker: Walker
}

export function assistWindows(ctx: AssistHandlerContext): AssistWindow[] {
  return ctx.actionLayer.listWindows()
}

export function assistStopAll(ctx: AssistHandlerContext): void {
  ctx.actionLayer.stopAll('you pressed stop')
}

export function assistClearStop(ctx: AssistHandlerContext): void {
  ctx.actionLayer.clearStop()
}

export function assistState(ctx: AssistHandlerContext): AssistState {
  return ctx.actionLayer.state()
}

const speakerConfigSchema = z.object({
  lines: z.array(z.string()),
  intervalMs: z.number().int().min(0),
  repeat: z.boolean(),
  connectionId: z.string().min(1, 'Pick a window to drive first.')
})

export async function startSpeaker(ctx: AssistHandlerContext, config: unknown): Promise<void> {
  const parsed = speakerConfigSchema.safeParse(config)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid speaker config')
  // Drop blank lines, so an empty textarea row is not spoken.
  const lines = parsed.data.lines.filter((line) => line.trim().length > 0)
  if (lines.length === 0) throw new Error('Add at least one line before you start the speaker.')
  const clean: SpeakerConfig = { ...parsed.data, lines }
  await ctx.speaker.start(clean)
}

const connectionIdSchema = z.string().min(1)

export function stopSpeaker(ctx: AssistHandlerContext, connectionId: unknown): void {
  const parsed = connectionIdSchema.safeParse(connectionId)
  if (!parsed.success) return
  ctx.speaker.stop(parsed.data)
}

export function speakerState(ctx: AssistHandlerContext): SpeakerState[] {
  return ctx.speaker.states()
}

const walkRequestSchema = z.object({
  connectionId: z.string().min(1, 'Pick a window to drive first.'),
  destination: z.union([z.string().min(1), z.number().int()])
})

export async function startWalker(
  ctx: AssistHandlerContext,
  request: unknown
): Promise<WalkOutcome> {
  const parsed = walkRequestSchema.safeParse(request)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid walk request')
  return ctx.walker.go(parsed.data as WalkRequest)
}

export function stopWalker(ctx: AssistHandlerContext, connectionId: unknown): void {
  const parsed = connectionIdSchema.safeParse(connectionId)
  if (!parsed.success) return
  ctx.walker.stop(parsed.data)
}

export function walkerState(ctx: AssistHandlerContext): WalkerState[] {
  return ctx.walker.states()
}

export function walkerDestinations(ctx: AssistHandlerContext): WalkerDestination[] {
  return ctx.walker.destinations()
}

export function registerAssistHandlers(ipcMain: IpcMain, ctx: AssistHandlerContext): void {
  ipcMain.handle('assist:windows', () => assistWindows(ctx))
  ipcMain.handle('assist:stopAll', () => assistStopAll(ctx))
  ipcMain.handle('assist:clearStop', () => assistClearStop(ctx))
  ipcMain.handle('assist:state', () => assistState(ctx))
  ipcMain.handle('speaker:start', (_, config) => startSpeaker(ctx, config))
  ipcMain.handle('speaker:stop', (_, connectionId) => stopSpeaker(ctx, connectionId))
  ipcMain.handle('speaker:state', () => speakerState(ctx))
  ipcMain.handle('walker:go', (_, request) => startWalker(ctx, request))
  ipcMain.handle('walker:stop', (_, connectionId) => stopWalker(ctx, connectionId))
  ipcMain.handle('walker:state', () => walkerState(ctx))
  ipcMain.handle('walker:destinations', () => walkerDestinations(ctx))
}

/** The channel main uses to push the stop state to the renderer. */
export const ASSIST_STATE_CHANNEL = 'assist:state-changed'
/** The channel main uses to push a Speaker's state to the renderer. */
export const SPEAKER_STATE_CHANNEL = 'speaker:state-changed'
/** The channel main uses to push a Walker's state to the renderer. */
export const WALKER_STATE_CHANNEL = 'walker:state-changed'
/**
 * The channel main uses to ask the renderer to toggle the Speaker. The renderer
 * owns the selected window, so the global hotkey acts through it.
 */
export const SPEAKER_TOGGLE_CHANNEL = 'speaker:toggle-requested'
