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
 *    id is from a recording, never a guess: the clout errands' from
 *    `cloutSteps`, the labor errands' from `laborSteps`. With no steps, the
 *    Laborer walks to the NPC and stops.
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
 * the world xml both put her there. The two town halls are the same room: the
 * spot is 2,11 and the official is on 1,12 (Sabrael, 2026-09-21, correcting
 * the earlier 1,11 for Rucesion).
 *
 * The NPC tiles are from the world repo's `Old*.xml` (`<Npc Name X Y>`),
 * except the two officials: the xml puts Eduardo on 1,9, and a click on 1,12
 * opened his dialog in the live run of 2026-09-21, so the measured tile
 * stands and Arilan takes the same. Riona is not in the xml's Mileth Inn;
 * Sabrael puts her on 3,3, where Maria stands in Rucesion's.
 */
/**
 * The civic errand: support one citizen, by name.
 *
 * Every Rucesion civic NPC runs the same conversation, from the recordings of
 * 2026-07-23 (Eduardo), 2026-07-26 (Angelo), 2026-08-01 (Maria), and
 * 2026-09-21 (Eduardo, with the player's answers and the already-supporting
 * branch). Only the NPC's main menu differs, and the row that starts the
 * conversation is "Rucesion Civics" on all three, with the same row pursuit.
 * Mileth is the same conversation under "Mileth Civics" with its own two ids:
 * the ids from Gabrael at Riona, and every row from the Laborer's own run at
 * Arilan the same night, which went through to the name.
 *
 * The verdicts after the name, all captured: "You give political support to
 * <name> for these Temuairan four days" (done), "<name> is not near" (the
 * citizen is not logged in; nothing given), and, one step earlier for a
 * citizen of another town, a no-choice dialog "You must give up your current
 * citizenship first…", on which the run stops.
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
const CITIZEN: ErrandParam = { name: 'citizen', label: 'Citizen to support' }

/** A town's civic ids: the "<Town> Civics" menu row, and the civic pursuit. */
interface CivicIds {
  town: 'Rucesion' | 'Mileth'
  civicsRow: number
  pursuit: number
}

/** "Rucesion Civics" on Maria, Angelo, and Eduardo, and their civic pursuit. */
const RUCESION: CivicIds = { town: 'Rucesion', civicsRow: 1612, pursuit: 588 }

/** "Mileth Civics" on Riona, and the civic pursuit behind it. */
const MILETH: CivicIds = { town: 'Mileth', civicsRow: 1603, pursuit: 579 }

function cloutSteps(ids: CivicIds): Pick<Errand, 'params' | 'steps' | 'branches'> {
  const { town, civicsRow, pursuit } = ids
  const branches: DialogStep[] = [
    {
      pursuit,
      when: '{citizen} is in Temuair now',
      choose: 'I continue to support the Aisling',
      then: 'done'
    },
    { pursuit, when: 'is in Temuair now', choose: 'Withdraw support', then: 'restart' }
  ]
  return {
    params: [CITIZEN],
    steps: [
      { pursuit: civicsRow, choose: `${town} Civics` },
      { pursuit, when: 'What is your civil action?', choose: 'Support a Citizen' },
      { pursuit, when: 'Are you sure you wish to support one now?', choose: 'I am sure' },
      { pursuit, when: 'Whom shall you support', answer: '{citizen}' }
    ],
    branches
  }
}

/**
 * The labor errand: work one Temuairan day for another Aisling, by name.
 *
 * From Sabrael's capture of 2026-09-21 (Evenue at Antonio): the menu row
 * "Labor", then under the labor pursuit "You want to work for another
 * Aisling? …" with the rows "I don't want to work", "I want to work", and
 * "((labor fix))", then "Who shall you work for?" as a text field. The
 * server's verdict is a notice, not a dialog, so the run reports the first
 * notice after the last step as its outcome. The three verdicts, all captured
 * the same night:
 *
 *   "You work for <name> for 1 day"
 *       a whole day was given
 *   "You work for <name>, although the Aisling didn't need much done"
 *       the Aisling had room for less than a day; it is full now
 *   "<name> doesn't need any jobs done. The Aisling hasn't done anything"
 *       the Aisling is full; nothing was given
 *
 * An Aisling holds six days of labor, which come back over time (Sabrael:
 * about every twelve hours).
 *
 * "((labor fix))" resets the laborer's own labor to one hour, free, once in a
 * while (`laborFixSteps`). It answers with a notice dialog, not a notice:
 * "This will reset your labor to one hour. You can only do this once." the
 * first time, "You have already reset your labor." when it is too soon. The
 * errand closes it and reports its text.
 *
 * The ids: the "Labor" row is 1335 on Antonio and on Cassidy (July 2026), and
 * the labor pursuit 311 was seen on Antonio. A pursuit is a server-wide script
 * id, not a per-NPC one (the civic pursuit is 588 on three NPCs, the bank
 * pursuit 0x56 on three), so the same values are given to every bank NPC. A
 * wrong one is a safe stop that names the right one.
 */
const LABOR_ROW = 1335
const LABOR_PURSUIT = 311
const AISLING: ErrandParam = { name: 'aisling', label: 'Aisling to work for' }

function laborSteps(): Pick<Errand, 'params' | 'steps'> {
  return {
    params: [AISLING],
    steps: [
      { pursuit: LABOR_ROW, choose: 'Labor' },
      { pursuit: LABOR_PURSUIT, when: 'work for another Aisling', choose: 'I want to work' },
      { pursuit: LABOR_PURSUIT, when: 'Who shall you work for', answer: '{aisling}' }
    ]
  }
}

function laborFixSteps(): Pick<Errand, 'steps'> {
  return {
    steps: [
      { pursuit: LABOR_ROW, choose: 'Labor' },
      { pursuit: LABOR_PURSUIT, when: 'work for another Aisling', choose: '((labor fix))' },
      { pursuit: LABOR_PURSUIT, when: 'reset your labor', close: true }
    ]
  }
}

/** A bank NPC's labor errand and its labor-fix errand, from one description. */
function bankErrands(
  npcName: string,
  place: string,
  destination: string,
  tiles: Pick<Errand, 'standTile' | 'npcTile'>
): Errand[] {
  return [
    { name: `Labor — ${npcName} (${place})`, destination, ...tiles, npcName, ...laborSteps() },
    {
      name: `Labor fix — ${npcName} (${place})`,
      destination,
      ...tiles,
      npcName,
      ...laborFixSteps()
    }
  ]
}

export const BUILTIN_ERRANDS: Errand[] = [
  // --- Clout: one errand for each NPC ------------------------------------
  {
    name: 'Clout — Maria (Rucesion Inn)',
    destination: 'Rucesion Inn',
    standTile: { x: 5, y: 6 },
    npcTile: { x: 3, y: 3 },
    npcName: 'Maria',
    ...cloutSteps(RUCESION)
  },
  {
    name: 'Clout — Angelo (Rucesion Bank)',
    destination: 'Rucesion Bank',
    standTile: { x: 5, y: 8 },
    npcTile: { x: 7, y: 3 },
    npcName: 'Angelo',
    ...cloutSteps(RUCESION)
  },
  {
    name: 'Clout — Eduardo (Rucesion Town Hall)',
    destination: 'Rucesion Town Hall',
    standTile: { x: 2, y: 11 },
    npcTile: { x: 1, y: 12 },
    npcName: 'Eduardo',
    ...cloutSteps(RUCESION)
  },
  {
    name: 'Clout — Aingeal (Mileth Tavern)',
    destination: 'Mileth Tavern',
    standTile: { x: 9, y: 5 },
    npcTile: { x: 6, y: 5 },
    npcName: 'Aingeal',
    ...cloutSteps(MILETH)
  },
  {
    name: 'Clout — Riona (Mileth Inn)',
    destination: 'Mileth Inn',
    standTile: { x: 6, y: 4 },
    npcTile: { x: 3, y: 3 },
    npcName: 'Riona',
    ...cloutSteps(MILETH)
  },
  {
    name: 'Clout — Arilan (Mileth Town Hall)',
    destination: 'Mileth Town Hall',
    standTile: { x: 2, y: 11 },
    npcTile: { x: 1, y: 12 },
    npcName: 'Arilan',
    ...cloutSteps(MILETH)
  },

  // --- Labor and labor fix: two errands for each bank NPC ----------------
  ...bankErrands('Antonio', 'Rucesion Bank', 'Rucesion Bank', {
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 }
  }),
  ...bankErrands('Cassidy', 'Mileth Bank', 'Mileth Bank', {
    standTile: { x: 6, y: 6 },
    npcTile: { x: 3, y: 5 }
  }),
  // The four storages are the same 12 x 12 room, with the NPC on (3,4), so
  // Rucesion's stand tile carries over to the other three.
  ...bankErrands('Jilt', 'Piet Bank', 'Piet Bank', {
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 }
  }),
  ...bankErrands('Lamont', 'Abel Bank', 'Abel Bank', {
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 }
  }),
  ...bankErrands('Argus', 'Undine Bank', 'Undine Bank', {
    standTile: { x: 5, y: 8 },
    npcTile: { x: 3, y: 4 }
  })
]

/** Every built-in errand, in order. */
export function builtinErrands(): Errand[] {
  return BUILTIN_ERRANDS
}

/** Find one built-in errand by name, or undefined when there is none. */
export function findErrand(name: string): Errand | undefined {
  return BUILTIN_ERRANDS.find((errand) => errand.name === name)
}
