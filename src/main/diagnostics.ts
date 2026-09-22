import os from 'os'
import { appIdentity } from '../shared/appIdentity'
import { simplifyPlatform } from '../shared/osName'
import { buildDiagnosticsBlock, type ErrorEntry } from '../shared/diagnostics'
import { truncateBodyForUrl } from '../shared/issueUrl'
import { scrubText } from '../shared/scrub'
import { isSafeExternalUrl } from '../shared/externalUrl'
import type { LogEntry } from '../shared/log'
import type { OpenIssueResult } from '../shared/types'

/**
 * Backing logic for the `diagnostics:*` report handlers: the house Report Issue
 * module's main half, composed against Midir's own session log.
 *
 * **It imports no electron, and the clipboard and the browser are injected**
 * (balor's shape). That is what lets the handler module import this file at all:
 * a runtime electron import anywhere in that graph and the node vitest project
 * stops loading it. With the two side effects as arguments, every assertion in
 * `diagnostics.test.ts` (that the clipboard gets the FULL body, that it gets it
 * BEFORE the URL opens, that a refused URL still leaves a copy) is a plain
 * function call.
 *
 * **The recent errors come from `main/log.ts`, not a second ring buffer.** The
 * house module keeps its own scrubbed session log because it has no other; Midir
 * has had one since WP8, with every warning and error either process writes, so
 * the report reads the newest `error` and `warn` entries from it. That log is not
 * scrubbed at capture (it is the Diagnostics tab's record, on the player's own
 * machine), so this module is the ONE scrub site, over the assembled block, which
 * is the only text that leaves the machine.
 */
export interface DiagnosticsIo {
  /** `clipboard.writeText`. */
  writeClipboard: (text: string) => void
  /** `shell.openExternal`, already gated on `isSafeExternalUrl` by its caller. */
  openExternal: (url: string) => void
}

/**
 * The URL length Midir will hand to the OS.
 *
 * `shell.openExternal` is reliable to roughly 2 KB across the browsers and desktop
 * handlers this has to work on, and the limit is the smallest of the browser's,
 * the desktop portal's, and, on Windows, the shell's. 1800 leaves headroom; the
 * cost of being conservative is a truncation note on a report whose full text is
 * already on the clipboard, while the cost of being wrong is a button that does
 * nothing.
 */
export const MAX_URL_LEN = 1800

/** How many of the newest warnings and errors the block carries. */
export const RECENT_ERRORS = 30

/** The newest warnings and errors of the session log, oldest first, as error entries. */
export function recentErrors(entries: LogEntry[], limit = RECENT_ERRORS): ErrorEntry[] {
  return entries
    .filter((e) => e.level === 'error' || e.level === 'warn')
    .slice(-limit)
    .map((e) => ({
      timestamp: new Date(e.timeMs).toISOString(),
      source: e.level,
      origin: e.scope,
      message: e.message
    }))
}

/**
 * The scrubbed diagnostics block, shown EDITABLE in the report dialog.
 *
 * Editable is the point rather than a courtesy: scrubbing is a set of rules about
 * shapes, and the person sending the report is the only one who can see what the
 * rules missed. Showing them the exact text that will be sent is the part of this
 * feature that makes the rest of it honest.
 */
export function buildDiagnostics(version: string, entries: LogEntry[]): string {
  const block = buildDiagnosticsBlock({
    productName: appIdentity.productName,
    version,
    os: simplifyPlatform(process.platform),
    errors: recentErrors(entries)
  })
  let userName: string | undefined
  try {
    userName = os.userInfo().username
  } catch {
    userName = undefined
  }
  return scrubText(block, { homeDir: os.homedir(), userName })
}

/**
 * Open a prefilled issue on the shared public intake, after copying the full report.
 *
 * **The clipboard write is first and is unconditional**, which is what makes every
 * failure below survivable: a truncated URL is completed by paste, and a URL that is
 * refused outright still leaves the user holding the whole report. It is also why
 * the copy is not skipped when nothing was truncated: the user has no way to know
 * in advance which case they are in.
 *
 * Only the stable per-app label rides in the URL. GitHub applies a `labels=` value
 * only for a label that already exists and drops it silently otherwise, so the
 * version is in the body instead, where nothing can drop it.
 */
export function openIssue(io: DiagnosticsIo, p: { title: string; body: string }): OpenIssueResult {
  io.writeClipboard(p.body)

  const { url, truncated } = truncateBodyForUrl(
    {
      owner: appIdentity.intakeOwner,
      repo: appIdentity.intakeRepo,
      title: p.title,
      body: p.body,
      labels: [appIdentity.appLabel]
    },
    MAX_URL_LEN
  )

  // Main composed this URL from its own constants, so the check can only fail if
  // `appIdentity` is edited into something that is not a web address. It runs
  // anyway: `shell.openExternal` hands a string to the operating system, and
  // `externalUrl.ts` exists precisely so no caller is trusted to have checked.
  if (!isSafeExternalUrl(url)) return { ok: false, reason: 'unsafe-url' }

  io.openExternal(url)
  return { ok: true, truncated }
}

/**
 * The always-works fallback: the full report on the clipboard and nothing else.
 * For the user with no GitHub account, the machine with no browser handler, and
 * the report that is going into a chat window instead.
 */
export function copyReport(io: DiagnosticsIo, p: { body: string }): { ok: true } {
  io.writeClipboard(p.body)
  return { ok: true }
}
