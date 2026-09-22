// The settings save payload (HTOO-235). Pure, over shared types only.
import { DEFAULT_SETTINGS, type MidirSettings } from './types'

/**
 * The save payload: every persisted field, and nothing else.
 *
 * Derived from `DEFAULT_SETTINGS`'s own keys so a field added later is carried
 * without anyone remembering to add it here. This store used to build the
 * payload by destructuring fourteen names, which is silent data loss on the
 * fifteenth: a change to any field writes the fourteen, main persists exactly
 * that, and the new field comes back as its default on the next load. Nothing
 * throws, nothing logs, and the atomic write and the `.bak` rotation are
 * working perfectly. The template fixed the same thing (HTOO-235);
 * `settingsPayload.test.ts` asserts the payload's keys are the schema's.
 *
 * `darkAgesPath` is the one optional field, absent from the defaults, so it is
 * carried by name when it is set.
 */
export function toSettings(state: MidirSettings): MidirSettings {
  const settings = Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((key) => [key, state[key as keyof MidirSettings]])
  ) as unknown as MidirSettings
  if (state.darkAgesPath !== undefined) settings.darkAgesPath = state.darkAgesPath
  return settings
}
