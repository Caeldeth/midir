// Pure item-sprite arithmetic. No archive, no disk, no Electron. The unit tests
// exercise this file with no game files present, so nothing here may open one.
//
// The recipe matches brigid's PanelSpriteRepository.GetItemSprite and the
// document repo's item-asset scoping (a scan of the 13,882 legacy items):
//
//   spriteId &= 0x7FFF       // the server sets 0x8000 as an "item display" flag
//   fileId   = ceil(spriteId / 266)
//   frameId  = (spriteId - 1) % 266
//   sheet    = item{fileId:D3}.epf   (item001.epf, item002.epf, ...)
//
// A spriteId of 0 has no icon.

/** How many item frames one item sheet holds. */
export const ITEMS_PER_FILE = 266

/** The "item display" flag the server sets on a sprite id. It is not part of the id. */
export const ITEM_DISPLAY_FLAG = 0x8000

/** The sprite id with the display flag removed. */
export function itemSpriteId(spriteId: number): number {
  return spriteId & 0x7fff
}

/**
 * The sheet file and frame for an item sprite id, or `null` when the id has no
 * icon.
 *
 * The `0x8000` display flag is stripped here and nowhere else. The record keeps
 * what the server sent; the flag is a drawing concern.
 */
export function itemSheetFor(spriteId: number): { fileId: number; frameId: number } | null {
  const id = itemSpriteId(spriteId)
  if (id === 0) return null
  const fileId = Math.ceil(id / ITEMS_PER_FILE)
  const frameId = (id - 1) % ITEMS_PER_FILE
  return { fileId, frameId }
}

/** The sheet entry name for a file id, for example 1 to "item001.epf". */
export function itemSheetName(fileId: number): string {
  return `item${String(fileId).padStart(3, '0')}.epf`
}

/**
 * The cache key for one rendered icon. The masked sprite id and the colour are
 * the whole identity of the picture, so two colours of one sprite are two keys
 * and the display flag never changes the key.
 */
export function iconCacheKey(spriteId: number, color: number): string {
  return `${itemSpriteId(spriteId)}:${color}`
}
