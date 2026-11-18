import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import { createFolderGrants } from '../../folderGrants'
import type { PickerDialog } from '../../pickerStart'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { chooseDarkAgesFolder, legendPresent, registerIconsHandlers } from '../icons'

const dir = mkdtempSync(join(tmpdir(), 'midir-icons-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('legendPresent', () => {
  it('is false for an unset or empty path', () => {
    expect(legendPresent(undefined)).toBe(false)
    expect(legendPresent('')).toBe(false)
    expect(legendPresent(42)).toBe(false)
  })

  it('is false for a folder with no legend.dat', () => {
    expect(legendPresent(dir)).toBe(false)
  })

  it('is true once legend.dat is beside it', () => {
    writeFileSync(join(dir, 'legend.dat'), 'not a real archive')
    expect(legendPresent(dir)).toBe(true)
  })
})

describe('chooseDarkAgesFolder', () => {
  it('returns the chosen folder', async () => {
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/Dark Ages'] }))
    } as unknown as PickerDialog
    expect(await chooseDarkAgesFolder(dialog, null)).toBe('C:/Dark Ages')
  })

  it('returns null when the user cancels', async () => {
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    } as unknown as PickerDialog
    expect(await chooseDarkAgesFolder(dialog, null)).toBeNull()
  })
})

describe('icons:probe handler', () => {
  /** A fake ipcMain that captures each handler by channel. */
  function fakeIpc(): {
    ipcMain: IpcMain
    call: (channel: string, arg: unknown) => Promise<unknown>
  } {
    const handlers = new Map<string, (event: unknown, arg: unknown) => unknown>()
    const ipcMain = {
      handle: (channel: string, handler: (event: unknown, arg: unknown) => unknown) => {
        handlers.set(channel, handler)
      }
    } as unknown as IpcMain
    return { ipcMain, call: async (channel, arg) => handlers.get(channel)!({}, arg) }
  }

  const dialog = {} as unknown as PickerDialog
  const BrowserWindow = { fromWebContents: () => null } as never

  it('arms the live path when legend.dat is found in a granted folder', async () => {
    const onLegendFound = vi.fn()
    const { ipcMain, call } = fakeIpc()
    registerIconsHandlers(
      ipcMain,
      dialog,
      BrowserWindow,
      createFolderGrants(Promise.resolve(dir)),
      onLegendFound
    )
    // `dir` holds a legend.dat by the time this runs (see the block above).
    expect(await call('icons:probe', dir)).toEqual({ legendFound: true })
    expect(onLegendFound).toHaveBeenCalledWith(dir)
  })

  it('does not arm the path when legend.dat is absent', async () => {
    const onLegendFound = vi.fn()
    const { ipcMain, call } = fakeIpc()
    const grants = createFolderGrants(Promise.resolve(undefined))
    grants.grant('C:/no-such-folder')
    registerIconsHandlers(ipcMain, dialog, BrowserWindow, grants, onLegendFound)
    expect(await call('icons:probe', 'C:/no-such-folder')).toEqual({ legendFound: false })
    expect(onLegendFound).not.toHaveBeenCalled()
  })

  it('refuses a folder nobody picked, although legend.dat is in it', async () => {
    // A renderer path alone must not point main's reads at a folder.
    const onLegendFound = vi.fn()
    const { ipcMain, call } = fakeIpc()
    registerIconsHandlers(
      ipcMain,
      dialog,
      BrowserWindow,
      createFolderGrants(Promise.resolve(undefined)),
      onLegendFound
    )
    expect(await call('icons:probe', dir)).toEqual({ legendFound: false })
    expect(onLegendFound).not.toHaveBeenCalled()
  })

  it('grants the folder the user picks, and only that one', async () => {
    const onLegendFound = vi.fn()
    const { ipcMain, call } = fakeIpc()
    const picker = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [dir] }))
    } as unknown as PickerDialog
    const grants = createFolderGrants(Promise.resolve(undefined))
    registerIconsHandlers(ipcMain, picker, BrowserWindow, grants, onLegendFound)
    expect(await call('icons:chooseFolder', undefined)).toBe(dir)
    expect(grants.isGranted(dir)).toBe(true)
    expect(await call('icons:probe', dir)).toEqual({ legendFound: true })
    expect(onLegendFound).toHaveBeenCalledWith(dir)
  })

  it('grants nothing when the user cancels the pick', async () => {
    const { ipcMain, call } = fakeIpc()
    const picker = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
    } as unknown as PickerDialog
    const grants = createFolderGrants(Promise.resolve(undefined))
    registerIconsHandlers(ipcMain, picker, BrowserWindow, grants)
    expect(await call('icons:chooseFolder', undefined)).toBeNull()
    expect(grants.isGranted(dir)).toBe(false)
  })
})
