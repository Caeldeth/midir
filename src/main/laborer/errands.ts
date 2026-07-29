import type { Errand } from '../../shared/types'

/**
 * The built-in errands the Laborer can run.
 *
 * An errand is data, not code: a name, an NPC to walk to, and a list of steps,
 * each of which expects a dialog and answers it. A new errand is a new entry
 * here, not new logic. Each NPC is its own errand, so the player picks one and
 * runs it.
 *
 * ## Two values in each entry still need a live capture
 *
 * The `destination` and the `npcName` are known. Two things are not, and they
 * are filled from a recorded session of the errand, or from the GUI check, not
 * guessed:
 *
 *  - `npcTile` — the exact tile the NPC stands on, so the walker finishes beside
 *    it. Without it the walker reaches the map but not the NPC.
 *  - `steps` — the pursuit id and the row text for each dialog step. With no
 *    steps, the Laborer walks to the map and stops.
 *
 * A placeholder is safe: the matcher refuses any dialog whose pursuit and row
 * text do not match, so a wrong value stops the run rather than acting on it.
 *
 * ## Five destinations are not in the world graph yet
 *
 * `destination` is a node name the route graph resolves. The graph has Rucesion
 * Inn, Rucesion Bank, Rucesion Town Hall, and Mileth Inn. It does **not** yet
 * have Mileth Tavern, Mileth Town Hall, Piet Bank, Abel Bank, or Undine Bank, so
 * an errand to one of those stops with `noRoute` until the graph gains the node.
 * That is the world-map coverage follow-up. The name is written here as the
 * building it should resolve to, so the errand works the moment the node exists.
 */
export const BUILTIN_ERRANDS: Errand[] = [
  // --- Clout: one errand for each NPC ------------------------------------
  {
    name: 'Clout — Maria (Rucesion Inn)',
    destination: 'Rucesion Inn',
    npcName: 'Maria',
    steps: []
  },
  {
    name: 'Clout — Angelo (Rucesion Bank)',
    destination: 'Rucesion Bank',
    npcName: 'Angelo',
    steps: []
  },
  {
    name: 'Clout — Eduardo (Rucesion Town Hall)',
    destination: 'Rucesion Town Hall',
    npcName: 'Eduardo',
    steps: []
  },
  {
    name: 'Clout — Aingeal (Mileth Tavern)',
    destination: 'Mileth Tavern',
    npcName: 'Aingeal',
    steps: []
  },
  { name: 'Clout — Riona (Mileth Inn)', destination: 'Mileth Inn', npcName: 'Riona', steps: [] },
  {
    name: 'Clout — Arilan (Mileth Town Hall)',
    destination: 'Mileth Town Hall',
    npcName: 'Arilan',
    steps: []
  },

  // --- Labor: one errand for each bank NPC -------------------------------
  {
    name: 'Labor — Antonio (Rucesion Bank)',
    destination: 'Rucesion Bank',
    npcName: 'Antonio',
    steps: []
  },
  {
    name: 'Labor — Cassidy (Rucesion Bank)',
    destination: 'Rucesion Bank',
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
