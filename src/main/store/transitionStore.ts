import { join } from 'node:path'
import { z } from 'zod'
import { createJsonStore, type JsonStore, type JsonStoreFailure } from '../jsonStore'
import type { TransitionObservation } from '../model/transitions'
import type { WarpEdit } from '../../shared/map'
import type { RouteHop } from '../route/graph'

/**
 * The edges learned from the wire: `transitions.json` (WP29).
 *
 * One record per edge, keyed by the origin map and tile and the destination
 * map, with how many times a clean walk-warp crossed it and when. It is the
 * learned layer of the route graph: the imported `WorldMap.dat` stays as DA
 * Walker shipped it, `scripts/worldmap-overrides.json` holds the corrections
 * found by hand, and this file holds the ones found by play. The graph merges
 * all three at run time (`route/graph.ts`, `mergeLearned`), and every edge
 * says where it came from.
 *
 * An edge enters the graph after `PROMOTION_OBSERVATIONS` clean crossings.
 * One crossing is a candidate: the reducer's rule is positive and the
 * recordings hold no false edge, but a death mid-step is a case the wire
 * cannot rule out, and a second crossing of the same tile to the same map is
 * not something a death repeats. The count and the times ride on the record,
 * the same "seen N times, as of" the bank keeps.
 *
 * The file is also the editable layer the Map tab writes (WP30): a
 * `curation` per edge key says the user accepted the edge (it enters the
 * graph whatever its count) or rejected it (it leaves the graph, whether the
 * wire or the imported file put it there). A warp placed by hand is an
 * acceptance, and one placed in place of another rejects that one too. The
 * imported file is never written.
 */
export const TRANSITIONS_FILE = 'transitions.json'

/** Clean crossings before a learned edge enters the graph. */
export const PROMOTION_OBSERVATIONS = 2

export interface LearnedEdge {
  fromMapId: number
  /** The tile on `fromMapId` the step landed on. */
  x: number
  y: number
  toMapId: number
  /** The first confirmed tile on the destination map, when the wire gave one. */
  arrivalX?: number
  arrivalY?: number
  /** A world-map hop: the point on the pane the client clicked. */
  via?: { kind: 'fieldMap'; screenX: number; screenY: number }
  /** How many clean walk-warps crossed this edge. */
  observations: number
  /** Capture time of the first and the newest crossing. */
  firstSeenMs: number
  lastSeenMs: number
}

/** One hand edit, keyed like an edge. */
export interface Curation {
  fromMapId: number
  x: number
  y: number
  toMapId: number
  verdict: 'accepted' | 'rejected'
  /** Kept for a hop the user moved, so the new tile keeps its gesture. */
  via?: RouteHop
  /** Wall-clock time of the edit. */
  atMs: number
}

export interface TransitionFile {
  edges: Record<string, LearnedEdge>
  curations: Record<string, Curation>
}

// A field missing from this schema is dropped on load, silently (WP11's rule).
const edgeSchema = z.object({
  fromMapId: z.number().int().nonnegative(),
  x: z.number().int(),
  y: z.number().int(),
  toMapId: z.number().int().nonnegative(),
  arrivalX: z.number().int().optional(),
  arrivalY: z.number().int().optional(),
  via: z
    .object({ kind: z.literal('fieldMap'), screenX: z.number(), screenY: z.number() })
    .optional(),
  observations: z.number().int().positive(),
  firstSeenMs: z.number(),
  lastSeenMs: z.number()
})

const curationSchema = z.object({
  fromMapId: z.number().int().nonnegative(),
  x: z.number().int(),
  y: z.number().int(),
  toMapId: z.number().int().nonnegative(),
  verdict: z.enum(['accepted', 'rejected']),
  via: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('fieldMap'), screenX: z.number(), screenY: z.number() }),
      z.object({ kind: z.literal('prompt') }),
      z.object({ kind: z.literal('dialog') })
    ])
    .optional(),
  atMs: z.number()
})

const fileSchema = z.object({
  edges: z.record(z.string(), edgeSchema),
  // Absent in a file written before WP30's edit.
  curations: z.record(z.string(), curationSchema).default({})
})

export type TransitionStore = JsonStore<TransitionFile>

export function emptyTransitionFile(): TransitionFile {
  return { edges: {}, curations: {} }
}

export function createTransitionStore(
  directory: string,
  onFailure?: (failure: JsonStoreFailure) => void
): TransitionStore {
  return createJsonStore<TransitionFile>({
    path: join(directory, TRANSITIONS_FILE),
    fallback: emptyTransitionFile,
    normalize: (raw) => {
      const parsed = fileSchema.safeParse(raw)
      return parsed.success ? parsed.data : null
    },
    backup: true,
    quarantine: true,
    cacheReads: true,
    ...(onFailure !== undefined ? { onFailure } : {})
  })
}

/** The key one edge is filed under: the origin map and tile, and the destination. */
export function edgeKey(edge: {
  fromMapId: number
  x: number
  y: number
  toMapId: number
}): string {
  return `${edge.fromMapId}:${edge.x},${edge.y}>${edge.toMapId}`
}

/**
 * `file` with one clean crossing counted. A new edge is a candidate of one;
 * a known one gains a crossing, the newest arrival and point, and its time.
 * An observation older than the record's newest adds its count and nothing
 * else, so a replay of an old recording cannot move a fresher reading back.
 */
export function withObservation(file: TransitionFile, seen: TransitionObservation): TransitionFile {
  const key = edgeKey(seen)
  const existing = file.edges[key]
  const arrival =
    seen.arrivalX !== undefined && seen.arrivalY !== undefined
      ? { arrivalX: seen.arrivalX, arrivalY: seen.arrivalY }
      : {}
  const via = seen.via !== undefined ? { via: seen.via } : {}
  if (existing === undefined) {
    const edge: LearnedEdge = {
      fromMapId: seen.fromMapId,
      x: seen.x,
      y: seen.y,
      toMapId: seen.toMapId,
      ...arrival,
      ...via,
      observations: 1,
      firstSeenMs: seen.atMs,
      lastSeenMs: seen.atMs
    }
    return { ...file, edges: { ...file.edges, [key]: edge } }
  }
  const newer = seen.atMs >= existing.lastSeenMs
  const edge: LearnedEdge = {
    ...existing,
    ...(newer ? arrival : {}),
    ...(newer ? via : {}),
    observations: existing.observations + 1,
    firstSeenMs: Math.min(existing.firstSeenMs, seen.atMs),
    lastSeenMs: Math.max(existing.lastSeenMs, seen.atMs)
  }
  return { ...file, edges: { ...file.edges, [key]: edge } }
}

/**
 * `file` with one hand edit applied (WP30). `via` is the hop of the warp
 * being edited or replaced, when it is a hop, so a moved hop keeps its
 * gesture.
 */
export function withCuration(
  file: TransitionFile,
  edit: WarpEdit,
  atMs: number,
  via?: Curation['via']
): TransitionFile {
  const curations = { ...file.curations }
  const key = edgeKey(edit)
  const record = (x: number, y: number, verdict: Curation['verdict']): Curation => ({
    fromMapId: edit.fromMapId,
    x,
    y,
    toMapId: edit.toMapId,
    verdict,
    ...(via !== undefined ? { via } : {}),
    atMs
  })
  switch (edit.action) {
    case 'accept':
      curations[key] = record(edit.x, edit.y, 'accepted')
      break
    case 'reject':
      curations[key] = record(edit.x, edit.y, 'rejected')
      break
    case 'restore':
      delete curations[key]
      break
    case 'place': {
      const replaced =
        edit.replace === undefined
          ? undefined
          : edgeKey({ fromMapId: edit.fromMapId, ...edit.replace })
      if (replaced !== undefined && replaced !== key) {
        curations[replaced] = {
          ...record(edit.replace!.x, edit.replace!.y, 'rejected'),
          toMapId: edit.replace!.toMapId
        }
      }
      curations[key] = record(edit.x, edit.y, 'accepted')
      break
    }
  }
  return { ...file, curations }
}

/**
 * The edges seen often enough to enter the graph, and the ones the user
 * accepted whatever their count, less the ones the user rejected.
 *
 * A plain warp tile leads to one map, so when the wire has seen a tile lead
 * to two, only the destination it saw most often is promoted: the Rucesion
 * Village Way tile (23,11) went to the Commons 45 times and, twice, after a
 * server notice, to map 3079 (the recordings of 2026-07-23 to 2026-09-22).
 * That is a gate turning a character away, not a second door, and an edge
 * learned from it would route the walker through a refusal. A world-map hop
 * is the exception: one edge tile reaches every map on the pane by click,
 * so each of its destinations stands on its own.
 */
export function promotedEdges(
  file: TransitionFile,
  threshold = PROMOTION_OBSERVATIONS
): LearnedEdge[] {
  const strongest = new Map<string, LearnedEdge>()
  for (const edge of Object.values(file.edges)) {
    if (edge.via !== undefined) continue
    const tile = `${edge.fromMapId}:${edge.x},${edge.y}`
    const held = strongest.get(tile)
    if (held === undefined || edge.observations > held.observations) strongest.set(tile, edge)
  }
  return Object.values(file.edges).filter((edge) => {
    const verdict = file.curations[edgeKey(edge)]?.verdict
    if (verdict !== undefined) return verdict === 'accepted'
    if (edge.observations < threshold) return false
    return edge.via !== undefined || strongest.get(`${edge.fromMapId}:${edge.x},${edge.y}`) === edge
  })
}
