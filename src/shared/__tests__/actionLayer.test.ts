import { describe, expect, it } from 'vitest'
import { MAX_CHAT_CHARS, MIN_HYPHEN_FRAGMENT, wrapChatLine } from '../actionLayer'

/** True when a hyphen sits next to a space, which must never happen. */
function hasSpacedHyphen(piece: string): boolean {
  return / -|- /.test(piece)
}

describe('wrapChatLine', () => {
  it('leaves a line within the limit unchanged', () => {
    expect(wrapChatLine('short')).toEqual(['short'])
    const exact = 'a'.repeat(MAX_CHAT_CHARS)
    expect(wrapChatLine(exact)).toEqual([exact])
  })

  it('breaks a long line of words at the spaces, with no hyphens', () => {
    // Twelve four-letter words fill a line exactly (12*4 + 11 spaces = 59).
    const text = Array.from({ length: 20 }, () => 'word').join(' ')
    const pieces = wrapChatLine(text)
    expect(pieces).toEqual(['word '.repeat(12).trim(), 'word '.repeat(8).trim()])
    for (const piece of pieces) expect(piece).not.toContain('-')
  })

  it('never hyphenates a space, so a space after a period stays whole', () => {
    const text = `${'ab '.repeat(19)}end. Beginning again now here`
    for (const piece of wrapChatLine(text)) {
      expect(hasSpacedHyphen(piece)).toBe(false)
      expect(piece.startsWith(' ')).toBe(false)
      expect(piece.endsWith(' ')).toBe(false)
    }
  })

  it('moves a whole word down rather than leave a tiny fragment', () => {
    // The line fills to 55, then a seven-letter word would only fit a two-letter
    // fragment before the hyphen — under the minimum — so it moves whole.
    const text = `${'a'.repeat(55)} bcdefgh`
    expect(wrapChatLine(text)).toEqual(['a'.repeat(55), 'bcdefgh'])
  })

  it('hyphenates only when both fragments stay above the minimum', () => {
    const long = 'a'.repeat(80)
    const text = `${'x'.repeat(40)} ${long}`
    const pieces = wrapChatLine(text)
    const hyphenated = pieces.filter((p) => p.endsWith('-'))
    expect(hyphenated.length).toBeGreaterThan(0)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_CHAT_CHARS)
      expect(hasSpacedHyphen(piece)).toBe(false)
    }
    // Each hyphenated word fragment keeps more than three letters.
    for (const piece of pieces) {
      if (!piece.endsWith('-')) continue
      const fragment = piece.slice(0, -1).split(' ').pop() ?? ''
      expect(fragment.length).toBeGreaterThanOrEqual(MIN_HYPHEN_FRAGMENT)
    }
  })

  it('breaks a single over-long word and keeps every character', () => {
    const text = 'z'.repeat(150)
    const pieces = wrapChatLine(text)
    expect(pieces.length).toBeGreaterThan(2)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_CHAT_CHARS)
      // The tail of a break is never a tiny orphan.
      const tail = piece.endsWith('-') ? piece.slice(0, -1) : piece
      expect(tail.length).toBeGreaterThanOrEqual(MIN_HYPHEN_FRAGMENT)
    }
    // Recover the text by dropping the hyphen markers.
    const joined = pieces.map((p) => (p.endsWith('-') ? p.slice(0, -1) : p)).join('')
    expect(joined).toBe(text)
  })
})
