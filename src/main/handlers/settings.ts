import type { IpcMain } from 'electron'
import { z } from 'zod'
import { MAX_RECORDING_CAP_MB, THEME_NAMES, type MidirSettings } from '../../shared/types'
import type { Logger } from '../log'
import type { createSettingsManager } from '../settingsManager'

export interface SettingsHandlerContext {
  settingsManager: ReturnType<typeof createSettingsManager>
  log: Logger
  /**
   * Called after a save lands, with the saved settings. index.ts uses it to
   * keep the live `darkAgesPath` the icon service reads in step with the file.
   */
  onSettingsSaved?: (settings: MidirSettings) => void
}

/** Every payload that crosses from the renderer is checked here. */
export const settingsSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]]),
  captureDevice: z.string(),
  autoStartCapture: z.boolean(),
  recordSessions: z.boolean(),
  // Zero means no limit. The maximum only stops an absurd value reaching disk.
  recordingCapMb: z.number().int().min(0).max(MAX_RECORDING_CAP_MB),
  // The Dark Ages install folder. Optional, and only used to draw item icons.
  darkAgesPath: z.string().optional()
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
  const valid = parsed.data as MidirSettings
  await ctx.settingsManager.save(valid)
  ctx.onSettingsSaved?.(valid)
}

export function registerSettingsHandlers(ipcMain: IpcMain, ctx: SettingsHandlerContext): void {
  ipcMain.handle('settings:load', () => loadSettings(ctx))
  ipcMain.handle('settings:save', (_, settings) => saveSettings(ctx, settings))
}
