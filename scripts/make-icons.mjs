#!/usr/bin/env node
// Generate every derived icon artifact from ONE committed master.
//
//   build/icon-square.png  (committed, 1024x1024, full-bleed, real alpha)
//        |
//        +--> build/icon-mac.png    824x824 centred on 1024x1024  (macOS)
//        +--> build/icons/NxN.png   8 sizes, full-bleed           (Linux)
//
// WHY THIS EXISTS — electron-builder never resamples a single PNG. From
// app-builder-lib's iconConverter, a .png source returns as-is:
//
//   const { width, height } = await getPngSize(resolved)
//   return [{ file: resolved, size: Math.max(width, height) }]
//
// One PNG in, ONE hicolor entry out, at whatever size that file happens to be.
// hicolor's index.theme enumerates sizes up to 512, so a 1024x1024 master lands
// in a directory the desktop environment never indexes and the app shows the
// generic blank-document icon. Nine of ten house apps shipped that (HTOO-38),
// and every one of them inherited it from this template.
//
// The related trap: electron-builder resolves the Linux icon as
// [linux.icon, mac.icon ?? icon]. `mac.icon` OUTRANKS the top-level `icon`, so
// an app that gives macOS its own artwork and leaves `linux.icon` unset ships
// the macOS artwork on Linux. The template HAS a mac.icon, so that precedence
// is live rather than hypothetical, and `linux.icon: build/icons` must stay
// explicit — buildResources/icons is only a fallback, used when the primary
// source list is empty, which mac.icon guarantees it never is.
//
// ── Two masters, and why the template ships the same picture in both ──
//
// `build/icon.png` is the WINDOWS master: the app's claimed Hyb colour variant,
// which the NSIS portable splash and the three runtime logo assets are also cut
// from, so they all agree. `build/icon-square.png` is the macOS + Linux master:
// a desktop environment wants a square tile, so a real app puts its `_fixed`
// tile from the document repo's `docs/logos/macros/` here. In the template both
// are the same placeholder emblem — there is no square tile for a skeleton — and
// a fork replaces BOTH. Balor (`scripts/make-icons.mjs`) is where this shape
// came from; it keeps its wreath on Windows and the tile elsewhere.
//
// One generator and one master, rather than oghma's two hand-run steps: the
// master is full-bleed with true alpha, so Apple's inset is something to ADD for
// macOS rather than something to undo for Linux. There is no crop, and so no
// `-gravity` trap for a later crop to re-anchor, and no `magick` recipe living
// in a YAML comment.
//
// Both outputs are COMMITTED, exactly as other repos commit build/icon.icns, so
// CI never needs ImageMagick. build/ is directories.buildResources and is never
// packaged, so none of this reaches the app at run time. `scripts/icons.test.mjs`
// reads the committed PNG headers so a stale set fails the ordinary suite.
//
// Requires ImageMagick 7 (`magick`). Regenerate after an artwork change:
//   node scripts/make-icons.mjs

import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(repoRoot, 'build', 'icon-square.png')
const MAC_OUT = join(repoRoot, 'build', 'icon-mac.png')
const OUT_DIR = join(repoRoot, 'build', 'icons')

// The master must be exactly this, full-bleed. Asserted, not assumed.
const MASTER_SIZE = 1024
const MASTER_BBOX = `${MASTER_SIZE}x${MASTER_SIZE}+0+0`

// Apple's grid: 824x824 of artwork centred in a 1024x1024 canvas, i.e. a 100px
// margin. Without it macOS draws the icon about 12% larger than every system
// icon beside it.
const MAC_ART = 824
const MAC_INSET = (MASTER_SIZE - MAC_ART) / 2
const MAC_BBOX = `${MAC_ART}x${MAC_ART}+${MAC_INSET}+${MAC_INSET}`

// The hicolor sizes electron-builder's collectIconsFromDir will pick up. It
// matches /^(\d+)(?:x\d+)?\.png$/i, so `512x512.png` and `512.png` both work;
// the explicit form is used here because it reads as the hicolor path it becomes.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

// -strip ALONE IS NOT DETERMINISTIC: it leaves a tIME chunk holding the wall
// clock, so re-running rewrites every file with identical pixels and different
// bytes. These are committed artifacts, so identical input must give
// byte-identical output or every regeneration reads as a change.
const DETERMINISTIC = [
  '-strip',
  '-define',
  'png:exclude-chunks=date,time',
  '-define',
  'png:compression-level=9'
]

function magick(args) {
  return execFileSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

// ── Guard the master ────────────────────────────────────────────────────────
//
// Both checks measure the EXTRACTED ALPHA CHANNEL, and neither uses the two
// things that look like they would do the job. Measured 2026-08-06 against a
// deliberately flattened tile, because the obvious versions both passed it:
//
//   - `%[channels]` reports `srgba` for a FULLY OPAQUE PNG32. The channel is
//     present; the transparency is not. So a source someone "repaired" by
//     flattening onto black and re-saving sails through a channel-list check —
//     the exact input the check exists to reject.
//   - `%@` on the image is a TRIM bounding box, not an alpha bounding box. It
//     trims on uniform border colour, so a flattened tile's black corners
//     trimmed to the same answer the real tile gives.
//
// Both returned the right answer for the wrong reason, on the same input, and
// agreed with each other while doing it. `-alpha extract` separates them: the
// real master reports minima 0 across 214 levels, a flattened one minima 1
// across exactly 1.
const alphaLevels = magick([SOURCE, '-alpha', 'extract', '-format', '%k', 'info:'])
const alphaMin = magick([SOURCE, '-alpha', 'extract', '-format', '%[fx:minima]', 'info:'])
if (alphaLevels === '1' || alphaMin !== '0') {
  fail(
    `build/icon-square.png has a constant or opaque alpha channel ` +
      `(levels=${alphaLevels}, minima=${alphaMin}).\n` +
      'Its rounded corners would render as a solid rectangle at every size.\n' +
      'Do NOT rescue it with `-transparent black`: that keys out artwork as well as\n' +
      'background and leaves an antialiased fringe. Use the _fixed source variant.'
  )
}

const masterGeometry = magick(['identify', '-format', '%wx%h', SOURCE])
if (masterGeometry !== `${MASTER_SIZE}x${MASTER_SIZE}`) {
  fail(
    `build/icon-square.png is ${masterGeometry}, expected ${MASTER_SIZE}x${MASTER_SIZE}.\n` +
      "The mac inset is computed from that size and would land off Apple's grid."
  )
}

const masterBbox = magick([SOURCE, '-alpha', 'extract', '-format', '%@', 'info:'])
if (masterBbox !== MASTER_BBOX) {
  fail(
    `build/icon-square.png has alpha bounding box ${masterBbox}, expected ${MASTER_BBOX}.\n` +
      'The master must be FULL-BLEED — an already-inset source would be inset twice for\n' +
      'macOS and would draw small at every Linux size, which passes a size check.'
  )
}

// ── macOS: add Apple's inset ────────────────────────────────────────────────
magick([
  SOURCE,
  '-resize',
  `${MAC_ART}x${MAC_ART}`,
  '-background',
  'none',
  '-gravity',
  'center',
  '-extent',
  `${MASTER_SIZE}x${MASTER_SIZE}`,
  ...DETERMINISTIC,
  `PNG32:${MAC_OUT}`
])
console.log(`  icon-mac.png  ${String(readFileSync(MAC_OUT).length).padStart(6)} bytes`)

// ── Linux: straight down, no crop ───────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const out = join(OUT_DIR, `${size}x${size}.png`)
  magick([SOURCE, '-resize', `${size}x${size}`, ...DETERMINISTIC, `PNG32:${out}`])
  console.log(`  ${size}x${size}.png  ${String(readFileSync(out).length).padStart(6)} bytes`)
}

// ── Verify what was written, rather than trusting the arguments ─────────────
//
// The invariant HTOO-38 is about is that every Linux size is FULL-BLEED. An
// inset source passes a size check and draws ~12% small, so the size check alone
// is the one that let the original defect ship. Assert the property directly.
const macBbox = magick([MAC_OUT, '-alpha', 'extract', '-format', '%@', 'info:'])
if (macBbox !== MAC_BBOX) fail(`icon-mac.png bbox ${macBbox}, expected ${MAC_BBOX}`)

for (const size of SIZES) {
  const out = join(OUT_DIR, `${size}x${size}.png`)
  const bbox = magick([out, '-alpha', 'extract', '-format', '%@', 'info:'])
  if (bbox !== `${size}x${size}+0+0`) {
    fail(`build/icons/${size}x${size}.png bbox ${bbox}, expected ${size}x${size}+0+0 (full-bleed)`)
  }
}

console.log(
  `\nVerified: icon-mac.png inset ${MAC_BBOX}, all ${SIZES.length} Linux sizes full-bleed.`
)
