import { describe, it, expect } from 'vitest'
import { scrubText } from '../scrub'

/**
 * `scrubText` is the single thing standing between a captured error and a public
 * GitHub issue, so this file is organised around what must NOT survive it — and,
 * just as importantly, around what must.
 *
 * **The negatives carry as much weight as the positives.** A scrubber that redacts
 * everything is trivially safe and completely useless: a report with no file names,
 * no URLs and no error text is a report nobody can act on. Each `leaves … alone`
 * case below is a real thing a bug report needs to still contain.
 */
describe('scrubText', () => {
  it('leaves an empty or non-string input alone', () => {
    expect(scrubText('')).toBe('')
    // The signature says string, but this runs on `String(entry.message ?? '')` in a
    // crash path — a defensive return is cheaper than a throw inside an error handler.
    expect(scrubText(undefined as unknown as string)).toBeUndefined()
  })

  describe('credentials — WP10s constraint, and the reason this module differs from the house one', () => {
    // `github/tokenStore.ts` and `github/client.ts` each assert no log line holds the
    // token. A module that captures errors inherits that requirement and inherits
    // neither test, so these are those tests, written again for this side.
    const TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

    it('redacts a token embedded in a remote URL, and keeps the host', () => {
      const out = scrubText(`fatal: could not read from https://${TOKEN}@github.com/erisco/midir`)
      expect(out).not.toContain(TOKEN)
      // The host survives, because "which remote failed" is the whole content of the
      // message. A rule that redacted the URL wholesale would be safe and useless.
      expect(out).toContain('github.com/erisco/midir')
    })

    it('redacts user:password in a remote URL', () => {
      const out = scrubText('remote: https://sabrael:hunter2@git.example.com/x.git rejected')
      expect(out).not.toContain('hunter2')
      expect(out).not.toContain('sabrael:')
      expect(out).toContain('git.example.com/x.git')
    })

    it('redacts an Authorization header value but keeps the scheme', () => {
      const out = scrubText(`GET /user failed\nAuthorization: Bearer ${TOKEN}`)
      expect(out).not.toContain(TOKEN)
      // Which KIND of credential was refused is diagnostic; the credential is not.
      expect(out).toContain('Bearer')
      expect(out).toContain('<redacted>')
    })

    it('redacts a secret-shaped environment assignment, whatever its name', () => {
      // The rule is generic so this file need not know any name; balor's own
      // `BALOR_ASKPASS_TOKEN` is the sample it was written against.
      const out = scrubText(`spawn failed: BALOR_ASKPASS_TOKEN=${TOKEN} GIT_TERMINAL_PROMPT=0`)
      expect(out).not.toContain(TOKEN)
      expect(out).toContain('BALOR_ASKPASS_TOKEN=<redacted>')
      // A neighbouring variable that holds no secret is untouched — the rule matches
      // the NAME, so this proves it is not matching the whole line.
      expect(out).toContain('GIT_TERMINAL_PROMPT=0')
    })

    it('does not screen a token by its prefix, and needs no list of them', () => {
      // Deliberate: `patToken.ts` refuses to screen a credential by what it looks
      // like on the way IN, because GitHub has changed its prefixes more than once.
      // The same refusal on the way out means a bare token with no container around
      // it is NOT redacted — and that is the honest behaviour to pin, so nobody
      // later reads a passing prefix test as coverage this does not have.
      //
      // Nothing puts a bare token into an error message: git echoes remotes and the
      // client sets headers, which are the two containers above.
      expect(scrubText(`something went wrong: ${TOKEN}`)).toContain(TOKEN)
    })
  })

  describe('paths', () => {
    it('collapses a deep Windows path to its basename, dropping the account name with it', () => {
      const out = scrubText('ENOENT: E:\\Dark Ages Dev\\Repos\\balor\\src\\index.ts')
      expect(out).toBe('ENOENT: …\\index.ts')
    })

    it('collapses a deep POSIX path, including one under a home directory', () => {
      expect(scrubText('at /home/sabrael/src/midir/index.ts:12')).toContain('…/index.ts:12')
      expect(scrubText('at /home/sabrael/src/midir/index.ts:12')).not.toContain('sabrael')
    })

    it('redacts the account name in a short user path the collapse cannot reach', () => {
      // Two components — nothing to collapse, so the name is redacted in place and
      // the recognisable prefix stays.
      expect(scrubText('cwd C:\\Users\\alice')).toBe('cwd C:\\Users\\<user>')
      expect(scrubText('cwd /home/alice')).toBe('cwd /home/<user>')
      expect(scrubText('cwd /Users/alice')).toBe('cwd /Users/<user>')
    })

    it('redacts an explicit home directory that lives nowhere near /home', () => {
      // The case the shape rules cannot see: a portable install on another volume.
      const out = scrubText('config at /opt/data/me/.balor', { homeDir: '/opt/data/me' })
      expect(out).not.toContain('/opt/data/me')
    })

    it('leaves a URL alone', () => {
      // The POSIX lookbehind exists for this. A collapsed URL would turn "the API
      // rejected /user/repos" into "…/repos", which names nothing.
      const out = scrubText('GET https://api.github.com/user/repos returned 403')
      expect(out).toContain('https://api.github.com/user/repos')
    })

    it('leaves a relative path alone', () => {
      // A repository-relative path is the most useful thing a stack can carry and
      // identifies nobody.
      expect(scrubText('at src/main/git/sync.ts:41')).toBe('at src/main/git/sync.ts:41')
    })
  })

  describe('identity', () => {
    it('redacts an e-mail address and an IPv4 address', () => {
      const out = scrubText('author sabrael@example.com from 192.168.1.44')
      expect(out).toBe('author <email> from <ip>')
    })

    it('redacts a bare username elsewhere in the text', () => {
      expect(scrubText('user sabrael is not a member', { userName: 'sabrael' })).toBe(
        'user <user> is not a member'
      )
    })

    it('leaves a username of fewer than three characters alone', () => {
      // A two-character name matched as a word would still be wrong often enough to
      // matter — and an over-scrubbed report is unreadable, which is its own failure.
      expect(scrubText('al so it failed', { userName: 'al' })).toBe('al so it failed')
    })

    it('does not match a username inside a longer word', () => {
      expect(scrubText('deserialisation failed for ann', { userName: 'ann' })).toBe(
        'deserialisation failed for <user>'
      )
      expect(scrubText('announcement failed', { userName: 'ann' })).toBe('announcement failed')
    })
  })

  it('leaves ordinary error text completely alone', () => {
    // The whole point. If this ever fails, the scrubber has started eating the thing
    // it exists to preserve.
    const clean = 'TypeError: Cannot read properties of undefined (reading "branch")'
    expect(scrubText(clean, { homeDir: '/home/sabrael', userName: 'sabrael' })).toBe(clean)
  })

  it('is idempotent, because it runs twice on the diagnostics block', () => {
    // `captureError` scrubs at capture and `buildDiagnostics` scrubs the assembled
    // block. A second pass must not redact its own placeholders — `<user>` becoming
    // `<<user>>` on every open would be a slow corruption nobody would notice.
    const once = scrubText('at /home/sabrael/src/midir/x.ts, mail sabrael@example.com', {
      homeDir: '/home/sabrael',
      userName: 'sabrael'
    })
    expect(scrubText(once, { homeDir: '/home/sabrael', userName: 'sabrael' })).toBe(once)
  })
})
