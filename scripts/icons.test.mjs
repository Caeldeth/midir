import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
// electron-builder's own YAML parser — a dependency of app-builder-lib, so it is
// present whenever electron-builder is, and it reads the file the way a
// packaging run will.
import { load as parseYaml } from 'js-yaml'

// The icon artifacts are GENERATED but COMMITTED — CI has no ImageMagick, so
// electron-builder reads what is in the tree. That makes them exactly the kind
// of thing that goes stale silently: change the master, forget
// `node scripts/make-icons.mjs`, and the build is green while the package ships
// the previous artwork at the previous sizes.
//
// This reads PNG headers directly rather than shelling out, so it needs no
// ImageMagick and runs in the ordinary suite. It therefore checks the two
// properties a header can carry — geometry and colour type — and NOT the alpha
// bounding box, which needs pixel decoding. `make-icons.mjs` asserts the
// bounding boxes itself, at the moment it writes them, which is the right place
// for the check that needs the decoder.
//
// Ported from balor's `scripts/icons.test.mjs`, plus mabon's schema-key check at
// the bottom (via corvath). R-008 / HTOO-38 / HTOO-63.
const REPO_ROOT = join(import.meta.dirname, '..')
const BUILD = join(REPO_ROOT, 'build')

/** hicolor's standard set, and the same list `make-icons.mjs` writes. */
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// PNG colour type 6 is truecolour WITH alpha. Type 2 is truecolour without, and
// that is the failure this catches: a master flattened onto black renders the
// rounded corners as a solid rectangle at every size — and still reports
// `srgba` to `magick identify -format "%[channels]"`, which is why the
// generator measures the extracted alpha channel instead.
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
  it('build/icon-square.png is the 1024 RGBA macOS/Linux master', () => {
    // Everything under build/icons/ and icon-mac.png is derived from this one
    // file. The generator additionally asserts it is full-bleed before reading.
    expect(readHeader(join(BUILD, 'icon-square.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
  })

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

  it('build/icon-mac.png is 1024 RGBA', () => {
    // Its 824-in-1024 inset is asserted by make-icons.mjs, which can decode.
    expect(readHeader(join(BUILD, 'icon-mac.png'))).toEqual({
      width: 1024,
      height: 1024,
      colorType: RGBA
    })
  })

  it('build/icons/ holds exactly the eight hicolor sizes and nothing else', () => {
    // "Nothing else" is load-bearing: electron-builder's collectIconsFromDir
    // matches /^(\d+)(?:x\d+)?\.png$/i over the whole directory, so a stray
    // `1024x1024.png` left behind by a regeneration would be collected and
    // installed into a hicolor directory the desktop environment never indexes.
    const found = readdirSync(join(BUILD, 'icons')).sort()
    expect(found).toEqual(SIZES.map((s) => `${s}x${s}.png`).sort())
  })

  it.each(SIZES)('build/icons/%ix%i.png is square, RGBA, and its named size', (size) => {
    // The filename becomes the hicolor path, so a file whose name and contents
    // disagree installs correct-looking artwork at the wrong resolution.
    expect(readHeader(join(BUILD, 'icons', `${size}x${size}.png`))).toEqual({
      width: size,
      height: size,
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

  it('linux.icon points at the directory, not a single file', () => {
    // The whole defect in one line. A single PNG is never resampled, so any
    // value here ending in .png yields exactly one hicolor entry at that file's
    // own size — which for a 1024 master is a size no desktop indexes. And it
    // must be EXPLICIT: with `mac.icon` set, deleting this line falls to the
    // macOS artwork, not back to a default.
    expect(childKeys('linux')).toContain('icon')
    expect(builderYml).toMatch(/^ {2}icon: build\/icons$/m)
  })

  it('mac.icon is the inset tile, never the master', () => {
    expect(builderYml).toMatch(/^ {2}icon: build\/icon-mac\.png$/m)
  })
})

describe('the desktop entry half of R-008 (HTOO-63)', () => {
  // A correct hicolor set is only half of it. Oghma shipped the right sizes and
  // still drew a generic taskbar icon, because nothing tied the running window
  // to the installed .desktop entry.
  it('desktopName is in package.json, where the schema expects it', () => {
    // LOWERCASE, matching `win.executableName` and what LinuxPackager derives:
    // `executableName` is `sanitizedName.toLowerCase()`, and StartupWMClass is
    // written from `desktopName` minus the suffix. A capitalised name would
    // match `productName`, look tidier beside it, and break the association.
    // Pinned to the executable name rather than to a literal, so the rename
    // checklist's find/replace keeps the two in step.
    expect(pkg.desktopName).toBe(`${executableName()}.desktop`)
    expect(pkg.desktopName).toBe(pkg.desktopName.toLowerCase())
  })

  it('linux.syncDesktopName is on', () => {
    expect(builderYml).toMatch(/^ {2}syncDesktopName: true$/m)
  })

  it('the pair exists for a reason: productName differs from the executable name', () => {
    // Pins WHY the pair is set. Without it electron-builder writes
    // `StartupWMClass=<productName>` while Electron reports the lowercase
    // executable, and the association fails on a case difference alone. If the
    // two are ever made identical this says so, rather than silently guarding
    // nothing.
    expect(pkg.productName).not.toBe(executableName())
  })

  it('every platform block uses only keys electron-builder declares', () => {
    // Mabon's finding, and the general form of the trap above: there is no
    // `linux.desktopName` key. Putting it there is NOT silently ignored — it
    // rejects the entire linux block with "configuration.linux should be one of
    // these: null", a message that never names the offending key. And
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
      mac: 'MacConfiguration',
      linux: 'LinuxConfiguration',
      nsis: 'NsisOptions',
      portable: 'PortableOptions',
      dmg: 'DmgOptions',
      appImage: 'AppImageOptions',
      deb: 'DebOptions'
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

/** `win.executableName` from electron-builder.yml, which is what the Linux
 *  packager also lowercases its own executable to. */
function executableName() {
  const name = /^ {2}executableName: (\S+)$/m.exec(builderYml)?.[1]
  expect(name, 'win.executableName not found').toBeTruthy()
  return name
}

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
