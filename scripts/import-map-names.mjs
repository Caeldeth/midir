#!/usr/bin/env node
// Import a map-name list into route/mapnames.json: the seed layer of the
// route graph's names (WP38).
//
//   node scripts/import-map-names.mjs <path to the list> [output]
//
// The list is a plain text file of `<map id> - <name>` lines, one map to a
// line. It is a community scrape of the retail client and it is old, so it is
// the weakest name Midir has: `mergeLearned` applies a name from here only to
// a map that WorldMap.dat, the world XML, and the wire all leave unnamed, and
// the wire's `SMapSize 0x15` name replaces it on the first visit
// (route/graph.ts). The file is never written at run time.
//
// The rows are not clean. The separator is a hyphen or a CP1252 en dash
// (0x96), some rows carry a `*` marker, some pad the name with runs of
// spaces, a name that starts with `null` means the scrape found none, and a
// few ids appear twice. The first row for an id wins and the rest are
// counted.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/main/route/mapnames.json'
)

/** CP1252 bytes the list uses that Latin-1 reads as controls. */
const CP1252 = { '\u0092': '’', '\u0096': '-', '\u0097': '-' }

/**
 * Read one list. Returns the names by map id, and what was dropped.
 */
export function parseNameList(text) {
  const names = {}
  let skipped = 0
  let duplicates = 0
  for (const line of text.split(/\r?\n/)) {
    const row = line.replace(/[\u0092\u0096\u0097]/g, (c) => CP1252[c])
    const match = /^\s*(\d+)\s*[-–—]\s*(.*)$/.exec(row)
    if (match === null) {
      if (row.trim() !== '') skipped += 1
      continue
    }
    const name = match[2]
      .replace(/(^|\s)\*(\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (name === '' || /^null\b/i.test(name)) continue
    const mapId = Number(match[1])
    if (names[mapId] !== undefined) {
      duplicates += 1
      continue
    }
    names[mapId] = name
  }
  return { names, skipped, duplicates }
}

async function main() {
  const source = process.argv[2]
  if (source === undefined) {
    console.error('Usage: node scripts/import-map-names.mjs <path to the list> [output]')
    process.exit(2)
  }
  const output = resolve(process.argv[3] ?? OUTPUT)
  const { names, skipped, duplicates } = parseNameList(await readFile(source, 'latin1'))
  const ordered = Object.fromEntries(
    Object.keys(names)
      .map(Number)
      .sort((a, b) => a - b)
      .map((mapId) => [mapId, names[mapId]])
  )
  await writeFile(
    output,
    JSON.stringify(
      {
        source: 'a map-name list, by scripts/import-map-names.mjs',
        note: 'Provisional: the weakest name Midir has. It names only a map no other source names, and the wire replaces it on the first visit.',
        names: ordered
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `Wrote ${Object.keys(ordered).length} names to ${output} (${duplicates} repeated ids and ${skipped} rows skipped).`
  )
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
