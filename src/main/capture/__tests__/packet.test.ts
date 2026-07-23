import { describe, expect, it } from 'vitest'
import {
  DataLink,
  isFinOrReset,
  isSyn,
  isSynAck,
  parseFrame,
  TcpFlag,
  type TcpSegment
} from '../packet'

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]
const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff
]
const ip = (text: string): number[] => text.split('.').map(Number)

interface FrameOptions {
  source?: string
  destination?: string
  sourcePort?: number
  destinationPort?: number
  sequence?: number
  flags?: number
  payload?: number[]
  /** Override the IP total length, to model segmentation offload. */
  totalLength?: number
  /** Extra bytes of TCP options, which must be a multiple of four. */
  tcpOptionBytes?: number
  vlanTags?: number
  protocol?: number
  ipVersion?: number
}

function buildTcpOverIpv4(options: FrameOptions = {}): {
  ipv4: number[]
  expected: FrameOptions
} {
  const payload = options.payload ?? [0xaa, 0x00, 0x02, 0x08, 0x20]
  const optionBytes = options.tcpOptionBytes ?? 0
  const tcpHeaderLength = 20 + optionBytes
  const ipHeaderLength = 20
  const totalLength = options.totalLength ?? ipHeaderLength + tcpHeaderLength + payload.length

  const tcp = [
    ...u16(options.sourcePort ?? 2610),
    ...u16(options.destinationPort ?? 51000),
    ...u32(options.sequence ?? 1000),
    ...u32(0), // acknowledgement
    ((tcpHeaderLength / 4) << 4) & 0xff,
    options.flags ?? TcpFlag.Psh | TcpFlag.Ack,
    ...u16(65535), // window
    ...u16(0), // checksum
    ...u16(0), // urgent pointer
    ...new Array<number>(optionBytes).fill(0x01) // NOP options
  ]

  const ipv4 = [
    ((options.ipVersion ?? 4) << 4) | (ipHeaderLength / 4),
    0x00, // DSCP
    ...u16(totalLength),
    ...u16(0x1234), // identification
    0x40,
    0x00, // flags and fragment offset
    64, // time to live
    options.protocol ?? 6,
    ...u16(0), // checksum
    ...ip(options.source ?? '203.0.113.7'),
    ...ip(options.destination ?? '192.168.1.20'),
    ...tcp,
    ...payload
  ]

  return { ipv4, expected: { ...options, payload } }
}

/**
 * Wrap an IPv4 packet in an Ethernet header, with `vlanTags` VLAN tags in
 * front of it. Each tag is two bytes of tag control information followed by
 * the type of whatever comes next.
 */
function ethernet(ipv4: number[], vlanTags = 0): Uint8Array {
  const header = [
    ...new Array<number>(6).fill(0x11), // destination MAC
    ...new Array<number>(6).fill(0x22) // source MAC
  ]
  if (vlanTags === 0) {
    header.push(0x08, 0x00) // IPv4
  } else {
    header.push(0x81, 0x00) // the first tag
    for (let i = 0; i < vlanTags; i++) {
      header.push(0x00, 0x64) // tag control information
      const isLast = i === vlanTags - 1
      header.push(...(isLast ? [0x08, 0x00] : [0x81, 0x00]))
    }
  }
  return Uint8Array.from([...header, ...ipv4])
}

const segment = (options: FrameOptions = {}): TcpSegment | null =>
  parseFrame(ethernet(buildTcpOverIpv4(options).ipv4), DataLink.Ethernet)

describe('parseFrame over Ethernet', () => {
  it('reads addresses, ports, sequence, and payload', () => {
    const parsed = segment({
      source: '203.0.113.7',
      destination: '192.168.1.20',
      sourcePort: 2610,
      destinationPort: 51000,
      sequence: 0x0001e240,
      payload: [0xaa, 0x00, 0x02, 0x08, 0x20]
    })
    expect(parsed).toMatchObject({
      sourceAddress: '203.0.113.7',
      destinationAddress: '192.168.1.20',
      sourcePort: 2610,
      destinationPort: 51000,
      sequence: 0x0001e240
    })
    expect([...parsed!.payload]).toEqual([0xaa, 0x00, 0x02, 0x08, 0x20])
  })

  it('reads a sequence number above 2^31 without going negative', () => {
    expect(segment({ sequence: 0xffffff00 })!.sequence).toBe(0xffffff00)
  })

  it('steps over TCP options', () => {
    const parsed = segment({ tcpOptionBytes: 12, payload: [1, 2, 3] })
    expect([...parsed!.payload]).toEqual([1, 2, 3])
  })

  it('returns an empty payload for a bare acknowledgement', () => {
    const parsed = segment({ payload: [], flags: TcpFlag.Ack })
    expect(parsed!.payload).toHaveLength(0)
  })

  it('trusts the frame when segmentation offload zeroes the IP total length', () => {
    // With offload on, the adapter reports a length the frame contradicts.
    const parsed = segment({ totalLength: 0, payload: [1, 2, 3, 4, 5] })
    expect([...parsed!.payload]).toEqual([1, 2, 3, 4, 5])
  })

  it('trims trailing padding the IP total length excludes', () => {
    // A short frame is padded to the 60-byte Ethernet minimum. The padding is
    // not payload, and reading it would corrupt the stream.
    const { ipv4 } = buildTcpOverIpv4({ payload: [1, 2] })
    const padded = Uint8Array.from([...ethernet(ipv4), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect([...parseFrame(padded, DataLink.Ethernet)!.payload]).toEqual([1, 2])
  })

  it('steps over a VLAN tag', () => {
    const { ipv4 } = buildTcpOverIpv4({ payload: [9, 8, 7] })
    expect([...parseFrame(ethernet(ipv4, 1), DataLink.Ethernet)!.payload]).toEqual([9, 8, 7])
  })

  it('steps over stacked VLAN tags', () => {
    const { ipv4 } = buildTcpOverIpv4({ payload: [4, 5] })
    expect([...parseFrame(ethernet(ipv4, 2), DataLink.Ethernet)!.payload]).toEqual([4, 5])
  })
})

describe('parseFrame ignores what is not its business', () => {
  it('ignores a protocol that is not TCP', () => {
    expect(segment({ protocol: 17 })).toBeNull() // UDP
  })

  it('ignores IPv6', () => {
    expect(segment({ ipVersion: 6 })).toBeNull()
  })

  it('ignores an EtherType that is not IPv4', () => {
    const frame = Uint8Array.from([
      ...new Array<number>(12).fill(0),
      0x86,
      0xdd, // IPv6
      ...new Array<number>(40).fill(0)
    ])
    expect(parseFrame(frame, DataLink.Ethernet)).toBeNull()
  })

  it('ignores a later IP fragment, whose TCP header is elsewhere', () => {
    const { ipv4 } = buildTcpOverIpv4()
    ipv4[6] = 0x00
    ipv4[7] = 0x25 // a non-zero fragment offset
    expect(parseFrame(ethernet(ipv4), DataLink.Ethernet)).toBeNull()
  })

  it('ignores a truncated frame', () => {
    const { ipv4 } = buildTcpOverIpv4()
    const whole = ethernet(ipv4)
    for (const length of [0, 8, 14, 20, 30]) {
      expect(parseFrame(whole.slice(0, length), DataLink.Ethernet), `length ${length}`).toBeNull()
    }
  })

  it('ignores an IP header length below the minimum', () => {
    const { ipv4 } = buildTcpOverIpv4()
    ipv4[0] = 0x44 // version 4, header length 4 words = 16 bytes
    expect(parseFrame(ethernet(ipv4), DataLink.Ethernet)).toBeNull()
  })

  it('ignores a link type it does not know', () => {
    const { ipv4 } = buildTcpOverIpv4()
    expect(parseFrame(ethernet(ipv4), 999)).toBeNull()
  })
})

describe('parseFrame over the other link types', () => {
  it('reads a raw IP frame', () => {
    const { ipv4 } = buildTcpOverIpv4({ payload: [7] })
    expect([...parseFrame(Uint8Array.from(ipv4), DataLink.Raw)!.payload]).toEqual([7])
  })

  it('reads a loopback frame whose family is AF_INET', () => {
    const { ipv4 } = buildTcpOverIpv4({ payload: [6] })
    const frame = Uint8Array.from([2, 0, 0, 0, ...ipv4])
    expect([...parseFrame(frame, DataLink.Null)!.payload]).toEqual([6])
  })

  it('ignores a loopback frame of another family', () => {
    const { ipv4 } = buildTcpOverIpv4()
    expect(parseFrame(Uint8Array.from([23, 0, 0, 0, ...ipv4]), DataLink.Null)).toBeNull()
  })
})

describe('the flag helpers', () => {
  it('recognises the opening segment', () => {
    expect(isSyn(segment({ flags: TcpFlag.Syn })!)).toBe(true)
    expect(isSyn(segment({ flags: TcpFlag.Syn | TcpFlag.Ack })!)).toBe(false)
  })

  it('recognises the answer to an opening segment', () => {
    expect(isSynAck(segment({ flags: TcpFlag.Syn | TcpFlag.Ack })!)).toBe(true)
    expect(isSynAck(segment({ flags: TcpFlag.Syn })!)).toBe(false)
  })

  it('recognises the end of a connection', () => {
    expect(isFinOrReset(segment({ flags: TcpFlag.Fin | TcpFlag.Ack })!)).toBe(true)
    expect(isFinOrReset(segment({ flags: TcpFlag.Rst })!)).toBe(true)
    expect(isFinOrReset(segment({ flags: TcpFlag.Psh | TcpFlag.Ack })!)).toBe(false)
  })
})
