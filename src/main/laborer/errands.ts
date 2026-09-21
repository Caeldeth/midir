import type { Errand } from '../../shared/types'

/**
 * The built-in errands the Laborer can run.
 *
 * An errand is data, not code: a name, an NPC to walk to, and a list of steps,
 * each of which expects a dialog and answers it. A new errand is a new entry
 * here, not new logic. Each NPC is its own errand, so the player picks one and
 * runs it.
 *
 * ## What each entry knows, and what still needs a live capture
 *
 * The `destination` and the `npcName` are known. The tile to stand on is known
 * for the six Mileth and Rucesion errands (Sabrael's capture of 2026-09-21):
 *
 *  - `standTile` — the spot to stand on to talk to the NPC, in front of the
 *    counter or the desk; the walker finishes on it. `npcTile` is the other
 *    form, the NPC's own tile, which the walker finishes beside. Without either
 *    the walker reaches the map but not the NPC.
 *  - `steps` — the pursuit id and the row text for each dialog step. Still a
 *    capture away. With no steps, the Laborer walks to the NPC and stops.
 *
 * A placeholder is safe: the matcher refuses any dialog whose pursuit and row
 * text do not match, so a wrong value stops the run rather than acting on it.
 *
 * ## Destinations the world graph does not reach yet
 *
 * `destination` is a node name the route graph resolves. Every errand building
 * is a node and routes: the Mileth and Rucesion ones from Sabrael's captures,
 * and Piet, Abel, and Undine banks from the Hybrasyl world xml (`Old*.xml`,
 * which Sabrael says is spot-on for retail, and which agrees with the .dat
 * wherever both speak; `scripts/worldmap-overrides.json` carries each with its
 * source).
 *
 * Cassidy is in Mileth Bank (map 135), not Rucesion's: the July capture and
 * the world xml both put her there.
 */
export const BUILTIN_ERRANDS: Errand[] = [
  // --- Clout: one errand for each NPC ------------------------------------
  {
    name: 'Clout — Maria (Rucesion Inn)',
    destination: 'Rucesion Inn',
    standTile: { x: 5, y: 6 },
    npcName: 'Maria',
    steps: []
  },
  {
    name: 'Clout — Angelo (Rucesion Bank)',
    destination: 'Rucesion Bank',
    standTile: { x: 5, y: 8 },
    npcName: 'Angelo',
    steps: []
  },
  {
    name: 'Clout — Eduardo (Rucesion Town Hall)',
    destination: 'Rucesion Town Hall',
    standTile: { x: 1, y: 11 },
    npcName: 'Eduardo',
    steps: []
  },
  {
    name: 'Clout — Aingeal (Mileth Tavern)',
    destination: 'Mileth Tavern',
    standTile: { x: 9, y: 5 },
    npcName: 'Aingeal',
    steps: []
  },
  {
    name: 'Clout — Riona (Mileth Inn)',
    destination: 'Mileth Inn',
    standTile: { x: 6, y: 4 },
    npcName: 'Riona',
    steps: []
  },
  {
    name: 'Clout — Arilan (Mileth Town Hall)',
    destination: 'Mileth Town Hall',
    standTile: { x: 2, y: 11 },
    npcName: 'Arilan',
    steps: []
  },

  // --- Labor: one errand for each bank NPC -------------------------------
  {
    name: 'Labor — Antonio (Rucesion Bank)',
    destination: 'Rucesion Bank',
    standTile: { x: 5, y: 8 },
    npcName: 'Antonio',
    steps: []
  },
  {
    name: 'Labor — Cassidy (Mileth Bank)',
    destination: 'Mileth Bank',
    standTile: { x: 6, y: 6 },
    npcName: 'Cassidy',
    steps: []
  },
  // The three other-town storages are the same 12 x 12 room as Rucesion's,
  // with the NPC on the same tile (3,4), so Rucesion's stand tile carries over.
  {
    name: 'Labor — Jilt (Piet Bank)',
    destination: 'Piet Bank',
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 },
    npcName: 'Jilt',
    steps: []
  },
  {
    name: 'Labor — Lamont (Abel Bank)',
    destination: 'Abel Bank',
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 },
    npcName: 'Lamont',
    steps: []
  },
  {
    name: 'Labor — Argus (Undine Bank)',
    destination: 'Undine Bank',
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 },
    npcName: 'Argus',
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
