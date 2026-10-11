import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dialogDefaultPath, pickerDialog, pickerStartPath, withPickerStart } from '../pickerStart'

// Ported from taliesin's pickerStart.test.ts (HTOO-553). The dialog here takes
// the parent window first, because Midir's handlers give one.

const docs = join('/home/me/Documents')
const onDisk = new Set([
  join('/'),
  join('/Dark Ages'),
  join('/Dark Ages', 'legend.dat'),
  join('/home/me'),
  docs
])
const exists = async (p: string): Promise<boolean> => onDisk.has(p)

describe('pickerStartPath', () => {
  it('takes the first candidate that exists', async () => {
    expect(await pickerStartPath([join('/Dark Ages'), join('/home/me')], exists)).toBe(
      join('/Dark Ages')
    )
  })

  it('skips a stale setting, an empty string and a missing value', async () => {
    expect(await pickerStartPath([null, undefined, '', join('/moved'), docs], exists)).toBe(docs)
  })

  it('returns undefined when nothing exists, so the dialog gets no defaultPath', async () => {
    expect(await pickerStartPath([join('/nope')], exists)).toBeUndefined()
  })
})

describe('dialogDefaultPath', () => {
  const start = async (): Promise<string | undefined> => docs

  it('uses the start folder when the handler names nothing', async () => {
    expect(await dialogDefaultPath(undefined, start, 'open', exists)).toBe(docs)
    expect(await dialogDefaultPath('', start, 'save', exists)).toBe(docs)
  })

  it('keeps an open path that exists, and does not look for a start folder', async () => {
    const noStart = vi.fn(start)
    expect(await dialogDefaultPath(join('/Dark Ages'), noStart, 'open', exists)).toBe(
      join('/Dark Ages')
    )
    expect(noStart).not.toHaveBeenCalled()
  })

  it('keeps a save path whose folder exists, although the file is new', async () => {
    const path = join('/Dark Ages', 'board.json')
    expect(await dialogDefaultPath(path, start, 'save', exists)).toBe(path)
  })

  it('puts a bare save name in the start folder, not in Downloads', async () => {
    // The board export gives a bare name (exportFileName).
    expect(await dialogDefaultPath('mail-Eolathe.json', start, 'save', exists)).toBe(
      join(docs, 'mail-Eolathe.json')
    )
  })

  it('moves a stale save path to the start folder and keeps its name', async () => {
    const stale = join('/moved', 'board.json')
    expect(await dialogDefaultPath(stale, start, 'save', exists)).toBe(join(docs, 'board.json'))
  })

  it('opens at the start folder, with no name, when the path and its folder are gone', async () => {
    expect(await dialogDefaultPath(join('/moved', 'game'), start, 'open', exists)).toBe(docs)
  })

  it('never hands an open dialog a bare name', async () => {
    expect(await dialogDefaultPath('maps', start, 'open', exists)).toBe(docs)
  })

  it('passes the request through when there is no start folder', async () => {
    const none = async (): Promise<undefined> => undefined
    expect(await dialogDefaultPath('board.json', none, 'save', exists)).toBe('board.json')
    expect(await dialogDefaultPath(undefined, none, 'open', exists)).toBeUndefined()
  })
})

describe('withPickerStart', () => {
  function setup(gameFolder: string | null = null) {
    const inner = {
      showOpenDialog: vi.fn(async (_window: unknown, _opts: OpenDialogOptions) => ({
        canceled: false,
        filePaths: [] as string[]
      })),
      showSaveDialog: vi.fn(async (_window: unknown, _opts: SaveDialogOptions) => ({
        canceled: false,
        filePath: ''
      }))
    }
    const dialog = withPickerStart(inner, {
      gameFolder: () => gameFolder,
      fallbacks: () => [docs, join('/home/me')],
      exists
    })
    const lastOpen = (): unknown => inner.showOpenDialog.mock.calls.at(-1)?.[1]
    const lastSave = (): unknown => inner.showSaveDialog.mock.calls.at(-1)?.[1]
    return { inner, dialog, lastOpen, lastSave }
  }

  it('opens in the Dark Ages folder, then in Documents when there is none', async () => {
    const withGame = setup(join('/Dark Ages'))
    await withGame.dialog.showOpenDialog(null, { properties: ['openDirectory'] })
    expect(withGame.lastOpen()).toMatchObject({ defaultPath: join('/Dark Ages') })

    const without = setup(null)
    await without.dialog.showOpenDialog(null, { properties: ['openDirectory'] })
    expect(without.lastOpen()).toMatchObject({ defaultPath: docs })
  })

  it('opens the next dialog in the folder of the last pick', async () => {
    const { inner, dialog, lastOpen, lastSave } = setup()
    inner.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [join('/home/me')] })
    await dialog.showOpenDialog(null, { properties: ['openDirectory'] })
    await dialog.showSaveDialog(null, { defaultPath: 'board.json' })
    expect(lastSave()).toMatchObject({ defaultPath: join('/home/me', 'board.json') })

    await dialog.showOpenDialog(null, { properties: ['openDirectory'] })
    expect(lastOpen()).toMatchObject({ defaultPath: join('/home/me') })
  })

  it('passes the parent window through and keeps the other options', async () => {
    const { inner, dialog, lastOpen } = setup()
    const parent = { id: 1 } as never
    inner.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(
      await dialog.showOpenDialog(parent, { title: 'Pick', properties: ['openDirectory'] })
    ).toEqual({ canceled: true, filePaths: [] })
    expect(inner.showOpenDialog.mock.calls.at(-1)?.[0]).toBe(parent)
    expect(lastOpen()).toMatchObject({ title: 'Pick', properties: ['openDirectory'] })
  })
})

describe('pickerDialog', () => {
  it("calls Electron's one-argument form when there is no parent window", async () => {
    const electron = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true }))
    }
    const dialog = pickerDialog(electron as never)
    await dialog.showOpenDialog(null, { title: 'a' })
    expect(electron.showOpenDialog).toHaveBeenLastCalledWith({ title: 'a' })
    const parent = { id: 1 } as never
    await dialog.showSaveDialog(parent, { title: 'b' })
    expect(electron.showSaveDialog).toHaveBeenLastCalledWith(parent, { title: 'b' })
  })
})
