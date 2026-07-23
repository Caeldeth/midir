import { join } from 'node:path'
import { z } from 'zod'
import type { CharacterRecord } from '../../shared/character'
import { createJsonStore, type JsonStore, type JsonStoreFailure } from '../jsonStore'
import { isPlaceholderName } from '../protocol/decode'

/**
 * Where the character records live.
 *
 * This is authoritative data: the whole point of Midir is that a character seen
 * once stays known. It therefore keeps a backup and moves a corrupt file aside
 * rather than discarding it.
 *
 * The file is keyed by character name, which is unique on a retail server.
 */

export const CHARACTERS_FILE = 'characters.json'

const itemSchema = z.object({
  name: z.string(),
  sprite: z.number(),
  color: z.number(),
  count: z.number(),
  canStack: z.boolean(),
  durability: z.number(),
  maxDurability: z.number()
})

const legendMarkSchema = z.object({
  icon: z.number(),
  color: z.number(),
  key: z.string(),
  text: z.string()
})

const statsSchema = z.object({
  level: z.number(),
  abilityLevel: z.number(),
  currentHealth: z.number(),
  maxHealth: z.number(),
  currentMana: z.number(),
  maxMana: z.number(),
  strength: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  constitution: z.number(),
  dexterity: z.number(),
  statPoints: z.number(),
  weight: z.number(),
  maxWeight: z.number(),
  gold: z.number(),
  totalExperience: z.number(),
  toNextLevel: z.number(),
  totalAbility: z.number(),
  toNextAbility: z.number(),
  gamePoints: z.number(),
  armorClass: z.number(),
  magicResistance: z.number(),
  damageModifier: z.number(),
  hitModifier: z.number(),
  attackElement: z.number(),
  defenseElement: z.number()
})

const appearanceSchema = z.object({
  characterClass: z.number(),
  nation: z.number(),
  hairStyle: z.number(),
  hairColor: z.number(),
  bodyShape: z.number(),
  faceShape: z.number(),
  skinColor: z.number(),
  armorSprite: z.number(),
  weaponSprite: z.number(),
  shieldSprite: z.number(),
  bootsSprite: z.number(),
  overcoatSprite: z.number(),
  overcoatColor: z.number()
})

const slotsSchema = z.record(z.string(), itemSchema)

const characterSchema = z.object({
  name: z.string().min(1),
  lastSeenMs: z.number(),
  firstSeenMs: z.number(),
  stats: statsSchema,
  appearance: appearanceSchema,
  equipment: slotsSchema,
  inventory: slotsSchema,
  legend: z.array(legendMarkSchema),
  title: z.string(),
  guild: z.string(),
  guildRank: z.string(),
  displayClass: z.string(),
  hasMail: z.boolean()
})

/** The whole file: characters by name. */
const fileSchema = z.object({
  version: z.literal(1),
  characters: z.record(z.string(), characterSchema)
})

export type CharacterFile = z.infer<typeof fileSchema>

export type CharacterStore = JsonStore<CharacterFile>

/** An empty file. */
export function emptyCharacterFile(): CharacterFile {
  return { version: 1, characters: {} }
}

/**
 * Drop any character whose name is the client's pre-login placeholder.
 *
 * Midir used to file `socket[295]` and its like as characters. They are not
 * people, so they are removed on load and the file is written back without
 * them the next time it is saved.
 */
export function withoutPlaceholders(file: CharacterFile): CharacterFile {
  const names = Object.keys(file.characters).filter((name) => isPlaceholderName(name))
  if (names.length === 0) return file
  const characters = { ...file.characters }
  for (const name of names) delete characters[name]
  return { ...file, characters }
}

/**
 * Open the character store under `directory`.
 *
 * `onFailure` receives a breadcrumb when a file heals or is quarantined, so
 * the user can be told rather than left wondering where their data went.
 */
export function createCharacterStore(
  directory: string,
  onFailure?: (failure: JsonStoreFailure) => void
): CharacterStore {
  return createJsonStore<CharacterFile>({
    path: join(directory, CHARACTERS_FILE),
    fallback: emptyCharacterFile,
    normalize: (raw) => {
      const parsed = fileSchema.safeParse(raw)
      return parsed.success ? withoutPlaceholders(parsed.data as CharacterFile) : null
    },
    backup: true,
    quarantine: true,
    cacheReads: true,
    ...(onFailure !== undefined ? { onFailure } : {})
  })
}

/** Put `record` into `file`, replacing any earlier record of the same name. */
export function withCharacter(file: CharacterFile, record: CharacterRecord): CharacterFile {
  const existing = file.characters[record.name]
  return {
    ...file,
    characters: {
      ...file.characters,
      // Keep the earliest first-seen time across sessions.
      [record.name]: {
        ...record,
        firstSeenMs:
          existing === undefined
            ? record.firstSeenMs
            : Math.min(existing.firstSeenMs, record.firstSeenMs)
      }
    }
  }
}

/** Remove one character. */
export function withoutCharacter(file: CharacterFile, name: string): CharacterFile {
  if (file.characters[name] === undefined) return file
  const characters = { ...file.characters }
  delete characters[name]
  return { ...file, characters }
}
