// The icon service. It turns a sprite id and a colour into PNG bytes, opening
// the game's `legend.dat` on the first request and never at startup.
//
// Icons are an enhancement over a record that is already complete. So every
// failure here is silence: no client path, a wrong path, a missing sheet, a
// frame past the end, or an archive that will not open all return `null`, and
// the caller answers the request with a 404. An `<img>` for a 404 draws
// nothing. A failure to open one archive is logged once, not once per icon.

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  ColorTable,
  DataArchive,
  EpfView,
  Palette,
  PaletteLookup,
  renderEpf
} from '@eriscorp/dalib-ts'
import type { Logger } from '../log'
import { encodePng } from './png'
import { itemSheetFor, itemSheetName, itemSpriteId, iconCacheKey } from './itemSprite'

/** A rendered frame, the shape dalib-ts `renderEpf` returns. */
export interface RenderedFrame {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/**
 * Draws one item frame from an already-open archive. The real one wraps
 * dalib-ts; a test passes a fake, so the service is provable with no game files.
 */
export interface ArchiveRenderer {
  renderFrame(
    fileId: number,
    frameId: number,
    spriteId: number,
    color: number
  ): RenderedFrame | null
}

/**
 * Opens `legend.dat` in a folder and returns a renderer, or `null` when the
 * folder holds no readable `legend.dat`.
 */
export type OpenLegendArchive = (folderPath: string) => Promise<ArchiveRenderer | null>

export interface IconServiceDeps {
  /** The Dark Ages install folder, or `undefined` when icons are off. */
  getDarkAgesPath: () => string | undefined
  log: Logger
  /** The archive opener. Defaults to the dalib-ts one. */
  openLegendArchive?: OpenLegendArchive
}

export interface IconService {
  /** PNG bytes for one item icon, or `null` when there is no icon to show. */
  render(spriteId: number, color: number): Promise<Uint8Array | null>
}

/**
 * The dalib-ts archive renderer for an open `legend.dat`.
 *
 * It caches one `EpfView` for each sheet, one `PaletteLookup`, and one dye
 * `ColorTable`, so a sheet is read once however many of its icons are drawn.
 * Item palettes come from `itempal*.tbl` and `item*.pal`; the dye ramps come
 * from `color0.tbl`. The dye replaces palette indices 98 to 103, and colour 0
 * means no dye.
 *
 * Every failure is `null` and silent, with one exception: a palette lookup that
 * will not build is an archive-level failure — icons are on, yet nothing draws
 * — so it is logged once. That is the one silent case that is otherwise
 * impossible to tell from an empty sheet.
 */
export function createLegendRenderer(archive: DataArchive, log: Logger): ArchiveRenderer {
  const sheets = new Map<number, EpfView | null>()
  let paletteLookup: PaletteLookup | null | undefined
  let dyeTable: ColorTable | null | undefined
  let loggedPaletteFailure = false

  function sheet(fileId: number): EpfView | null {
    const cached = sheets.get(fileId)
    if (cached !== undefined) return cached
    const entry = archive.get(itemSheetName(fileId))
    const view = entry === undefined ? null : EpfView.fromEntry(entry)
    sheets.set(fileId, view)
    return view
  }

  function palettes(): PaletteLookup | null {
    if (paletteLookup === undefined) {
      try {
        paletteLookup = PaletteLookup.fromArchivePatterns('itempal', 'item', archive)
      } catch (error) {
        paletteLookup = null
        if (!loggedPaletteFailure) {
          loggedPaletteFailure = true
          log.warn('icons', `The item palette would not build from legend.dat: ${String(error)}`)
        }
      }
    }
    return paletteLookup
  }

  function dyes(): ColorTable | null {
    if (dyeTable === undefined) {
      try {
        dyeTable = ColorTable.fromArchive('color0', archive)
      } catch {
        dyeTable = null
      }
    }
    return dyeTable
  }

  return {
    renderFrame(fileId, frameId, spriteId, color) {
      const view = sheet(fileId)
      const frame = view?.tryGet(frameId)
      if (frame === undefined || frame === null) return null

      const lookup = palettes()
      if (lookup === null) return null
      let palette: Palette
      try {
        palette = lookup.getPaletteForId(spriteId)
      } catch {
        return null
      }

      if (color > 0) {
        const entry = dyes()?.get(color)
        if (entry !== undefined) palette = palette.dye(entry)
      }

      const rgba = renderEpf(frame, palette)
      return { data: rgba.data, width: rgba.width, height: rgba.height }
    }
  }
}

/** The default opener: read `legend.dat` from a folder and parse it. */
function defaultOpener(log: Logger): OpenLegendArchive {
  return async (folderPath) => {
    let bytes: Uint8Array
    try {
      bytes = await readFile(join(folderPath, 'legend.dat'))
    } catch {
      return null
    }
    try {
      return createLegendRenderer(DataArchive.fromBuffer(bytes), log)
    } catch {
      return null
    }
  }
}

export function createIconService(deps: IconServiceDeps): IconService {
  const { getDarkAgesPath, log } = deps
  const open = deps.openLegendArchive ?? defaultOpener(log)

  // One archive is open at a time, keyed by its folder. A path change resets it.
  let openPath: string | undefined
  let opening: Promise<ArchiveRenderer | null> | undefined
  // Paths already logged as failed, so a broken path logs once, not once per icon.
  const loggedFailures = new Set<string>()
  // A draw that throws logs once, not once per icon.
  let loggedDrawFailure = false
  // Rendered PNG bytes, keyed by (masked sprite id, colour). `null` marks a key
  // that produced no icon, so a missing frame is not retried on every render.
  const pngCache = new Map<string, Uint8Array | null>()

  return {
    async render(spriteId, color) {
      const path = getDarkAgesPath()
      if (path === undefined || path === '') return null

      // A sprite id with no icon needs no archive at all, so this stays above
      // the open below and keeps the "first icon request" laziness.
      if (itemSpriteId(spriteId) === 0) return null

      // A folder change invalidates everything the previous archive drew, so
      // detect it before the cache lookup below. This runs synchronously, so
      // concurrent requests all share the one new open.
      if (openPath !== path) {
        openPath = path
        opening = open(path)
        pngCache.clear()
      }

      const key = iconCacheKey(spriteId, color)
      const cached = pngCache.get(key)
      if (cached !== undefined) return cached

      const archive = await opening!
      if (archive === null) {
        if (!loggedFailures.has(path)) {
          loggedFailures.add(path)
          log.warn('icons', `Could not open legend.dat under ${path}. Item icons are off.`)
        }
        return null
      }

      const sheet = itemSheetFor(spriteId)
      if (sheet === null) {
        pngCache.set(key, null)
        return null
      }

      let png: Uint8Array | null = null
      try {
        const frame = archive.renderFrame(
          sheet.fileId,
          sheet.frameId,
          itemSpriteId(spriteId),
          color
        )
        if (frame !== null && frame.width > 0 && frame.height > 0) {
          png = encodePng(frame.data, frame.width, frame.height)
        }
      } catch (error) {
        // A malformed sheet must not throw out of the request. It is one more
        // way to have no icon, logged once so it cannot spam.
        if (!loggedDrawFailure) {
          loggedDrawFailure = true
          log.warn('icons', `Could not draw an item icon: ${String(error)}`)
        }
        png = null
      }

      pngCache.set(key, png)
      return png
    }
  }
}
