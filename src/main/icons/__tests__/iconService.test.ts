import { describe, expect, it, vi } from 'vitest'
import type { LogEntry } from '../../../shared/log'
import type { Logger } from '../../log'
import { createIconService, type ArchiveRenderer, type RenderedFrame } from '../iconService'

/** A logger that only remembers what it was told. */
function fakeLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const add =
    (level: LogEntry['level']) =>
    (scope: string, message: string): void => {
      entries.push({ timeMs: 0, level, scope, message })
    }
  return {
    entries,
    filePath: '',
    recent: () => entries,
    info: add('info'),
    warn: add('warn'),
    error: add('error')
  }
}

/** A 1×1 opaque red frame. */
const RED_FRAME: RenderedFrame = { data: Uint8Array.from([255, 0, 0, 255]), width: 1, height: 1 }

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

describe('icon service', () => {
  it('renders nothing and opens nothing when no folder is set', async () => {
    const open = vi.fn(async () => null)
    const service = createIconService({
      getDarkAgesPath: () => undefined,
      log: fakeLogger(),
      openLegendArchive: open
    })
    expect(await service.render(5, 0)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('renders nothing and opens nothing for a sprite id of 0', async () => {
    const open = vi.fn(async () => null)
    const service = createIconService({
      getDarkAgesPath: () => 'C:/DA',
      log: fakeLogger(),
      openLegendArchive: open
    })
    expect(await service.render(0, 0)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('returns PNG bytes for a hit', async () => {
    const renderFrame = vi.fn<ArchiveRenderer['renderFrame']>(() => RED_FRAME)
    const service = createIconService({
      getDarkAgesPath: () => 'C:/DA',
      log: fakeLogger(),
      openLegendArchive: async () => ({ renderFrame })
    })
    const png = await service.render(1, 0)
    expect(png).not.toBeNull()
    expect(Array.from(png!.subarray(0, 8))).toEqual(PNG_SIGNATURE)
    // Sprite 1 is sheet 1, frame 0, and the palette id is the masked sprite id.
    expect(renderFrame).toHaveBeenCalledWith(1, 0, 1, 0)
  })

  it('opens the archive once and caches the rendered icon', async () => {
    const renderFrame = vi.fn<ArchiveRenderer['renderFrame']>(() => RED_FRAME)
    const open = vi.fn(async () => ({ renderFrame }))
    const service = createIconService({
      getDarkAgesPath: () => 'C:/DA',
      log: fakeLogger(),
      openLegendArchive: open
    })
    const first = await service.render(1, 0)
    const second = await service.render(1, 0)
    expect(second).toBe(first)
    expect(open).toHaveBeenCalledTimes(1)
    expect(renderFrame).toHaveBeenCalledTimes(1)
  })

  it('renders the same sprite at two colours as two icons', async () => {
    const renderFrame = vi.fn<ArchiveRenderer['renderFrame']>(() => RED_FRAME)
    const service = createIconService({
      getDarkAgesPath: () => 'C:/DA',
      log: fakeLogger(),
      openLegendArchive: async () => ({ renderFrame })
    })
    await service.render(1, 0)
    await service.render(1, 3)
    expect(renderFrame).toHaveBeenNthCalledWith(1, 1, 0, 1, 0)
    expect(renderFrame).toHaveBeenNthCalledWith(2, 1, 0, 1, 3)
  })

  it('renders nothing and logs once when the archive will not open', async () => {
    const log = fakeLogger()
    const service = createIconService({
      getDarkAgesPath: () => 'C:/bad',
      log,
      openLegendArchive: async () => null
    })
    expect(await service.render(1, 0)).toBeNull()
    expect(await service.render(2, 0)).toBeNull()
    expect(log.entries.filter((e) => e.level === 'warn')).toHaveLength(1)
  })

  it('renders nothing when the frame is missing', async () => {
    const service = createIconService({
      getDarkAgesPath: () => 'C:/DA',
      log: fakeLogger(),
      openLegendArchive: async () => ({ renderFrame: () => null })
    })
    expect(await service.render(1, 0)).toBeNull()
  })

  it('reopens the archive when the folder changes', async () => {
    const renderFrame = vi.fn<ArchiveRenderer['renderFrame']>(() => RED_FRAME)
    const open = vi.fn(async () => ({ renderFrame }))
    let path = 'C:/DA'
    const service = createIconService({
      getDarkAgesPath: () => path,
      log: fakeLogger(),
      openLegendArchive: open
    })
    await service.render(1, 0)
    path = 'D:/DA'
    await service.render(1, 0)
    expect(open).toHaveBeenCalledTimes(2)
    // The cache was cleared, so the icon was drawn again for the new archive.
    expect(renderFrame).toHaveBeenCalledTimes(2)
  })
})
