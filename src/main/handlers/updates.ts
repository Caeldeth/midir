import type { IpcMain } from 'electron'
import { appIdentity } from '../../shared/appIdentity'
import type { UpdateCheckResult } from '../../shared/updateVersion'
import { checkForUpdate as runCheck } from '../updateCheck'

/**
 * The update check (WP44, `HTOO-495`). The module it wraps is
 * `main/updateCheck.ts`; this file is only Midir's wiring.
 *
 * **This is Midir's one outbound request.** Everything else Midir does reads the
 * wire or the disk. One GET of the house version manifest, no user data, and no
 * identifier beyond a User-Agent that names the app. `SECURITY.md` states it.
 *
 * The check never throws. "Up to date" and "could not tell" are different
 * values, because a check that reports the first when it means the second is the
 * fault this module exists to end.
 */

export interface UpdateHandlerContext {
  /** The app version, which is what the manifest entry is compared against. */
  appGetVersion: () => string
  /**
   * `net.fetch` in production, so the request takes the system proxy and the OS
   * certificate store. A test injects a double, and the module falls back to
   * global `fetch` when nothing is injected.
   */
  fetchImpl?: typeof fetch
}

export function checkForUpdate(ctx: UpdateHandlerContext): Promise<UpdateCheckResult> {
  return runCheck({
    currentVersion: ctx.appGetVersion(),
    updateKey: appIdentity.updateKey,
    releaseUrlPrefix: appIdentity.releaseUrlPrefix,
    fetchImpl: ctx.fetchImpl
  })
}

export function registerUpdateHandlers(ipcMain: IpcMain, ctx: UpdateHandlerContext): void {
  ipcMain.handle('app:checkForUpdate', () => checkForUpdate(ctx))
}
