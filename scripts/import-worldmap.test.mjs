import { describe, it, expect } from 'vitest'
import { applyOverrides, parseWorldMap } from './import-worldmap.mjs'

/**
 * A snippet in the shapes the real WorldMap.dat uses, read against what DA
 * Walker's own loader does with each line (see the header of the importer).
 * Rucesion's world-map tiles reach five maps by five different clicks; Veltain
 * Mines has a prompt; Noam has a ship dialog; Loures Dungeon has an arrival
 * gesture on a -1 destination.
 */
const SNIPPET = `-1 505 -1 -1 Rucesion
421
37 28
502 306 77
28 44 27 44
3012 343 250
28 44 27 44
3010
29 0

502 70 78 Abel
3014
28 0 29 0

2900 20 22 Veltain Mines Enterance
11021 -1
19 11 19 10

-1 10055 -1 -1 Noam
1960 485 62 528 314 -1 -1 -1 -1
45 24

-1 378 30 10 Loures Dungeon
-1 568 189 528 315 -1
14 8
`

describe('parseWorldMap', () => {
  const { nodes, skipped, namedCount } = parseWorldMap(SNIPPET)
  const byId = new Map(nodes.map((n) => [n.mapId, n]))

  it('reads every block, and drops the header flag and the map size', () => {
    expect(nodes.map((n) => n.mapId)).toEqual([378, 502, 505, 2900, 10055])
    expect(byId.get(505).name).toBe('Rucesion')
    expect(byId.get(502).name).toBe('Abel')
    expect(namedCount).toBe(5)
    expect(skipped).toEqual([])
  })

  it('keeps a plain warp with no hop', () => {
    expect(byId.get(505).exits.find((e) => e.toMapId === 421)).toEqual({
      toMapId: 421,
      x: 37,
      y: 28
    })
    expect(byId.get(502).exits).toEqual([
      { toMapId: 3014, x: 28, y: 0 },
      { toMapId: 3014, x: 29, y: 0 }
    ])
  })

  it('keeps a world-map click as a fieldMap hop on each tile', () => {
    const toAbel = byId.get(505).exits.filter((e) => e.toMapId === 502)
    expect(toAbel).toEqual([
      { toMapId: 502, x: 27, y: 44, via: { kind: 'fieldMap', screenX: 306, screenY: 77 } },
      { toMapId: 502, x: 28, y: 44, via: { kind: 'fieldMap', screenX: 306, screenY: 77 } }
    ])
    // The same tiles reach Loures by a different click.
    const toLoures = byId.get(505).exits.filter((e) => e.toMapId === 3012)
    expect(toLoures.map((e) => e.via)).toEqual([
      { kind: 'fieldMap', screenX: 343, screenY: 250 },
      { kind: 'fieldMap', screenX: 343, screenY: 250 }
    ])
  })

  it('keeps a bare Space as a prompt hop', () => {
    expect(byId.get(2900).exits).toEqual([
      { toMapId: 11021, x: 19, y: 10, via: { kind: 'prompt' } },
      { toMapId: 11021, x: 19, y: 11, via: { kind: 'prompt' } }
    ])
  })

  it('marks a longer sequence as a dialog hop', () => {
    expect(byId.get(10055).exits).toEqual([
      { toMapId: 1960, x: 45, y: 24, via: { kind: 'dialog' } }
    ])
  })

  it('drops an arrival gesture, whose destination is -1', () => {
    expect(byId.get(378).exits).toEqual([])
  })
})

describe('applyOverrides', () => {
  it('replaces the tiles of one exit and keeps its hop', () => {
    const { nodes } = parseWorldMap(SNIPPET)
    const { applied, unmatched } = applyOverrides(nodes, {
      exits: [
        { fromMapId: 505, toMapId: 421, tiles: [[36, 28]] },
        { fromMapId: 505, toMapId: 502, tiles: [[28, 45]] },
        { fromMapId: 505, toMapId: 9999, tiles: [[0, 0]] },
        { fromMapId: 1, toMapId: 2, tiles: [[0, 0]] }
      ]
    })
    const rucesion = nodes.find((n) => n.mapId === 505)
    expect(rucesion.exits.filter((e) => e.toMapId === 421)).toEqual([
      { toMapId: 421, x: 36, y: 28 }
    ])
    expect(rucesion.exits.filter((e) => e.toMapId === 502)).toEqual([
      { toMapId: 502, x: 28, y: 45, via: { kind: 'fieldMap', screenX: 306, screenY: 77 } }
    ])
    expect(applied).toEqual(['505 -> 421', '505 -> 502'])
    expect(unmatched).toEqual(['505 -> 9999', '1 -> 2'])
  })
})
