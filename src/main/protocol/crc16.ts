/**
 * The client's custom CRC16.
 *
 * Source: darkages-741-re/docs/network/checksums.md.
 *
 * **This is not CRC-16/XMODEM.** The table is generated from the same
 * polynomial, `0x1021`, but the input byte is XORed in *after* the table
 * lookup instead of forming part of the table index:
 *
 *   crc = table[crc >> 8] XOR ((crc << 8) & 0xFFFF) XOR byte
 *
 * The running value starts at zero and there is no final XOR. A standard
 * library CRC16 substituted here returns a different value for every input, so
 * the check value below is the way to catch the mistake: the ASCII text
 * `123456789` gives `0xBEEF`.
 *
 * Midir uses it for one thing: the dialog-response inner wrapper on client
 * opcodes 0x39 and 0x3A. See dialogWrapper.ts.
 */

/** The generator polynomial for the table. */
const POLYNOMIAL = 0x1021

const TABLE = buildTable()

function buildTable(): Uint16Array {
  const table = new Uint16Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index << 8
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x8000) !== 0 ? ((value << 1) ^ POLYNOMIAL) & 0xffff : (value << 1) & 0xffff
    }
    table[index] = value
  }
  return table
}

/** The CRC16 of `bytes`, as an unsigned 16-bit value. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc = (TABLE[crc >> 8]! ^ ((crc << 8) & 0xffff) ^ byte) & 0xffff
  }
  return crc
}
