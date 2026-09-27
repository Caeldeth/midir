import { describe, expect, it, vi } from 'vitest'
import { createLegendService, hasBadge, type BadgeRenderer } from '../legendService'
import { fakeLogger } from '../../__tests__/handlers.test'

/**
 * The legend badges (WP42). The archive is faked, so these prove the service's
 * own rules: what it draws, what it refuses, what it caches, and what it says
 * when the client's files are not there.
 */

function archive(bytes = Uint8Array.from([1, 2, 3])): BadgeRenderer & { calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    renderBadge(icon) {
      calls.push(icon)
      return hasBadge(icon) ? bytes : null
    }
  }
}

describe('hasBadge', () => {
  it('is true for the eight frames the sheet holds', () => {
    for (let icon = 0; icon < 8; icon++) expect(hasBadge(icon)).toBe(true)
  })

  it('is false for "None" and for anything off the sheet', () => {
    // 8 is the "None" icon, and the client's sheet has no ninth frame.
    expect(hasBadge(8)).toBe(false)
    expect(hasBadge(9)).toBe(false)
    expect(hasBadge(-1)).toBe(false)
    expect(hasBadge(2.5)).toBe(false)
  })
})

describe('createLegendService', () => {
  it('draws a badge for a mark that has one', async () => {
    const sheet = archive()
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log: fakeLogger(),
      openBadgeArchive: async () => sheet
    })
    expect(await service.render(6)).toEqual(Uint8Array.from([1, 2, 3]))
    expect(sheet.calls).toEqual([6])
  })

  it('draws nothing without a Dark Ages folder, and never opens the archive', async () => {
    const open = vi.fn(async () => archive())
    const service = createLegendService({
      getDarkAgesPath: () => undefined,
      log: fakeLogger(),
      openBadgeArchive: open
    })
    expect(await service.render(6)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('needs no archive for a mark with no badge, which keeps the open lazy', async () => {
    const open = vi.fn(async () => archive())
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log: fakeLogger(),
      openBadgeArchive: open
    })
    expect(await service.render(8)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('draws each badge once and serves the rest from the cache', async () => {
    const sheet = archive()
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log: fakeLogger(),
      openBadgeArchive: async () => sheet
    })
    await service.render(1)
    await service.render(1)
    await service.render(2)
    expect(sheet.calls).toEqual([1, 2])
  })

  it('opens the archive once for many marks', async () => {
    const open = vi.fn(async () => archive())
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log: fakeLogger(),
      openBadgeArchive: open
    })
    await Promise.all([service.render(0), service.render(1), service.render(2)])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('opens again and forgets the cache when the folder changes', async () => {
    let folder = 'C:/one'
    const open = vi.fn(async () => archive())
    const service = createLegendService({
      getDarkAgesPath: () => folder,
      log: fakeLogger(),
      openBadgeArchive: open
    })
    await service.render(3)
    folder = 'C:/two'
    await service.render(3)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('says once that the archive would not open, and draws nothing after', async () => {
    const log = fakeLogger()
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log,
      openBadgeArchive: async () => null
    })
    expect(await service.render(1)).toBeNull()
    expect(await service.render(2)).toBeNull()
    const warnings = log.entries.filter((e) => e.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('setoa.dat')
  })

  it('remembers a frame that drew nothing, so it is not retried for every mark', async () => {
    const sheet: BadgeRenderer & { calls: number[] } = {
      calls: [],
      renderBadge(icon) {
        this.calls.push(icon)
        return null
      }
    }
    const service = createLegendService({
      getDarkAgesPath: () => 'C:/game',
      log: fakeLogger(),
      openBadgeArchive: async () => sheet
    })
    expect(await service.render(4)).toBeNull()
    expect(await service.render(4)).toBeNull()
    expect(sheet.calls).toEqual([4])
  })
})
