import { describe, it, expect } from 'vitest'
import { buildDiagnosticsBlock, formatErrorLine } from '../diagnostics'

describe('formatErrorLine', () => {
  it('renders timestamp, source, origin and message in that order', () => {
    expect(
      formatErrorLine({
        timestamp: '2026-08-06T10:00:00.000Z',
        source: 'uncaughtException',
        origin: 'main',
        message: 'Error: boom'
      })
    ).toBe('2026-08-06T10:00:00.000Z [uncaughtException] main :: Error: boom')
  })

  it('flattens a multi-line stack onto one physical line', () => {
    // One entry is one line, because grep over five session files is the first
    // thing anyone does with these — a wrapped stack turns one hit into a
    // fragment with no timestamp on it.
    const line = formatErrorLine({
      timestamp: 't',
      message: 'Error: boom',
      stack: 'Error: boom\n    at a (x.ts:1)\n    at b (y.ts:2)'
    })
    expect(line).not.toContain('\n')
    expect(line).toContain('at a (x.ts:1) | at b (y.ts:2)')
  })

  it('defaults an empty entry rather than rendering undefined', () => {
    // Its callers are error handlers, which is exactly where a half-built object
    // arrives. "undefined" in a log line reads as a fact about the error.
    const line = formatErrorLine({})
    expect(line).toBe('[error] main ::')
    expect(line).not.toContain('undefined')
  })
})

describe('buildDiagnosticsBlock', () => {
  it('puts app, OS and the errors heading in a fixed order', () => {
    const block = buildDiagnosticsBlock({
      productName: 'Balor',
      version: '0.1.0',
      os: 'linux',
      errors: [{ timestamp: 't', source: 'react', origin: 'renderer', message: 'Error: boom' }]
    })
    expect(block.split('\n')).toEqual([
      'App: Balor 0.1.0',
      'OS: linux',
      '--- recent errors (scrubbed) ---',
      't [react] renderer :: Error: boom'
    ])
  })

  it('says so when nothing was captured, rather than ending on the heading', () => {
    // An absent section reads as a bundle that failed to collect. A sentence reads
    // as an answer — and "it misbehaved without throwing" is a real report.
    expect(
      buildDiagnosticsBlock({ productName: 'Balor', version: '0.1.0', os: 'linux' })
    ).toContain('No errors captured this session.')
  })

  it('builds a usable block from no input at all', () => {
    // Called from a crash path; it must not throw on a missing version.
    expect(() => buildDiagnosticsBlock()).not.toThrow()
    expect(buildDiagnosticsBlock()).toContain('--- recent errors (scrubbed) ---')
  })

  it('redacts nothing itself', () => {
    // Deliberate, and worth pinning: `captureError` is the single scrub site. A
    // second one here would make it ambiguous which pass a given line went through
    // — and this module is fed already-scrubbed entries by contract.
    expect(buildDiagnosticsBlock({ errors: [{ message: '/home/alice/x' }] })).toContain(
      '/home/alice/x'
    )
  })
})
