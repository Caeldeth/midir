import { describe, expect, it } from 'vitest'
import { decodePursuitMessage } from '../decode/pursuit'

/**
 * The bodies here are built to the shape both protocol sources pin for
 * SPursuitMessage 0x30, with invented prose. The one fact under test that
 * carries a rule is dialogType 9, the credential pane the Laborer must refuse.
 */

function string8(text: string): number[] {
  return [text.length, ...[...text].map((c) => c.charCodeAt(0))]
}

function string16(text: string): number[] {
  return [text.length >> 8, text.length & 0xff, ...[...text].map((c) => c.charCodeAt(0))]
}

function u16(value: number): number[] {
  return [value >> 8, value & 0xff]
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

interface DialogOptions {
  dialogType: number
  sourceId?: number
  npcName?: string
  pursuit?: number
  step?: number
  hasPrevious?: boolean
  hasNext?: boolean
  text?: string
  choices?: string[]
  /** For a text-entry dialog: the prolog, the max, and the epilog. */
  input?: { prolog: string; max: number; epilog: string }
  trailing?: number[]
}

const TEXT_TYPES = new Set([0, 2, 4, 6, 9])
const OPTION_TYPES = new Set([2, 3, 6])
const INPUT_TYPES = new Set([4, 5, 9])

/** Build one SPursuitMessage 0x30 body, opcode first. */
function pursuitMessage(options: DialogOptions): Uint8Array {
  const type = options.dialogType
  const bytes: number[] = [
    0x30,
    type,
    0x01, // object type: creature
    ...u32(options.sourceId ?? 0x1f6f),
    0x00, // read and discarded
    ...u16(0x4038), // sprite
    0x00, // colour
    0x00, // read and discarded
    ...u16(0x4038), // sprite2, discarded
    0x00, // colour2, discarded
    ...u16(options.pursuit ?? 0x0064),
    ...u16(options.step ?? 1),
    options.hasPrevious ? 1 : 0,
    options.hasNext ? 1 : 0,
    0x00, // unknown / show-graphic
    ...string8(options.npcName ?? 'Donnan')
  ]
  if (TEXT_TYPES.has(type)) bytes.push(...string16(options.text ?? 'A line of dialog. '))
  if (OPTION_TYPES.has(type)) {
    const choices = options.choices ?? []
    bytes.push(choices.length, ...choices.flatMap((choice) => string8(choice)))
  }
  if (INPUT_TYPES.has(type)) {
    const input = options.input ?? { prolog: 'Name: ', max: 16, epilog: '' }
    bytes.push(...string8(input.prolog), input.max, ...string8(input.epilog))
  }
  if (options.trailing) bytes.push(...options.trailing)
  return Uint8Array.from(bytes)
}

describe('decodePursuitMessage', () => {
  it('reads a plain text dialog', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({ dialogType: 0, npcName: 'Donnan', text: 'Well met. ', pursuit: 0x0064 })
    )
    expect(decoded).toMatchObject({
      kind: 'pursuitMessage',
      dialogType: 0,
      dialogKind: 'text',
      npcName: 'Donnan',
      pursuit: 0x0064,
      text: 'Well met. ',
      isProtected: false
    })
    expect(decoded.options).toBeUndefined()
  })

  it('reads an options menu, in wire order', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({
        dialogType: 2,
        text: 'What do you need? ',
        choices: ['Give clout', 'Ask about work', 'Nothing']
      })
    )
    expect(decoded.dialogKind).toBe('options')
    expect(decoded.options).toEqual([
      { text: 'Give clout' },
      { text: 'Ask about work' },
      { text: 'Nothing' }
    ])
  })

  it('reads a simple options menu, which carries no prose', () => {
    const decoded = decodePursuitMessage(pursuitMessage({ dialogType: 3, choices: ['Yes', 'No'] }))
    expect(decoded.dialogKind).toBe('options')
    expect(decoded.text).toBeUndefined()
    expect(decoded.options).toEqual([{ text: 'Yes' }, { text: 'No' }])
  })

  it('reads a text-entry dialog without failing on its body', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({
        dialogType: 4,
        text: 'How many? ',
        input: { prolog: '', max: 8, epilog: '' }
      })
    )
    expect(decoded.dialogKind).toBe('textInput')
    expect(decoded.text).toBe('How many? ')
    expect(decoded.isProtected).toBe(false)
  })

  it('flags dialogType 9 as protected, the credential pane', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({ dialogType: 9, text: 'Enter your account. ' })
    )
    expect(decoded.dialogKind).toBe('protected')
    expect(decoded.isProtected).toBe(true)
  })

  it('reads the close variant, which ends the packet at the type byte', () => {
    const decoded = decodePursuitMessage(Uint8Array.from([0x30, 0x0a]))
    expect(decoded.dialogKind).toBe('close')
    expect(decoded.isProtected).toBe(false)
  })

  it('reads the close variant even with the reference server trailing byte', () => {
    const decoded = decodePursuitMessage(Uint8Array.from([0x30, 0x0a, 0x00]))
    expect(decoded.dialogKind).toBe('close')
  })

  it('carries the previous and next flags', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({ dialogType: 0, hasPrevious: true, hasNext: false })
    )
    expect(decoded.hasPrevious).toBe(true)
    expect(decoded.hasNext).toBe(false)
  })

  it('accepts a body longer than the fields it reads', () => {
    const decoded = decodePursuitMessage(
      pursuitMessage({ dialogType: 0, trailing: [0xaa, 0xbb, 0xcc] })
    )
    expect(decoded.dialogType).toBe(0)
  })
})
