import type { LegendMark } from '../../shared/character'

/**
 * What the wire says about a character's right to enter a gated map (WP32).
 *
 * Two facts gate a map: registration, and citizenship of the map's town. The
 * Mileth Commons and the Rucesion Commons admit a registered citizen of their
 * own town and no one else. Registration is not a field on the wire and is
 * read from positive signals only; silence proves nothing (a missed login, a
 * late capture start, or a dropped packet all look like "no message").
 *
 * ## Registration
 *
 * - "Your expiration date is 8-22", an SSystemMessage 0x0A type 3 at login,
 *   means registered (recording of 2026-07-24; the date is month-day with no
 *   padding). An unregistered account never gets this line (Sabrael).
 * - "(( Register first: www.darkages.com -> Click 'Register' ))" (a bank's
 *   Labor or a civic action, 2026-09-21) and "((Register at www.DarkAges.com
 *   for full benefits))" (the Commons gate, the same day) mean unregistered.
 * - A legend mark that says "Unregistered" means unregistered. It is not
 *   always there (Sabrael: inconsistent, and that is correct), so its absence
 *   proves nothing, and no recording to date holds one.
 *
 * ## Citizenship
 *
 * The `nation` byte of SSelfLook 0x39, on the record as `appearance.nation`,
 * is the citizenship: 4 Mileth, 6 Rucesion (the Nation table in
 * darkages-741-re; 0 None, 1 Suomi, 3 Loures, 5 Tagor, 7 Noes, 9 Piet, 11
 * Abel, 12 Undine). Every recording agrees with its legend where the legend
 * speaks, and the byte is right where the legend is stale: the legend mark
 * "<Town> Citizen by oath of <Name> - <Date>" is given only by Mileth and
 * Rucesion, Medenia does not remove the marks of other towns, and Sylphid
 * (Medenian, Sabrael) is nation 7 with an old Rucesion mark. So the byte is
 * the fact and the legend is not read for this. Value 0 is "None" and also
 * the empty record's default, so 0 bars nothing.
 *
 * ## The gate's own word
 *
 * "Only a Mileth citizen may enter here" is the Commons refusing. A citizen
 * who is unregistered gets it followed two seconds later by the register
 * line; a registered non-citizen gets it alone (recordings of 2026-07-23 and
 * 2026-09-21). The walker reads it to learn a gate and to stop with the town
 * named, and it is the authority whenever the byte and a gate disagree.
 */

/** The Nation values that name a town with a gate. */
export const NATION_OF_TOWN: Readonly<Record<string, number>> = {
  Suomi: 1,
  Loures: 3,
  Mileth: 4,
  Tagor: 5,
  Rucesion: 6,
  Noes: 7,
  Piet: 9,
  Abel: 11,
  Undine: 12
}

/** Whether the legend carries the unregistered mark. Absence proves nothing. */
export function hasUnregisteredMark(legend: readonly LegendMark[]): boolean {
  return legend.some((mark) => /unregistered/i.test(mark.text) || /unregistered/i.test(mark.key))
}

/**
 * What a system notice says about registration: true for the login line of a
 * registered account, false for either register-first refusal, undefined for
 * any other text.
 */
export function registrationFromNotice(text: string): boolean | undefined {
  const line = text.trim()
  if (/^Your expiration date is /.test(line)) return true
  if (/^\(\(\s*Register (first:|at) /i.test(line)) return false
  return undefined
}

/** The town a gate's refusal names, or null for any other text. */
export function gateFromNotice(text: string): { town: string } | null {
  const match = /^Only an? ([A-Z][a-z]+) citizen may enter here/.exec(text.trim())
  return match === null ? null : { town: match[1] }
}
