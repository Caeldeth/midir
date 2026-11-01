import { describe, expect, it } from 'vitest'
import type { EpfFrame } from '@eriscorp/dalib-ts'
import { hasPixels } from '../epfFrame'

function frame(left: number, top: number, right: number, bottom: number): EpfFrame {
  const size = Math.max(0, right - left) * Math.max(0, bottom - top)
  return { left, top, right, bottom, data: new Uint8Array(size) }
}

describe('hasPixels', () => {
  it('is true for a frame with an area', () => {
    expect(hasPixels(frame(0, 0, 32, 32))).toBe(true)
    expect(hasPixels(frame(4, 2, 5, 3))).toBe(true)
  })

  it('is false for a placeholder, which dalib-ts keeps since 3.2.0', () => {
    expect(hasPixels(frame(0, 0, 0, 0))).toBe(false)
  })

  it('is false when only one side is zero', () => {
    expect(hasPixels(frame(0, 0, 32, 0))).toBe(false)
    expect(hasPixels(frame(0, 0, 0, 32))).toBe(false)
  })
})
