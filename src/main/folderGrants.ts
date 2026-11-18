import { resolve } from 'node:path'

/**
 * The Dark Ages folders that main trusts.
 *
 * Main reads game files from the Dark Ages folder: `legend.dat`, `ia.dat`,
 * the khan archives and the map cache. The renderer can write the settings, so
 * a renderer path alone must not choose that folder. A compromised renderer
 * could otherwise point main at any folder on the disk. This is the fault that
 * Elatha had in HTOO-698.
 *
 * A folder becomes a grant in two ways only:
 *
 * - The user picks it in the folder dialog that main opens.
 * - It is the folder in the settings file at startup. That value came from an
 *   earlier pick, or from the user's own edit of `settings.json`. The renderer
 *   cannot write that file except through `settings:save`, which this guards.
 *
 * Midir runs on Windows only, so the compare folds case.
 */
export interface FolderGrants {
  /** Settles when the startup folder is a grant. Await it before `isGranted`. */
  readonly ready: Promise<void>
  /** Record a folder that the user picked in a dialog that main opened. */
  grant(path: string): void
  /** True when `path` is a granted folder. */
  isGranted(path: string): boolean
}

function keyOf(path: string): string {
  return resolve(path).toLowerCase()
}

/**
 * @param startup the Dark Ages folder in the settings file at startup. A
 *   rejected or empty value grants nothing.
 */
export function createFolderGrants(startup: Promise<string | undefined>): FolderGrants {
  const granted = new Set<string>()
  const add = (path: string | undefined): void => {
    if (typeof path === 'string' && path !== '') granted.add(keyOf(path))
  }
  const ready = startup.then(add, () => undefined)
  return {
    ready,
    grant: add,
    isGranted: (path) => typeof path === 'string' && path !== '' && granted.has(keyOf(path))
  }
}
