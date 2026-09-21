import { describe, expect, it } from 'vitest'
import { decodeServerPacket } from '../decode'
import { decodeSystemMessage } from '../decode/message'

/** The refusal an unregistered character gets for Labor. Captured 2026-09-21. */
const REGISTER_FIRST = Uint8Array.from(
  Buffer.from(
    '0a03003a28282052656769737465722066697273743a207777772e6461726b616765732e636f6d202d3e20436c69636b2027526567697374657227202929',
    'hex'
  )
)

describe('decodeSystemMessage (SSystemMessage 0x0A)', () => {
  it('reads the type and the string16 text of the captured refusal', () => {
    expect(decodeSystemMessage(REGISTER_FIRST)).toEqual({
      kind: 'systemMessage',
      messageType: 3,
      text: "(( Register first: www.darkages.com -> Click 'Register' ))"
    })
  })

  it('reads the confirmation prompt with its three reply values', () => {
    const body = Uint8Array.from([
      0x0a, 0x11, 0x05, 0x06, 0x02, 0x41, 0x42, 0x00, 0x03, 0x59, 0x65, 0x73
    ])
    expect(decodeSystemMessage(body)).toEqual({
      kind: 'systemMessage',
      messageType: 0x11,
      text: 'Yes',
      confirm: { value0: 5, value1: 6, value: 'AB' }
    })
  })

  it('accepts trailing bytes after the text', () => {
    const body = Uint8Array.from([0x0a, 0x03, 0x00, 0x02, 0x48, 0x69, 0xff, 0xff])
    expect(decodeSystemMessage(body).text).toBe('Hi')
  })

  it('is registered for 0x0A in the server direction', () => {
    const packet = decodeServerPacket(REGISTER_FIRST)
    expect(packet?.kind).toBe('systemMessage')
  })
})
