// Privacy scrubbing for captured errors and the diagnostics block. PURE — no
// node/electron imports; the caller (main) passes `homeDir` / `userName` in from
// `os.*`, which is what keeps this unit-testable and keeps `shared/` free of node.
//
// **In Midir, scrubbing runs on the assembled REPORT**, in `main/diagnostics.ts`,
// and not at capture. The house module scrubs at capture because its session log
// exists for the report; Midir's session log (`main/log.ts`) predates the module
// and is the diagnostic record the Diagnostics tab shows the player, paths and
// all, on their own machine. The one scrub site is the block the report dialog
// shows editable, which is the only text that leaves the machine. The Diagnostics
// tab's log view and the log files on disk are not scrubbed, and the Report Issue
// dialog says so beside the Reveal-logs button.
//
// Goal: strip anything identifying a person, a machine or an account — usernames,
// home and repository paths, emails, IP addresses, and **credentials** — while
// leaving enough of an error (type, message, file basename) to debug from.
//
// **The credential rules are Balor's addition to the house module**, taken whole:
// the house doc says an app that captures the output of anything it did not write
// takes balor's scrub rather than the five base rules, and Midir's log carries
// text the game client and the server wrote (notices, dialog text, chat). Nothing
// matches a token by its PREFIX; these rules match the CONTAINER a secret travels
// in (a URL's userinfo, a header, an assignment), which is a property of the text
// rather than a guess about the value.

// `userinfo@host` inside anything URL-shaped. Anchored on a scheme so a bare
// email address in prose is left to the e-mail rule.
const URL_USERINFO = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+@/g

/** Blank the credentials out of any URL inside `text`, keeping the scheme and host. */
export function redactUrlCredentials(text: string): string {
  return text.replace(URL_USERINFO, '$1***@')
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `Authorization: Bearer <t>` / `token <t>`. Keeps the scheme, drops the value —
// so a 401 still says which kind of credential was refused.
const AUTH_HEADER_RE = /\b(authorization\s*:\s*)(\w+\s+)?\S+/gi

// A shell- or env-style assignment whose NAME says it carries a secret. Generic on
// purpose, so this file has to know no name.
const SECRET_ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY))(\s*=\s*)\S+/gi

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

// Deep ABSOLUTE paths (3+ components) collapse to "…<sep><basename>". Runs before
// the account-path rules so a path with an embedded username — `C:\Users\alice\src\
// midir\index.ts` — folds to `…\index.ts`, dropping the account name AND the local
// directory structure in one pass rather than leaving a redacted skeleton of it.
// It also catches paths that carry no username at all, which on this machine is
// most of them.
const WIN_DEEP_PATH_RE = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\){2,}[^\\/:*?"<>|\r\n]+/g
// POSIX variant. The lookbehind is what keeps it from eating a URL's path
// (`https://a/b/c`) or a path already glued to a word or a colon.
const POSIX_DEEP_PATH_RE = /(?<![:/\w])(?:\/[^/\s:*?"<>|\r\n]+){3,}/g

// Short named-account paths the collapse could not reach — only two components,
// `C:\Users\alice` or `/home/alice`. Keep the recognisable prefix, redact the name.
const WIN_USER_RE = /([A-Za-z]:[\\/]Users[\\/])([^\\/:*?"<>|\r\n]+)/gi
const POSIX_HOME_RE = /((?:\/Users|\/home)\/)([^/\r\n]+)/g

export interface ScrubContext {
  homeDir?: string
  userName?: string
}

/**
 * Scrub identifying information out of a block of text.
 *
 * The order below is load-bearing at three points:
 *
 * - **Credentials first.** `redactUrlCredentials` leaves `https://***@github.com/o/r`,
 *   which still names the failing remote. Letting the email rule reach it first
 *   would produce `https://<email>/o/r` — redacted, but no longer an answer to
 *   "which remote".
 * - **Deep paths before account paths**, so an embedded username is dropped with
 *   the whole path rather than redacted in place inside a path that survives.
 * - **`homeDir` after both**, because it exists for the install that lives nowhere
 *   near `/home` or `C:\Users` and is therefore the case the shapes above miss.
 */
export function scrubText(text: string, ctx: ScrubContext = {}): string {
  if (typeof text !== 'string' || text.length === 0) return text
  const { homeDir, userName } = ctx
  let out = text

  // 1. Credentials, in the three containers they travel in.
  out = redactUrlCredentials(out)
  out = out.replace(AUTH_HEADER_RE, (_m, head: string, scheme?: string) =>
    scheme ? `${head}${scheme}<redacted>` : `${head}<redacted>`
  )
  out = out.replace(SECRET_ASSIGNMENT_RE, '$1$2<redacted>')

  // 2. Emails and IPv4 — independent of any path shape, so they run up front.
  out = out.replace(EMAIL_RE, '<email>')
  out = out.replace(IPV4_RE, '<ip>')

  // 3. Collapse deep absolute paths to their basename.
  out = out.replace(WIN_DEEP_PATH_RE, (m) => `…\\${m.split('\\').pop()}`)
  out = out.replace(POSIX_DEEP_PATH_RE, (m) => `…/${m.split('/').pop()}`)

  // 4. Short account paths the collapse did not reach.
  out = out.replace(WIN_USER_RE, '$1<user>')
  out = out.replace(POSIX_HOME_RE, '$1<user>')

  // 5. An explicit home directory, for a non-standard install location.
  if (typeof homeDir === 'string' && homeDir.length > 0) {
    out = out.replace(new RegExp(escapeRegExp(homeDir), 'gi'), '<HOME>')
  }

  // 6. A bare username token elsewhere in the text — inside a message, or a URL
  // the path rules left alone. Only when long enough to be unambiguous: a
  // two-character name would clobber innocent substrings ("al" inside "also"),
  // and a diagnostics block nobody can read is worse than one naming an account.
  if (typeof userName === 'string' && userName.length >= 3) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(userName)}\\b`, 'g'), '<user>')
  }

  return out
}
