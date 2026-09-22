import { describe, it, expect } from 'vitest'
import {
  composeIssueBody,
  copyReportMessage,
  openIssueFailedMessage,
  openIssueMessage,
  DEFAULT_ISSUE_TITLE
} from '../reportMessages'

describe('composeIssueBody', () => {
  it('fences the diagnostics so GitHub does not render them as markdown', () => {
    const body = composeIssueBody('It broke.', 'App: Midir 0.1.0\nOS: linux')
    expect(body).toBe('It broke.\n\n```\nApp: Midir 0.1.0\nOS: linux\n```')
  })

  it('keeps a scrub placeholder visible', () => {
    // The reason the fence is not decoration. Unfenced, GitHub eats `<user>` as an
    // HTML tag — so the redaction that put it there stops being visible to the
    // person reading the report, and a path with underscores comes out italicised.
    const body = composeIssueBody('x', 'at …/x.ts for <user> in my_module_name')
    expect(body).toContain('<user>')
    expect(body).toContain('my_module_name')
    expect(body.startsWith('x\n\n```\n')).toBe(true)
  })

  it('trims the description but not the diagnostics', () => {
    // The block is main's own, possibly edited by hand. Trimming somebody's edit is
    // not this function's business.
    expect(composeIssueBody('  spaced  ', '  block  ')).toBe('spaced\n\n```\n  block  \n```')
  })

  it('still produces a valid body when the user wrote nothing', () => {
    // A report with only diagnostics is a real report — "it crashed and here is the
    // stack" needs no prose.
    expect(composeIssueBody('', 'App: Midir')).toBe('\n\n```\nApp: Midir\n```')
  })
})

describe('openIssueMessage', () => {
  it('names the clipboard on the ordinary success', () => {
    const m = openIssueMessage({ ok: true, truncated: false })
    expect(m.severity).toBe('success')
    expect(m.text).toContain('clipboard')
  })

  it('treats truncation as information, not failure, and asks for one paste', () => {
    // Nothing went wrong: the report was longer than a link may be. Wording it as an
    // error would send people back to retype a description already in their hands.
    const m = openIssueMessage({ ok: true, truncated: true })
    expect(m.severity).not.toBe('error')
    expect(m.text).toContain('paste')
  })

  it('offers the manual route when the URL was refused, and still names the clipboard', () => {
    const m = openIssueMessage({ ok: false, reason: 'unsafe-url' })
    expect(m.severity).toBe('error')
    expect(m.text).toContain('clipboard')
    // The intake is named so the user can finish by hand. It comes from
    // `appIdentity`, so the sentence cannot drift from the URL the button opens.
    expect(m.text).toContain('github.com/hybrasyl/cernunnos')
  })
})

describe('openIssueFailedMessage', () => {
  it('promises no clipboard, because there is none', () => {
    // The distinction from `unsafe-url`. This throw comes from validation, BEFORE
    // main touches the clipboard — promising a copy that is not there is worse than
    // reporting the failure plainly.
    const m = openIssueFailedMessage()
    expect(m.severity).toBe('error')
    expect(m.text).not.toMatch(/is on your clipboard/)
    expect(m.text).toContain('Copy the report')
  })
})

describe('copyReportMessage', () => {
  it('says which way it went', () => {
    expect(copyReportMessage(true)).toEqual({
      severity: 'success',
      text: 'Report copied to your clipboard.'
    })
    expect(copyReportMessage(false).severity).toBe('error')
  })
})

describe('DEFAULT_ISSUE_TITLE', () => {
  it('is a title somebody can triage from', () => {
    // An untitled issue has to be opened before anyone can tell what it is about.
    expect(DEFAULT_ISSUE_TITLE).toContain('Midir')
  })
})
