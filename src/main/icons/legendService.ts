import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DataArchive, EpfView, Palette, renderEpf } from '@eriscorp/dalib-ts'
import type { Logger } from '../log'
import { encodePng } from './png'
import { LEGEND_ICON_FRAMES } from '../../shared/labels'

/**
 * The legend badges, drawn from the player's own client (WP42).
 *
 * `SSelfLook 0x39` gives each legend mark an icon byte, and the client draws it
 * from `legends.epf` in `setoa.dat`: the byte is the frame index, and
 * `LegendListPane` loads the first eight frames. The sheet is 21 x 20 per frame,
 * the palette is `gui03.pal` from the same archive, and indexed pixel zero is
 * transparent (`darkages-741-re/docs/file-formats/epf.md`, "Character legend
 * badges"; the frames were rendered and checked against the eight names before
 * this shipped).
 *
 * This is the item icons' own pattern: read the client's files, render on
 * demand, cache the bytes, and answer "no icon" for everything that goes wrong.
 * A player with no Dark Ages folder set sees the mark's name instead.
 */

/** The archive a folder's badges are drawn from, or null when it will not open. */
export type OpenBadgeArchive = (folderPath: string) => Promise<BadgeRenderer | null>

export interface BadgeRenderer {
  /** One badge as PNG bytes, or null when the sheet has no such frame. */
  renderBadge(icon: number): Uint8Array | null
}

export interface LegendService {
  /** One badge as PNG bytes, or null when there is none to draw. */
  render(icon: number): Promise<Uint8Array | null>
  /**
   * The 256 colours a mark's `color` byte indexes, as CSS hex, or null when the
   * client's palette cannot be read.
   */
  palette(): Promise<string[] | null>
}

export interface LegendServiceDeps {
  getDarkAgesPath: () => string | undefined
  log: Logger
  /** Injected by tests. The default reads `setoa.dat` from the folder. */
  openBadgeArchive?: OpenBadgeArchive
  /** Injected by tests. The default reads `legend.dat`'s text palette. */
  openTextPalette?: (folderPath: string) => Promise<string[] | null>
}

/** The sheet the client's legend list draws from, and the palette it uses. */
export const BADGE_ARCHIVE = 'setoa.dat'
export const BADGE_SHEET = 'legends.epf'
export const BADGE_PALETTE = 'gui03.pal'

/**
 * Where a mark's **text** colour comes from, which is not where its badge comes
 * from: the `color` byte is an index into palette slot 0, which the client loads
 * from `legend.pal` in `legend.dat`, the same palette its rich text uses
 * (`darkages-741-re/docs/network/server/057-0x39-self-look.md`). Read against a
 * real client, index 1 is aqua, 32 white, 68 yellow, 88 blue, 128 green and 248
 * red — the six that Hybrasyl's own `LegendColor` names, which is a second
 * source agreeing.
 */
export const TEXT_ARCHIVE = 'legend.dat'
export const TEXT_PALETTE = 'legend.pal'

/** True for an icon byte the sheet has a frame for. 8 ("None") has none. */
export function hasBadge(icon: number): boolean {
  return Number.isInteger(icon) && icon >= 0 && icon < LEGEND_ICON_FRAMES
}

export function createBadgeRenderer(archive: DataArchive, log: Logger): BadgeRenderer {
  let sheet: EpfView | null | undefined
  let palette: Palette | null | undefined
  let loggedFailure = false

  return {
    renderBadge(icon) {
      if (!hasBadge(icon)) return null
      try {
        if (sheet === undefined) sheet = EpfView.fromArchive(BADGE_SHEET, archive)
        if (palette === undefined) {
          const entry = archive.get(BADGE_PALETTE)
          palette = entry === undefined ? null : Palette.fromEntry(entry)
        }
      } catch (error) {
        sheet = null
        palette = null
        if (!loggedFailure) {
          loggedFailure = true
          log.warn(
            'icons',
            `The legend badges would not load from ${BADGE_ARCHIVE}: ${String(error)}`
          )
        }
      }
      if (sheet === null || palette === null) return null

      const frame = sheet.tryGet(icon)
      if (frame === undefined) return null
      const rgba = renderEpf(frame, palette)
      if (rgba.width === 0 || rgba.height === 0) return null
      return encodePng(rgba.data, rgba.width, rgba.height)
    }
  }
}

/** Read the text palette out of a folder's `legend.dat`, as CSS hex. */
export function readTextPalette(archive: DataArchive): string[] | null {
  const entry = archive.get(TEXT_PALETTE)
  if (entry === undefined) return null
  const palette = Palette.fromEntry(entry)
  const hex = (value: number): string => value.toString(16).padStart(2, '0')
  const colours: string[] = []
  for (let index = 0; index < palette.length; index++) {
    const colour = palette.get(index)
    colours.push(`#${hex(colour.r)}${hex(colour.g)}${hex(colour.b)}`)
  }
  return colours
}

/** The default opener: read `setoa.dat` from a folder and parse it. */
function defaultOpener(log: Logger): OpenBadgeArchive {
  return async (folderPath) => {
    let bytes: Uint8Array
    try {
      bytes = await readFile(join(folderPath, BADGE_ARCHIVE))
    } catch {
      return null
    }
    try {
      return createBadgeRenderer(DataArchive.fromBuffer(bytes), log)
    } catch {
      return null
    }
  }
}

/** The default palette opener: read `legend.dat` and take its text palette. */
function defaultPaletteOpener(): (folderPath: string) => Promise<string[] | null> {
  return async (folderPath) => {
    try {
      const bytes = await readFile(join(folderPath, TEXT_ARCHIVE))
      return readTextPalette(DataArchive.fromBuffer(bytes))
    } catch {
      return null
    }
  }
}

export function createLegendService(deps: LegendServiceDeps): LegendService {
  const { getDarkAgesPath, log } = deps
  const open = deps.openBadgeArchive ?? defaultOpener(log)
  const openPalette = deps.openTextPalette ?? defaultPaletteOpener()
  // One palette at a time, keyed by its folder, like the badge archive.
  let palettePath: string | undefined
  let paletteOpening: Promise<string[] | null> | undefined

  // One archive at a time, keyed by its folder. A path change resets it.
  let openPath: string | undefined
  let opening: Promise<BadgeRenderer | null> | undefined
  const loggedFailures = new Set<string>()
  // Rendered bytes by icon byte. `null` marks one that draws nothing, so a
  // missing frame is not retried on every mark in the list.
  const pngCache = new Map<number, Uint8Array | null>()

  return {
    async render(icon) {
      const path = getDarkAgesPath()
      if (path === undefined || path === '') return null
      // A mark with no badge needs no archive, which keeps the open lazy.
      if (!hasBadge(icon)) return null

      if (openPath !== path) {
        openPath = path
        opening = open(path)
        pngCache.clear()
      }

      const cached = pngCache.get(icon)
      if (cached !== undefined) return cached

      const archive = await opening!
      if (archive === null) {
        if (!loggedFailures.has(path)) {
          loggedFailures.add(path)
          log.warn(
            'icons',
            `Could not open ${BADGE_ARCHIVE} under ${path}. The legend badges are off.`
          )
        }
        return null
      }

      const png = archive.renderBadge(icon)
      pngCache.set(icon, png)
      return png
    },

    async palette() {
      const path = getDarkAgesPath()
      if (path === undefined || path === '') return null
      if (palettePath !== path) {
        palettePath = path
        paletteOpening = openPalette(path)
      }
      return paletteOpening!
    }
  }
}
