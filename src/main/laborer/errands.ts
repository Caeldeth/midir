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
 * `destination` is a node name the route graph resolves. Rucesion Inn, Rucesion
 * Bank, Rucesion Town Hall, Mileth Inn, Mileth Tavern, and Mileth Town Hall are
 * nodes (the last two from `scripts/worldmap-overrides.json`); the two Mileth
 * additions still lack the door tile on the Mileth side, so they resolve but
 * do not route until it is captured. Piet Bank, Abel Bank, and Undine Bank
 * are not nodes yet (WP33). The towns themselves are reachable: the walker
 * crosses the world map. The name is written here as the building it should
 * resolve to, so the errand works the moment its node routes.
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
    name: 'Labor — Cassidy (Rucesion Bank)',
    destination: 'Rucesion Bank',
    standTile: { x: 5, y: 8 },
    npcName: 'Cassidy',
    steps: []
  },
  { name: 'Labor — Jilt (Piet Bank)', destination: 'Piet Bank', npcName: 'Jilt', steps: [] },
  { name: 'Labor — Lamont (Abel Bank)', destination: 'Abel Bank', npcName: 'Lamont', steps: [] },
  { name: 'Labor — Argus (Undine Bank)', destination: 'Undine Bank', npcName: 'Argus', steps: [] }
]

/** Every built-in errand, in order. */
export function builtinErrands(): Errand[] {
  return BUILTIN_ERRANDS
}

/** Find one built-in errand by name, or undefined when there is none. */
export function findErrand(name: string): Errand | undefined {
  return BUILTIN_ERRANDS.find((errand) => errand.name === name)
}
