import { describe, expect, it } from 'vitest'
import { mergeLearned, worldNodes, type RouteNode, type XmlNode } from '../graph'
import xmlworld from '../xmlworld.json'
import { describeGraph } from '../graphReport'

/**
 * The shape of the route graph (WP43).
 *
 * The first tests are over made-up nodes, because a rule has to be readable.
 * The last ones are over the imported files themselves, which is the plan's
 * verification step: the report and a script over the same files must agree.
 */

function node(mapId: number, exits: number[], candidates: number[] = []): RouteNode {
  return {
    mapId,
    name: `Map ${mapId}`,
    exits: exits.map((toMapId, index) => ({ toMapId, x: index, y: 0 })),
    ...(candidates.length > 0
      ? { candidates: candidates.map((toMapId, index) => ({ toMapId, x: index, y: 1 })) }
      : {})
  }
}

describe('describeGraph', () => {
  it('counts a map-to-map pair once, whatever its tiles', () => {
    // A town often has three doors to the same shop. That is one way there.
    const report = describeGraph([node(1, [2, 2, 2]), node(2, [1])])
    expect(report.nodes).toBe(2)
    expect(report.routedPairs).toBe(2)
    expect(report.oneWay).toEqual([])
  })

  it('names a warp with no warp back', () => {
    const report = describeGraph([node(1, [2]), node(2, [])])
    expect(report.oneWay).toEqual([{ fromMapId: 1, toMapId: 2 }])
    expect(report.noWayOut).toEqual([2])
  })

  it('finds the pieces, largest first, and counts a piece of one', () => {
    const report = describeGraph([
      node(1, [2]),
      node(2, [1]),
      node(3, [4]),
      node(4, [3]),
      node(5, [])
    ])
    expect(report.components.map((c) => c.size)).toEqual([2, 2, 1])
    expect(report.components[2]?.mapIds).toEqual([5])
  })

  it('joins a piece over a candidate, and keeps the routed pieces apart', () => {
    // This is the whole point of the candidate layer: the XML proposes a way in
    // that no walk has crossed (WP24).
    const report = describeGraph([node(1, [2]), node(2, [1], [3]), node(3, [])])
    expect(report.components.map((c) => c.size)).toEqual([2, 1])
    expect(report.componentsWithCandidates.map((c) => c.size)).toEqual([3])
    expect(report.candidateOnly).toEqual([3])
    expect(report.candidatePairs).toBe(1)
  })

  it('does not count a candidate the graph already routes over', () => {
    // The same hop is often both an authored warp and an XML one.
    const report = describeGraph([node(1, [2], [2]), node(2, [1])])
    expect(report.candidatePairs).toBe(0)
    expect(report.candidateOnly).toEqual([])
  })

  it('names a map nothing can enter, on any layer', () => {
    const report = describeGraph([node(1, [2]), node(2, []), node(3, [])])
    expect(report.noWayIn).toEqual([1, 3])
    // A map with a candidate in is not one of them.
    expect(describeGraph([node(1, [], [3]), node(3, [])]).noWayIn).toEqual([1])
  })

  it('reads a map that only other maps mention', () => {
    // WorldMap.dat names an exit to a map it has no node for. The report must
    // still hold that map, or the counts miss it.
    const report = describeGraph([node(1, [99])])
    expect(report.nodes).toBe(2)
    expect(report.noWayOut).toEqual([99])
  })
})

describe('the imported world', () => {
  // The graph the app starts from: WorldMap.dat with the world XML over it as
  // the candidate layer, and no learned edge, so the numbers are the files'.
  const nodes = mergeLearned(worldNodes, {
    transitions: { edges: {}, curations: {} },
    xml: xmlworld.nodes as XmlNode[]
  })
  const report = describeGraph(nodes)

  it('holds every map of the imported files', () => {
    expect(report.nodes).toBe(718)
  })

  it('is 334 pieces over the routed warps: one of 385 maps, and 333 of one', () => {
    expect(report.components).toHaveLength(334)
    expect(report.components[0]?.size).toBe(385)
    expect(report.components.filter((c) => c.size === 1)).toHaveLength(333)
  })

  it('is 9 pieces once the candidates count, the largest of 690 maps', () => {
    expect(report.componentsWithCandidates).toHaveLength(9)
    expect(report.componentsWithCandidates[0]?.size).toBe(690)
  })

  it('holds 13 maps with no way in on any layer', () => {
    expect(report.noWayIn).toHaveLength(13)
  })

  it('holds 6 maps with a routed way in and no routed way out', () => {
    expect(report.noWayOut).toHaveLength(6)
  })

  it('holds 228 warps with no warp back', () => {
    expect(report.oneWay).toHaveLength(228)
  })

  it('holds 320 maps whose only way in is a candidate', () => {
    // The routed view leaves 333 maps as pieces of one. 320 of them have a
    // candidate way in and 13 have no way in at all, which is the whole 333.
    expect(report.candidateOnly).toHaveLength(320)
    expect(report.candidateOnly.length + report.noWayIn.length).toBe(333)
  })
})
