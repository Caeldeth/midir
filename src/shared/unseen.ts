// The "hide unseen" filter over the character list (WP25). Pure, so both the
// renderer and the node tests can use it.

/** The choices the hide-unseen control offers, in days. 0 is off. */
export const HIDE_UNSEEN_DAY_CHOICES = [0, 7, 30, 90, 180, 365] as const

const DAY_MS = 24 * 60 * 60 * 1000

/** The one field the filter reads. */
export interface SeenRecord {
  lastSeenMs: number
}

/**
 * The capture-time "now" the threshold counts back from.
 *
 * It is the newest `lastSeenMs` over the records, not the wall clock. The
 * record runs on capture time, and the wall clock would hide every character
 * after a month with Midir off, or hide everyone but one during a replay of an
 * old evening. Counting back from the newest sighting asks the one question
 * that matters: which characters has the player left behind.
 */
export function newestSeenMs(records: readonly SeenRecord[]): number {
  let newest = 0
  for (const record of records) if (record.lastSeenMs > newest) newest = record.lastSeenMs
  return newest
}

/** True when `record` was last seen more than `days` before the newest sighting. */
export function isUnseen(record: SeenRecord, days: number, newestMs: number): boolean {
  if (days <= 0) return false
  return newestMs - record.lastSeenMs > days * DAY_MS
}

/**
 * Split the records into the ones to show and the ones the filter hides.
 *
 * Hiding is a view. Nothing here touches the file, and a record comes back the
 * moment `days` grows or goes to 0. Only the explicit Forget removes one.
 */
export function splitUnseen<T extends SeenRecord>(
  records: readonly T[],
  days: number
): { shown: T[]; hidden: T[] } {
  const newest = newestSeenMs(records)
  const shown: T[] = []
  const hidden: T[] = []
  for (const record of records) (isUnseen(record, days, newest) ? hidden : shown).push(record)
  return { shown, hidden }
}
