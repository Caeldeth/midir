/**
 * The maps that hold monsters, for the explorer's "avoid hostile" option (WP41).
 *
 * **This list is Sabrael's to keep.** It is a prior, not a measurement: nothing
 * on the wire says a map is dangerous, and the explorer's own evidence arrives
 * only after a character has been hit. So the list names what a player already
 * knows, and the explorer treats a named map as neither a target nor a crossing.
 *
 * A map is hostile when any of its names matches a pattern, or its id is in
 * `HOSTILE_MAP_IDS`, unless its id is in `HOSTILE_EXCEPTIONS`. Names are matched
 * rather than ids because the ids run in long unnamed ranges, and a pattern
 * keeps its meaning as the wire corrects a name.
 *
 * **A pattern that is too broad costs more than one that is too narrow.** An
 * avoided map is not explored *and* not walked through, so a region behind one
 * is out of reach for the run. `oren` was left out for exactly that reason: it
 * catches Oren Island City and 40 of its shops along with the tombs.
 *
 * The list is Sabrael's own (2026-09-27: "Mileth Crypt, Abel Crypt, Piet Crypt,
 * Mehadi, East Woodlands, West Woodlands", then "astrid, veltain and mine can be
 * added") plus the dungeon words that read unambiguously in the map names. Each
 * one is counted against the 2387 known map names before it goes in: `mine` takes
 * 47 and every one of them is a mine, and `veltain` takes 8 that all say "Veltain
 * Mines", so it is redundant today and kept for the day the wire names one of
 * them something else. `oren` stays out, for the reason above.
 */

/** Map-name patterns whose maps hold monsters. */
export const HOSTILE_PATTERNS: readonly RegExp[] = [
  /crypt/i,
  /dungeon/i,
  /woodland/i,
  /mehadi/i,
  /forest/i,
  /\bcave/i,
  /hunting/i,
  /\bmaze\b/i,
  /chaos/i,
  /giragan/i,
  /\btower\b/i,
  /\bpit\b/i,
  /insect/i,
  /astrid/i,
  /veltain/i,
  /\bmines?\b/i
]

/** Maps to treat as hostile whatever they are called. */
export const HOSTILE_MAP_IDS: readonly number[] = []

/**
 * Maps a pattern catches that are safe to walk. A town shop with a hostile word
 * in its name belongs here, so the pattern can stay broad.
 */
export const HOSTILE_EXCEPTIONS: readonly number[] = []

/** The names a node answers to, for matching. */
interface NamedNode {
  mapId: number
  name: string
  gameName?: string
  seedName?: string
}

/** True when any of a node's names reads as a hostile place. */
export function isHostileName(node: NamedNode): boolean {
  const names = [node.name, node.gameName ?? '', node.seedName ?? ''].filter((n) => n !== '')
  return names.some((name) => HOSTILE_PATTERNS.some((pattern) => pattern.test(name)))
}

/**
 * The hostile maps among these nodes. The explorer asks on every pick, so a name
 * the wire corrects mid-run is taken into account.
 */
export function hostileMaps(nodes: readonly NamedNode[]): Set<number> {
  const exceptions = new Set(HOSTILE_EXCEPTIONS)
  const hostile = new Set<number>()
  for (const id of HOSTILE_MAP_IDS) if (!exceptions.has(id)) hostile.add(id)
  for (const node of nodes) {
    if (exceptions.has(node.mapId)) continue
    if (isHostileName(node)) hostile.add(node.mapId)
  }
  return hostile
}
