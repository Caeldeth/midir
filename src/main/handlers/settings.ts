import type { IpcMain } from 'electron'
import { z } from 'zod'
import { THEME_NAMES, type MidirSettings } from '../../shared/types'
import type { createSettingsManager } from '../settingsManager'

export interface SettingsHandlerContext {
  settingsManager: ReturnType<typeof createSettingsManager>
}

/** Every payload that crosses from the renderer is checked here. */
export const settingsSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]]),
  captureDevice: z.string(),
  autoStartCapture: z.boolean(),
  recordSessions: z.boolean()
})

export async function loadSettings(ctx: SettingsHandlerContext): Promise<MidirSettings> {
  return ctx.settingsManager.load()
}

export async function saveSettings(ctx: SettingsHandlerContext, settings: unknown): Promise<void> {
  const parsed = settingsSchema.safeParse(settings)
  if (!parsed.success) {
    console.error('[settings:save] rejected an invalid payload:', parsed.error.message)
    throw new Error('Invalid settings payload')
  }
  await ctx.settingsManager.save(parsed.data as MidirSettings)
}

export function registerSettingsHandlers(ipcMain: IpcMain, ctx: SettingsHandlerContext): void {
  ipcMain.handle('settings:load', () => loadSettings(ctx))
  ipcMain.handle('settings:save', (_, settings) => saveSettings(ctx, settings))
}
