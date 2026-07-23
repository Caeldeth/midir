/**
 * IPC handler bodies as plain async functions.
 *
 * Each function takes only its data arguments (no IPC event), so tests can
 * import and call them directly. `registerHandlers` wires every function up
 * to its channel via the supplied `ipcMain` and `BrowserWindow` references.
 */
import type { IpcMain, BrowserWindow as BrowserWindowType } from 'electron'
import { z } from 'zod'
import { THEME_NAMES, type MidirSettings } from '../shared/types'
import type { createSettingsManager } from './settingsManager'

export interface HandlerContext {
  settingsPath: string
  settingsManager: ReturnType<typeof createSettingsManager>
  appGetVersion: () => string
  /**
   * Called once when the renderer signals `app:ready` (settings hydrated).
   * Wired up in index.ts to reveal the main window + tear down the splash.
   */
  onAppReady?: () => void
}

export const settingsSchema = z.object({
  theme: z.enum(THEME_NAMES as [string, ...string[]])
})

// ── Settings / app ───────────────────────────────────────────────────────────

export async function loadSettings(ctx: HandlerContext): Promise<MidirSettings> {
  return ctx.settingsManager.load()
}

export async function saveSettings(ctx: HandlerContext, settings: unknown): Promise<void> {
  const parsed = settingsSchema.safeParse(settings)
  if (!parsed.success) {
    console.error('[settings:save] rejected invalid payload:', parsed.error.message)
    throw new Error('Invalid settings payload')
  }
  await ctx.settingsManager.save(parsed.data as MidirSettings)
}

// ── Registry ─────────────────────────────────────────────────────────────────

interface RegisterDeps {
  ipcMain: IpcMain
  BrowserWindow: typeof BrowserWindowType
}

export function registerHandlers(deps: RegisterDeps, ctx: HandlerContext): void {
  const { ipcMain, BrowserWindow } = deps

  // Window controls
  ipcMain.on('minimize-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.on('maximize-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('close-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  // Renderer signals it has hydrated (settings loaded) → reveal main window and
  // dismiss the splash. Handled in index.ts, which owns the window refs.
  ipcMain.on('app:ready', () => {
    ctx.onAppReady?.()
  })

  // App / settings
  ipcMain.handle('app:getVersion', () => ctx.appGetVersion())
  ipcMain.handle('settings:load', () => loadSettings(ctx))
  ipcMain.handle('settings:save', (_, settings) => saveSettings(ctx, settings))
}
