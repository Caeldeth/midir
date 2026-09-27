#!/usr/bin/env node
// Export the music track of each map Midir has read (WP40).
//
//   node scripts/export-map-music.mjs <output file> [--csv] [--maps <maps.json>]
//
// The reading comes from `maps.json`, which the capture service writes as the
// wire names, sizes, and scores each map. `SSoundEffect 0x19` carries a track
// number and no audio: the client plays its own local `.\music\<track>.mus`, so
// what is exported is one number per map, in the range 1 to 64.
//
// Hybrasyl holds the same value as `Music`, an unsignedByte attribute on a map.
// This script writes a file and nothing else. It never writes into the world
// repo, into ceridwen, or into any other repo: what to do with the table is a
// person's decision.
//
// The table is as complete as the walking that filled it. A track arrives only
// when the track changes, so a map whose music matches the map behind it is
// silent, and silence is not a reading.
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the app keeps its store on Windows. */
export function defaultMapsPath(env = process.env, platform = process.platform) {
  const local = platform === 'win32' ? env.LOCALAPPDATA : undefined
  if (local === undefined || local === '') return null
  return join(local, 'Erisco', 'Midir', 'maps.json')
}

/**
 * The rows to export, by map id. A map with no music reading is left out: it
 * has no value to state, and a zero would read as a track.
 */
export function musicRows(file) {
  const rows = []
  for (const [key, entry] of Object.entries(file?.maps ?? {})) {
    if (entry?.music === undefined) continue
    rows.push({
      mapId: Number(key),
      name: entry.name ?? '',
      track: entry.music.track,
      seenAtMs: entry.music.seenAtMs,
      seenAt: new Date(entry.music.seenAtMs).toISOString()
    })
  }
  return rows.sort((a, b) => a.mapId - b.mapId)
}

/** One CSV field. A name with a comma or a quote is quoted, and quotes double. */
export function csvField(value) {
  const text = String(value)
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv(rows) {
  const lines = ['mapId,name,track,seenAt']
  for (const row of rows) {
    lines.push([row.mapId, csvField(row.name), row.track, row.seenAt].join(','))
  }
  return `${lines.join('\n')}\n`
}

async function main(argv) {
  const args = argv.slice(2)
  const csv = args.includes('--csv')
  const mapsAt = args.indexOf('--maps')
  const mapsPath = mapsAt >= 0 ? args[mapsAt + 1] : defaultMapsPath()
  const output = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--maps')

  if (output === undefined) {
    console.error('Give the file to write: node scripts/export-map-music.mjs <output> [--csv]')
    process.exit(2)
  }
  if (mapsPath === undefined || mapsPath === null) {
    console.error('Give the store with --maps <maps.json>. LOCALAPPDATA named none.')
    process.exit(2)
  }

  let file
  try {
    file = JSON.parse(await readFile(mapsPath, 'utf-8'))
  } catch (error) {
    console.error(`Could not read ${mapsPath}: ${error.message}`)
    process.exit(1)
  }

  const rows = musicRows(file)
  const total = Object.keys(file?.maps ?? {}).length
  await writeFile(output, csv ? toCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`, 'utf-8')
  const tracks = new Set(rows.map((row) => row.track)).size
  console.log(
    `Wrote ${rows.length} maps with a music track to ${output} ` +
      `(${tracks} distinct tracks; ${total - rows.length} of ${total} maps read are still silent).`
  )
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
