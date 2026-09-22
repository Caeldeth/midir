import accessData from './access.json'
import { NATION_OF_TOWN } from '../model/access'

/**
 * The gated maps, and whether a character may pass one (WP32).
 *
 * A gate admits a registered citizen of the towns it lists and no one else:
 * the Mileth Commons admits Mileth and Loures, the Rucesion Commons Rucesion
 * and Loures, and no other map is gated (Sabrael, 2026-09-21). The seed is
 * `access.json`, hand-kept apart from the generated `worldmap.json`; the
 * wire adds to it for the length of a session when a walk meets a gate's own
 * refusal, "Only a <Town> citizen may enter here" (`model/access.ts`).
 *
 * What the character carries to a gate is a `Passport`: registration as the
 * record knows it, the citizenship byte, and the maps whose gates refused
 * this character this session. Unknown never bars (registration undefined,
 * citizenship not yet seen): a wrong "may pass" costs one refused walk,
 * which the refusal then teaches; a wrong "may not" refuses a walk the
 * character could make. A citizenship of nowhere (0) is known, and bars.
 */

/** A map that admits only a registered citizen of the towns it lists. */
export interface Gate {
  mapId: number
  /** The gate's own town, the one its refusal names. */
  town: string
  /** The towns whose citizens it admits. Absent means the gate's own town only. */
  admits?: string[]
  name?: string
}

/** What a character carries to a gate. Unknown fields never bar. */
export interface Passport {
  registered?: boolean | undefined
  /** The Nation byte: the citizenship. 0 is a citizenship of nowhere, and bars. */
  citizenship?: number | undefined
  /** Maps whose gates refused this character this session. */
  refusedMaps?: ReadonlySet<number> | undefined
}

/** Why a gate bars a character, or null when it does not. */
export type GateBar = 'registration' | 'citizenship'

/** The seeded gates, from access.json. */
export function seededGates(): Gate[] {
  return (accessData.gates as Gate[]).map((g) => ({
    mapId: g.mapId,
    town: g.town,
    ...(g.admits !== undefined ? { admits: [...g.admits] } : {}),
    ...(g.name !== undefined ? { name: g.name } : {})
  }))
}

/** Whether `gate` bars the holder of `passport`, and why. */
export function gateBars(gate: Gate, passport: Passport): GateBar | null {
  if (passport.registered === false) return 'registration'
  if (passport.refusedMaps?.has(gate.mapId) === true) return 'citizenship'
  if (passport.citizenship === undefined) return null
  const admitted = (gate.admits ?? [gate.town])
    .map((town) => NATION_OF_TOWN[town])
    .filter((nation): nation is number => nation !== undefined)
  if (admitted.length === 0) return null
  return admitted.includes(passport.citizenship) ? null : 'citizenship'
}

/** A one-line reading of why a gate barred the character, for the log and the UI. */
export function gateBarText(gate: Gate, bar: GateBar): string {
  const place = gate.name ?? `map ${gate.mapId}`
  const towns = (gate.admits ?? [gate.town]).join(' or ')
  return bar === 'registration'
    ? `${place} admits only a registered character`
    : `${place} admits only a citizen of ${towns}`
}
