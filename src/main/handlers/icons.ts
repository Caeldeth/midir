// The icon settings IPC: a folder picker for the Dark Ages install, and a check
// for `legend.dat` beside it. The pixels themselves never cross IPC — they are
// served over the `midir-icon://` protocol (see icons/protocol.ts).

import type { BrowserWindow as BrowserWindowType, IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PickerDialog } from '../pickerStart'

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
 * or `null` when the user cancels. The dialog is `withPickerStart`'s, so it opens
 * in the folder already chosen, or in Documents (HTOO-553).
 */
export async function chooseDarkAgesFolder(
  dialog: PickerDialog,
  window: BrowserWindowType | null
): Promise<string | null> {
  const options = {
    title: 'Choose your Dark Ages folder',
    properties: ['openDirectory' as const]
  }
  const result = await dialog.showOpenDialog(window, options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export function registerIconsHandlers(
  ipcMain: IpcMain,
  dialog: PickerDialog,
  BrowserWindow: typeof BrowserWindowType,
  onLegendFound?: (path: string) => void,
  legend?: { palette: () => Promise<string[] | null> }
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
  // The colours a legend mark's `color` byte indexes. 256 short strings, asked
  // for once and kept in the renderer, so no mark carries its colour over IPC.
  ipcMain.handle('icons:legendPalette', async () => (await legend?.palette()) ?? null)
}
