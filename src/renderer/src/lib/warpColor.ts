import type { MapWarp } from '@shared/map'

/**
 * The colour of a warp tile on the Map tab, as a palette path (HTOO-572).
 *
 * The mark is drawn over the open tiles, which are `background.paper`, so each
 * colour must hold 3:1 there in every theme. A candidate warp is only an
 * outline in this colour, so the outline must hold 3:1 too.
 *
 * - A warp behind a dialog is `warning.main`.
 * - A warp from the wire or from an edit by hand is `success.main`.
 * - A world data warp is `info.main`.
 * - An imported warp is `text.primary`. It was `secondary.main`, the title bar's
 *   colour, which is a fill for the bar only: on paper it is 1.07:1 in
 *   dubhaimid and 1.28:1 in chadul. The walls are `text.secondary`, so a warp
 *   cannot take that colour.
 *
 * `midirMarks.test.ts` measures each colour in each theme.
 */
export function warpColor(warp: Pick<MapWarp, 'via' | 'source'>): string {
  if (warp.via === 'dialog') return 'warning.main'
  if (warp.source === 'learned' || warp.source === 'curated') return 'success.main'
  if (warp.source === 'xml') return 'info.main'
  return 'text.primary'
}

/**
 * The border of the picked warp. A selection mark is `primary.main`, the token
 * that holds on the page and on paper. It was `text.primary`, which is now the
 * fill of an imported warp, so the border did not show on one.
 */
export const PICKED_WARP_BORDER = 'primary.main'
