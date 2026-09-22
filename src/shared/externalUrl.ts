// Scheme allowlist for "open this in the user's browser". Pure string logic — no
// electron/node imports — so main can gate `shell.openExternal` on it and the unit
// tests can drive it directly.
//
// `shell.openExternal` hands the URL to the operating system, which will happily
// act on far more than a web link: `file:` opens a local path, `smb:` reaches a
// network share, and a registered custom scheme launches whatever claimed it.
//
// An app renders strings it did not author sooner than it expects — a homepage
// out of an API response, a link out of a data file — so the set of URLs that
// can reach `openExternal` is attacker-influenced in a way it is not for an app
// that only ever links to its own site. Allow exactly web pages and mailto, and
// refuse the rest rather than trusting every caller to have checked.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** True when `url` is a well-formed URL whose scheme is safe to hand to the OS. */
export function isSafeExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false // not a URL at all (relative path, bare string, control bytes)
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol)
}
