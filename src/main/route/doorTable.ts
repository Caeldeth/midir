/**
 * The retail client's door table: the 66 pairs of static tile ids a
 * `SStaticObjectState 0x32` can move between.
 *
 * Read from `Darkages.exe` (USDA 7.41) at `DAT_0068b8b0`, `.rdata` file offset
 * 0x28a4b0, 66 rows of two `u16`, on 2026-09-22; the document repo's 0x32 page
 * describes the table and this dump agrees with every row it cites (row 2 is
 * `2163 → 4519`, and `3159 / 3151` is the one reversed pair). Column 0 is the
 * form a non-zero state selects and column 1 the form state 0 selects; for the
 * 43 ordinary door rows that is closed and open. The client looks the object's
 * **current** tile id up in either column and moves it to the requested one,
 * so a door the map cache stores in its open form still resolves. An id in
 * neither column is not a door to the client, and the packet changes nothing:
 * Midir must change nothing too, or the walker would plan through a wall the
 * client still draws.
 *
 * Hybrasyl carries a longer, hand-audited table (81 doors). It is the server's
 * view, and Midir follows the client's, because the client's collision is the
 * one the character walks against.
 */
export const DOOR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1994, 1997],
  [2000, 2003],
  [2163, 4519],
  [2164, 4520],
  [2165, 4521],
  [2196, 4532],
  [2197, 4533],
  [2198, 4534],
  [2227, 4527],
  [2228, 4528],
  [2229, 4529],
  [2260, 4540],
  [2261, 4541],
  [2262, 4542],
  [2291, 4523],
  [2292, 4524],
  [2293, 4525],
  [2328, 4536],
  [2329, 4537],
  [2330, 4538],
  [2436, 2432],
  [2461, 2465],
  [2673, 2680],
  [2674, 2681],
  [2675, 2682],
  [2687, 2694],
  [2688, 2695],
  [2689, 2696],
  [2714, 2721],
  [2715, 2722],
  [2727, 2734],
  [2728, 2735],
  [2761, 2768],
  [2762, 2769],
  [2776, 2783],
  [2777, 2784],
  [2850, 2857],
  [2851, 2858],
  [2852, 2859],
  [2874, 2881],
  [2875, 2882],
  [2876, 2883],
  [2897, 2903],
  [2898, 2904],
  [2929, 2923],
  [2930, 2924],
  [2945, 2951],
  [2946, 2952],
  [2971, 2977],
  [2972, 2978],
  [2993, 2999],
  [2994, 3000],
  [3019, 3025],
  [3020, 3026],
  [3058, 3066],
  [3059, 3067],
  [3090, 3098],
  [3091, 3099],
  [3118, 3126],
  [3119, 3127],
  [3150, 3158],
  [3159, 3151],
  [3178, 3186],
  [3179, 3187],
  [3210, 3218],
  [3211, 3219]
]

/** Tile id to its row, from either column. */
const ROW_OF = new Map<number, readonly [number, number]>()
for (const pair of DOOR_PAIRS) {
  ROW_OF.set(pair[0], pair)
  ROW_OF.set(pair[1], pair)
}

/** True when the client would recognise `tileId` as a door panel. */
export function isDoorTile(tileId: number): boolean {
  return ROW_OF.has(tileId)
}

/**
 * The tile id a door shows after a `0x32` with `state`, or undefined when
 * `tileId` is in no row and the client leaves the object as it is.
 */
export function doorTileFor(tileId: number, state: number): number | undefined {
  const row = ROW_OF.get(tileId)
  if (row === undefined) return undefined
  return state === 0 ? row[1] : row[0]
}
