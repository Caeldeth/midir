import { describe, expect, it } from 'vitest'
import { reduceDialog, type DialogState } from '../dialog'
import type { PursuitMessage } from '../../protocol/decode/pursuit'
import type { NpcMenu } from '../../protocol/decode/dialog'
import type { DecodedPacket } from '../../protocol/decode'

function pursuit(overrides: Partial<PursuitMessage> = {}): PursuitMessage {
  return {
    kind: 'pursuitMessage',
    dialogType: 2,
    dialogKind: 'options',
    objectType: 1,
    sourceId: 0x1f6f,
    npcName: 'Donnan',
    pursuit: 0x0064,
    step: 1,
    hasPrevious: false,
    hasNext: false,
    isProtected: false,
    ...overrides
  }
}

function menu(overrides: Partial<NpcMenu> = {}): NpcMenu {
  return {
    kind: 'npcMenu',
    sourceId: 0x1f6f,
    npcName: 'Donnan',
    menuType: 0,
    text: 'What do you need? ',
    isTextInput: false,
    options: [],
    ...overrides
  }
}

const heartbeat: DecodedPacket = { kind: 'removeInventory', slot: 1 }

describe('reduceDialog', () => {
  it('keeps a scripted dialog as the one on screen', () => {
    const state = reduceDialog(null, { packet: pursuit(), timestampMs: 100 })
    expect(state).toEqual({ packet: pursuit(), asOfMs: 100 })
  })

  it('keeps an NPC menu as the one on screen', () => {
    const state = reduceDialog(null, { packet: menu(), timestampMs: 200 })
    expect(state?.packet.kind).toBe('npcMenu')
    expect(state?.asOfMs).toBe(200)
  })

  it('replaces the dialog when the next step arrives, with a new time', () => {
    const first = reduceDialog(null, { packet: pursuit({ step: 1 }), timestampMs: 100 })
    const second = reduceDialog(first, { packet: pursuit({ step: 2 }), timestampMs: 260 })
    expect((second?.packet as PursuitMessage).step).toBe(2)
    expect(second?.asOfMs).toBe(260)
  })

  it('leaves the dialog alone for an ordinary packet in between', () => {
    const first = reduceDialog(null, { packet: pursuit(), timestampMs: 100 })
    const after = reduceDialog(first, { packet: heartbeat, timestampMs: 150 })
    expect(after).toBe(first)
  })

  it('clears the dialog on a close', () => {
    const first = reduceDialog(null, { packet: pursuit(), timestampMs: 100 })
    const closed = reduceDialog(first, {
      packet: pursuit({ dialogType: 0x0a, dialogKind: 'close' }),
      timestampMs: 300
    })
    expect(closed).toBeNull()
  })

  it('clears the dialog on a lost packet', () => {
    const first: DialogState = { packet: pursuit(), asOfMs: 100 }
    const after = reduceDialog(first, { packet: heartbeat, timestampMs: 150, sawLoss: true })
    expect(after).toBeNull()
  })

  it('does not treat the bank menu as a conversation dialog', () => {
    const bank: DecodedPacket = {
      kind: 'bankContents',
      sourceId: 0x1f6f,
      npcName: 'Drave',
      items: []
    }
    const first = reduceDialog(null, { packet: pursuit(), timestampMs: 100 })
    const after = reduceDialog(first, { packet: bank, timestampMs: 150 })
    expect(after).toBe(first)
  })
})

describe('the client answer beside the dialog', () => {
  it('attaches CMerchant 0x39 to the menu on screen, and CPursuit 0x3A to a pursuit', () => {
    const shown = reduceDialog(null, {
      packet: menu({ options: [{ text: 'Labor', pursuit: 1335 }] }),
      timestampMs: 1000
    })
    const answered = reduceDialog(shown, {
      packet: {
        kind: 'merchantResponse',
        objectType: 1,
        objectId: 1,
        pursuit: 1335,
        tail: new Uint8Array()
      },
      timestampMs: 1500
    })
    expect(answered?.asOfMs).toBe(1000)
    expect(answered?.answer?.packet.kind).toBe('merchantResponse')
    expect(answered?.answer?.asOfMs).toBe(1500)
    const next = reduceDialog(answered, { packet: pursuit({ pursuit: 311 }), timestampMs: 2000 })
    expect(next?.answer).toBeUndefined()
    const typed = reduceDialog(next, {
      packet: {
        kind: 'pursuitResponse',
        objectType: 1,
        objectId: 1,
        pursuit: 311,
        step: 25,
        text: 'Pandsala'
      },
      timestampMs: 2500
    })
    expect(typed?.answer?.packet).toMatchObject({ kind: 'pursuitResponse', text: 'Pandsala' })
  })

  it('drops an answer with no dialog on screen', () => {
    expect(
      reduceDialog(null, {
        packet: {
          kind: 'merchantResponse',
          objectType: 1,
          objectId: 1,
          pursuit: 1335,
          tail: new Uint8Array()
        },
        timestampMs: 1500
      })
    ).toBeNull()
  })
})
