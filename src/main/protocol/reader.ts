/**
 * A cursor over a packet body.
 *
 * All multi-byte integers in the Dark Ages protocol are big-endian.
 *
 * Strings are length-prefixed. They are decoded as latin1, so one byte becomes
 * one character and no byte is lost. The USA client sends ASCII for names and
 * item text. A caller that must handle another code page can recover the
 * original bytes from the characters.
 *
 * The retail parsers read the fields they know and then stop. A body that is
 * longer than its known fields is normal, not an error. Use `remaining` to
 * check for extra bytes. Never fail on them.
 */
export class PacketReader {
  private readonly body: Uint8Array
  private offset: number

  constructor(body: Uint8Array, offset = 0) {
    this.body = body
    this.offset = offset
  }

  /** The number of bytes that are not read yet. */
  get remaining(): number {
    return this.body.length - this.offset
  }

  /** The index of the next byte to read. */
  get position(): number {
    return this.offset
  }

  /** True while at least one byte is left. */
  get hasMore(): boolean {
    return this.remaining > 0
  }

  private require(count: number): number {
    if (this.remaining < count) {
      throw new RangeError(
        `packet body is too short: need ${count} byte(s) at offset ${this.offset}, ${this.remaining} left`
      )
    }
    const at = this.offset
    this.offset += count
    return at
  }

  /** Read one unsigned byte. */
  u8(): number {
    return this.body[this.require(1)]!
  }

  /** Read one signed byte. */
  i8(): number {
    const value = this.u8()
    return value > 0x7f ? value - 0x100 : value
  }

  /** Read a big-endian unsigned 16-bit integer. */
  u16(): number {
    const at = this.require(2)
    return (this.body[at]! << 8) | this.body[at + 1]!
  }

  /** Read a big-endian unsigned 32-bit integer. */
  u32(): number {
    const at = this.require(4)
    return (
      (this.body[at]! * 0x1000000 +
        (this.body[at + 1]! << 16) +
        (this.body[at + 2]! << 8) +
        this.body[at + 3]!) >>>
      0
    )
  }

  /** Read a boolean stored as one byte. Any value other than 0 is true. */
  bool(): boolean {
    return this.u8() !== 0
  }

  /** Read `count` raw bytes as a copy. */
  bytes(count: number): Uint8Array {
    const at = this.require(count)
    return this.body.slice(at, at + count)
  }

  /** Read every byte that is left, as a copy. */
  rest(): Uint8Array {
    return this.bytes(this.remaining)
  }

  /** Read a string with a one-byte length prefix. */
  string8(): string {
    return this.text(this.u8())
  }

  /** Read a string with a big-endian two-byte length prefix. */
  string16(): string {
    return this.text(this.u16())
  }

  /** Skip `count` bytes. */
  skip(count: number): void {
    this.require(count)
  }

  private text(length: number): string {
    const at = this.require(length)
    let out = ''
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.body[at + i]!)
    return out
  }
}
