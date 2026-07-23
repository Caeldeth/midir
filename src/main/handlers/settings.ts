import type { IpcMain } from 'electron'
import { z } from 'zod'
import { MAX_RECORDING_CAP_MB, THEME_NAMES, type MidirSettings } from '../../shared/types'
import type { Logger } from '../log'
import type { createSettingsManager } from '../settingsManager'

export interface SettingsHandlerContext {
  settingsManager: ReturnType<typeof createSettingsManager>
  log: Logger
}

/** Every payload that crosses from the renderer is checked here. */
export const settingsSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]]),
  captureDevice: z.string(),
  autoStartCapture: z.boolean(),
  recordSessions: z.boolean(),
  // Zero means no limit. The maximum only stops an absurd value reaching disk.
  recordingCapMb: z.number().int().min(0).max(MAX_RECORDING_CAP_MB)
})

export async function loadSettings(ctx: SettingsHandlerContext): Promise<MidirSettings> {
  return ctx.settingsManager.load()
}

export async function saveSettings(ctx: SettingsHandlerContext, settings: unknown): Promise<void> {
  const parsed = settingsSchema.safeParse(settings)
  if (!parsed.success) {
    ctx.log.error('settings', `Rejected an invalid payload: ${parsed.error.message}`)
    throw new Error('Invalid settings payload')
  }
  await ctx.settingsManager.save(parsed.data as MidirSettings)
}

export function registerSettingsHandlers(ipcMain: IpcMain, ctx: SettingsHandlerContext): void {
  ipcMain.handle('settings:load', () => loadSettings(ctx))
  ipcMain.handle('settings:save', (_, settings) => saveSettings(ctx, settings))
}
