import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  applyXorTransform,
  buildMd5Source,
  buildSaltTable,
  CLIENT_INTEGRITY_LENGTH,
  decryptSession,
  decryptStartup,
  KEY_LENGTH,
  MD5_SOURCE_LENGTH,
  readSeeds,
  saltTable,
  SALT_TABLE_COUNT,
  SEED_TRAILER_LENGTH,
  selectSessionKey,
  STARTUP_KEY,
  type CipherState,
  type Direction
} from '../cipher'
import hybrasylSaltTables from './fixtures/hybrasylSaltTables.json'

// The readable text the client's constructor starts from, before it replaces
// bytes 3 and 7. Decrypting with this instead of STARTUP_KEY is the classic
// wrong-key mistake, and it corrupts one byte in nine twice over.
const READABLE_KEY = new Uint8Array([...'UrkcnItnI'].map((c) => c.charCodeAt(0)))

const MASKS: Record<Direction, { low: number; seed8: number; high: number }> = {
  clientToServer: { low: 0x70, seed8: 0x23, high: 0x74 },
  serverToClient: { low: 0x74, seed8: 0x24, high: 0x64 }
}

/**
 * Build an encrypted body the way a sender would. The transform is its own
 * inverse, so the test uses the same primitive the decoder uses.
 */
function buildEncryptedBody(options: {
  opcode: number
  sequence: number
  plaintext: Uint8Array
  key: Uint8Array
  saltSelector: number
  direction: Direction
  seed16?: number
  seed8?: number
}): Uint8Array {
  const { opcode, sequence, plaintext, key, saltSelector, direction } = options
  const seed16 = options.seed16 ?? 0x0100
  const seed8 = options.seed8 ?? 0x64

  const payload = Uint8Array.from(plaintext)
  applyXorTransform(payload, key, saltTable(saltSelector), sequence)

  const integrity = direction === 'clientToServer' ? CLIENT_INTEGRITY_LENGTH : 0
  const body = new Uint8Array(2 + payload.length + integrity + SEED_TRAILER_LENGTH)
  body[0] = opcode
  body[1] = sequence
  body.set(payload, 2)

  const mask = MASKS[direction]
  const at = body.length - SEED_TRAILER_LENGTH
  body[at] = (seed16 & 0xff) ^ mask.low
  body[at + 1] = seed8 ^ mask.seed8
  body[at + 2] = ((seed16 >> 8) & 0xff) ^ mask.high
  return body
}

const ascii = (text: string): Uint8Array => Uint8Array.from([...text].map((c) => c.charCodeAt(0)))

describe('buildSaltTable', () => {
  it('reproduces every Hybrasyl salt table byte for byte', () => {
    // Hybrasyl ships the ten tables as literal arrays. The client generates
    // them from formulas. Two independent sources, so agreement is evidence.
    for (let selector = 0; selector < SALT_TABLE_COUNT; selector++) {
      expect([...buildSaltTable(selector)], `selector ${selector}`).toEqual(
        hybrasylSaltTables[selector]
      )
    }
  })

  it('makes selector 0 the identity table', () => {
    const table = buildSaltTable(0)
    for (let i = 0; i < 256; i++) expect(table[i]).toBe(i)
  })

  it('rejects a selector outside 0 through 9', () => {
    expect(() => buildSaltTable(10)).toThrow(RangeError)
    expect(() => buildSaltTable(-1)).toThrow(RangeError)
    expect(() => buildSaltTable(1.5)).toThrow(RangeError)
  })
})

describe('STARTUP_KEY', () => {
  it('differs from the readable text by 0x86 at byte 3 and 0xCD at byte 7', () => {
    // The client builds the key from "UrkcnItnI" and then replaces two bytes.
    // This is the difference the RE notes call out, so it pins the constant.
    const difference = STARTUP_KEY.map((b, i) => b ^ READABLE_KEY[i]!)
    expect([...difference]).toEqual([0, 0, 0, 0x86, 0, 0, 0, 0xcd, 0])
  })
})

describe('buildMd5Source', () => {
  it('produces 1024 lowercase hexadecimal ASCII bytes', () => {
    const source = buildMd5Source('Sabrael')
    expect(source).toHaveLength(MD5_SOURCE_LENGTH)
    const text = String.fromCharCode(...source)
    expect(text).toMatch(/^[0-9a-f]{1024}$/)
  })

  it('starts with the double MD5 of the name, then appends 31 more hashes', () => {
    // table = md5Hex(md5Hex(name)), then 31 times table += md5Hex(table).
    // Rebuild it here with the platform hash so the shape is pinned, not the
    // implementation.
    const hex = (text: string): string => createHash('md5').update(text, 'latin1').digest('hex')

    let expected = hex(hex('Sabrael'))
    expect(expected).toHaveLength(32)
    for (let i = 0; i < 31; i++) expected += hex(expected)

    expect(String.fromCharCode(...buildMd5Source('Sabrael'))).toBe(expected)
  })

  it('gives a different source for a different name', () => {
    expect([...buildMd5Source('Sabrael')]).not.toEqual([...buildMd5Source('sabrael')])
  })
})

describe('selectSessionKey', () => {
  it('returns nine bytes drawn from the source', () => {
    const source = buildMd5Source('Sabrael')
    const key = selectSessionKey(source, 0x1234, 0x64)
    expect(key).toHaveLength(KEY_LENGTH)
    for (const byte of key) expect([...source]).toContain(byte)
  })

  it('follows index = (seed16 + (seed8 * seed8 + 9i) * i) mod 1024', () => {
    const source = buildMd5Source('Sabrael')
    const seed16 = 0x0abc
    const seed8 = 0x7f
    const key = selectSessionKey(source, seed16, seed8)
    for (let i = 0; i < KEY_LENGTH; i++) {
      expect(key[i]).toBe(source[(seed16 + (seed8 * seed8 + 9 * i) * i) % 1024])
    }
  })

  it('changes when either seed changes', () => {
    const source = buildMd5Source('Sabrael')
    const base = [...selectSessionKey(source, 0x0100, 0x64)]
    expect([...selectSessionKey(source, 0x0101, 0x64)]).not.toEqual(base)
    expect([...selectSessionKey(source, 0x0100, 0x65)]).not.toEqual(base)
  })
})

describe('applyXorTransform', () => {
  it('is its own inverse', () => {
    const salt = saltTable(7)
    const key = STARTUP_KEY
    const original = ascii('the quick brown fox jumps over the lazy dog')

    const working = Uint8Array.from(original)
    applyXorTransform(working, key, salt, 3)
    expect([...working]).not.toEqual([...original])
    applyXorTransform(working, key, salt, 3)
    expect([...working]).toEqual([...original])
  })

  it('applies exactly one salt XOR inside the block whose index is the sequence', () => {
    // Every other block takes salt[block] and salt[sequence]. The sequence
    // block would take the same byte twice, so exactly one must survive.
    const salt = saltTable(5)
    const sequence = 2
    const payload = new Uint8Array(45) // five nine-byte blocks
    applyXorTransform(payload, STARTUP_KEY, salt, sequence)

    for (let i = 0; i < payload.length; i++) {
      const block = Math.trunc(i / KEY_LENGTH)
      const expected =
        block === sequence
          ? STARTUP_KEY[i % KEY_LENGTH]! ^ salt[sequence]!
          : STARTUP_KEY[i % KEY_LENGTH]! ^ salt[block]! ^ salt[sequence]!
      expect(payload[i], `byte ${i}, block ${block}`).toBe(expected)
    }
  })

  it('handles an empty payload', () => {
    const payload = new Uint8Array(0)
    expect(() => applyXorTransform(payload, STARTUP_KEY, saltTable(0), 0)).not.toThrow()
  })
})

describe('readSeeds', () => {
  it('recovers the seeds a client-direction sender wrote', () => {
    const body = buildEncryptedBody({
      opcode: 0x0e,
      sequence: 5,
      plaintext: ascii('hello'),
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'clientToServer',
      seed16: 0xfe12,
      seed8: 0x9a
    })
    expect(readSeeds(body, 'clientToServer')).toEqual({ seed16: 0xfe12, seed8: 0x9a })
  })

  it('recovers the seeds a server-direction sender wrote', () => {
    const body = buildEncryptedBody({
      opcode: 0x08,
      sequence: 200,
      plaintext: ascii('hello'),
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'serverToClient',
      seed16: 0x0100,
      seed8: 0x64
    })
    expect(readSeeds(body, 'serverToClient')).toEqual({ seed16: 0x0100, seed8: 0x64 })
  })

  it('uses different mask constants for the two directions', () => {
    const body = buildEncryptedBody({
      opcode: 0x08,
      sequence: 1,
      plaintext: ascii('x'),
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'serverToClient',
      seed16: 0x0100,
      seed8: 0x64
    })
    expect(readSeeds(body, 'clientToServer')).not.toEqual({ seed16: 0x0100, seed8: 0x64 })
  })

  it('rejects a body too short to hold a trailer', () => {
    expect(() => readSeeds(new Uint8Array(2), 'serverToClient')).toThrow(RangeError)
  })
})

describe('decryptStartup', () => {
  const state: CipherState = { saltSelector: 0, startupKey: STARTUP_KEY }

  it('recovers the plaintext body, opcode first', () => {
    const plaintext = ascii('\x0aYou have been idle for too long.')
    const body = buildEncryptedBody({
      opcode: 0x0a,
      sequence: 17,
      plaintext: plaintext.slice(1),
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'serverToClient'
    })
    expect([...decryptStartup(body, state, 'serverToClient')]).toEqual([...plaintext])
  })

  it('reproduces the wrong-key artefact when the readable text is used as the key', () => {
    // The RE notes describe a capture that decoded to readable English except
    // for the bytes the 0x86/0xCD difference touches. Reproduce that exactly.
    const message = 'You have been idle for too long. Your connection has been closed.'
    const plaintext = ascii(message)
    const body = buildEncryptedBody({
      opcode: 0x0a,
      sequence: 0,
      plaintext,
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'serverToClient'
    })

    const right = decryptStartup(body, state, 'serverToClient')
    expect(String.fromCharCode(...right.slice(1))).toBe(message)

    const wrong = decryptStartup(
      body,
      { saltSelector: 0, startupKey: READABLE_KEY },
      'serverToClient'
    )
    for (let i = 0; i < plaintext.length; i++) {
      const slot = i % KEY_LENGTH
      const difference = slot === 3 ? 0x86 : slot === 7 ? 0xcd : 0x00
      expect(wrong[i + 1], `byte ${i}`).toBe(plaintext[i]! ^ difference)
    }
  })

  it('drops the four integrity bytes in the client direction', () => {
    const plaintext = ascii('Sabrael')
    const body = buildEncryptedBody({
      opcode: 0x03,
      sequence: 0,
      plaintext,
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'clientToServer'
    })
    const plain = decryptStartup(body, state, 'clientToServer')
    expect(plain).toHaveLength(1 + plaintext.length)
    expect(String.fromCharCode(...plain.slice(1))).toBe('Sabrael')
  })

  it('rejects a body too short to decrypt', () => {
    expect(() => decryptStartup(new Uint8Array(4), state, 'serverToClient')).toThrow(RangeError)
  })
})

describe('decryptSession', () => {
  const md5Source = buildMd5Source('Sabrael')

  it('round-trips through every salt selector and several sequences', () => {
    const plaintext = ascii('slot 1, a stack of 27 things, and a longer tail to cross blocks')

    for (let saltSelector = 0; saltSelector < SALT_TABLE_COUNT; saltSelector++) {
      for (const sequence of [0, 1, 9, 128, 255]) {
        const seed16 = 0x0100 + saltSelector * 37 + sequence
        const seed8 = 0x64 + ((saltSelector * 11 + sequence) % 0x9b)
        const key = selectSessionKey(md5Source, seed16, seed8)
        const body = buildEncryptedBody({
          opcode: 0x0f,
          sequence,
          plaintext,
          key,
          saltSelector,
          direction: 'serverToClient',
          seed16,
          seed8
        })
        const plain = decryptSession(
          body,
          { saltSelector, startupKey: STARTUP_KEY, md5Source },
          'serverToClient'
        )
        expect([...plain.slice(1)], `selector ${saltSelector}, sequence ${sequence}`).toEqual([
          ...plaintext
        ])
        expect(plain[0]).toBe(0x0f)
      }
    }
  })

  it('decodes each packet on its own, so a gap does not stop the next packet', () => {
    // The seeds and the sequence travel inside each packet. Decoding packet
    // three must not need packets one and two.
    const state: CipherState = { saltSelector: 4, startupKey: STARTUP_KEY, md5Source }
    const third = buildEncryptedBody({
      opcode: 0x08,
      sequence: 3,
      plaintext: ascii('third'),
      key: selectSessionKey(md5Source, 0x2222, 0x70),
      saltSelector: 4,
      direction: 'serverToClient',
      seed16: 0x2222,
      seed8: 0x70
    })
    expect(String.fromCharCode(...decryptSession(third, state, 'serverToClient').slice(1))).toBe(
      'third'
    )
  })

  it('refuses to decrypt before the character name is known', () => {
    const body = buildEncryptedBody({
      opcode: 0x08,
      sequence: 0,
      plaintext: ascii('x'),
      key: STARTUP_KEY,
      saltSelector: 0,
      direction: 'serverToClient'
    })
    expect(() =>
      decryptSession(body, { saltSelector: 0, startupKey: STARTUP_KEY }, 'serverToClient')
    ).toThrow(/character name/)
  })

  it('produces the wrong plaintext for the wrong character name', () => {
    const seed16 = 0x0abc
    const seed8 = 0x64
    const body = buildEncryptedBody({
      opcode: 0x08,
      sequence: 2,
      plaintext: ascii('Sabrael the Wanderer'),
      key: selectSessionKey(md5Source, seed16, seed8),
      saltSelector: 0,
      direction: 'serverToClient',
      seed16,
      seed8
    })
    const other = decryptSession(
      body,
      { saltSelector: 0, startupKey: STARTUP_KEY, md5Source: buildMd5Source('Someone') },
      'serverToClient'
    )
    expect(String.fromCharCode(...other.slice(1))).not.toBe('Sabrael the Wanderer')
  })
})
