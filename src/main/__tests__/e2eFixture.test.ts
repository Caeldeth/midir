import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeChunk, serialiseLine, type RecordingLine } from '../capture/recording'
import type { ConnectionInfo, StreamChunk } from '../capture/source'
import { frameOf, redirectBody, sessionBody, str8, u16, u32 } from '../capture/__tests__/helpers'
import { createReplaySource } from '../capture/replaySource'
import { createSessionTracker } from '../capture/tracker'
import { ServerOpcode } from '../protocol/opcodes'
import { BANK_WITHDRAW_PURSUIT } from '../protocol/decode/dialog'

/**
 * The e2e suite's recording, `e2e/fixtures/session.ndjson` (WP21).
 *
 * It is synthesised here from plaintext packets and the test helpers' cipher,
 * not cut from a real session: this repository is public, and a real recording
 * carries character names, other players' chat, and everything else the wire
 * said that evening. The file is committed so the e2e suite needs no build
 * step, and this test rebuilds it and compares, so a change to the cipher, the
 * frame, or the packets here is caught rather than silently drifting from the
 * file. Set `WRITE_E2E_FIXTURE=1` to rewrite the file after such a change.
 *
 * One login of `Fintan` (level 99, 3,000,000,000 gold, a stack, an item, a worn weapon) and
 * one visit to a banker (three items held), on 2026-07-23 so the "as of" times
 * read as a date rather than as the epoch.
 */

const FIXTURE_PATH = join(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'session.ndjson')

export const FIXTURE_CHARACTER = 'Fintan'
export const FIXTURE_BANKER = 'Antonio'
export const FIXTURE_BANK_ITEMS = [
  { sprite: 0x8053, count: 4, name: 'Bent Crux' },
  { sprite: 0x876a, count: 3, name: 'Jeweled Dark Belt' },
  { sprite: 0x844a, count: 2, name: 'Wolf Claw' }
]

const T0 = Date.UTC(2026, 6, 23, 13, 13, 44)

const LOGIN: ConnectionInfo = {
  id: 'login',
  localAddress: '192.168.1.20',
  localPort: 51000,
  remoteAddress: '203.0.113.8',
  remotePort: 2611,
  openedAtMs: T0
}

const WORLD: ConnectionInfo = {
  id: 'world',
  localAddress: '192.168.1.20',
  localPort: 51001,
  remoteAddress: '203.0.113.9',
  remotePort: 2612,
  openedAtMs: T0 + 1000
}

const chunk = (connection: ConnectionInfo, body: number[], timestampMs: number): StreamChunk => ({
  connectionId: connection.id,
  direction: 'serverToClient',
  bytes: Uint8Array.from(frameOf(body)),
  timestampMs,
  gap: false
})

/** A full SStatus, every block present: level 99, 2431 of 2500 health, 3,000,000,000 gold. */
const STATUS = [
  ServerOpcode.Status,
  0x3d,
  0x02,
  0x00,
  0x00,
  99,
  12,
  ...u32(2500),
  ...u32(1800),
  150,
  88,
  120,
  200,
  75,
  0x01,
  3,
  ...u16(1000),
  ...u16(742),
  ...u32(0),
  ...u32(2431),
  ...u32(1799),
  ...u32(1234567890),
  ...u32(4000),
  ...u32(88000),
  ...u32(1200),
  ...u32(45),
  ...u32(3000000000),
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01, // mail state
  0x01,
  0x02,
  30,
  0x00,
  0xf6, // armour class -10
  12,
  9
]

const inventory = (
  slot: number,
  sprite: number,
  name: string,
  quantity: number,
  canStack: boolean
): number[] => [
  ServerOpcode.AddInventory,
  slot,
  ...u16(sprite),
  0,
  ...str8(name),
  ...u32(quantity),
  canStack ? 1 : 0,
  ...u32(0),
  ...u32(0)
]

const equip = (slot: number, sprite: number, name: string, max: number, cur: number): number[] => [
  ServerOpcode.AddEquip,
  slot,
  ...u16(sprite),
  0,
  ...str8(name),
  0,
  ...u32(max),
  ...u32(cur)
]

const string16 = (text: string): number[] => [...u16(text.length), ...Buffer.from(text, 'latin1')]

/** SScreenMenu 0x2F type 4 with the bank's pursuit: the withdraw list. */
const BANK = [
  ServerOpcode.ScreenMenu,
  4,
  0x01,
  ...u32(0x1f6f),
  0x00,
  ...u16(0x4038),
  0x00,
  0x01,
  ...u16(0x4038),
  0x00,
  0x00,
  ...str8(FIXTURE_BANKER),
  ...string16('Here is what you have deposited with me previously. '),
  ...u16(BANK_WITHDRAW_PURSUIT),
  ...u16(FIXTURE_BANK_ITEMS.length),
  ...FIXTURE_BANK_ITEMS.flatMap((row) => [
    ...u16(row.sprite),
    0,
    ...u32(row.count),
    ...str8(row.name),
    ...str8(' ')
  ])
]

export function fixtureLines(): RecordingLine[] {
  let sequence = 0
  const world = (body: number[], atMs: number): RecordingLine =>
    encodeChunk(
      chunk(
        WORLD,
        sessionBody({
          plaintext: body,
          keyName: FIXTURE_CHARACTER,
          saltSelector: 3,
          sequence: ++sequence
        }),
        atMs
      )
    )
  return [
    { kind: 'header', version: 1, startedAtMs: T0 },
    { kind: 'open', ...LOGIN },
    encodeChunk(
      chunk(
        LOGIN,
        redirectBody({
          address: WORLD.remoteAddress,
          port: WORLD.remotePort,
          name: FIXTURE_CHARACTER,
          saltSelector: 3
        }),
        T0 + 500
      )
    ),
    { kind: 'close', id: LOGIN.id, timestampMs: T0 + 600 },
    { kind: 'open', ...WORLD },
    world(STATUS, T0 + 1100),
    world(inventory(1, 0x0021, 'Raw Fish', 65, true), T0 + 1200),
    world(inventory(2, 0x8053, 'Bent Crux', 1, false), T0 + 1300),
    world(equip(1, 0x8100, 'Staff of Ages', 500, 400), T0 + 1400),
    world(BANK, T0 + 60_000),
    { kind: 'close', id: WORLD.id, timestampMs: T0 + 120_000 }
  ]
}

export function fixtureText(): string {
  return fixtureLines().map(serialiseLine).join('')
}

describe('the e2e fixture recording', () => {
  it('is the committed file, byte for byte', () => {
    const text = fixtureText()
    if (process.env['WRITE_E2E_FIXTURE'] === '1') writeFileSync(FIXTURE_PATH, text)
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(text)
  })

  it('decodes through the tracker: the login, the items, the equip, the bank', async () => {
    const kinds: string[] = []
    let keyName: string | undefined
    const tracker = createSessionTracker((event) => {
      if (event.event.type !== 'packet') {
        kinds.push(`unreadable:${event.event.reason}`)
        return
      }
      kinds.push(event.event.packet.kind)
      keyName = event.keyName ?? keyName
      if (event.event.packet.kind === 'bankContents') {
        expect(event.event.packet.npcName).toBe(FIXTURE_BANKER)
        expect(event.event.packet.items.map((i) => i.name)).toEqual(
          FIXTURE_BANK_ITEMS.map((i) => i.name)
        )
      }
    })
    await createReplaySource(fixtureLines()).start(tracker)
    expect(kinds).toEqual([
      'transferServer',
      'status',
      'addInventory',
      'addInventory',
      'addEquip',
      'bankContents'
    ])
    expect(keyName).toBe(FIXTURE_CHARACTER)
  })
})
