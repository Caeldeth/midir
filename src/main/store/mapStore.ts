import { join } from 'node:path'
import { z } from 'zod'
import { createJsonStore, type JsonStore, type JsonStoreFailure } from '../jsonStore'

/**
 * The maps the wire has named and sized: `maps.json` (WP30).
 *
 * The map cache `lodNNNNN.map` has no header, so a map's size is not in the
 * file, and the imported world graph knows the size of 47 maps in 385. But a
 * cache file exists only for a map the player has visited, and every visit
 * sends `SMapSize 0x15` with the id, the name, and the size. So the size of
 * every map Midir can draw has crossed the wire at least once, and this store
 * keeps it. It is learned data, like the boards: small, per map id, and the
 * newest reading wins.
 */
export const MAPS_FILE = 'maps.json'

export interface MapSize {
  name: string
  width: number
  height: number
  /** Capture time of the packet the reading came from. */
  seenAtMs: number
}

export interface MapFile {
  maps: Record<string, MapSize>
}

const fileSchema = z.object({
  maps: z.record(
    z.string(),
    z.object({
      name: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      seenAtMs: z.number()
    })
  )
})

export type MapStore = JsonStore<MapFile>

export function emptyMapFile(): MapFile {
  return { maps: {} }
}

export function createMapStore(
  directory: string,
  onFailure?: (failure: JsonStoreFailure) => void
): MapStore {
  return createJsonStore<MapFile>({
    path: join(directory, MAPS_FILE),
    fallback: emptyMapFile,
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

/** `file` with one map's size from the wire; a newer reading replaces an older one. */
export function withMapSize(
  file: MapFile,
  mapId: number,
  size: { name: string; width: number; height: number },
  seenAtMs: number
): MapFile {
  const key = String(mapId)
  const existing = file.maps[key]
  if (existing !== undefined && existing.seenAtMs > seenAtMs) return file
  if (
    existing !== undefined &&
    existing.width === size.width &&
    existing.height === size.height &&
    existing.name === size.name
  ) {
    return file
  }
  return { maps: { ...file.maps, [key]: { ...size, seenAtMs } } }
}
