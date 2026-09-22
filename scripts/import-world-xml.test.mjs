import { describe, expect, it } from 'vitest'
import {
  buildNodes,
  disagreements,
  hybrasylOnly,
  parseMapXml,
  RETAIL_MAP_IDS_END
} from './import-world-xml.mjs'

/**
 * The world XML importer (WP24, provisional). The snippet is the shape of
 * `xml/maps/.ignore/OldRucesionCommons.xml`: the Town Hall door the XML puts
 * at y 5 where the wire puts it at y 6, which is why the layer is provisional.
 */
const COMMONS = `<?xml version="1.0" encoding="utf-8"?>
<Map xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Id="3048" X="20" Y="20" xmlns="http://www.hybrasyl.com/XML/Hybrasyl/2020-02">
  <Name>Old Rucesion Commons</Name>
  <Flags />
  <Warps>
    <Warp X="5" Y="5">
      <MapTarget X="7" Y="14">Old Rucesion Town Hall</MapTarget>
    </Warp>
    <Warp X="19" Y="3">
      <MapTarget X="1" Y="10">Sgath Pit</MapTarget>
    </Warp>
  </Warps>
  <Npcs />
</Map>
`

const HALL = `<Map Id="3049" Music="7" X="10" Y="16"><Name>Old Rucesion Town Hall</Name><Warps /></Map>`

describe('parseMapXml', () => {
  it('reads the id, the size, the name, and each warp with its arrival and target', () => {
    expect(parseMapXml(COMMONS)).toEqual({
      mapId: 3048,
      width: 20,
      height: 20,
      name: 'Old Rucesion Commons',
      warps: [
        { x: 5, y: 5, arrivalX: 7, arrivalY: 14, target: 'Old Rucesion Town Hall' },
        { x: 19, y: 3, arrivalX: 1, arrivalY: 10, target: 'Sgath Pit' }
      ]
    })
    expect(parseMapXml(HALL)?.warps).toEqual([])
    expect(parseMapXml('<Npc Name="Donnan" />')).toBeNull()
  })
})

describe('buildNodes', () => {
  const commons = { ...parseMapXml(COMMONS), area: '.ignore', file: 'OldRucesionCommons.xml' }
  const hall = { ...parseMapXml(HALL), area: '.ignore', file: 'OldRucesionTownHall.xml' }

  it('resolves a target by name and skips one no map has', () => {
    const { nodes, unresolved } = buildNodes([commons, hall], [commons, hall])
    expect(unresolved).toBe(1)
    expect(nodes).toEqual([
      {
        mapId: 3048,
        name: 'Old Rucesion Commons',
        width: 20,
        height: 20,
        exits: [{ toMapId: 3049, x: 5, y: 5, arrivalX: 7, arrivalY: 14 }]
      },
      { mapId: 3049, name: 'Old Rucesion Town Hall', width: 10, height: 16, exits: [] }
    ])
  })

  it('prefers the referring map’s own area, then .ignore, and refuses an ambiguous name', () => {
    const twinOld = { ...hall, mapId: 1, area: '.ignore' }
    const twinProd = { ...hall, mapId: 2, area: 'Rucesion' }
    const twinOther = { ...hall, mapId: 3, area: 'Mileth' }
    const fromProd = { ...commons, area: 'Rucesion' }
    expect(buildNodes([fromProd], [fromProd, twinOld, twinProd]).nodes[0].exits[0].toMapId).toBe(2)
    expect(buildNodes([commons], [commons, twinOld, twinProd]).nodes[0].exits[0].toMapId).toBe(1)
    const ambiguous = buildNodes(
      [fromProd],
      [fromProd, twinProd, twinOther, { ...hall, mapId: 4, area: 'Rucesion' }]
    )
    expect(ambiguous.nodes[0].exits).toEqual([])
    expect(ambiguous.unresolved).toBe(2)
  })
})

describe('disagreements', () => {
  it('reports a production copy whose warps differ from .ignore’s', () => {
    const commons = { ...parseMapXml(COMMONS), area: '.ignore' }
    const moved = {
      ...commons,
      area: 'Rucesion',
      warps: [{ x: 5, y: 6, arrivalX: 7, arrivalY: 14, target: 'Old Rucesion Town Hall' }]
    }
    expect(disagreements([commons], [moved])).toEqual([
      {
        mapId: 3048,
        name: 'Old Rucesion Commons',
        onlyOld: ['5,5>Old Rucesion Town Hall', '19,3>Sgath Pit'],
        onlyNew: ['5,6>Old Rucesion Town Hall']
      }
    ])
    expect(disagreements([commons], [commons])).toEqual([])
  })
})

describe('hybrasylOnly', () => {
  const names = { 3048: 'Rucesion Commons', 700: 'Aisling Undercroft' }

  it('leaves out a map retail does not have', () => {
    // Retail stops below 30000, whatever the map is called.
    expect(RETAIL_MAP_IDS_END).toBe(30000)
    expect(hybrasylOnly({ mapId: 30400, name: 'Undine' }, names)).toBe(true)
    // An Old or Undercroft map stands or falls by the name list.
    expect(hybrasylOnly({ mapId: 3048, name: 'Old Rucesion Commons' }, names)).toBe(false)
    expect(hybrasylOnly({ mapId: 700, name: 'Undercroft 1' }, names)).toBe(false)
    expect(hybrasylOnly({ mapId: 701, name: 'Undercroft 2' }, names)).toBe(true)
    expect(hybrasylOnly({ mapId: 702, name: 'Old Dubhaim Keep' }, names)).toBe(true)
    // Every other map is retail's, named or not.
    expect(hybrasylOnly({ mapId: 703, name: 'Mehadi Swamp 3' }, names)).toBe(false)
  })
})
