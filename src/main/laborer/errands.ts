import type { DialogStep, Errand, ErrandParam } from '../../shared/types'

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
 *  - `steps` — the pursuit id and the row text for each dialog step. Every
 *    value is from a recording, never a guess. The Rucesion clout errands have
 *    theirs (see `cloutSteps`); the rest are still a capture away. With no
 *    steps, the Laborer walks to the NPC and stops.
 *
 * A placeholder is safe: the matcher refuses any dialog whose pursuit and row
 * text do not match, so a wrong value stops the run rather than acting on it.
 * The stop line names every pursuit id the dialog carried, so a run against an
 * errand with no steps is itself the capture of the ids it needs.
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
/**
 * The civic errand: support one citizen, by name.
 *
 * Every Rucesion civic NPC runs the same conversation, from the recordings of
 * 2026-07-23 (Eduardo), 2026-07-26 (Angelo), 2026-08-01 (Maria), and
 * 2026-09-21 (Eduardo, with the player's answers and the already-supporting
 * branch). Only the NPC's main menu differs, and the row that starts the
 * conversation is "Rucesion Civics" on all three, with the same row pursuit.
 * Sabrael expects Mileth's to be the same conversation under "Mileth Civics"
 * with its own ids; those ids wait on a capture.
 *
 * The pursuit is one id for the whole conversation, so each step also names
 * the prose it expects. The citizen is a parameter, never a name in this file.
 *
 * The branch: a second "Support a Citizen" inside the four-day window shows
 * "<name> is in Temuair now. You can attempt to withdraw your support from the
 * Aisling." with the rows "I continue to support the Aisling" and "Withdraw
 * support". When the name is the wanted citizen, the errand is already done.
 * When it is another, the errand withdraws and starts again from the menu,
 * which the player opens once more.
 */
const CIVIC_PURSUIT = 588
const CITIZEN: ErrandParam = { name: 'citizen', label: 'Citizen to support' }

function cloutSteps(
  town: 'Rucesion',
  civicsRow: number
): Pick<Errand, 'params' | 'steps' | 'branches'> {
  const branches: DialogStep[] = [
    {
      pursuit: CIVIC_PURSUIT,
      when: '{citizen} is in Temuair now',
      choose: 'I continue to support the Aisling',
      then: 'done'
    },
    {
      pursuit: CIVIC_PURSUIT,
      when: 'is in Temuair now',
      choose: 'Withdraw support',
      then: 'restart'
    }
  ]
  return {
    params: [CITIZEN],
    steps: [
      { pursuit: civicsRow, choose: `${town} Civics` },
      { pursuit: CIVIC_PURSUIT, when: 'What is your civil action?', choose: 'Support a Citizen' },
      {
        pursuit: CIVIC_PURSUIT,
        when: 'Are you sure you wish to support one now?',
        choose: 'I am sure'
      },
      { pursuit: CIVIC_PURSUIT, when: 'Whom shall you support', answer: '{citizen}' }
    ],
    branches
  }
}

/** The "Rucesion Civics" row's pursuit on Maria, Angelo, and Eduardo. */
const RUCESION_CIVICS_ROW = 1612

export const BUILTIN_ERRANDS: Errand[] = [
  // --- Clout: one errand for each NPC ------------------------------------
  {
    name: 'Clout — Maria (Rucesion Inn)',
    destination: 'Rucesion Inn',
    standTile: { x: 5, y: 6 },
    npcName: 'Maria',
    ...cloutSteps('Rucesion', RUCESION_CIVICS_ROW)
  },
  {
    name: 'Clout — Angelo (Rucesion Bank)',
    destination: 'Rucesion Bank',
    standTile: { x: 5, y: 8 },
    npcName: 'Angelo',
    ...cloutSteps('Rucesion', RUCESION_CIVICS_ROW)
  },
  {
    name: 'Clout — Eduardo (Rucesion Town Hall)',
    destination: 'Rucesion Town Hall',
    standTile: { x: 1, y: 11 },
    npcName: 'Eduardo',
    ...cloutSteps('Rucesion', RUCESION_CIVICS_ROW)
  },
  // The Mileth three: expected to be the same conversation under "Mileth
  // Civics", with their own ids. A run against one of them stops on the main
  // menu and names the row ids; the steps follow from that capture.
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
  // The main menu row is "Labor" (pursuit 1335 on Antonio and Cassidy, July
  // recordings). What follows it was never chosen with Midir recording, so the
  // steps wait on one capture.
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
