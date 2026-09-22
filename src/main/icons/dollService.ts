import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  ColorTable,
  DataArchive,
  EpfView,
  Palette,
  PaletteLookup,
  renderEpf,
  type ColorTableEntry
} from '@eriscorp/dalib-ts'
import type { Logger } from '../log'
import type { DollAppearance } from '../../shared/doll'
import { composeDoll, dollLayers, type DollFrameSource, type DollLayer } from './doll'
import type { RenderedFrame } from './iconService'
import { encodePng } from './png'

/**
 * The doll service: the khan archives behind `composeDoll` (WP37).
 *
 * The client keeps its character art in eleven archives beside `legend.dat`:
 * `khanpal.dat` (every palette and palette table), and five pairs
 * `khan{m|w}{ad|eh|im|ns|tz}.dat`, one per gender, each holding the sheets
 * whose letter falls in its range. Which palette table a letter reads is the
 * client's, as Brigid carries it: `a`, `b`, `n` read `palb`; `c`, `g`, `j`
 * `palc`; `e`, `f`, `h`, `i`, `l`, `u`, `w` their own; `p` and `s` `palp`.
 * The body's skin (`m`) and the face (`o`) do not read a table: `palm` is one
 * palette per skin colour. The dye ramps are `color0.tbl` in `legend.dat`,
 * replacing palette indices 98 to 103 where the sheet's palette still holds
 * the undyed placeholders there; a palette that does not is not dyeable.
 *
 * Like the icons, every failure here is silence: no folder, a missing
 * archive, a missing sheet, or a frame past the end returns `null`, and the
 * Equip screen keeps its placeholder. A failure to open an archive is logged
 * once.
 */
export interface DollServiceDeps {
  getDarkAgesPath: () => string | undefined
  log: Logger
  /** Read one archive by file name from the game folder. Injected by tests. */
  openArchive?: (folder: string, fileName: string) => Promise<DataArchive | null>
}

export interface DollService {
  /** PNG bytes for the doll, or `null` when there is no doll to show. */
  render(appearance: DollAppearance): Promise<Uint8Array | null>
}

/** The archive each sheet letter lives in, by gender. */
export function khanArchiveFor(letter: string, isMale: boolean): string {
  const gender = isMale ? 'm' : 'w'
  if (letter >= 'a' && letter <= 'd') return `khan${gender}ad.dat`
  if (letter >= 'e' && letter <= 'h') return `khan${gender}eh.dat`
  if (letter >= 'i' && letter <= 'm') return `khan${gender}im.dat`
  if (letter >= 'n' && letter <= 's') return `khan${gender}ns.dat`
  if (letter >= 't' && letter <= 'z') return `khan${gender}tz.dat`
  return `khan${gender}ad.dat`
}

/** The palette table a sheet letter reads. */
export function paletteTableFor(letter: string): string {
  switch (letter) {
    case 'a':
    case 'b':
    case 'n':
      return 'palb'
    case 'c':
    case 'g':
    case 'j':
      return 'palc'
    case 'e':
      return 'pale'
    case 'f':
      return 'palf'
    case 'h':
      return 'palh'
    case 'i':
      return 'pali'
    case 'l':
      return 'pall'
    case 'p':
    case 's':
      return 'palp'
    case 'u':
      return 'palu'
    case 'w':
      return 'palw'
    default:
      return 'palb'
  }
}

/** The sheet's entry name: gender, letter, the sprite in three digits, the animation. */
export function sheetName(layer: DollLayer, anim: string): string {
  return `${layer.isMale ? 'm' : 'w'}${layer.letter}${String(layer.sprite).padStart(3, '0')}${anim}.epf`
}

/**
 * The khan palette table's gender override. dalib-ts declares these as a
 * const enum, which does not survive a bundler, so the values are written
 * here: -1 selects the male column, -2 the female.
 */
const OVERRIDE_MALE = -1
const OVERRIDE_FEMALE = -2

/** True when the palette still holds the undyed placeholders, so a dye applies. */
function isDyeable(palette: Palette, placeholders: ColorTableEntry | undefined): boolean {
  if (placeholders === undefined) return false
  for (let i = 0; i < placeholders.colors.length; i++) {
    const held = palette.get(98 + i)
    const expected = placeholders.colors[i]!
    if (held.r !== expected.r || held.g !== expected.g || held.b !== expected.b) return false
  }
  return true
}

async function defaultOpenArchive(folder: string, fileName: string): Promise<DataArchive | null> {
  try {
    const bytes = await readFile(join(folder, fileName))
    return DataArchive.fromBuffer(bytes)
  } catch {
    return null
  }
}

/** The frame source, with the archives it needs opened ahead of a composition. */
export interface KhanFrameSource extends DollFrameSource {
  prepare(layers: DollLayer[]): Promise<void>
}

/**
 * Build the frame source over one game folder's archives. Everything is
 * opened on first use and kept; a folder change in Settings builds a new one.
 */
export async function createKhanFrameSource(
  folder: string,
  openArchive: (folder: string, fileName: string) => Promise<DataArchive | null>,
  log: Logger
): Promise<KhanFrameSource | null> {
  const khanpal = await openArchive(folder, 'khanpal.dat')
  if (khanpal === null) {
    log.warn('doll', `No readable khanpal.dat in ${folder}; the doll is off.`)
    return null
  }
  const archives = new Map<string, DataArchive | null>()
  const sheets = new Map<string, EpfView | null>()
  const lookups = new Map<string, PaletteLookup | null>()
  let bodyPalettes: Map<number, Palette> | null | undefined
  let dyes: ColorTable | null | undefined

  async function archive(name: string): Promise<DataArchive | null> {
    const cached = archives.get(name)
    if (cached !== undefined) return cached
    const opened = await openArchive(folder, name)
    if (opened === null) log.warn('doll', `No readable ${name} in ${folder}.`)
    archives.set(name, opened)
    return opened
  }

  function lookup(letter: string): PaletteLookup | null {
    const table = paletteTableFor(letter)
    const cached = lookups.get(table)
    if (cached !== undefined) return cached
    let built: PaletteLookup | null
    try {
      built = PaletteLookup.fromArchive(table, khanpal!)
    } catch (error) {
      built = null
      log.warn('doll', `The ${table} palette would not build from khanpal.dat: ${String(error)}`)
    }
    lookups.set(table, built)
    return built
  }

  function skinPalettes(): Map<number, Palette> | null {
    if (bodyPalettes === undefined) {
      try {
        bodyPalettes = Palette.fromArchive('palm', khanpal!)
      } catch (error) {
        bodyPalettes = null
        log.warn('doll', `The body palettes would not build from khanpal.dat: ${String(error)}`)
      }
    }
    return bodyPalettes
  }

  // The dye table is opened lazily with legend.dat, the icons' archive.
  async function dyeTable(): Promise<ColorTable | null> {
    if (dyes === undefined) {
      const legend = await archive('legend.dat')
      try {
        dyes = legend === null ? null : ColorTable.fromArchive('color0', legend)
      } catch {
        dyes = null
      }
    }
    return dyes
  }

  // The sheets and archives are opened ahead of composition, because the
  // compositor is synchronous: `prepare` walks the layers once, then `frame`
  // answers from the caches.
  const source: KhanFrameSource = {
    async prepare(layers) {
      await dyeTable()
      for (const layer of layers) {
        const name = sheetName(layer, '01')
        if (sheets.has(name)) continue
        const dat = await archive(khanArchiveFor(layer.letter, layer.isMale))
        const entry = dat?.get(name)
        let view: EpfView | null = null
        try {
          view = entry === undefined ? null : EpfView.fromEntry(entry)
        } catch (error) {
          log.warn('doll', `Sheet ${name} would not open: ${String(error)}`)
        }
        sheets.set(name, view)
      }
    },
    frame(layer, anim, frameIndex): RenderedFrame | null {
      const view = sheets.get(sheetName(layer, anim))
      const frame = view?.tryGet(frameIndex)
      if (frame === undefined || frame === null) return null

      let palette: Palette | undefined
      if (layer.bodyPalette) {
        palette = skinPalettes()?.get(layer.color)
      } else {
        const table = lookup(layer.letter)
        if (table === null) return null
        try {
          // Brigid's rule: a number at or above 1000 is the same palette,
          // without the luminance blending the general lookup would add.
          let number = table.table.getPaletteNumber(
            layer.sprite,
            layer.isMale ? OVERRIDE_MALE : OVERRIDE_FEMALE
          )
          if (number >= 1000) number -= 1000
          palette = table.palettes.get(number)
        } catch {
          return null
        }
        if (palette !== undefined && layer.color > 0 && dyes !== null && dyes !== undefined) {
          const entry = dyes.get(layer.color)
          if (entry !== undefined && isDyeable(palette, dyes.get(0))) palette = palette.dye(entry)
        }
      }
      if (palette === undefined) return null
      const rgba = renderEpf(frame, palette)
      return { data: rgba.data, width: rgba.width, height: rgba.height }
    }
  }
  return source
}

export function createDollService(deps: DollServiceDeps): DollService {
  const openArchive = deps.openArchive ?? defaultOpenArchive
  let sourceFolder: string | undefined
  let sourcePromise: Promise<KhanFrameSource | null> | undefined

  function sourceFor(folder: string): Promise<KhanFrameSource | null> {
    if (sourcePromise === undefined || sourceFolder !== folder) {
      sourceFolder = folder
      sourcePromise = createKhanFrameSource(folder, openArchive, deps.log)
    }
    return sourcePromise
  }

  return {
    async render(appearance) {
      const folder = deps.getDarkAgesPath()
      if (folder === undefined) return null
      const source = await sourceFor(folder)
      if (source === null) return null
      const layers = dollLayers(appearance)
      if (layers === null) return null
      await source.prepare(Object.values(layers))
      const doll = composeDoll(appearance, source)
      if (doll === null) return null
      return encodePng(doll.data, doll.width, doll.height)
    }
  }
}
