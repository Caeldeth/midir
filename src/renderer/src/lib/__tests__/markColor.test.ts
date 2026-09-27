import { describe, expect, it } from 'vitest'
import { lightnessOf, parseHex, readableMarkColor } from '../markColor'

/**
 * The colour a legend mark is written in (WP42). The hue is the client's; the
 * lightness is moved only as far as the theme needs, so a mark is never written
 * in the background colour.
 *
 * The samples are real entries from the client's own text palette: index 1 aqua,
 * 32 near-white, 68 yellow, 88 blue, 128 green, 248 red.
 */

const AQUA = '#00ffff'
const NEAR_WHITE = '#ffe7eb'
const RED = '#ff0000'
const GREEN = '#00ff00'
const BLUE = '#7fa7f3'

describe('parseHex', () => {
  it('reads a six-digit colour', () => {
    expect(parseHex('#ffe7eb')).toEqual({ r: 255, g: 231, b: 235 })
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('refuses anything else, so the caller leaves the text alone', () => {
    expect(parseHex('red')).toBeNull()
    expect(parseHex('#fff')).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})

describe('readableMarkColor', () => {
  it('leaves a colour the theme can show', () => {
    expect(readableMarkColor(RED, 'light')).toBe(RED)
    expect(readableMarkColor(BLUE, 'dark')).toBe(BLUE)
  })

  it('darkens a near-white mark on a light theme, instead of losing it', () => {
    const result = readableMarkColor(NEAR_WHITE, 'light')
    expect(result).not.toBe(NEAR_WHITE)
    expect(lightnessOf(parseHex(result!)!)).toBeLessThan(lightnessOf(parseHex(NEAR_WHITE)!))
    expect(lightnessOf(parseHex(result!)!)).toBeCloseTo(0.62, 1)
  })

  it('lifts a near-black mark on a dark theme', () => {
    const result = readableMarkColor('#100804', 'dark')
    expect(lightnessOf(parseHex(result!)!)).toBeGreaterThan(0.3)
  })

  it('keeps the hue when it moves the lightness', () => {
    // Near-white is pink-ish: red stays the strongest channel after darkening.
    const darkened = parseHex(readableMarkColor(NEAR_WHITE, 'light')!)!
    expect(darkened.r).toBeGreaterThan(darkened.g)
    expect(darkened.b).toBeGreaterThan(darkened.g)
    // Green stays green when it is lifted.
    const lifted = parseHex(readableMarkColor('#003300', 'dark')!)!
    expect(lifted.g).toBeGreaterThan(lifted.r)
    expect(lifted.g).toBeGreaterThan(lifted.b)
  })

  it('lifts pure black, which no scaling could', () => {
    const result = parseHex(readableMarkColor('#000000', 'dark')!)!
    expect(result.r).toBeGreaterThan(0)
    expect(lightnessOf(result)).toBeCloseTo(0.34, 1)
  })

  it('shows aqua and green as themselves on a dark theme', () => {
    expect(readableMarkColor(AQUA, 'dark')).toBe(AQUA)
    expect(readableMarkColor(GREEN, 'dark')).toBe(GREEN)
  })

  it('gives nothing back for a colour it cannot read', () => {
    expect(readableMarkColor('not a colour', 'dark')).toBeUndefined()
  })
})
