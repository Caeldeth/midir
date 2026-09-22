#!/usr/bin/env node
// Import the world repo's map XML into route/xmlworld.json: the provisional
// layer of the route graph (WP24, provisional).
//
//   node scripts/import-world-xml.mjs [path to the world repo, default ../world]
//
// Two sets are read. `xml/maps/.ignore/Old*.xml` is Hybrasyl's authoring of
// the retail town maps, kept out of production because production replaced
// them; and a fixed list of production areas whose maps are retail's,
// unchanged (Sabrael, 2026-09-22). A map in both sets is read from `.ignore`,
// and the production copy's warps are compared against it: a disagreement is
// counted and printed, never merged.
//
// The XML is right often enough to be worth having and wrong often enough not
// to trust blind: the Rucesion Town Hall door is (4,5) and (5,5) in the XML
// and (4,6) and (5,6) on the wire. So every edge here enters the graph as a
// candidate, and becomes an exit only when the wire crosses it once or the
// user accepts it on the Map tab (route/graph.ts, mergeLearned). The walker
// gains nothing from this file on its own.
//
// A `<Warp>` names its destination map, not its id. Names are resolved
// against every map in the world repo: the referring map's own folder first,
// then `.ignore`, then any map with that name if there is exactly one. A
// target that resolves nowhere, or to two maps, is skipped and counted.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_WORLD = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'world')
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/main/route/xmlworld.json'
)

/** The production areas whose maps are retail's, unchanged. */
export const PRODUCTION_AREAS = [
  'Mehadi',
  'Pravat',
  'New Crypt',
  'East Woods',
  'West Woods',
  'Dubhaim Castle',
  'CR',
  'Astrid',
  'Oren Ruins',
  'Oren Sewer',
  'Shinewood Forest',
  'Suomi',
  'Undine'
]

/** Parse one map file. Returns null when it is not a map. */
export function parseMapXml(text) {
  const head = /<Map\b[^>]*\bId="(\d+)"[^>]*\bX="(\d+)"[^>]*\bY="(\d+)"/.exec(text)
  if (head === null) return null
  const name = /<Name>([^<]*)<\/Name>/.exec(text)?.[1]?.trim() ?? ''
  const warps = []
  const warpRe =
    /<Warp\b[^>]*\bX="(\d+)"[^>]*\bY="(\d+)"[^>]*>\s*<MapTarget\b[^>]*\bX="(\d+)"[^>]*\bY="(\d+)"[^>]*>([^<]*)<\/MapTarget>/g
  for (const m of text.matchAll(warpRe)) {
    warps.push({
      x: Number(m[1]),
      y: Number(m[2]),
      arrivalX: Number(m[3]),
      arrivalY: Number(m[4]),
      target: m[5].trim()
    })
  }
  return { mapId: Number(head[1]), width: Number(head[2]), height: Number(head[3]), name, warps }
}

async function readMaps(root) {
  const out = []
  async function walk(dir, area) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, area === '' ? entry.name : area)
      else if (entry.name.endsWith('.xml')) {
        const parsed = parseMapXml(await readFile(path, 'utf8'))
        if (parsed !== null) out.push({ ...parsed, area, file: entry.name })
      }
    }
  }
  await walk(root, '')
  return out
}

/**
 * Build the nodes from the maps read. `chosen` is the set to import; `all`
 * resolves names. Returns the nodes and the counts for the report.
 */
export function buildNodes(chosen, all) {
  const byName = new Map()
  for (const map of all) {
    const list = byName.get(map.name) ?? []
    list.push(map)
    byName.set(map.name, list)
  }
  const resolveTarget = (from, name) => {
    const list = byName.get(name) ?? []
    const same = list.filter((m) => m.area === from.area)
    if (same.length === 1) return same[0].mapId
    const ignored = list.filter((m) => m.area === '.ignore')
    if (ignored.length === 1) return ignored[0].mapId
    return list.length === 1 ? list[0].mapId : null
  }
  let unresolved = 0
  const nodes = []
  for (const map of chosen) {
    const exits = []
    for (const warp of map.warps) {
      const toMapId = resolveTarget(map, warp.target)
      if (toMapId === null) {
        unresolved++
        continue
      }
      exits.push({
        toMapId,
        x: warp.x,
        y: warp.y,
        arrivalX: warp.arrivalX,
        arrivalY: warp.arrivalY
      })
    }
    nodes.push({ mapId: map.mapId, name: map.name, width: map.width, height: map.height, exits })
  }
  nodes.sort((a, b) => a.mapId - b.mapId)
  return { nodes, unresolved }
}

/** Where a production copy of an `.ignore` map disagrees with it. */
export function disagreements(ignored, production) {
  const out = []
  const key = (w) => `${w.x},${w.y}>${w.target}`
  for (const map of production) {
    const old = ignored.find((m) => m.mapId === map.mapId)
    if (old === undefined) continue
    const oldKeys = new Set(old.warps.map(key))
    const newKeys = new Set(map.warps.map(key))
    const onlyOld = [...oldKeys].filter((k) => !newKeys.has(k))
    const onlyNew = [...newKeys].filter((k) => !oldKeys.has(k))
    if (onlyOld.length > 0 || onlyNew.length > 0) {
      out.push({ mapId: map.mapId, name: old.name, onlyOld, onlyNew })
    }
  }
  return out
}

async function main() {
  const world = resolve(process.argv[2] ?? DEFAULT_WORLD)
  const all = await readMaps(join(world, 'xml', 'maps'))
  const ignored = all.filter((m) => m.area === '.ignore' && m.file.startsWith('Old'))
  const production = all.filter((m) => PRODUCTION_AREAS.includes(m.area))
  const ignoredIds = new Set(ignored.map((m) => m.mapId))
  const chosen = [...ignored, ...production.filter((m) => !ignoredIds.has(m.mapId))]
  const { nodes, unresolved } = buildNodes(chosen, all)
  const differ = disagreements(ignored, production)

  const exits = nodes.reduce((n, node) => n + node.exits.length, 0)
  await writeFile(
    OUTPUT,
    JSON.stringify(
      {
        source:
          'the world repo: xml/maps/.ignore/Old*.xml and the retail-unchanged production areas, by scripts/import-world-xml.mjs',
        note: 'Provisional: every exit is a candidate until the wire crosses it once or the user accepts it. Never used by the walker on its own.',
        areas: PRODUCTION_AREAS,
        nodes
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `Wrote ${nodes.length} nodes, ${exits} exits to ${OUTPUT} (${ignored.length} from .ignore, ${chosen.length - ignored.length} from ${PRODUCTION_AREAS.length} production areas; ${unresolved} warp targets unresolved and skipped).`
  )
  for (const d of differ) {
    console.log(
      `Map ${d.mapId} ${d.name}: production differs from .ignore; only .ignore: ${d.onlyOld.join(' ') || 'none'}; only production: ${d.onlyNew.join(' ') || 'none'}`
    )
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
