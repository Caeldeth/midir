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
}

export interface LegendServiceDeps {
  getDarkAgesPath: () => string | undefined
  log: Logger
  /** Injected by tests. The default reads `setoa.dat` from the folder. */
  openBadgeArchive?: OpenBadgeArchive
}

/** The sheet the client's legend list draws from, and the palette it uses. */
export const BADGE_ARCHIVE = 'setoa.dat'
export const BADGE_SHEET = 'legends.epf'
export const BADGE_PALETTE = 'gui03.pal'

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

export function createLegendService(deps: LegendServiceDeps): LegendService {
  const { getDarkAgesPath, log } = deps
  const open = deps.openBadgeArchive ?? defaultOpener(log)

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
    }
  }
}
