/**
 * Where a map tile is drawn on the game's 640 x 480 screen, relative to the
 * player's own tile.
 *
 * The client draws the map isometrically around the player: a tile is 56 px
 * wide and 27 px tall, one step east goes half a tile right and half a tile
 * down, one step south goes half a tile left and half a tile down. So the
 * screen offset of a tile (dx, dy) from the player is
 *
 *   x = (dx - dy) * 28
 *   y = (dx + dy) * 13.5
 *
 * and the player's own tile is drawn at a fixed screen point, the view
 * centre: the middle of the world window. The tile geometry and the window
 * are the client's; where in the tile the sprite is hit is measured: the pane
 * watcher logs each hand click that opens an NPC dialog with the player's
 * tile at the time, and the NPC's tile is known from the errand, so one such
 * click gives the centre the click implies, and the run logs it.
 *
 * A creature is clicked on its sprite, which stands on the tile and rises
 * above it, so the click aims a little above the tile's centre.
 */

/** The tile's size on screen, in pixels. */
export const TILE_WIDTH = 56
export const TILE_HEIGHT = 27

/**
 * Where the player's own tile is drawn: the centre of the world window, which
 * is the `MAP` region of the client's main layout (`_nbk_s.txt` in
 * `setoa.dat`: 3 3 619 311), not of the whole client. Sabrael: the character
 * is always the centre of the world window. A measured click refines it.
 */
export const VIEW_CENTRE = { x: 311, y: 157 }

/** How far above the tile's centre a creature's body is clicked. */
export const BODY_LIFT = 12

export interface Tile {
  x: number
  y: number
}

export interface Point {
  x: number
  y: number
}

/** The screen offset of `tile` from the player's `own` tile. */
export function tileOffset(own: Tile, tile: Tile): Point {
  const dx = tile.x - own.x
  const dy = tile.y - own.y
  return { x: ((dx - dy) * TILE_WIDTH) / 2, y: ((dx + dy) * TILE_HEIGHT) / 2 }
}

/** The screen point to click a creature standing on `tile`, seen from `own`. */
export function creaturePoint(own: Tile, tile: Tile, centre: Point = VIEW_CENTRE): Point {
  const offset = tileOffset(own, tile)
  return { x: Math.round(centre.x + offset.x), y: Math.round(centre.y + offset.y - BODY_LIFT) }
}

/**
 * The view centre a hand click implies: the click's screen point, less the
 * offset of the clicked tile from the player's, plus the body lift.
 */
export function centreFromClick(click: Point, own: Tile, tile: Tile): Point {
  const offset = tileOffset(own, tile)
  return { x: Math.round(click.x - offset.x), y: Math.round(click.y - offset.y + BODY_LIFT) }
}
