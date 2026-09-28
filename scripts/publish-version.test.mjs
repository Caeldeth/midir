// house module: update-check v1 — change it in the template, then port
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isNewer, parseTag, publish, readUpdateKey, updateManifest } from './publish-version.mjs'
import { isNewerVersion } from '../src/shared/updateVersion'

const SEED = {
  schema: 1,
  apps: {
    alpha: { version: '1.0.0', released: '2026-01-01T00:00:00Z', url: 'https://x/alpha' },
    zeta: { version: '3.0.0', released: '2026-01-01T00:00:00Z', url: 'https://x/zeta' }
  }
}
const seedText = JSON.stringify(SEED, null, 2) + '\n'
const ENTRY = { version: '1.7.0', released: '2026-09-28T00:00:00Z', url: 'https://x/mine' }

describe('parseTag', () => {
  it('accepts vX.Y.Z only', () => {
    expect(parseTag('v1.7.0')).toBe('1.7.0')
    for (const bad of ['1.7.0', 'v1.7', 'v1.7.0-beta.1', undefined])
      expect(parseTag(bad)).toBeNull()
  })
})

describe('isNewer', () => {
  it('agrees with the app-side rule in src/shared/updateVersion.ts', () => {
    // Two copies of one rule, in two languages. This pins them together.
    const cases = [
      ['1.6.0', '1.7.0'],
      ['2.9.0', '2.10.0'],
      ['1.7.0', '1.7.0'],
      ['1.7.0', '1.6.9'],
      ['1.x.0', '9.9.9']
    ]
    for (const [a, b] of cases) expect(isNewer(a, b)).toBe(isNewerVersion(a, b))
  })
})

describe('readUpdateKey', () => {
  it('reads the key from appIdentity source', () => {
    expect(readUpdateKey("  updateKey: 'oghma',\n")).toBe('oghma')
  })

  // The ONE line of the ported module that is not portable: it asserts the
  // adopting app's own key, so every copy has to change it. The template says
  // 'template' here. Worth fixing in the template so the next app's port is a
  // plain copy (noted on HTOO-382).
  it('reads the real appIdentity of this app', () => {
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'shared', 'appIdentity.ts'),
      'utf8'
    )
    expect(readUpdateKey(src)).toBe('midir')
  })

  it('fails without one', () => {
    expect(() => readUpdateKey('export const x = 1')).toThrow(/no updateKey/)
  })
})

describe('updateManifest', () => {
  it('adds a new key in sorted order and keeps every other key as read', () => {
    const out = updateManifest(seedText, 'mid', ENTRY)
    const data = JSON.parse(out)
    expect(Object.keys(data.apps)).toEqual(['alpha', 'mid', 'zeta'])
    expect(data.apps.alpha).toEqual(SEED.apps.alpha)
    expect(data.apps.zeta).toEqual(SEED.apps.zeta)
    expect(out.endsWith('}\n')).toBe(true)
  })

  it('changes only one app’s lines', () => {
    const before = updateManifest(seedText, 'mid', ENTRY).split('\n')
    const after = updateManifest(before.join('\n'), 'mid', { ...ENTRY, version: '1.8.0' }).split(
      '\n'
    )
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['      "version": "1.8.0",'])
  })

  it('never goes backwards, and refuses the same version twice', () => {
    expect(() => updateManifest(seedText, 'zeta', { ...ENTRY, version: '2.9.9' })).toThrow(
      /not newer/
    )
    expect(() => updateManifest(seedText, 'zeta', { ...ENTRY, version: '3.0.0' })).toThrow(
      /not newer/
    )
  })

  it('refuses a file that is not schema 1', () => {
    expect(() => updateManifest('{"schema":2,"apps":{}}', 'x', ENTRY)).toThrow(/schema 1/)
  })
})

// The git path, end to end, against temporary repos: a bare "origin" that
// stands in for cernunnos on GitHub, a clone that stands in for ../cernunnos,
// and a fake app repo. Only `gh` is faked.
describe('publish', () => {
  let root
  let origin
  let clone
  let other
  let app

  const g = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const configure = (cwd) => {
    g(cwd, 'config', 'user.name', 'Test')
    g(cwd, 'config', 'user.email', 'test@example.invalid')
    g(cwd, 'config', 'core.hooksPath', '.git/hooks')
    g(cwd, 'config', 'core.autocrlf', 'false')
  }
  const release = (tag) => ({
    tagName: tag,
    url: `https://github.com/x/app/releases/tag/${tag}`,
    publishedAt: '2026-09-28T12:00:00Z',
    isDraft: false,
    isPrerelease: false
  })
  const originFile = () => g(origin, 'show', 'main:versions.json')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'publish-version-'))
    origin = join(root, 'origin.git')
    clone = join(root, 'cernunnos')
    other = join(root, 'other')
    app = join(root, 'app')
    g(root, 'init', '--quiet', '--bare', '-b', 'main', origin)
    g(root, 'clone', '--quiet', origin, clone)
    configure(clone)
    writeFileSync(join(clone, 'versions.json'), seedText)
    g(clone, 'add', 'versions.json')
    g(clone, 'commit', '--quiet', '-m', 'seed')
    g(clone, 'push', '--quiet', '-u', 'origin', 'main')
    g(root, 'clone', '--quiet', origin, other)
    configure(other)
    mkdirSync(join(app, 'src', 'shared'), { recursive: true })
    writeFileSync(join(app, 'package.json'), JSON.stringify({ version: '1.7.0' }))
    writeFileSync(
      join(app, 'src', 'shared', 'appIdentity.ts'),
      "export const a = { updateKey: 'mid' }\n"
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  const run = (extra = {}) =>
    publish({ tag: 'v1.7.0', repoRoot: app, cernunnos: clone, release, log: () => {}, ...extra })

  it('commits and pushes this app’s entry only', () => {
    expect(run()).toEqual({ key: 'mid', version: '1.7.0', pushed: true })
    const data = JSON.parse(originFile())
    expect(data.apps.mid).toEqual({
      version: '1.7.0',
      released: '2026-09-28T12:00:00Z',
      url: 'https://github.com/x/app/releases/tag/v1.7.0'
    })
    expect(data.apps.alpha).toEqual(SEED.apps.alpha)
    expect(g(origin, 'log', '-1', '--format=%s', 'main')).toBe('versions: mid 1.7.0')
  })

  it('a dry run changes nothing', () => {
    expect(run({ dryRun: true }).pushed).toBe(false)
    expect(originFile()).toBe(seedText.trim())
    expect(g(clone, 'status', '--porcelain')).toBe('')
  })

  it('recovers when another release pushed between our commit and our push', () => {
    // A post-commit hook in our clone makes the other clone push first: the
    // exact window a second developer's release would hit.
    const hook = join(clone, '.git', 'hooks', 'post-commit')
    const theirs =
      JSON.stringify(
        { ...SEED, apps: { ...SEED.apps, alpha: { ...SEED.apps.alpha, version: '1.1.0' } } },
        null,
        2
      ) + '\n'
    writeFileSync(join(root, 'theirs.json'), theirs)
    writeFileSync(
      hook,
      `#!/bin/sh\ncp "${join(root, 'theirs.json').replace(/\\/g, '/')}" "${join(other, 'versions.json').replace(/\\/g, '/')}"\ngit -C "${other.replace(/\\/g, '/')}" commit --quiet -am "versions: alpha 1.1.0"\ngit -C "${other.replace(/\\/g, '/')}" push --quiet\nrm "$0"\n`
    )
    chmodSync(hook, 0o755)
    expect(run().pushed).toBe(true)
    const data = JSON.parse(originFile())
    expect(data.apps.alpha.version).toBe('1.1.0')
    expect(data.apps.mid.version).toBe('1.7.0')
  })

  it('refuses a release that is not published as stable', () => {
    expect(() => run({ release: (t) => ({ ...release(t), isDraft: true }) })).toThrow(
      /not published/
    )
    expect(originFile()).toBe(seedText.trim())
  })

  it('refuses a tag that does not match package.json', () => {
    expect(() => run({ tag: 'v1.8.0' })).toThrow(/does not match package.json/)
  })

  it('refuses a dirty cernunnos checkout: that work is someone else’s', () => {
    writeFileSync(join(clone, 'README.md'), 'local edit\n')
    expect(() => run()).toThrow(/uncommitted changes/)
    expect(originFile()).toBe(seedText.trim())
  })

  it('refuses to publish the same version twice', () => {
    run()
    expect(() => run()).toThrow(/not newer/)
  })
})
