import type { Errand } from '../../shared/types'

/**
 * The built-in errands the Laborer can run.
 *
 * An errand is data, not code: a name, an NPC to walk to, and a list of steps,
 * each of which expects a dialog and answers it. A new errand is a new entry
 * here, not new logic.
 *
 * ## The values below need a live capture
 *
 * The pursuit ids, the row text, the NPC tile, and the map are facts of one
 * live conversation. They are filled from a recorded session of the errand, or
 * from the GUI check, not guessed. Until then the entry below is a **placeholder
 * with the right shape**: it is safe to keep, because the matcher refuses any
 * dialog whose pursuit and row text do not match, so a wrong value stops the run
 * rather than acting on it. Replace the placeholder values when the capture is
 * in hand (WP17 PR2 GUI check).
 */
export const BUILTIN_ERRANDS: Errand[] = [
  {
    name: 'Clout (placeholder — fill from a capture)',
    // Mileth Commons is map 3025; the NPC tile is a placeholder until captured.
    destination: 3025,
    npcTile: { x: 0, y: 0 },
    npcName: '',
    steps: []
  }
]

/** Every built-in errand, in order. */
export function builtinErrands(): Errand[] {
  return BUILTIN_ERRANDS
}

/** Find one built-in errand by name, or undefined when there is none. */
export function findErrand(name: string): Errand | undefined {
  return BUILTIN_ERRANDS.find((errand) => errand.name === name)
}
