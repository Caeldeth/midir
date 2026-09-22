import { readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createReplaySourceFromFile } from '../capture/replaySource'
import { createCaptureService } from '../captureService'
import { createCharacterStore } from '../store/characterStore'
import { createTransitionStore, type LearnedEdge } from '../store/transitionStore'
import { worldGraph } from '../route/graph'

/**
 * The transition learner over real recordings (WP29, verification 3).
 *
 * The recordings are private and stay off the repository, so this runs only
 * when `MIDIR_RECORDINGS` names their folder, and is skipped otherwise:
 *
 *   MIDIR_RECORDINGS="%LOCALAPPDATA%\Erisco\Midir\recordings" npm test
 *
 * Over the 44 recordings of 2026-07-23 to 2026-09-22 it learned 110 edges:
 * 77 the imported graph holds tile for tile, 4 beside an authored strip (the
 * Town Hall door's second tile, an edge column the .dat lists three tiles
 * of), 16 pairs the .dat lacks, and 13 maps it does not know at all. None
 * contradicts the graph: every learned tile on a known pair is an authored
 * tile or within two of one.
 */
const recordings = process.env.MIDIR_RECORDINGS

describe.skipIf(recordings === undefined)('the learner over the recordings', () => {
  let edges: LearnedEdge[] = []
  let work = ''

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'midir-learn-'))
    const transitionStore = createTransitionStore(work)
    for (const file of readdirSync(recordings!).filter((f) => f.endsWith('.ndjson'))) {
      const source = await createReplaySourceFromFile(join(recordings!, file))
      const service = createCaptureService({
        store: createCharacterStore(work),
        transitionStore,
        createSource: () => source,
        saveDebounceMs: 0
      })
      await service.start('replay')
      await service.stop()
    }
    edges = Object.values((await transitionStore.load()).edges)
  }, 600_000)

  afterAll(async () => {
    if (work !== '') await rm(work, { recursive: true, force: true })
  })

  it('learns the walk-warps the imported graph holds, tile for tile', () => {
    const same = edges.filter((e) =>
      worldGraph
        .node(e.fromMapId)
        ?.exits.some((x) => x.toMapId === e.toMapId && x.x === e.x && x.y === e.y)
    )
    expect(same.length).toBeGreaterThan(50)
  })

  it('never learns a tile far from the authored strip for a pair the graph knows', () => {
    const far: string[] = []
    for (const e of edges) {
      const exits = worldGraph.node(e.fromMapId)?.exits.filter((x) => x.toMapId === e.toMapId) ?? []
      if (exits.length === 0) continue
      const nearest = Math.min(...exits.map((x) => Math.abs(x.x - e.x) + Math.abs(x.y - e.y)))
      if (nearest > 2) far.push(`${e.fromMapId} (${e.x},${e.y}) -> ${e.toMapId}, ${nearest} off`)
    }
    expect(far).toEqual([])
  })

  it('reads the arrival tile of every edge', () => {
    expect(edges.every((e) => e.arrivalX !== undefined && e.arrivalY !== undefined)).toBe(true)
  })

  it('learns the world-map hop from Mileth Gateway with the point the wire gives', () => {
    // The .dat recorded (306, 77) for this click; the wire's point is a pixel off it.
    const hop = edges.find((e) => e.fromMapId === 3079 && e.toMapId === 3014)
    expect(hop?.via?.kind).toBe('fieldMap')
    expect(Math.abs((hop?.via?.screenX ?? 0) - 306)).toBeLessThanOrEqual(2)
    expect(Math.abs((hop?.via?.screenY ?? 0) - 77)).toBeLessThanOrEqual(2)
  })
})
