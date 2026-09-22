import { describe, expect, it, vi } from 'vitest'
import type { IconService } from '../iconService'
import { handleIconRequest, parseIconUrl } from '../protocol'
import { DOLL_FIELDS, dollUrl } from '../../../shared/doll'
import { emptyCharacter } from '../../../shared/character'

describe('parseIconUrl', () => {
  it('reads the sprite and colour from the path, behind the fixed host', () => {
    expect(parseIconUrl('midir-icon://item/12345/6')).toEqual({
      kind: 'item',
      sprite: 12345,
      color: 6
    })
  })

  it('keeps a high sprite id intact, where a numeric host would be mangled to an IP', () => {
    // 32774 as a host is read as 0.0.128.6; in the path it stays 32774.
    expect(parseIconUrl('midir-icon://item/32774/0')).toEqual({
      kind: 'item',
      sprite: 32774,
      color: 0
    })
  })

  it('defaults the colour to 0 when only the sprite is given', () => {
    expect(parseIconUrl('midir-icon://item/12345')).toEqual({
      kind: 'item',
      sprite: 12345,
      color: 0
    })
  })

  it('refuses a url that does not parse to two non-negative integers', () => {
    expect(parseIconUrl('not a url')).toBeNull()
    expect(parseIconUrl('midir-icon://item')).toBeNull()
    expect(parseIconUrl('midir-icon://item/abc/6')).toBeNull()
    expect(parseIconUrl('midir-icon://item/12/-1')).toBeNull()
  })

  it('reads a doll request: the appearance fields in the path, in order (WP37)', () => {
    const url = dollUrl({
      ...emptyCharacter('x', 0).appearance,
      bodyShape: 2,
      hairStyle: 55,
      weaponSprite: 162
    })
    expect(url.startsWith('midir-icon://doll/2/0/55/')).toBe(true)
    const parsed = parseIconUrl(url)
    expect(parsed?.kind).toBe('doll')
    if (parsed?.kind !== 'doll') return
    expect(parsed.appearance).toMatchObject({ bodyShape: 2, hairStyle: 55, weaponSprite: 162 })
    expect(Object.keys(parsed.appearance)).toHaveLength(DOLL_FIELDS.length)
    expect(parseIconUrl('midir-icon://doll/1/2/3')).toBeNull()
    expect(parseIconUrl('midir-icon://doll/' + DOLL_FIELDS.map(() => 'x').join('/'))).toBeNull()
  })
})

describe('handleIconRequest', () => {
  function service(render: IconService['render']): IconService {
    return { render: vi.fn(render) }
  }

  it('hands a doll request to the doll service, and 404s without one', async () => {
    const url = dollUrl(emptyCharacter('x', 0).appearance)
    const dolls = { render: vi.fn(async () => Uint8Array.from([9])) }
    const items = service(async () => null)
    expect(await handleIconRequest(items, url, dolls)).toEqual({
      status: 200,
      body: Uint8Array.from([9])
    })
    expect(items.render).not.toHaveBeenCalled()
    expect(await handleIconRequest(items, url)).toEqual({ status: 404 })
  })

  it('answers a hit with 200 and the bytes', async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    const res = await handleIconRequest(
      service(async () => bytes),
      'midir-icon://item/5/0'
    )
    expect(res).toEqual({ status: 200, body: bytes })
  })

  it('answers a miss with 404', async () => {
    const res = await handleIconRequest(
      service(async () => null),
      'midir-icon://item/5/0'
    )
    expect(res).toEqual({ status: 404 })
  })

  it('answers a malformed request with 404 and never calls the service', async () => {
    const render = vi.fn(async () => Uint8Array.from([1]))
    const res = await handleIconRequest({ render }, 'garbage')
    expect(res).toEqual({ status: 404 })
    expect(render).not.toHaveBeenCalled()
  })

  it('answers an empty body with 404', async () => {
    const res = await handleIconRequest(
      service(async () => new Uint8Array(0)),
      'midir-icon://item/5/0'
    )
    expect(res).toEqual({ status: 404 })
  })
})
