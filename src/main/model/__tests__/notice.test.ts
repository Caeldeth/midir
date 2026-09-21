import { describe, expect, it } from 'vitest'
import { reduceNotice } from '../notice'
import type { SystemMessage } from '../../protocol/decode/message'
import type { DecodedPacket } from '../../protocol/decode'

function message(messageType: number, text: string): SystemMessage {
  return { kind: 'systemMessage', messageType, text }
}

describe('reduceNotice', () => {
  it('keeps the newest notice with its capture time', () => {
    const first = reduceNotice(null, { packet: message(3, 'one'), timestampMs: 1000 })
    const second = reduceNotice(first, { packet: message(3, 'two'), timestampMs: 2000 })
    expect(first).toEqual({ packet: message(3, 'one'), asOfMs: 1000 })
    expect(second).toEqual({ packet: message(3, 'two'), asOfMs: 2000 })
  })

  it('skips a settings row, which is not a message to the player', () => {
    const state = reduceNotice(null, { packet: message(3, 'one'), timestampMs: 1000 })
    expect(reduceNotice(state, { packet: message(7, '1Listen:ON'), timestampMs: 2000 })).toBe(state)
  })

  it('leaves the state alone for any other packet', () => {
    const state = reduceNotice(null, { packet: message(3, 'one'), timestampMs: 1000 })
    const walk: DecodedPacket = { kind: 'walk', direction: 0, step: 1 }
    expect(reduceNotice(state, { packet: walk, timestampMs: 2000 })).toBe(state)
  })

  it('forgets the notice after a lost packet', () => {
    const state = reduceNotice(null, { packet: message(3, 'one'), timestampMs: 1000 })
    const walk: DecodedPacket = { kind: 'walk', direction: 0, step: 1 }
    expect(reduceNotice(state, { packet: walk, timestampMs: 2000, sawLoss: true })).toBeNull()
  })
})
