import { PacketReader } from '../reader'

/**
 * SFieldMap 0x2E, the world map, and CFieldMapClick 0x3F, the point the player
 * picked on it.
 *
 * Leaving a town does not step onto the next town. The edge tiles of a gateway
 * map open this full-screen pane over a field image (`field001`), and the
 * player clicks one of its points. The client answers with 0x3F, and the
 * server then teleports the character: SMapInfo 0x15 and the normal map load
 * follow. So a cross-town walk is a walk to the edge tile, a click on the pane,
 * and a wait for the map change. See route/graph.ts for how a route carries
 * that hop, and walker.ts for the click.
 *
 * ## The layout
 *
 * Body after the opcode:
 *
 *   [string8 fieldName]         the client asset stem, for example field001
 *   [u8 pointCount]
 *   [u8 currentIndex]           which point marks where the player is now
 *   pointCount x:
 *     [u16 screenX][u16 screenY][string8 name]
 *     [u16 checksum][u16 mapId][u16 x][u16 y]
 *
 * Every integer is big-endian. Trailing bytes are not fields.
 *
 * ## The four words after the name
 *
 * The client stores them and echoes them back in 0x3F without reading them.
 * The document repo (binary-verified) calls them opaque handles, because the
 * client gives them no meaning. darkages-741-re names them from a retail
 * capture: checksum 0, then the destination map id and tile. Retail fills them
 * that way, and Midir reads them that way, for one purpose only: to pick the
 * point whose `mapId` is the next map of the route. A server that fills them
 * differently breaks that match, and the walker then falls back to the
 * position DA Walker recorded for the same hop.
 *
 * ## The screen position
 *
 * `screenX` and `screenY` are where the point is drawn on the 640 x 480 pane,
 * so they are also where to click. One caveat from the client binary: a point
 * whose name is in the client's image table is drawn from `<fieldName>.txt`
 * in the client's assets, and the wire position is ignored for it. The one
 * retail point both sources checked (Loures, 344 x 250) agrees with the wire.
 *
 * Sources: the document repo `server/0x2E-field-map.md` and
 * `client/0x3F-map-point-click.md`; darkages-741-re
 * `server/046-0x2e-field-map.md` and `client/063-0x3f-field-map.md`. Both
 * agree on the layout.
 */

/** One clickable point on the world map. */
export interface FieldMapPoint {
  /** Where the point is drawn on the 640 x 480 pane, and so where to click. */
  screenX: number
  screenY: number
  /** The label, for example `Loures`. */
  name: string
  /** The first echoed word. Zero in every retail capture. */
  checksum: number
  /** The map the point leads to, as retail fills it. */
  mapId: number
  /** The arrival tile on that map, as retail fills it. */
  x: number
  y: number
}

/** SFieldMap 0x2E, decoded. */
export interface FieldMap {
  kind: 'fieldMap'
  /** The client asset stem of the background image. */
  fieldName: string
  /** The index into `points` of the player's current location marker. */
  currentIndex: number
  points: FieldMapPoint[]
}

/** CFieldMapClick 0x3F: the four words of the chosen point, echoed. */
export interface FieldMapClick {
  kind: 'fieldMapClick'
  checksum: number
  mapId: number
  x: number
  y: number
}

/** Decode SFieldMap 0x2E. */
export function decodeFieldMap(body: Uint8Array): FieldMap {
  const reader = new PacketReader(body, 1)
  const fieldName = reader.string8()
  const count = reader.u8()
  const currentIndex = reader.u8()
  const points: FieldMapPoint[] = []
  for (let index = 0; index < count; index++) {
    const screenX = reader.u16()
    const screenY = reader.u16()
    const name = reader.string8()
    const checksum = reader.u16()
    const mapId = reader.u16()
    const x = reader.u16()
    const y = reader.u16()
    points.push({ screenX, screenY, name, checksum, mapId, x, y })
  }
  return { kind: 'fieldMap', fieldName, currentIndex, points }
}

/** Decode CFieldMapClick 0x3F. */
export function decodeFieldMapClick(body: Uint8Array): FieldMapClick {
  const reader = new PacketReader(body, 1)
  return {
    kind: 'fieldMapClick',
    checksum: reader.u16(),
    mapId: reader.u16(),
    x: reader.u16(),
    y: reader.u16()
  }
}
