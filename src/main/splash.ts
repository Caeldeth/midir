import { BrowserWindow } from 'electron'
import { join } from 'path'
import { messageOf, type Logger } from './log'

/**
 * Frameless, transparent splash window shown the instant the app boots — before
 * the main window's renderer bundle has evaluated. It stays up until the
 * renderer signals `app:ready` (see the boot sequence in `index.ts`), so the
 * user gets immediate branded feedback instead of a few seconds of nothing.
 *
 * Deliberately dependency-free and self-contained (loads a static
 * `resources/splash.html`) so it ports between sibling apps by copying this
 * file + `resources/splash.html` and swapping the logo/title.
 *
 * `splash.once('ready-to-show', () => splash.show())` on its own is not enough.
 * Four backstops matter, and every one of them fails *silently* — see the
 * skeleton doc's "Splash + app:ready reveal handshake" section.
 */

/**
 * Fallback delay for showing the window if `ready-to-show` never arrives.
 *
 * Deliberately short. A long fallback (the 500 ms this used to be) is actively
 * harmful: it delays the only moment the splash becomes visible, which widens
 * the window in which the reveal can destroy it before it was ever shown.
 */
const SHOW_FALLBACK_MS = 150

/**
 * Minimum time the splash stays on screen once it appears.
 *
 * A packaged build boots far faster than dev: the renderer is one prebuilt
 * bundle over `file://` rather than hundreds of modules served by vite, so
 * `app:ready` can arrive before the splash has even been shown. Destroying it
 * there means `show()` no-ops on a destroyed window and the user sees no splash
 * at all. Holding the reveal to this floor means it is always actually seen,
 * and never as a sub-100ms flash.
 */
const MIN_VISIBLE_MS = 600

/**
 * Hard cap on the splash's lifetime. It is `alwaysOnTop` + `skipTaskbar`, so a
 * boot that dies before the reveal would otherwise strand a floating window the
 * user cannot focus, close, or even find in the taskbar. Longer than the
 * 15s reveal backstop in index.ts, so this only ever fires if that failed too.
 */
const MAX_LIFETIME_MS = 20000

export interface SplashController {
  /** The underlying window. Prefer the methods below over driving it directly. */
  readonly window: BrowserWindow
  isDestroyed: () => boolean
  /** Tear down immediately, skipping the minimum-visible floor. Abnormal paths
   *  only (the main window died, the app is quitting). Runs a pending
   *  `dismiss` callback so a reveal can never be left hanging. */
  destroy: () => void
  /**
   * Normal handoff. Shows the splash if it has not appeared yet, keeps it up
   * for the remainder of {@link MIN_VISIBLE_MS}, then destroys it and runs
   * `onDone`. Callers reveal the main window from `onDone` so the two swap
   * cleanly instead of the always-on-top splash sitting over a live window.
   */
  dismiss: (onDone?: () => void) => void
}

export function createSplashWindow(log?: Logger): SplashController {
  const splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    show: false,
    // Fully transparent, explicitly. `transparent: true` governs what the
    // renderer paints over; it does not change the NATIVE background, which
    // stays Electron's default opaque white and is what the compositor shows
    // for a frame at either end of the window's life. The renderer's own
    // `background: transparent` cannot reach it. Without this the splash card
    // arrives with a white rectangle behind its rounded corners (HTOO-456).
    backgroundColor: '#00000000',
    // The splash has no IPC needs; keep it isolated with no preload.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // resources/** is bundled + asarUnpacked, so this resolves in production too.
  splash.loadFile(join(__dirname, '../../resources/splash.html')).catch((err) => {
    log?.error('splash', `Could not load the splash window: ${messageOf(err)}`)
  })

  let shown = false
  let minVisibleElapsed = false
  let dismissRequested = false
  let onDismissed: (() => void) | null = null

  const show = (): void => {
    if (shown || splash.isDestroyed()) return
    shown = true
    splash.show()
    setTimeout(() => {
      minVisibleElapsed = true
      settle()
    }, MIN_VISIBLE_MS)
  }

  /** Destroy + hand off once both the caller has asked and the floor has passed. */
  const settle = (): void => {
    if (!dismissRequested || !minVisibleElapsed) return
    const done = onDismissed
    onDismissed = null // so the `closed` handler does not run it twice
    if (!splash.isDestroyed()) splash.destroy()
    done?.()
  }

  // `ready-to-show` is unreliable for transparent windows on Windows — if it
  // never fires the splash would silently never appear, so back it with a timer.
  const showTimer = setTimeout(show, SHOW_FALLBACK_MS)
  splash.once('ready-to-show', show)

  const selfDestruct = setTimeout(() => {
    if (!splash.isDestroyed()) splash.destroy()
  }, MAX_LIFETIME_MS)

  splash.once('closed', () => {
    clearTimeout(showTimer)
    clearTimeout(selfDestruct)
    // Destroyed by something other than `settle` (the main window closed, the
    // lifetime cap fired). Release a waiting reveal rather than stranding it.
    const done = onDismissed
    onDismissed = null
    done?.()
  })

  return {
    window: splash,
    isDestroyed: () => splash.isDestroyed(),
    destroy: () => {
      if (!splash.isDestroyed()) splash.destroy()
    },
    dismiss: (onDone?: () => void) => {
      if (splash.isDestroyed()) {
        onDone?.()
        return
      }
      dismissRequested = true
      onDismissed = onDone ?? null
      // A dismiss that beat the first paint still gets the splash on screen;
      // this is the case that loses the splash entirely.
      show()
      settle()
    }
  }
}
