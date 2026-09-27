/**
 * Where the world graph's nodes go (WP43).
 *
 * A warp graph has no coordinates: `WorldMap.dat` places a map on the world
 * map, and most maps are not on it at all. So the picture is built from the
 * graph's own shape, and the shape that reads best for a route graph is rings
 * of hops: the root in the middle, everything one warp away on the first ring,
 * everything two warps away on the second. Distance from the middle is then
 * "how far to walk", which is the question the view is for.
 *
 * A force simulation would need hundreds of ticks over 718 nodes to settle, and
 * would settle somewhere different every time. This is deterministic and one
 * pass over the edges for each relaxation round, so it is instant at every size
 * the real graph reaches, and the same graph always draws the same way.
 */

export interface LayoutNode {
  mapId: number
  x: number
  y: number
  /** Warps from the root. The root itself is 0. */
  depth: number
}

export interface LayoutInput {
  /** The ids to place. A node with no edge inside the scope is placed as well. */
  nodes: readonly number[]
  /** The undirected neighbours of each id, inside the scope. */
  neighbours: ReadonlyMap<number, readonly number[]>
  /** The middle of the picture. The lowest id when it is left out or not in `nodes`. */
  root?: number
  /** Relaxation rounds. Three is enough to untangle a ring; more only creeps. */
  passes?: number
}

/** The gap between two rings, in the layout's own units. */
const RING_GAP = 100
/** The gap between two pieces of the graph when several are drawn. */
const PIECE_GAP = 60
const DEFAULT_PASSES = 3

/** The ids of one piece, in the order a breadth-first walk reaches them. */
function reach(
  root: number,
  neighbours: ReadonlyMap<number, readonly number[]>,
  seen: Set<number>
): { mapId: number; depth: number; parent?: number }[] {
  const found: { mapId: number; depth: number; parent?: number }[] = [{ mapId: root, depth: 0 }]
  seen.add(root)
  for (let at = 0; at < found.length; at++) {
    const here = found[at]!
    for (const next of neighbours.get(here.mapId) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      found.push({ mapId: next, depth: here.depth + 1, parent: here.mapId })
    }
  }
  return found
}

/** Turn an angle into a point on the ring for `depth`. */
function place(mapId: number, depth: number, angle: number): LayoutNode {
  const radius = depth * RING_GAP
  return { mapId, depth, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/**
 * The circular mean of some angles, or null when there are none.
 *
 * Angles do not average: the mean of 350 and 10 degrees is 0, not 180. So they
 * are averaged as points on the circle.
 */
function meanAngle(angles: readonly number[]): number | null {
  if (angles.length === 0) return null
  let x = 0
  let y = 0
  for (const angle of angles) {
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  if (x === 0 && y === 0) return null
  return Math.atan2(y, x)
}

/** Lay out one piece: the root in the middle, a ring for each hop out. */
function layoutPiece(
  root: number,
  neighbours: ReadonlyMap<number, readonly number[]>,
  seen: Set<number>,
  passes: number
): LayoutNode[] {
  const found = reach(root, neighbours, seen)
  const angles = new Map<number, number>()
  const depths = new Map<number, number>()
  for (const entry of found) depths.set(entry.mapId, entry.depth)

  // Ring by ring, in breadth-first order, so a node sits near its parent and a
  // whole branch stays together instead of being spread around the circle.
  const byDepth = new Map<number, number[]>()
  for (const entry of found) {
    const ring = byDepth.get(entry.depth)
    if (ring === undefined) byDepth.set(entry.depth, [entry.mapId])
    else ring.push(entry.mapId)
  }
  for (const [depth, ring] of byDepth) {
    if (depth === 0) {
      angles.set(ring[0]!, 0)
      continue
    }
    ring.forEach((mapId, index) => {
      angles.set(mapId, (index / ring.length) * Math.PI * 2)
    })
  }

  // Relax: pull each node toward its neighbours, and keep it on its own ring.
  // The ring is what carries the meaning, so only the angle moves.
  for (let pass = 0; pass < passes; pass++) {
    for (const [depth, ring] of byDepth) {
      if (depth === 0 || ring.length < 3) continue
      const wanted = new Map<number, number>()
      for (const mapId of ring) {
        const pull = (neighbours.get(mapId) ?? [])
          .filter((other) => depths.has(other) && depths.get(other) !== depth)
          .map((other) => angles.get(other)!)
        const mean = meanAngle(pull)
        if (mean !== null) wanted.set(mapId, mean)
      }
      // Sort the ring by where each node wants to be, then spread it evenly.
      // Spreading rather than moving is what stops two nodes landing on each
      // other: the order is the neighbours' doing, the spacing is the ring's.
      const order = [...ring].sort((left, right) => {
        const a = wanted.get(left)
        const b = wanted.get(right)
        if (a === undefined && b === undefined) return left - right
        if (a === undefined) return 1
        if (b === undefined) return -1
        return a - b || left - right
      })
      const offset = meanAngle([...wanted.values()]) ?? 0
      order.forEach((mapId, index) => {
        angles.set(mapId, offset + (index / order.length) * Math.PI * 2)
      })
      ring.splice(0, ring.length, ...order)
    }
  }

  return found.map((entry) => place(entry.mapId, entry.depth, angles.get(entry.mapId)!))
}

/** How far a piece reaches from its middle. */
function radiusOf(piece: readonly LayoutNode[]): number {
  return piece.reduce((far, node) => Math.max(far, Math.hypot(node.x, node.y)), 0)
}

/**
 * Place every id, piece by piece.
 *
 * The piece holding the root is laid out first and keeps the middle. The rest
 * are laid out around it, largest first, in a grid of cells as wide as the
 * widest piece: 333 of the real graph's pieces are one map each, and a grid is
 * the only honest way to show that many things that touch nothing.
 */
export function layoutGraph(input: LayoutInput): Map<number, LayoutNode> {
  const { nodes, neighbours } = input
  const passes = input.passes ?? DEFAULT_PASSES
  const inScope = new Set(nodes)
  const root =
    input.root !== undefined && inScope.has(input.root)
      ? input.root
      : [...inScope].sort((a, b) => a - b)[0]

  const placed = new Map<number, LayoutNode>()
  if (root === undefined) return placed

  const seen = new Set<number>()
  const scoped = new Map<number, readonly number[]>()
  for (const mapId of inScope) {
    scoped.set(
      mapId,
      (neighbours.get(mapId) ?? []).filter((other) => inScope.has(other))
    )
  }

  const first = layoutPiece(root, scoped, seen, passes)
  for (const node of first) placed.set(node.mapId, node)

  const rest: LayoutNode[][] = []
  for (const mapId of [...inScope].sort((a, b) => a - b)) {
    if (seen.has(mapId)) continue
    rest.push(layoutPiece(mapId, scoped, seen, passes))
  }
  if (rest.length === 0) return placed

  rest.sort((left, right) => right.length - left.length || left[0]!.mapId - right[0]!.mapId)
  const cell = Math.max(...rest.map((piece) => radiusOf(piece) * 2), RING_GAP) + PIECE_GAP
  const columns = Math.max(1, Math.ceil(Math.sqrt(rest.length)))
  // Below the first piece, so the root's own piece is never pushed off centre.
  const top = radiusOf(first) + PIECE_GAP + cell / 2
  rest.forEach((piece, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const dx = (column - (columns - 1) / 2) * cell
    const dy = top + row * cell
    for (const node of piece) {
      placed.set(node.mapId, { ...node, x: node.x + dx, y: node.y + dy })
    }
  })
  return placed
}

/** The box every placed node fits in. */
export function boundsOf(placed: ReadonlyMap<number, LayoutNode>): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  let first = true
  for (const node of placed.values()) {
    if (first) {
      minX = maxX = node.x
      minY = maxY = node.y
      first = false
      continue
    }
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }
  return { minX, minY, maxX, maxY }
}
