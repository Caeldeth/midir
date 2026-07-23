// The icon settings IPC: a folder picker for the Dark Ages install, and a check
// for `legend.dat` beside it. The pixels themselves never cross IPC — they are
// served over the `midir-icon://` protocol (see icons/protocol.ts).

import type { BrowserWindow as BrowserWindowType, Dialog, IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Whether a folder holds a readable `legend.dat`. This is the whole test for
 * "are icons on": with the file present Midir can draw them, without it icons
 * stay off and the Settings card says so.
 */
export function legendPresent(folderPath: unknown): boolean {
  if (typeof folderPath !== 'string' || folderPath === '') return false
  try {
    return existsSync(join(folderPath, 'legend.dat'))
  } catch {
    return false
  }
}

/**
 * Open the folder picker for the Dark Ages install and return the chosen path,
 * or `null` when the user cancels.
 */
export async function chooseDarkAgesFolder(
  dialog: Dialog,
  window: BrowserWindowType | null
): Promise<string | null> {
  const options = {
    title: 'Choose your Dark Ages folder',
    properties: ['openDirectory' as const]
  }
  const result =
    window !== null
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export function registerIconsHandlers(
  ipcMain: IpcMain,
  dialog: Dialog,
  BrowserWindow: typeof BrowserWindowType,
  onLegendFound?: (path: string) => void
): void {
  ipcMain.handle('icons:chooseFolder', (event) =>
    chooseDarkAgesFolder(dialog, BrowserWindow.fromWebContents(event.sender))
  )
  ipcMain.handle('icons:probe', (_event, folderPath: unknown) => {
    const legendFound = legendPresent(folderPath)
    // The renderer turns icons on the moment this reports a hit. Arm the live
    // path here so the service can serve before the (debounced) settings save
    // lands. Without this, the first icons after picking a folder 404.
    if (legendFound && typeof folderPath === 'string') onLegendFound?.(folderPath)
    return { legendFound }
  })
}
