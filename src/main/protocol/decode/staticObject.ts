import { PacketReader } from '../reader'

/**
 * SStaticObjectState 0x32. A static object on the map changed state: a door.
 *
 * Body: `[u8 opcode][u8 count]` then `count` records of
 * `[u8 x][u8 y][u8 state][u8 side]`. Both protocol sources agree on the shape,
 * and the document repo's page binary-verifies it (`SStaticObjectState::Process`
 * at 0x0059c290 reads one count byte and four bytes per record). Retail
 * batches: a two-panel door is one packet with `count` 2 (Abel Port, 2026-09-21).
 * A packet with `count` 0 is the same opcode used as a walk acknowledgement,
 * and decodes to no records.
 *
 * `state` is 0 for the open form and any other value for the closed form: the
 * client looks the object's current tile id up in its 66-pair table and moves
 * it to column 1 for 0, column 0 otherwise (`route/doorTable.ts`). `side`
 * chooses one of the cell's two static slots. Which one is a measurement, not
 * a name: against four map caches (505, 3048, 502, 501) every side-1 record
 * lands on the cell's first static (file offset +2) and every side-0 record on
 * its second (+4). The second protocol source names those slots the other way
 * round, so this decoder carries the byte and `mapGrid.ts` carries the offset.
 *
 * Trailing bytes are not fields: one recorded packet carried an extra zero
 * after its last record.
 */
export interface StaticObjectRecord {
  x: number
  y: number
  /** 0 is the open form; any other value is the closed form. */
  state: number
  /** The static slot: non-zero is the cell's first static, 0 its second. */
  side: number
}

export interface StaticObjectState {
  kind: 'staticObjectState'
  records: StaticObjectRecord[]
}

/** The bytes one record holds. */
const RECORD_BYTES = 4

export function decodeStaticObjectState(body: Uint8Array): StaticObjectState {
  const reader = new PacketReader(body, 1)
  const count = reader.u8()
  const records: StaticObjectRecord[] = []
  for (let i = 0; i < count && reader.remaining >= RECORD_BYTES; i++) {
    records.push({ x: reader.u8(), y: reader.u8(), state: reader.u8(), side: reader.u8() })
  }
  return { kind: 'staticObjectState', records }
}
