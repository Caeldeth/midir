import { describe, it, expect } from 'vitest'
import { buildIssueUrl, truncateBodyForUrl } from '../issueUrl'
import { isSafeExternalUrl } from '../externalUrl'

const INTAKE = { owner: 'hybrasyl', repo: 'cernunnos' }

describe('buildIssueUrl', () => {
  it('targets the intake repositorys issues/new path', () => {
    expect(buildIssueUrl(INTAKE)).toBe('https://github.com/hybrasyl/cernunnos/issues/new?')
  })

  it('percent-encodes everything that could be a separator', () => {
    // This is the security argument for why a title and a body are not a fourth
    // input shape, so it is asserted rather than assumed: a body cannot introduce a
    // parameter of its own, because `&`, `=` and `#` never survive as themselves.
    const url = buildIssueUrl({ ...INTAKE, body: 'a&labels=app:oghma#frag' })
    expect(url).toContain('body=a%26labels%3Dapp%3Aoghma%23frag')
    // Exactly one `&` in the whole URL is impossible to assert here (there is one
    // parameter), so assert the thing that matters: no injected separator.
    expect(url.split('&')).toHaveLength(1)
  })

  it('carries the label as a parameter, and only when there is one', () => {
    expect(buildIssueUrl({ ...INTAKE, labels: ['app:balor'] })).toContain('labels=app%3Abalor')
    expect(buildIssueUrl(INTAKE)).not.toContain('labels=')
  })

  it('omits an empty title or body rather than sending a blank parameter', () => {
    const url = buildIssueUrl({ ...INTAKE, title: '', body: '' })
    expect(url).not.toContain('title=')
    expect(url).not.toContain('body=')
  })

  it('produces something isSafeExternalUrl accepts', () => {
    // The gate in `main/diagnostics.ts` is only useful if the happy path clears it.
    // A test that only checked the refusal would pass on a version that refuses
    // everything.
    expect(
      isSafeExternalUrl(
        buildIssueUrl({ ...INTAKE, title: 'x', body: 'y\nz', labels: ['app:balor'] })
      )
    ).toBe(true)
  })
})

describe('truncateBodyForUrl', () => {
  it('leaves a short body untouched and says it did not truncate', () => {
    const p = { ...INTAKE, title: 'Short', body: 'A few words.', labels: ['app:balor'] }
    const { url, truncated } = truncateBodyForUrl(p, 1800)
    expect(truncated).toBe(false)
    expect(url).toBe(buildIssueUrl(p))
  })

  it('trims a long body to fit the budget and appends a note pointing at the clipboard', () => {
    const p = { ...INTAKE, title: 'Long', body: 'x'.repeat(10_000), labels: ['app:balor'] }
    const { url, truncated } = truncateBodyForUrl(p, 1800)
    expect(truncated).toBe(true)
    expect(url.length).toBeLessThanOrEqual(1800)
    // Read the parameter back out rather than decoding the whole URL. `+` is a space
    // inside a query value and `decodeURIComponent` does not know that, so decoding
    // the raw string is a check that fails on correct output.
    expect(new URL(url).searchParams.get('body')).toContain('full report is on your clipboard')
  })

  it('respects the budget for a body whose encoding expands the most', () => {
    // The reason this is a binary search over the BUILT url rather than arithmetic
    // over the body. Newlines and backticks are three encoded characters each, so a
    // "budget minus overhead" sum tuned on ASCII overshoots here — by enough to
    // produce a link the OS silently refuses.
    const p = { ...INTAKE, title: 'Fenced', body: '```\n'.repeat(2000), labels: ['app:balor'] }
    const { url, truncated } = truncateBodyForUrl(p, 1800)
    expect(truncated).toBe(true)
    expect(url.length).toBeLessThanOrEqual(1800)
  })

  it('still returns an openable URL when even the note does not fit', () => {
    // A budget smaller than the title and labels. Dropping the body entirely is the
    // right answer: the issue page opens, and the clipboard has everything.
    const p = { ...INTAKE, title: 'T'.repeat(200), body: 'anything', labels: ['app:balor'] }
    const { url, truncated } = truncateBodyForUrl(p, 120)
    expect(truncated).toBe(true)
    expect(url).not.toContain('body=')
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it('keeps the label even when the body is trimmed away', () => {
    // The label is the only thing routing the report to Balor's triage. Losing it to
    // a length budget would be silent — GitHub drops an unknown label without error.
    const p = { ...INTAKE, title: 'Long', body: 'y'.repeat(10_000), labels: ['app:balor'] }
    expect(truncateBodyForUrl(p, 1800).url).toContain('labels=app%3Abalor')
  })
})
