// Renderer-boundary hardening, kept in ONE place so the policy is single-sourced
// and auditable rather than scattered across window constructors.
//
// HTOO-61. Four apps ported this module before the template had it — mabon's
// WP18 wrote it, dagda and epona adapted it, balor is the port taken here —
// and each found the same holes as the last, because every fork inherited them
// from this skeleton. The template shipped a bare `setWindowOpenHandler` that
// forwarded ANY scheme the renderer asked for to `shell.openExternal`, no
// `will-navigate` guard, and no IPC sender validation.
//
// The template has the shape a single-window app has: one main window with a
// preload, and a splash with none — so the splash cannot send IPC and there is
// nothing to grade. One trusted window, no roles. An app that grows a second
// window WITH a preload should look at mabon's role model before widening this.
//
// Four protections:
//
//   1. hardenWindow()  — deny top-level navigation away from our own content, and
//      deny every child window, handing validated external URLs to the OS instead.
//   2. guardIpc()      — wrap ipcMain so every handler rejects an IPC whose sender
//      is not the top frame of a known window at our own location.
//   3. Trusted-window bookkeeping that forgets a window when its webContents dies,
//      so a reused id cannot inherit trust.
//   4. installContentSecurityPolicy() — put the CSP on the RESPONSE rather than
//      leaving it to a `<meta>` tag inside the document. HTOO-391.
//
// ⚠ The module FAILS CLOSED. If `initWindowSecurity` does not run before
// `registerHandlers`, every IPC is rejected and the app boots to a dead window.
// The e2e specs catch that; the unit tests cannot. Run `npm run e2e` after
// touching boot, and after adding an IPC channel.
//
// This is a SECOND gate. The zod schemas at each handler still validate every
// payload; nothing here replaces them.

import { pathToFileURL } from 'url'
import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { isSafeExternalUrl } from '../shared/externalUrl'

/**
 * Locations we consider "our own content", each keyed as `protocol//host` plus
 * pathname. Query and hash are ignored so a future `?window=x` variant still
 * matches.
 *
 * Empty until `initWindowSecurity` runs, which fails CLOSED: before init nothing
 * is trusted, so a handler registered too early rejects rather than admits.
 * `registerHandlers` runs at module scope in index.ts, before `app.whenReady()`,
 * so this ordering is load-bearing rather than incidental.
 */
let trustedLocations: string[] = []

/**
 * The key form above. One place, so init and lookup cannot disagree.
 *
 * **`host` explicitly, NOT `origin`.** For a `file:` URL the WHATWG parser
 * returns the opaque origin `"null"`, so an origin-based key carries no host
 * information at all and every `file://` host compares equal. That makes
 * `file://attacker.example/opt/Midir/.../index.html` indistinguishable from the
 * local path we actually trust — a page served from a remote share at a
 * mirroring path would satisfy both the `will-navigate` guard and the IPC sender
 * check, with our preload attached.
 *
 * The usual reassurance is that Windows is spared because a trusted path starts
 * with a drive letter and `C:` is not a legal UNC share name. That is a property
 * of the PATH, not of the platform: `pathToFileURL` on a UNC path yields a real
 * host and a pathname with no drive letter — and the Linux deb and AppImage
 * install under plain POSIX paths with no such accident at all.
 *
 * For `http`/`https` this is identical to `origin` — the parser normalises the
 * default port away — so nothing changes on the dev-server path.
 */
function locationKey(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}

/**
 * webContents.id values for windows we constructed. An IPC from a webContents
 * absent from this set — a devtools extension, an unexpected frame, anything we
 * did not create — is rejected outright.
 */
const trustedWindows = new Set<number>()

/**
 * Record the renderer locations we trust. Call once at boot, before any window
 * loads. `devUrl` is `ELECTRON_RENDERER_URL` under `electron-vite dev` and
 * undefined otherwise; `prodIndexHtml` is the absolute path passed to `loadFile`.
 */
export function initWindowSecurity(devUrl: string | undefined, prodIndexHtml: string): void {
  const locations: string[] = []
  if (devUrl) {
    try {
      locations.push(locationKey(new URL(devUrl)))
    } catch {
      // Malformed dev URL — leave it out and fail closed rather than guess.
    }
  }
  // pathToFileURL, never string concatenation. A path containing a space, a `#`
  // or a non-ASCII character produces a different file URL than the naive form,
  // and a trusted location that never matches is a LOCKOUT — every IPC rejected,
  // the app dead on arrival — not a safety margin.
  locations.push(locationKey(pathToFileURL(prodIndexHtml)))
  trustedLocations = locations
}

/** True when `rawUrl` points at our own renderer content. */
function isTrustedLocation(rawUrl: string): boolean {
  let key: string
  try {
    key = locationKey(new URL(rawUrl))
  } catch {
    return false // about:blank, a bare string, anything malformed
  }
  return trustedLocations.includes(key)
}

/**
 * Register a window we created, so its IPC is accepted. Forgotten when its
 * webContents is destroyed — Electron reuses ids, and a stale entry would hand
 * trust to whatever gets that id next.
 */
export function registerTrustedWindow(win: BrowserWindow): void {
  const id = win.webContents.id
  trustedWindows.add(id)
  win.webContents.once('destroyed', () => trustedWindows.delete(id))
}

interface HardenOptions {
  allowExternal: boolean
  openExternal: (url: string) => void
}

/**
 * Deny top-level navigation and every child window.
 *
 * `openExternal` is injected rather than imported so this module stays free of a
 * runtime `electron` import and the unit tests need no electron stub. A
 * navigation to an outside URL is handed to the browser instead of merely
 * blocked — otherwise a plain `<a href>` in the renderer would silently do
 * nothing.
 */
export function hardenWindow(
  win: BrowserWindow,
  { allowExternal, openExternal }: HardenOptions
): void {
  win.webContents.setWindowOpenHandler((details) => {
    if (allowExternal && isSafeExternalUrl(details.url)) openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedLocation(url)) return // our own content — e.g. a dev HMR full reload
    event.preventDefault()
    if (allowExternal && isSafeExternalUrl(url)) openExternal(url)
  })
}

/**
 * The authority check: accept an IPC only from the top frame of a known window,
 * at one of our own locations. Exported for direct unit testing.
 */
export function isSenderAllowed(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const contents = event.sender
  if (!contents || contents.isDestroyed()) return false
  if (!trustedWindows.has(contents.id)) return false
  // Must be the window's OWN top frame. An iframe inherits the preload, so a
  // subframe reaching a privileged channel is exactly what this rejects.
  const frame = event.senderFrame
  if (!frame || frame !== contents.mainFrame) return false
  return isTrustedLocation(frame.url)
}

/**
 * Wrap `ipcMain` so `.handle` / `.on` reject an untrusted sender before the real
 * handler runs. An `invoke` rejection surfaces as an error in the renderer; a
 * fire-and-forget `.on` is dropped silently.
 *
 * Returned as a Proxy so call sites read as ordinary `ipcMain` usage — the point
 * is that a handler added later is covered by construction rather than by
 * remembering to opt in. Every channel an app adds from here inherits the guard
 * without the author having to think about it.
 */
export function guardIpc(ipcMain: IpcMain): IpcMain {
  const wrappers = new WeakMap<(...args: never[]) => void, (...args: never[]) => void>()

  return new Proxy(ipcMain, {
    get(target, prop, receiver) {
      if (prop === 'handle') {
        return (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown
        ) => {
          target.handle(channel, (event, ...args) => {
            if (!isSenderAllowed(event)) {
              throw new Error(`IPC "${channel}" rejected: untrusted sender`)
            }
            return listener(event, ...(args as never[]))
          })
        }
      }
      if (prop === 'on') {
        return (channel: string, listener: (event: IpcMainEvent, ...args: never[]) => void) => {
          const wrapped = (event: IpcMainEvent, ...args: never[]): void => {
            if (!isSenderAllowed(event)) return
            listener(event, ...args)
          }
          wrappers.set(
            listener as (...args: never[]) => void,
            wrapped as unknown as (...args: never[]) => void
          )
          target.on(channel, wrapped as never)
          return receiver
        }
      }
      // `.on` registered a wrapper, so removal has to be remapped or it silently
      // removes nothing and the listener stays live.
      if (prop === 'off' || prop === 'removeListener') {
        return (channel: string, listener: (...args: never[]) => void) => {
          target.removeListener(channel, (wrappers.get(listener) ?? listener) as never)
          return receiver
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as IpcMain
}

/**
 * The renderer's policy: the template's, plus `midir-icon:` in `img-src` for the
 * item icons (the scheme is registered `bypassCSP`, and the tag names it
 * anyway so the two say the same thing). **This string is duplicated in
 * `src/renderer/index.html`'s `<meta>` tag on purpose**, and `windowSecurity.csp.test.ts`
 * reads that file and asserts the two agree — a static HTML document cannot
 * import a TS constant, so the choice is between two copies that are pinned and
 * two copies that are not.
 *
 * The meta tag STAYS. A header is not a replacement for it: this is defence in
 * depth, and the tag is what a reader of the HTML sees.
 */
export const RENDERER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: midir-icon:"

/**
 * The splash's policy, and it is deliberately TIGHTER than the renderer's.
 *
 * `resources/splash.html` has one inline `<style>`, one same-origin `<img>` and
 * **no script of any kind** — it is self-contained so it paints before the
 * renderer bundle exists. So it gets `default-src 'none'` and no `script-src`
 * grant at all, where the renderer must allow its own bundle.
 *
 * **Two policies, and the header still only ever carries one.** A meta policy and
 * a header policy INTERSECT rather than override, so the splash ends up under
 * `RENDERER_CSP ∩ SPLASH_CSP`, which is `SPLASH_CSP`. Selecting a policy per URL
 * in the header would be more precise and would need path matching against an
 * asar URL to do it — fragile, for an outcome the intersection already gives.
 */
export const SPLASH_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"

/**
 * The DEVELOPMENT policy: `RENDERER_CSP` with `'unsafe-inline'` added to
 * `script-src`, and nothing else changed.
 *
 * **`npm run dev` does not work under the production policy, and finding that
 * out cost a launch.** `@vitejs/plugin-react` injects the React Refresh preamble
 * as an INLINE `<script>` at the top of `<head>`, and the dev server's HMR
 * client is inline too. Under `script-src 'self'` Chromium refuses the preamble,
 * the plugin then throws `can't detect preamble`, and the window never renders.
 *
 * **The meta tag never blocked it, and the reason is the whole point of this
 * card.** A meta policy applies from the point the parser REACHES it, and the
 * preamble is injected above it. So the tag let through exactly the code the
 * header stops — which is the window HTOO-391 was written to close, discovered
 * by closing it.
 *
 * **It is keyed on `NODE_ENV === 'development'`, NOT on `app.isPackaged`.** The
 * e2e suite runs the BUILT app with `electron .`, so `isPackaged` is false
 * there: keying on it would hand the relaxed policy to the one automated check
 * that exercises a real renderer, and the strict policy would then be tested
 * nowhere at all. electron-vite sets `development`; `e2e/helpers.js` sets
 * `test`.
 */
export const DEV_RENDERER_CSP = RENDERER_CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'"
)

/** The policy for this launch. Production unless electron-vite says otherwise. */
export function cspForEnvironment(nodeEnv: string | undefined): string {
  return nodeEnv === 'development' ? DEV_RENDERER_CSP : RENDERER_CSP
}

/** The header name, lower-cased once so the strip and the write cannot disagree. */
const CSP_HEADER = 'content-security-policy'

/**
 * Schemes whose responses we stamp. **An allowlist rather than "everything",
 * because `devtools:` is not our content to police** — putting `default-src 'self'`
 * on Chromium's own inspector breaks the tool in dev and buys nothing.
 */
const POLICED_PROTOCOLS = new Set(['file:', 'http:', 'https:'])

/** The two shapes of `onHeadersReceived` we use, named so this file needs no electron import. */
interface HeadersReceivedDetails {
  url: string
  responseHeaders?: Record<string, string[]> | undefined
}
interface HeadersReceivedResponse {
  responseHeaders?: Record<string, string[]> | undefined
}
export interface CspSession {
  webRequest: {
    onHeadersReceived(
      listener: (
        details: HeadersReceivedDetails,
        callback: (response: HeadersReceivedResponse) => void
      ) => void
    ): void
  }
}

/** True when a response at this URL should carry our policy. */
export function isPolicedUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    // A URL we cannot parse is POLICED, not exempted. A header can only ever
    // restrict, so this direction fails closed: the worst case is a policy on
    // something that did not need one.
    return true
  }
  return POLICED_PROTOCOLS.has(url.protocol)
}

/**
 * Strip every existing CSP header, then write ours.
 *
 * **Replaced, not added to.** Two CSP headers intersect, so leaving one in place
 * would make the effective policy a function of whoever else set it. Header names
 * are case-insensitive, so the match is too — and the `-report-only` variant goes
 * with it for the same reason: a report-only policy left behind is a second
 * policy in the response we did not write.
 */
export function applyCspHeaders(
  headers: Record<string, string[]> | undefined,
  policy: string
): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase()
    if (lower === CSP_HEADER || lower === `${CSP_HEADER}-report-only`) continue
    next[name] = value
  }
  next['Content-Security-Policy'] = [policy]
  return next
}

/**
 * Put the policy on every response the renderer loads.
 *
 * `session` is INJECTED rather than imported, like `openExternal` above, so this
 * module stays free of a runtime `electron` import and the unit tests need no
 * electron stub.
 *
 * **A meta tag applies once the parser reaches it; a header applies to the
 * response.** That gap is the whole of what this changes — the policy string is
 * unchanged from the tag it joins, which is worth saying because a header CSP is
 * an easy place to tighten a policy by accident and meet it later as a rendering
 * bug.
 */
export function installContentSecurityPolicy(session: CspSession, policy = RENDERER_CSP): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!isPolicedUrl(details.url)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({ responseHeaders: applyCspHeaders(details.responseHeaders, policy) })
  })
}

/** Test-only reset, so suites do not leak trusted state between cases. */
export function __resetWindowSecurityForTests(): void {
  trustedLocations = []
  trustedWindows.clear()
}
