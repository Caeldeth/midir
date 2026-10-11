import type {
  BrowserWindow,
  Dialog,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

// Where a file or folder picker opens (HTOO-553). Since Electron 43 a dialog with
// no `defaultPath` opens in Downloads, not in the last folder used. So every
// dialog goes through `withPickerStart`, which fills `defaultPath` in: the path
// the handler gave if it is usable, then the last folder picked this session,
// then the Dark Ages folder, then Documents, then home. A stale candidate (a
// folder since moved) is skipped rather than handed to the dialog, which would
// fall back to Downloads again.
//
// The rule wraps the dialog, the way `guardIpc` wraps `ipcMain`, so a picker
// added later cannot forget it. Ported from taliesin's src/main/pickerStart.ts
// (itself from creidhne), with one change: Midir's handlers give the parent
// window, so the dialog here takes `(window, options)`.

/** The two pickers Midir's handlers call, with the parent window explicit. */
export interface PickerDialog {
  showOpenDialog(
    window: BrowserWindow | null,
    options: OpenDialogOptions
  ): Promise<OpenDialogReturnValue>
  showSaveDialog(
    window: BrowserWindow | null,
    options: SaveDialogOptions
  ): Promise<SaveDialogReturnValue>
}

/** Electron's overloaded dialog as a `PickerDialog`: no window means no parent. */
export function pickerDialog(
  dialog: Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>
): PickerDialog {
  return {
    showOpenDialog: (window, options) =>
      window !== null ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options),
    showSaveDialog: (window, options) =>
      window !== null ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
  }
}

type Exists = (p: string) => Promise<boolean>

/**
 * Async on purpose: a sync check against a game folder on a network share that
 * has gone away blocks the main process for seconds.
 */
const pathExists: Exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false
  )

/** The first candidate that is a non-empty string and exists on disk. */
export async function pickerStartPath(
  candidates: readonly (string | null | undefined)[],
  exists: Exists = pathExists
): Promise<string | undefined> {
  for (const p of candidates) {
    if (p && (await exists(p))) return p
  }
  return undefined
}

/**
 * The `defaultPath` for one dialog, from what the handler asked for and the
 * start folder. `start` is called only when the request cannot be used as it is.
 *
 * - A save keeps a path whose folder exists: the file is usually new. A stale
 *   or bare name ("mail-Eolathe.json") goes in the start folder, because
 *   without a folder Electron 43+ puts it in Downloads.
 * - An open keeps a path that exists, or else the folder it was in. Otherwise
 *   it opens at the start folder, with no name: a name it cannot find helps
 *   nobody.
 */
export async function dialogDefaultPath(
  given: string | undefined,
  start: () => Promise<string | undefined>,
  kind: 'open' | 'save',
  exists: Exists = pathExists
): Promise<string | undefined> {
  if (given && isAbsolute(given)) {
    if (kind === 'open' && (await exists(given))) return given
    if (await exists(dirname(given))) return kind === 'save' ? given : dirname(given)
  }
  const dir = await start()
  if (kind === 'open' || !given) return dir
  if (!dir) return given
  return join(dir, isAbsolute(given) ? basename(given) : given)
}

export interface PickerStartSources {
  /**
   * The Dark Ages folder from the settings in memory, or nothing. Never call
   * `settingsManager.load()` for it: a load that recovers from the backup
   * writes the backup back, which can revert a save still in flight.
   */
  gameFolder: () => string | null | undefined
  /** The last folders to try: Documents, then home. */
  fallbacks: () => string[]
  exists?: Exists
}

/** A dialog that fills `defaultPath` in, and remembers the folder of each pick. */
export function withPickerStart(dialog: PickerDialog, sources: PickerStartSources): PickerDialog {
  const exists = sources.exists ?? pathExists
  let lastPickedDir: string | undefined
  const start = async (): Promise<string | undefined> =>
    pickerStartPath([lastPickedDir, sources.gameFolder(), ...sources.fallbacks()], exists)

  return {
    async showOpenDialog(window, options) {
      const r = await dialog.showOpenDialog(window, {
        ...options,
        defaultPath: await dialogDefaultPath(options.defaultPath, start, 'open', exists)
      })
      const picked = r.filePaths[0]
      if (picked) {
        lastPickedDir = options.properties?.includes('openDirectory') ? picked : dirname(picked)
      }
      return r
    },
    async showSaveDialog(window, options) {
      const r = await dialog.showSaveDialog(window, {
        ...options,
        defaultPath: await dialogDefaultPath(options.defaultPath, start, 'save', exists)
      })
      if (r.filePath) lastPickedDir = dirname(r.filePath)
      return r
    }
  }
}
