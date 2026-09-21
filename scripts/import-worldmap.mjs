// Import DA Walker's WorldMap.dat into route/worldmap.json.
//
// Run once at import time, not at runtime. The walker reads the JSON, never the
// .dat. Re-run this only to refresh the graph from a newer WorldMap.dat.
//
//   node scripts/import-worldmap.mjs "E:/Games/Dark Ages/Walker/WorldMap.dat"
//
// WorldMap.dat is a hand-made text file. A block is one map node, blocks are
// split by a blank line, and a block is:
//
//   [-1] <mapId> <width> <height> [Name]   the header
//   <destMap> [gesture ints...]            an exit's destination map
//   <x> <y> [<x> <y> ...]                  the warp tile(s) that reach it
//   ... more exits ...
//
// This is what DA Walker's own loader reads (DAWalkerStart.initilizeMap and
// Mover.startMovement in the decompile), not a guess from the numbers:
//
//   - The header's two ints are the map's width and height. `-1 -1` means
//     "derive the size from the .map file". Midir gets the size off the wire
//     (SMapInfo 0x15), so they are dropped. A leading -1 marks the map for the
//     destination dropdown, and is dropped too.
//   - The ints after a destination map are a gesture DA Walker performs after
//     it walks onto the warp tile, because the step alone does not fire the
//     warp. `x y` is a click at that position of the 640 x 480 client area,
//     and `-1` is a Space key. One click is the world map: the tile opens
//     SFieldMap 0x2E, and the click picks a point on it. A bare -1 is a yes/no
//     prompt. A longer sequence is an NPC conversation (a ship, a caravan).
//   - A destination of -1 is a gesture DA Walker performs on arrival at the
//     final map. It is not an edge and is dropped.
//
// The importer is tolerant: it logs and skips a line it cannot classify, and it
// prints a coverage report so a human can see exactly what made it in.
//
// The .dat is hand-made and is sometimes a tile off. worldmap-overrides.json
// beside this script holds the corrections the wire has proven, each with the
// observation behind it, and the importer applies them after the parse. The
// .dat stays as DA Walker shipped it.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DEFAULT_SOURCE = 'E:/Games/Dark Ages/Walker/WorldMap.dat'
const OVERRIDES = join(dirname(fileURLToPath(import.meta.url)), 'worldmap-overrides.json')
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
 * Parse a block header: `[-1] mapId width height [name]`.
 *
 * A leading `-1` is the dropdown flag. The mapId follows, then up to two size
 * ints, and the rest of the line is the name. Names start with a letter, so
 * consuming up to two integer tokens as the size never eats a name.
 *
 * Returns `{ mapId, name }` or null when the first token is not a map id.
 */
function parseHeader(line) {
  const tokens = line.trim().split(/\s+/)
  let i = 0
  if (tokens[i] === '-1' && /^\d+$/.test(tokens[i + 1] ?? '')) i++
  if (!/^\d+$/.test(tokens[i] ?? '')) return null
  const mapId = Number(tokens[i])
  i++
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
 * `3012 344 250` (a world-map hop: destination, then the click position).
 */
function looksLikeTiles(values) {
  if (values.length === 0 || values.length % 2 !== 0) return false
  return values.every((v) => v >= 0 && v <= MAX_TILE)
}

/**
 * Classify the gesture ints after a destination map into a route hop, or
 * undefined when there are none (the warp fires on the step).
 *
 * See route/graph.ts `RouteHop` for what the walker does with each kind.
 */
function hopOf(gesture) {
  if (gesture.length === 0) return undefined
  if (gesture.length === 2 && gesture[0] >= 0 && gesture[1] >= 0) {
    return { kind: 'fieldMap', screenX: gesture[0], screenY: gesture[1] }
  }
  if (gesture.length === 1 && gesture[0] === -1) return { kind: 'prompt' }
  return { kind: 'dialog' }
}

/**
 * Apply the proven corrections and additions to the parsed nodes, in place.
 *
 * An `exits` override names one exit (from one map to another) and the warp
 * tiles that are true for it. Those tiles replace the .dat's for that exit;
 * the exit's hop, if it had one, is kept. An override for a map or an exit the
 * .dat does not have is reported, not invented.
 *
 * A `nodes` override adds a map the .dat lacks, with its name and its exits,
 * or adds exits to a map the .dat has. A name is set only where the .dat gave
 * none. A node that arrives with no exits is a fact on record (its arrival
 * tile), not a change to the graph.
 */
export function applyOverrides(nodes, overrides) {
  const applied = []
  const unmatched = []
  for (const addition of overrides.nodes ?? []) {
    let node = nodes.find((n) => n.mapId === addition.mapId)
    if (node === undefined) {
      node = { mapId: addition.mapId, name: addition.name ?? '', exits: [] }
      nodes.push(node)
      nodes.sort((a, b) => a.mapId - b.mapId)
      applied.push(`node ${addition.mapId}`)
    } else if (node.name === '' && addition.name) {
      node.name = addition.name
    }
    for (const exit of addition.exits ?? []) {
      for (const [x, y] of exit.tiles) {
        if (node.exits.some((e) => e.toMapId === exit.toMapId && e.x === x && e.y === y)) continue
        node.exits.push({ toMapId: exit.toMapId, x, y })
        applied.push(`${addition.mapId} -> ${exit.toMapId} at ${x},${y}`)
      }
    }
    node.exits.sort((a, b) => a.toMapId - b.toMapId || a.x - b.x || a.y - b.y)
  }
  for (const override of overrides.exits ?? []) {
    const node = nodes.find((n) => n.mapId === override.fromMapId)
    const existing = node?.exits.filter((e) => e.toMapId === override.toMapId) ?? []
    if (node === undefined || existing.length === 0) {
      unmatched.push(`${override.fromMapId} -> ${override.toMapId}`)
      continue
    }
    const via = existing[0].via
    node.exits = node.exits.filter((e) => e.toMapId !== override.toMapId)
    for (const [x, y] of override.tiles) {
      node.exits.push({ toMapId: override.toMapId, x, y, ...(via !== undefined ? { via } : {}) })
    }
    node.exits.sort((a, b) => a.toMapId - b.toMapId || a.x - b.x || a.y - b.y)
    applied.push(`${override.fromMapId} -> ${override.toMapId}`)
  }
  return { applied, unmatched }
}

/**
 * Parse the whole file into route nodes.
 *
 * Returns the nodes sorted by map id, the lines that did not parse, and the
 * counts the coverage report prints. Pure, so a test can feed it a snippet.
 */
export function parseWorldMap(text) {
  const blocks = text.split(/\r?\n\r?\n/)

  /** mapId -> { mapId, name, exits: Map<`${to}:${x}:${y}`, exit> } */
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

    // Walk the exit lines. A destination line sets the current destination and
    // its gesture; the tile lines that follow attach to it.
    let currentDest = null
    let currentHop = undefined
    for (let i = 1; i < lines.length; i++) {
      const values = ints(lines[i])
      if (values === null) {
        skipped.push(`${mapId}: ${lines[i]}`)
        continue
      }
      if (looksLikeTiles(values) && currentDest !== null) {
        // A destination map of -1 is an arrival gesture, not an edge.
        if (currentDest < 0) continue
        for (let j = 0; j < values.length; j += 2) {
          const x = values[j]
          const y = values[j + 1]
          node.exits.set(`${currentDest}:${x}:${y}`, {
            toMapId: currentDest,
            x,
            y,
            ...(currentHop !== undefined ? { via: currentHop } : {})
          })
        }
      } else {
        currentDest = values[0]
        currentHop = hopOf(values.slice(1))
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

  return { nodes: out, skipped, blockCount: blocks.length, namedCount }
}

async function main() {
  const source = process.argv[2] ?? DEFAULT_SOURCE
  const text = await readFile(source, 'latin1')
  const { nodes, skipped, blockCount } = parseWorldMap(text)
  const overrides = JSON.parse(await readFile(OVERRIDES, 'utf8'))
  const { applied, unmatched } = applyOverrides(nodes, overrides)
  const namedCount = nodes.filter((n) => n.name !== '').length

  const edgeCount = nodes.reduce((sum, n) => sum + n.exits.length, 0)
  const hopCounts = { fieldMap: 0, prompt: 0, dialog: 0 }
  for (const n of nodes) for (const e of n.exits) if (e.via) hopCounts[e.via.kind]++

  await writeFile(
    OUT,
    JSON.stringify(
      {
        source: 'DA Walker WorldMap.dat, with scripts/worldmap-overrides.json applied',
        note: 'Imported by scripts/import-worldmap.mjs. Do not hand-edit; re-run the script.',
        nodes
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  // The coverage report. A human reads this to trust the import.
  console.log(`Read ${blockCount} blocks from ${source}`)
  console.log(`Wrote ${nodes.length} nodes (${namedCount} named), ${edgeCount} exits to ${OUT}`)
  console.log(
    `Exits with a hop: ${hopCounts.fieldMap} world-map clicks, ${hopCounts.prompt} prompts, ${hopCounts.dialog} dialog sequences (not routed)`
  )
  console.log(`Applied ${applied.length} override(s) from ${OVERRIDES}: ${applied.join(', ')}`)
  if (unmatched.length > 0) {
    console.log(`Override(s) with no matching exit in the .dat: ${unmatched.join(', ')}`)
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} line(s) that did not parse:`)
    for (const s of skipped.slice(0, 40)) console.log(`  ${s}`)
    if (skipped.length > 40) console.log(`  ... and ${skipped.length - 40} more`)
  }
}

// Run as a script, not when imported by a test.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
