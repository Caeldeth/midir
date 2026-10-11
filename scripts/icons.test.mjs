import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
// electron-builder's own YAML parser — a dependency of app-builder-lib, so it is
// present whenever electron-builder is, and it reads the file the way a
// packaging run will.
import { load as parseYaml } from 'js-yaml'

// The Windows master is COMMITTED, and electron-builder reads it from the tree.
// This reads its PNG header directly rather than shelling out, so it needs no
// ImageMagick and runs in the ordinary suite. It checks the two properties a
// header can carry: geometry and colour type.
//
// Midir builds for Windows only (see electron-builder.yml), so the template's
// macOS tile, its Linux hicolor set, and their generator are not here. The last
// block pins that, because every port from the template brings them back.
//
// Ported from balor's `scripts/icons.test.mjs`, plus mabon's schema-key check at
// the bottom (via corvath). R-008 / HTOO-38.
const REPO_ROOT = join(import.meta.dirname, '..')
const BUILD = join(REPO_ROOT, 'build')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// PNG colour type 6 is truecolour WITH alpha. Type 2 is truecolour without, and
// that is the failure this catches: a master flattened onto black renders the
// rounded corners as a solid rectangle at every size.
const RGBA = 6

function readHeader(path) {
  const buf = readFileSync(path)
  expect(buf.subarray(0, 8), `${path} is not a PNG`).toEqual(PNG_SIGNATURE)
  expect(buf.subarray(12, 16).toString('ascii'), `${path} first chunk`).toBe('IHDR')
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25)
  }
}

const builderYml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))

describe('committed icon artifacts', () => {
  it('build/icon.png is the 1024 RGBA Windows master', () => {
    // Nothing generates it, so this only pins that it has not been replaced by
    // something opaque — the three runtime logo assets and the portable splash
    // are cut from it, and an opaque master lands the logo on a visible box.
    expect(readHeader(join(BUILD, 'icon.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
  })
})

describe('electron-builder.yml wiring', () => {
  it('parses as YAML at all', () => {
    // Found the hard way while writing the comments in this file: a comment line
    // that lost its `#` broke the whole document, `npm run validate` stayed
    // green, and the first thing to open the file was `electron-builder --dir`.
    // `npm run build` is electron-vite and never reads this file, so nothing in
    // the ordinary gate does — except this.
    expect(() => parseYaml(builderYml)).not.toThrow()
    expect(parseYaml(builderYml)).toMatchObject({ appId: expect.any(String) })
  })
})

describe('the platform blocks', () => {
  it('builds for Windows only', () => {
    // Midir reads the Dark Ages client's traffic and drives its window, and the
    // client runs on Windows only. A macOS or Linux block would package an app
    // with nothing to read, and release.yml would pay a macOS runner for it.
    const config = parseYaml(builderYml)
    for (const block of ['mac', 'dmg', 'mas', 'linux', 'appImage', 'deb', 'snap', 'rpm']) {
      expect(config, `electron-builder.yml has a ${block} block`).not.toHaveProperty(block)
    }
    expect(config.win.target.map((t) => t.target)).toEqual(['nsis', 'portable'])
    for (const script of Object.keys(pkg.scripts)) {
      expect(script, 'a package script builds for another platform').not.toMatch(
        /^build:(mac|linux)/
      )
    }
  })

  it('every platform block uses only keys electron-builder declares', () => {
    // Mabon's finding: a key that electron-builder does not declare is not
    // ignored. It rejects the whole block with "configuration.<block> should be
    // one of these: null", a message that never names the bad key. And
    // `npm run build` is electron-vite, which never reads electron-builder.yml,
    // so typecheck, lint, the whole suite and the build all stay green on a
    // configuration that cannot package at all.
    //
    // Checked against electron-builder's own shipped schema rather than a list
    // maintained here, so it stays true across upgrades.
    const scheme = JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules/app-builder-lib/scheme.json'), 'utf8')
    ).definitions

    const BLOCKS = {
      win: 'WindowsConfiguration',
      nsis: 'NsisOptions',
      portable: 'PortableOptions'
    }

    for (const [block, definition] of Object.entries(BLOCKS)) {
      const allowed = Object.keys(scheme[definition]?.properties ?? {})
      expect(allowed.length, `${definition} has no properties in the schema`).toBeGreaterThan(0)

      for (const key of childKeys(block)) {
        expect(allowed, `${block}.${key} is not a key electron-builder declares`).toContain(key)
      }
    }
  })
})

/**
 * Immediate children of a top-level block in electron-builder.yml.
 *
 * Raw text rather than a parser: there is no YAML dependency in this repository,
 * this is a file it owns, and the job is to catch a human edit. Comments and
 * list items are skipped; only `  key:` at exactly two spaces counts.
 */
function childKeys(block) {
  const lines = builderYml.split('\n')
  const start = lines.findIndex((l) => l === `${block}:`)
  if (start === -1) return []
  const keys = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break // next top-level key ends the block
    const match = /^ {2}([A-Za-z][\w-]*):/.exec(line)
    if (match) keys.push(match[1])
  }
  return keys
}
