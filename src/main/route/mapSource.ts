import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DataArchive, SotpFile } from '@eriscorp/dalib-ts'
import type { Logger } from '../log'
import { buildMapGrid, type Collision, type MapGrid } from './mapGrid'

/**
 * The source of a map's passability, read from the game's own files.
 *
 * Two files, both static game data, both read the same way `legend.dat` is read
 * for icons: never memory, never a write. The tile cache `maps\lodNNNNN.map`
 * gives the tiles; `sotp.dat` inside `ia.dat` gives the collision flags. The
 * walker asks for a grid by map id, with the width and height from the live
 * SMapSize on the wire.
 *
 * Every failure here is a null, not a throw: no game folder, a map the client
 * has never visited, or an archive that will not open all mean "no grid", and
 * the walker refuses to move with a reason. A grid is required to move, so a
 * missing one is a stop, not a silent walk into a wall.
 */
export interface MapProvider {
  /** The passability of a map, or null when it cannot be read. */
  gridFor(mapId: number, width: number, height: number): Promise<MapGrid | null>
}

export interface MapSourceOptions {
  /**
   * The Dark Ages install folder, the one that holds `ia.dat` and `maps\`, or
   * undefined when none is set. It is a getter, because the folder is chosen in
   * Settings and can change without a restart.
   */
  gameFolder: () => string | undefined
  log: Logger
  /** Read a file's bytes. Injected by tests. */
  readMapFile?: (path: string) => Promise<Uint8Array>
  /** Load the SOTP collision table. Injected by tests. */
  loadCollision?: (gameFolder: string) => Promise<Collision | null>
}

/** The SOTP file, wrapped as the collision query the grid needs. */
function collisionFromSotp(sotp: SotpFile): Collision {
  return { collisionFor: (tileId: number) => sotp.getCollision(tileId) }
}

/** The default SOTP loader: open `ia.dat` and read `sotp.dat` from it. */
async function defaultLoadCollision(gameFolder: string): Promise<Collision | null> {
  const archive = await DataArchive.fromFile(join(gameFolder, 'ia.dat'))
  const sotp = SotpFile.fromArchive(archive, 'sotp.dat')
  return collisionFromSotp(sotp)
}

async function defaultReadMapFile(path: string): Promise<Uint8Array> {
  const buffer = await readFile(path)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function createMapSource(options: MapSourceOptions): MapProvider {
  const { gameFolder, log } = options
  const readMapFile = options.readMapFile ?? defaultReadMapFile
  const loadCollision = options.loadCollision ?? defaultLoadCollision

  // The collision table is one file for every map, so it is loaded once and
  // kept. It is keyed by the folder it came from, so a folder changed in
  // Settings reloads it. A null means the load failed and every grid request
  // fails with it.
  let cachedFolder: string | undefined
  let collisionPromise: Promise<Collision | null> | undefined

  function collision(folder: string): Promise<Collision | null> {
    if (collisionPromise === undefined || cachedFolder !== folder) {
      cachedFolder = folder
      collisionPromise = loadCollision(folder).catch((error) => {
        log.warn('walker', `Could not load sotp.dat from ia.dat: ${String(error)}.`)
        return null
      })
    }
    return collisionPromise
  }

  async function gridFor(mapId: number, width: number, height: number): Promise<MapGrid | null> {
    const folder = gameFolder()
    if (folder === undefined) {
      log.warn('walker', 'No Dark Ages folder is set, so no map passability is available.')
      return null
    }
    const sotp = await collision(folder)
    if (sotp === null) return null
    let bytes: Uint8Array
    try {
      bytes = await readMapFile(join(folder, 'maps', `lod${mapId}.map`))
    } catch (error) {
      log.warn('walker', `No map cache for map ${mapId}: ${String(error)}.`)
      return null
    }
    try {
      return buildMapGrid(bytes, width, height, sotp)
    } catch (error) {
      log.warn('walker', `Map ${mapId} cache does not fit ${width}x${height}: ${String(error)}.`)
      return null
    }
  }

  return { gridFor }
}
