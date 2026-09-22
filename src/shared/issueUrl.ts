// Pure construction of a GitHub "new issue" prefill URL, plus the length-budget
// truncation that keeps it openable. No node/electron imports.
//
// **`URLSearchParams` does the encoding, and that is the security argument for why
// a title and a body are not a fourth input shape.** A body is prose the user
// typed: it names nothing, resolves to nothing, and reaches no argv anywhere — the
// same reasoning `shared/commitMessage.ts` carries, one container over. The
// difference from a commit message is that this one does enter a container with a
// framing (a URL), and that is exactly what `URLSearchParams` closes: it
// percent-encodes `&`, `#`, `?` and every control byte, so there is no separator
// left for a body to break out through. Compare `patToken.ts`, which bans CR and LF
// outright — an HTTP header value has no encoder, so the ban has to do the work the
// encoder does here.
//
// The composed URL is still gated on `isSafeExternalUrl` before it reaches
// `shell.openExternal` (in `main/diagnostics.ts`), which stands where `git
// check-ref-format --branch` stands for a typed branch name: the pure screen first,
// then the authority that owns the format.

const TRUNCATION_NOTE =
  '\n\n_(diagnostics truncated — the full report is on your clipboard; paste it here)_'

export interface IssueUrlParams {
  owner: string
  repo: string
  title?: string
  body?: string
  labels?: string[]
}

/** Build a `github.com/<owner>/<repo>/issues/new` prefill URL. */
export function buildIssueUrl({
  owner,
  repo,
  title = '',
  body = '',
  labels = []
}: IssueUrlParams): string {
  const params = new URLSearchParams()
  if (title) params.set('title', title)
  if (body) params.set('body', body)
  if (labels && labels.length) params.set('labels', labels.join(','))
  return `https://github.com/${owner}/${repo}/issues/new?${params.toString()}`
}

/**
 * Build the issue URL with `body` trimmed so the WHOLE URL fits in `maxUrlLen`,
 * appending a note that points at the clipboard when it had to trim.
 *
 * **Binary search over the built URL, not arithmetic over the body.** Percent
 * encoding expands a string non-linearly and by an amount that depends on its
 * bytes — a body of newlines and backticks triples, a body of ASCII words barely
 * grows — so any "budget minus overhead" sum is wrong for some real input and
 * right for the one it was tested against. Measuring the finished URL is the
 * property that makes this correct, and it is also its own self-check: the
 * returned URL is short enough because that is the condition the search accepted.
 *
 * The caller copies the FULL body to the clipboard before opening the URL, so a
 * truncated prefill is always completable by paste.
 */
export function truncateBodyForUrl(
  p: IssueUrlParams,
  maxUrlLen: number
): { url: string; truncated: boolean } {
  const full = buildIssueUrl(p)
  if (full.length <= maxUrlLen) return { url: full, truncated: false }

  const body = p.body || ''
  let lo = 0
  let hi = body.length
  let best = ''
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = body.slice(0, mid) + TRUNCATION_NOTE
    if (buildIssueUrl({ ...p, body: candidate }).length <= maxUrlLen) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // `best` stays empty when even the note alone does not fit — a budget smaller
  // than the title and labels. Returning the URL without a body is still the right
  // answer: the issue page opens, and the clipboard has everything.
  return { url: buildIssueUrl({ ...p, body: best }), truncated: true }
}
