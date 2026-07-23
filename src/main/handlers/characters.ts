import type { IpcMain } from 'electron'
import { z } from 'zod'
import type { CharacterRecord } from '../../shared/types'
import type { CaptureService } from '../captureService'
import { withoutCharacter, type CharacterStore } from '../store/characterStore'

export interface CharacterHandlerContext {
  characterStore: CharacterStore
  captureService: CaptureService
}

const nameSchema = z.string().min(1)

/** Every recorded character, most recently seen first. */
export async function listCharacters(ctx: CharacterHandlerContext): Promise<CharacterRecord[]> {
  const file = await ctx.characterStore.load()
  return Object.values(file.characters).sort((a, b) => b.lastSeenMs - a.lastSeenMs)
}

export async function getCharacter(
  ctx: CharacterHandlerContext,
  name: unknown
): Promise<CharacterRecord | null> {
  const parsed = nameSchema.safeParse(name)
  if (!parsed.success) return null
  const file = await ctx.characterStore.load()
  return file.characters[parsed.data] ?? null
}

export async function removeCharacter(ctx: CharacterHandlerContext, name: unknown): Promise<void> {
  const parsed = nameSchema.safeParse(name)
  if (!parsed.success) throw new Error('Invalid character name')
  // Write anything still waiting first, or the delete could be undone by a
  // pending record for the same character.
  await ctx.captureService.flush()
  await ctx.characterStore.update((file) => withoutCharacter(file, parsed.data))
}

export function registerCharacterHandlers(ipcMain: IpcMain, ctx: CharacterHandlerContext): void {
  ipcMain.handle('characters:list', () => listCharacters(ctx))
  ipcMain.handle('characters:get', (_, name) => getCharacter(ctx, name))
  ipcMain.handle('characters:remove', (_, name) => removeCharacter(ctx, name))
}

/** The channel main uses to push a changed character to the renderer. */
export const CHARACTER_CHANGED_CHANNEL = 'characters:changed'
