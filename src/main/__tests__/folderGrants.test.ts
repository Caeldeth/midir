import { describe, expect, it } from 'vitest'
import { createFolderGrants } from '../folderGrants'

describe('createFolderGrants', () => {
  it('grants the startup folder once it is ready', async () => {
    const grants = createFolderGrants(Promise.resolve('C:\\Games\\Dark Ages'))
    await grants.ready
    expect(grants.isGranted('C:\\Games\\Dark Ages')).toBe(true)
  })

  it('grants a picked folder', async () => {
    const grants = createFolderGrants(Promise.resolve(undefined))
    await grants.ready
    expect(grants.isGranted('D:\\Dark Ages')).toBe(false)
    grants.grant('D:\\Dark Ages')
    expect(grants.isGranted('D:\\Dark Ages')).toBe(true)
  })

  it('folds case and reads a path the way Windows does', async () => {
    const grants = createFolderGrants(Promise.resolve('C:\\Games\\Dark Ages'))
    await grants.ready
    expect(grants.isGranted('c:\\games\\dark ages')).toBe(true)
    expect(grants.isGranted('C:\\Games\\Dark Ages\\')).toBe(true)
    expect(grants.isGranted('C:\\Games\\Other\\..\\Dark Ages')).toBe(true)
  })

  it('does not grant a folder inside or beside a grant', async () => {
    const grants = createFolderGrants(Promise.resolve('C:\\Games\\Dark Ages'))
    await grants.ready
    expect(grants.isGranted('C:\\Games\\Dark Ages\\maps')).toBe(false)
    expect(grants.isGranted('C:\\Games')).toBe(false)
    expect(grants.isGranted('C:\\Games\\Dark Ages 2')).toBe(false)
  })

  it('grants nothing for an empty value or a failed load', async () => {
    const empty = createFolderGrants(Promise.resolve(''))
    await empty.ready
    expect(empty.isGranted('')).toBe(false)
    const failed = createFolderGrants(Promise.reject(new Error('unreadable')))
    await failed.ready
    expect(failed.isGranted('C:\\Games\\Dark Ages')).toBe(false)
    failed.grant('')
    expect(failed.isGranted('')).toBe(false)
  })
})
