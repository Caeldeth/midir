/**
 * IPC handler bodies as plain async functions.
 *
 * Each function takes only its data arguments and no IPC event, so a test can
 * import it and call it directly. `registerHandlers` wires each one to its
 * channel with the supplied `ipcMain` and `BrowserWindow`.
 */
import type { BrowserWindow as BrowserWindowType, Dialog, IpcMain, Shell } from 'electron'
import type { CaptureService } from '../captureService'
import type { CharacterStore } from '../store/characterStore'
import type { createSettingsManager } from '../settingsManager'
import { registerCaptureHandlers, type CaptureHandlerContext } from './capture'
import { registerCharacterHandlers, type CharacterHandlerContext } from './characters'
import { registerDiagnosticsHandlers, type DiagnosticsHandlerContext } from './diagnostics'
import { registerIconsHandlers } from './icons'
import { registerSettingsHandlers, type SettingsHandlerContext } from './settings'

export * from './capture'
export * from './characters'
export * from './diagnostics'
export * from './icons'
export * from './settings'

export interface HandlerContext
  extends
    SettingsHandlerContext,
    CaptureHandlerContext,
    CharacterHandlerContext,
    DiagnosticsHandlerContext {
  settingsPath: string
  settingsManager: ReturnType<typeof createSettingsManager>
  appGetVersion: () => string
  captureService: CaptureService
  characterStore: CharacterStore
  /**
   * Called once when the renderer signals `app:ready`, meaning settings are
   * hydrated. index.ts wires this to revealing the window and closing the
   * splash.
   */
  onAppReady?: () => void
  /**
   * Arm the live Dark Ages folder the icon service reads. index.ts wires this
   * to the `darkAgesPath` variable, so a probe that finds `legend.dat` lets the
   * service serve before the settings save lands.
   */
  updateDarkAgesPath?: (path: string) => void
}

interface RegisterDeps {
  ipcMain: IpcMain
  BrowserWindow: typeof BrowserWindowType
  /** Used to open a folder Midir owns. */
  shell: Shell
  /** Used for the Dark Ages folder picker. */
  dialog: Dialog
}

export function registerHandlers(deps: RegisterDeps, ctx: HandlerContext): void {
  const { ipcMain, BrowserWindow, shell, dialog } = deps

  // Window controls. These keep the legacy unprefixed names.
  ipcMain.on('minimize-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.on('maximize-window', (e) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    if (window?.isMaximized()) window.unmaximize()
    else window?.maximize()
  })
  ipcMain.on('close-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  // The renderer says it has hydrated. index.ts owns the window references, so
  // it reveals the main window and closes the splash.
  ipcMain.on('app:ready', () => {
    ctx.onAppReady?.()
  })

  ipcMain.handle('app:getVersion', () => ctx.appGetVersion())

  registerSettingsHandlers(ipcMain, ctx)
  registerCaptureHandlers(ipcMain, ctx)
  registerCharacterHandlers(ipcMain, ctx)
  registerDiagnosticsHandlers(ipcMain, shell, ctx)
  registerIconsHandlers(ipcMain, dialog, BrowserWindow, ctx.updateDarkAgesPath)
}
