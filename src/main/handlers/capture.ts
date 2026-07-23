import type { IpcMain } from 'electron'
import { z } from 'zod'
import type { CaptureAvailability, CaptureStatus } from '../../shared/types'
import type { CaptureService } from '../captureService'

export interface CaptureHandlerContext {
  captureService: CaptureService
  /** Report which adapters are available, and why none are when that is so. */
  captureAvailability: () => CaptureAvailability
}

const deviceSchema = z.string().min(1, 'Choose a capture adapter first.')

export function listAvailability(ctx: CaptureHandlerContext): CaptureAvailability {
  return ctx.captureAvailability()
}

export async function startCapture(
  ctx: CaptureHandlerContext,
  device: unknown
): Promise<CaptureStatus> {
  const parsed = deviceSchema.safeParse(device)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid adapter')
  await ctx.captureService.start(parsed.data)
  return ctx.captureService.status()
}

export async function stopCapture(ctx: CaptureHandlerContext): Promise<CaptureStatus> {
  await ctx.captureService.stop()
  return ctx.captureService.status()
}

export function captureStatus(ctx: CaptureHandlerContext): CaptureStatus {
  return ctx.captureService.status()
}

export function registerCaptureHandlers(ipcMain: IpcMain, ctx: CaptureHandlerContext): void {
  ipcMain.handle('capture:availability', () => listAvailability(ctx))
  ipcMain.handle('capture:start', (_, device) => startCapture(ctx, device))
  ipcMain.handle('capture:stop', () => stopCapture(ctx))
  ipcMain.handle('capture:status', () => captureStatus(ctx))
}

/** The channel main uses to push a new status to the renderer. */
export const CAPTURE_STATUS_CHANNEL = 'capture:status-changed'

export type { CaptureService }
