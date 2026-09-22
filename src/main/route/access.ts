import accessData from './access.json'
import { NATION_OF_TOWN } from '../model/access'

/**
 * The gated maps, and whether a character may pass one (WP32).
 *
 * A gate admits a registered citizen of its town and no one else. The seed is
 * `access.json`, hand-kept apart from the generated `worldmap.json`; the
 * wire adds to it for the length of a session when a walk meets a gate's own
 * refusal, "Only a <Town> citizen may enter here" (`model/access.ts`).
 *
 * What the character carries to a gate is a `Passport`: registration as the
 * record knows it, the citizenship byte, and the towns whose gates refused
 * this character this session. Unknown never bars (registration undefined,
 * nation 0 or absent): a wrong "may pass" costs one refused walk, which the
 * refusal then teaches; a wrong "may not" refuses a walk the character could
 * make.
 */

/** A map that admits only a registered citizen of one town. */
export interface Gate {
  mapId: number
  town: string
  name?: string
}

/** What a character carries to a gate. Unknown fields never bar. */
export interface Passport {
  registered?: boolean | undefined
  /** The Nation byte: the citizenship. 0 is none, and bars nothing. */
  nation?: number | undefined
  /** Towns whose gates refused this character this session. */
  refusedTowns?: ReadonlySet<string> | undefined
}

/** Why a gate bars a character, or null when it does not. */
export type GateBar = 'registration' | 'citizenship'

/** The seeded gates, from access.json. */
export function seededGates(): Gate[] {
  return (accessData.gates as Gate[]).map((g) => ({
    mapId: g.mapId,
    town: g.town,
    ...(g.name !== undefined ? { name: g.name } : {})
  }))
}

/** Whether `gate` bars the holder of `passport`, and why. */
export function gateBars(gate: Gate, passport: Passport): GateBar | null {
  if (passport.registered === false) return 'registration'
  if (passport.refusedTowns?.has(gate.town) === true) return 'citizenship'
  const own = NATION_OF_TOWN[gate.town]
  if (
    own !== undefined &&
    passport.nation !== undefined &&
    passport.nation !== 0 &&
    passport.nation !== own
  ) {
    return 'citizenship'
  }
  return null
}

/** A one-line reading of why a gate barred the character, for the log and the UI. */
export function gateBarText(gate: Gate, bar: GateBar): string {
  const place = gate.name ?? `map ${gate.mapId}`
  return bar === 'registration'
    ? `${place} admits only a registered character`
    : `${place} admits only a citizen of ${gate.town}`
}
