import { describe, expect, it } from 'vitest'
import { ClientOpcode, opcodeName, ServerOpcode, transformFor } from '../opcodes'

describe('transformFor', () => {
  it('marks the three raw client opcodes', () => {
    for (const opcode of [0x00, 0x10, 0x48]) {
      expect(transformFor(opcode, 'clientToServer'), `0x${opcode.toString(16)}`).toBe('none')
    }
  })

  it('marks the sixteen startup-key client opcodes', () => {
    const startup = [
      0x02, 0x03, 0x04, 0x0b, 0x26, 0x2d, 0x3a, 0x42, 0x43, 0x4b, 0x57, 0x62, 0x68, 0x71, 0x73, 0x7b
    ]
    expect(startup).toHaveLength(16)
    for (const opcode of startup) {
      expect(transformFor(opcode, 'clientToServer'), `0x${opcode.toString(16)}`).toBe('startup')
    }
  })

  it('marks the three raw server opcodes', () => {
    for (const opcode of [0x00, 0x03, 0x40]) {
      expect(transformFor(opcode, 'serverToClient'), `0x${opcode.toString(16)}`).toBe('none')
    }
  })

  it('marks the eight startup-key server opcodes', () => {
    const startup = [0x01, 0x02, 0x0a, 0x56, 0x60, 0x62, 0x66, 0x6f]
    expect(startup).toHaveLength(8)
    for (const opcode of startup) {
      expect(transformFor(opcode, 'serverToClient'), `0x${opcode.toString(16)}`).toBe('startup')
    }
  })

  it('treats every other opcode as a session packet', () => {
    for (const opcode of [ServerOpcode.Status, ServerOpcode.AddInventory, ServerOpcode.SelfLook]) {
      expect(transformFor(opcode, 'serverToClient')).toBe('session')
    }
    expect(transformFor(0x06, 'clientToServer')).toBe('session')
  })

  it('keeps the two directions apart', () => {
    // 0x10 is raw from the client but a session packet from the server.
    expect(transformFor(0x10, 'clientToServer')).toBe('none')
    expect(transformFor(0x10, 'serverToClient')).toBe('session')
    // 0x0A is a startup-key packet from the server and a session packet from
    // the client.
    expect(transformFor(0x0a, 'serverToClient')).toBe('startup')
    expect(transformFor(0x0a, 'clientToServer')).toBe('session')
    // 0x40 is raw from the server only.
    expect(transformFor(0x40, 'serverToClient')).toBe('none')
    expect(transformFor(0x40, 'clientToServer')).toBe('session')
  })
})

describe('opcodeName', () => {
  it('names a modelled server opcode', () => {
    expect(opcodeName(ServerOpcode.AddInventory, 'serverToClient')).toBe('AddInventory')
    expect(opcodeName(ServerOpcode.SelfLook, 'serverToClient')).toBe('SelfLook')
  })

  it('names a modelled client opcode', () => {
    expect(opcodeName(ClientOpcode.Login, 'clientToServer')).toBe('Login')
  })

  it('falls back to the hexadecimal value', () => {
    expect(opcodeName(0x5b, 'serverToClient')).toBe('0x5b')
    expect(opcodeName(0x06, 'clientToServer')).toBe('0x06')
  })
})
