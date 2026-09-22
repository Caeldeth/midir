import { describe, expect, it } from 'vitest'
import { parseNameList } from './import-map-names.mjs'

/**
 * The map-name importer (WP38). The rows are the shapes the real list holds:
 * a plain row, a CP1252 en dash for the separator, a `*` marker, padding
 * spaces, a name the scrape never found, a repeated id, and a line that is
 * not a row at all.
 */
const LIST = [
  '001 - Mileth Crypt 1-1',
  '135 \x96 Mileth Storage',
  '206 - Kadath                          *',
  '3210 - Ironfort       (pk 11101)',
  '721 \x96 Grand Gen\x92s Room',
  '11 - null',
  '108 - null - former Loures? GM Map',
  '10130 - Andor 30',
  '10130 - Andor 31',
  '-----',
  '7139',
  ''
].join('\r\n')

describe('parseNameList', () => {
  it('reads a name for each id, and drops what is not one', () => {
    const { names, skipped, duplicates } = parseNameList(LIST)
    expect(names).toEqual({
      1: 'Mileth Crypt 1-1',
      135: 'Mileth Storage',
      206: 'Kadath',
      721: 'Grand Gen’s Room',
      3210: 'Ironfort (pk 11101)',
      10130: 'Andor 30'
    })
    expect(duplicates).toBe(1)
    expect(skipped).toBe(2)
  })
})
