import type { WorldGraphView } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { neighboursOf, rootOf, scopedMaps, useGraphStore } from '../graphStore'

/** The scope the World tab draws, computed here so a change of scope is free (WP43). */

const EDGES: WorldGraphView['edges'] = [
  { fromMapId: 1, toMapId: 2, source: 'authored', candidate: false, tiles: 1 },
  { fromMapId: 2, toMapId: 3, source: 'authored', candidate: false, tiles: 1 },
  { fromMapId: 3, toMapId: 4, source: 'xml', candidate: true, tiles: 1 },
  { fromMapId: 8, toMapId: 9, source: 'authored', candidate: false, tiles: 1 }
]

const EVERY = [1, 2, 3, 4, 8, 9, 50]

function view(over: Partial<WorldGraphView> = {}): WorldGraphView {
  return {
    nodes: EVERY.map((mapId) => ({ mapId, name: `Map ${mapId}`, read: false, hostile: false })),
    edges: EDGES,
    report: {
      nodes: EVERY.length,
      routedPairs: 3,
      candidatePairs: 1,
      components: [
        { size: 4, mapIds: [1, 2, 3, 4] },
        { size: 2, mapIds: [8, 9] },
        { size: 1, mapIds: [50] }
      ],
      componentsWithCandidates: [],
      noWayIn: [],
      noWayOut: [],
      oneWay: [],
      candidateOnly: [4]
    },
    positions: [],
    ...over
  }
}

describe('neighboursOf', () => {
  it('reads a warp both ways, because a piece is what a player can reach', () => {
    const neighbours = neighboursOf(EDGES)
    expect(neighbours.get(2)).toEqual([1, 3])
  })

  it('counts a map once however many warps lead to it', () => {
    const neighbours = neighboursOf([...EDGES, ...EDGES])
    expect(neighbours.get(2)).toEqual([1, 3])
  })
})

describe('scopedMaps', () => {
  const neighbours = neighboursOf(EDGES)

  it('takes the whole piece the middle map belongs to, uncrossed warps and all', () => {
    const scoped = scopedMaps('component', EVERY, neighbours, 1, 2)
    expect(scoped.sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('takes a radius in warps', () => {
    expect(scopedMaps('near', EVERY, neighbours, 1, 1).sort((a, b) => a - b)).toEqual([1, 2])
    expect(scopedMaps('near', EVERY, neighbours, 1, 2).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('takes every map, pieces and singletons alike', () => {
    expect(scopedMaps('all', EVERY, neighbours, 1, 2).sort((a, b) => a - b)).toEqual(EVERY)
  })

  it('takes every map when nothing names a middle', () => {
    expect(scopedMaps('component', EVERY, neighbours, null, 2)).toEqual(EVERY)
  })

  it('holds a map that touches nothing, when that map is the middle', () => {
    expect(scopedMaps('component', EVERY, neighbours, 50, 2)).toEqual([50])
  })
})

describe('rootOf', () => {
  it('takes the map the user picked', () => {
    expect(rootOf(view(), 77)).toBe(77)
  })

  it('follows a live character when the user has picked nothing', () => {
    const live = view({ positions: [{ connectionId: 'c1', name: 'Gabrael', mapId: 9 }] })
    expect(rootOf(live, null)).toBe(9)
  })

  it('falls back to the largest piece, so the view opens on something', () => {
    expect(rootOf(view(), null)).toBe(1)
  })

  it('has no middle with no graph', () => {
    expect(rootOf(null, null)).toBeNull()
  })
})

describe('the store', () => {
  it('keeps a failure to show the user, and no graph', async () => {
    window.api.graph.view = async () => {
      throw new Error('the graph would not build')
    }
    await useGraphStore.getState().refresh()
    expect(useGraphStore.getState().error).toBe('the graph would not build')
    expect(useGraphStore.getState().view).toBeNull()
    expect(useGraphStore.getState().loading).toBe(false)
  })
})
