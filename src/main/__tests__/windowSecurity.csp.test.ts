// HTOO-391 — the CSP response header, and the two documents' own meta tags.
//
// The policy strings live in THREE places between them: `RENDERER_CSP` and
// `SPLASH_CSP` in windowSecurity.ts, the meta tag in src/renderer/index.html, and
// the meta tag in resources/splash.html. A static HTML document cannot import a
// TS constant, so the choice is between copies that are pinned and copies that
// are not. These tests are the pin.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  RENDERER_CSP,
  DEV_RENDERER_CSP,
  cspForEnvironment,
  SPLASH_CSP,
  isPolicedUrl,
  applyCspHeaders,
  installContentSecurityPolicy,
  type CspSession
} from '../windowSecurity'

const repoRoot = join(__dirname, '../../..')

/** The `content="…"` of the first CSP meta tag in a document, whitespace-collapsed. */
function metaPolicy(relPath: string): string {
  const html = readFileSync(join(repoRoot, relPath), 'utf-8')
  const tag = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]*)"/.exec(html)
  if (!tag) throw new Error(`no CSP meta tag in ${relPath}`)
  return tag[1]!.replace(/\s+/g, ' ').trim()
}

describe('the policy strings and the documents agree', () => {
  it('src/renderer/index.html carries RENDERER_CSP verbatim', () => {
    expect(metaPolicy('src/renderer/index.html')).toBe(RENDERER_CSP)
  })

  it('resources/splash.html carries SPLASH_CSP verbatim', () => {
    expect(metaPolicy('resources/splash.html')).toBe(SPLASH_CSP)
  })

  // The splash is self-contained by design — one inline <style>, one same-origin
  // <img>, and no script at all. Its policy grants no script source, and this
  // asserts the REASON rather than the string: a splash that grows a <script>
  // fails here rather than silently running it under a policy nobody re-read.
  it('the splash grants no script source, and the document has no script', () => {
    expect(SPLASH_CSP).not.toMatch(/script-src/)
    expect(SPLASH_CSP).toMatch(/default-src 'none'/)
    const html = readFileSync(join(repoRoot, 'resources/splash.html'), 'utf-8')
    expect(html).not.toMatch(/<script/i)
  })
})

describe('isPolicedUrl', () => {
  it('polices the three schemes our own content loads over', () => {
    expect(isPolicedUrl('file:///opt/Midir/resources/app.asar/out/renderer/index.html')).toBe(true)
    expect(isPolicedUrl('http://localhost:5173/index.html')).toBe(true)
    expect(isPolicedUrl('https://localhost:5173/index.html')).toBe(true)
  })

  // Not our content to police. `default-src 'self'` on Chromium's own inspector
  // breaks the tool in dev and buys nothing.
  it('leaves devtools and extension responses alone', () => {
    expect(isPolicedUrl('devtools://devtools/bundled/inspector.html')).toBe(false)
    expect(isPolicedUrl('chrome-extension://abc/panel.html')).toBe(false)
  })

  // Fails CLOSED. A header can only restrict, so the worst case of policing an
  // unparseable URL is a policy on something that did not need one.
  it('polices a URL it cannot parse', () => {
    expect(isPolicedUrl('not a url')).toBe(true)
    expect(isPolicedUrl('')).toBe(true)
  })
})

describe('applyCspHeaders', () => {
  it('writes the policy and keeps every unrelated header', () => {
    const out = applyCspHeaders(
      { 'Content-Type': ['text/html'], 'X-Whatever': ['1'] },
      RENDERER_CSP
    )
    expect(out['Content-Security-Policy']).toEqual([RENDERER_CSP])
    expect(out['Content-Type']).toEqual(['text/html'])
    expect(out['X-Whatever']).toEqual(['1'])
  })

  // Two CSP headers INTERSECT rather than override, so an existing one left in
  // place would make the effective policy a function of whoever else set it.
  it('replaces an existing policy rather than adding to it', () => {
    const out = applyCspHeaders({ 'content-security-policy': ["default-src 'none'"] }, RENDERER_CSP)
    const names = Object.keys(out).filter((n) => n.toLowerCase().startsWith('content-security'))
    expect(names).toEqual(['Content-Security-Policy'])
    expect(out['Content-Security-Policy']).toEqual([RENDERER_CSP])
  })

  // Header names are case-insensitive, so the match has to be. A survivor here
  // is invisible in a manual check, because the browser applies the intersection
  // and the page still looks right.
  it('strips a policy header whatever its casing', () => {
    const out = applyCspHeaders({ 'CONTENT-SECURITY-POLICY': ["default-src 'none'"] }, RENDERER_CSP)
    expect(Object.keys(out)).toEqual(['Content-Security-Policy'])
  })

  // A report-only policy left behind is still a second policy in a response we
  // wrote — same reasoning, and the one a reader is most likely to think benign.
  it('strips the report-only variant too', () => {
    const out = applyCspHeaders(
      { 'Content-Security-Policy-Report-Only': ["default-src 'none'"] },
      RENDERER_CSP
    )
    expect(Object.keys(out)).toEqual(['Content-Security-Policy'])
  })

  it('handles a response with no headers at all', () => {
    expect(applyCspHeaders(undefined, RENDERER_CSP)['Content-Security-Policy']).toEqual([
      RENDERER_CSP
    ])
  })
})

describe('installContentSecurityPolicy', () => {
  /** A session double that captures the listener so a response can be driven through it. */
  function fakeSession(): {
    session: CspSession
    respond: (
      url: string,
      headers?: Record<string, string[]>
    ) => Record<string, string[]> | undefined
  } {
    let listener:
      | ((
          details: { url: string; responseHeaders?: Record<string, string[]> | undefined },
          callback: (r: { responseHeaders?: Record<string, string[]> | undefined }) => void
        ) => void)
      | undefined
    const session: CspSession = {
      webRequest: {
        onHeadersReceived(fn) {
          listener = fn
        }
      }
    }
    return {
      session,
      respond(url, headers) {
        if (!listener) throw new Error('no listener registered')
        const cb = vi.fn()
        listener({ url, responseHeaders: headers }, cb)
        expect(cb).toHaveBeenCalledTimes(1)
        return cb.mock.calls[0]![0].responseHeaders
      }
    }
  }

  it('stamps our own content', () => {
    const { session, respond } = fakeSession()
    installContentSecurityPolicy(session)
    const out = respond('file:///opt/Midir/out/renderer/index.html', {
      'Content-Type': ['text/html']
    })
    expect(out?.['Content-Security-Policy']).toEqual([RENDERER_CSP])
  })

  it('passes a devtools response through untouched', () => {
    const { session, respond } = fakeSession()
    installContentSecurityPolicy(session)
    const original = { 'Content-Type': ['text/html'] }
    const out = respond('devtools://devtools/bundled/inspector.html', original)
    expect(out).toBe(original)
    expect(out?.['Content-Security-Policy']).toBeUndefined()
  })

  // Every response gets a callback. A path that returns without calling one
  // HANGS the request rather than failing it, which reads as a blank window.
  it('always answers, on both branches', () => {
    const { session, respond } = fakeSession()
    installContentSecurityPolicy(session)
    expect(() => respond('file:///x/index.html')).not.toThrow()
    expect(() => respond('devtools://devtools/x.html')).not.toThrow()
  })
})

// The dev/production split, added after `npm run dev` stopped working on `main`.
//
// The unit suite and the e2e suite both passed over it, and neither could have
// caught it: **no gate in this repository runs the Vite dev server.** That is
// already `docs/testing.md` §2's first structural reason — `npm run dev` needs a
// GUI — arriving as a real failure rather than as a caveat.
describe('the development policy', () => {
  it('is the production policy plus inline scripts, and nothing else', () => {
    // Compared by construction rather than by a second literal: a hand-written
    // dev string would be a second copy to drift, and the thing that must stay
    // true is that ONLY script-src moved.
    expect(DEV_RENDERER_CSP).toBe(
      RENDERER_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    )
    expect(DEV_RENDERER_CSP).toContain("style-src 'self' 'unsafe-inline'")
    expect(DEV_RENDERER_CSP).toContain("default-src 'self'")
  })

  // The assertion that matters, because the whole point of the card is the
  // production policy. A relaxation that leaks into a build is worse than the
  // broken dev server it fixed.
  it('leaves production with NO inline script grant', () => {
    const scriptSrc = RENDERER_CSP.split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(RENDERER_CSP).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('selects the dev policy only for NODE_ENV=development', () => {
    expect(cspForEnvironment('development')).toBe(DEV_RENDERER_CSP)
    expect(cspForEnvironment('production')).toBe(RENDERER_CSP)
    expect(cspForEnvironment(undefined)).toBe(RENDERER_CSP)
  })

  // **`test` must get the STRICT policy**, and this is the case that decides it.
  // `e2e/helpers.js` launches the built app with `electron .`, so `isPackaged` is
  // false there. Keying the split on `isPackaged` would hand the relaxed policy
  // to the one automated check that drives a real renderer — and the production
  // policy would then be exercised nowhere at all.
  it('gives the e2e suite the production policy, not the relaxed one', () => {
    expect(cspForEnvironment('test')).toBe(RENDERER_CSP)
  })
})
