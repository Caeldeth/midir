// Import DA Walker's WorldMap.dat into route/worldmap.json.
//
// Run once at import time, not at runtime. The walker reads the JSON, never the
// .dat. Re-run this only to refresh the graph from a newer WorldMap.dat.
//
//   node scripts/import-worldmap.mjs "E:/Games/Dark Ages/Walker/WorldMap.dat"
//
// WorldMap.dat is a hand-made text file, and it is messier than one clean rule.
// A block is one map node, blocks are split by a blank line, and a block is:
//
//   <mapId> <arrivalX> <arrivalY> [Name]   the header; a leading -1 is a flag
//   <destMap>                     an exit's destination map (1 or 3 ints)
//   <x> <y> [<x> <y> ...]         the warp tile(s) that reach that destination
//   ... more exits ...
//
// The header's two coordinate fields are the map's default arrival tile. They
// are `-1 -1` when unset (the common case) and real coordinates otherwise
// (`502 70 78 Abel`). We drop them: A* finds the tile inside the destination map.
//
// Two record variants break the "dest then x y" rule and are handled below:
//   - A caravan exit gives 3 ints: destMap and its arrival coords. We keep the
//     destMap and drop the arrival coords; A* finds the tile inside the map.
//   - A few exit lines carry extra junk ints (flags, -1s). We keep the first int
//     as the destMap and drop the rest.
//
// The importer is tolerant: it logs and skips a line it cannot classify, and it
// prints a coverage report so a human can see exactly what made it in.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DEFAULT_SOURCE = 'E:/Games/Dark Ages/Walker/WorldMap.dat'
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'main',
  'route',
  'worldmap.json'
)

/** The largest a real map tile coordinate is. Retail maps stay well under this. */
const MAX_TILE = 300

/**
 * Parse a block header: `[flag] mapId arrivalX arrivalY [name]`.
 *
 * A leading `-1` is a flag we drop. The mapId follows. Two arrival-coordinate
 * tokens follow the mapId when they are present (they always are in this file),
 * and the rest of the line is the name. Names start with a letter, so consuming
 * up to two integer tokens as arrival coordinates never eats a name.
 *
 * Returns `{ mapId, name }` or null when the first token is not a map id.
 */
function parseHeader(line) {
  const tokens = line.trim().split(/\s+/)
  let i = 0
  // Drop a leading -1 flag when a real map id follows it.
  if (tokens[i] === '-1' && /^\d+$/.test(tokens[i + 1] ?? '')) i++
  if (!/^\d+$/.test(tokens[i] ?? '')) return null
  const mapId = Number(tokens[i])
  i++
  // Consume up to two arrival-coordinate integers, then take the rest as name.
  let consumed = 0
  while (consumed < 2 && /^-?\d+$/.test(tokens[i] ?? '')) {
    i++
    consumed++
  }
  return { mapId, name: tokens.slice(i).join(' ').trim() }
}

/** All whitespace-separated integers on a line, or null when a token is not an int. */
function ints(line) {
  const tokens = line.trim().split(/\s+/)
  const out = []
  for (const token of tokens) {
    if (!/^-?\d+$/.test(token)) return null
    out.push(Number(token))
  }
  return out
}

/**
 * Is this line a list of warp tiles, or a new exit's destination line?
 *
 * A tile line is an even count of ints and every int is a plausible coordinate.
 * Anything else starts a new exit, whose destination is the first int. This
 * splits `9 19 10 19` (two tiles) from `100` (a destination) and from
 * `6997 264 386` (a caravan destination with arrival coords we drop).
 */
function looksLikeTiles(values) {
  if (values.length === 0 || values.length % 2 !== 0) return false
  return values.every((v) => v >= 0 && v <= MAX_TILE)
}

async function main() {
  const source = process.argv[2] ?? DEFAULT_SOURCE
  const text = await readFile(source, 'latin1')
  const blocks = text.split(/\r?\n\r?\n/)

  /** mapId -> { mapId, name, exits: Map<`${to}:${x}:${y}`, {toMapId,x,y}> } */
  const nodes = new Map()
  const skipped = []
  let namedCount = 0

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length === 0) continue

    const header = parseHeader(lines[0])
    if (header === null) {
      skipped.push(`header: ${lines[0]}`)
      continue
    }
    const { mapId, name } = header

    const node = nodes.get(mapId) ?? { mapId, name: '', exits: new Map() }
    if (name !== '' && node.name === '') {
      node.name = name
      namedCount++
    }
    nodes.set(mapId, node)

    // Walk the exit lines. A destination line sets the current destination; the
    // tile lines that follow attach to it.
    let currentDest = null
    for (let i = 1; i < lines.length; i++) {
      const values = ints(lines[i])
      if (values === null) {
        skipped.push(`${mapId}: ${lines[i]}`)
        continue
      }
      if (looksLikeTiles(values) && currentDest !== null) {
        for (let j = 0; j < values.length; j += 2) {
          const x = values[j]
          const y = values[j + 1]
          // A destination map of -1 is a sentinel, not a real edge.
          if (currentDest < 0) continue
          node.exits.set(`${currentDest}:${x}:${y}`, { toMapId: currentDest, x, y })
        }
      } else {
        currentDest = values[0]
      }
    }
  }

  const out = [...nodes.values()]
    .sort((a, b) => a.mapId - b.mapId)
    .map((n) => ({
      mapId: n.mapId,
      name: n.name,
      exits: [...n.exits.values()].sort((a, b) => a.toMapId - b.toMapId || a.x - b.x || a.y - b.y)
    }))

  const edgeCount = out.reduce((sum, n) => sum + n.exits.length, 0)

  await writeFile(
    OUT,
    JSON.stringify(
      {
        source: 'DA Walker WorldMap.dat',
        note: 'Imported by scripts/import-worldmap.mjs. Do not hand-edit; re-run the script.',
        nodes: out
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  // The coverage report. A human reads this to trust the import.
  console.log(`Read ${blocks.length} blocks from ${source}`)
  console.log(`Wrote ${out.length} nodes (${namedCount} named), ${edgeCount} exits to ${OUT}`)
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} line(s) that did not parse:`)
    for (const s of skipped.slice(0, 40)) console.log(`  ${s}`)
    if (skipped.length > 40) console.log(`  ... and ${skipped.length - 40} more`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
