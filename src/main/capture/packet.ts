/**
 * Pull the TCP payload out of a captured link-layer frame.
 *
 * This file is pure. It takes bytes and returns a description, so every case
 * below can be tested without an adapter, a driver, or a game.
 *
 * Only IPv4 over TCP is parsed. The retail client speaks IPv4, and anything
 * else on the adapter is not Midir's business.
 */

/** Link-layer types, as pcap_datalink reports them. */
export const DataLink = {
  /** BSD loopback. A four-byte address-family header. */
  Null: 0,
  /** Ethernet. A fourteen-byte header. Npcap reports this for Wi-Fi too. */
  Ethernet: 1,
  /** Raw IP, with no link header. */
  Raw: 101
} as const

const ETHERTYPE_IPV4 = 0x0800
const ETHERTYPE_VLAN = 0x8100
const ETHERTYPE_QINQ = 0x88a8
const IP_PROTOCOL_TCP = 6

const ETHERNET_HEADER_LENGTH = 14
const VLAN_TAG_LENGTH = 4
const NULL_HEADER_LENGTH = 4

/** TCP header flag bits. */
export const TcpFlag = {
  Fin: 0x01,
  Syn: 0x02,
  Rst: 0x04,
  Psh: 0x08,
  Ack: 0x10
} as const

/** One parsed TCP segment. */
export interface TcpSegment {
  sourceAddress: string
  sourcePort: number
  destinationAddress: string
  destinationPort: number
  /** The sequence number of the first payload byte. */
  sequence: number
  flags: number
  payload: Uint8Array
}

/** True while the segment opens a connection from the side that dialled. */
export function isSyn(segment: TcpSegment): boolean {
  return (segment.flags & TcpFlag.Syn) !== 0 && (segment.flags & TcpFlag.Ack) === 0
}

/** True while the segment answers a connection attempt. */
export function isSynAck(segment: TcpSegment): boolean {
  return (segment.flags & TcpFlag.Syn) !== 0 && (segment.flags & TcpFlag.Ack) !== 0
}

/** True while the segment ends a connection, cleanly or not. */
export function isFinOrReset(segment: TcpSegment): boolean {
  return (segment.flags & (TcpFlag.Fin | TcpFlag.Rst)) !== 0
}

/**
 * Parse one captured frame.
 *
 * Returns null when the frame is not IPv4 over TCP, when it is a later IP
 * fragment, or when it is truncated. None of those is an error: the adapter
 * carries other traffic, and Midir simply ignores it.
 */
export function parseFrame(frame: Uint8Array, datalink: number): TcpSegment | null {
  const ipOffset = ipOffsetOf(frame, datalink)
  if (ipOffset === null) return null
  return parseIpv4(frame, ipOffset)
}

function ipOffsetOf(frame: Uint8Array, datalink: number): number | null {
  switch (datalink) {
    case DataLink.Raw:
      return 0

    case DataLink.Null:
      // The four-byte header holds the address family in host byte order. 2 is
      // AF_INET on every platform Midir runs on.
      if (frame.length < NULL_HEADER_LENGTH) return null
      return frame[0] === 2 && frame[1] === 0 ? NULL_HEADER_LENGTH : null

    case DataLink.Ethernet: {
      if (frame.length < ETHERNET_HEADER_LENGTH) return null
      let offset = 12
      let etherType = (frame[offset]! << 8) | frame[offset + 1]!
      offset += 2
      // Step over any VLAN tags. Each adds four bytes and a fresh type field.
      while (etherType === ETHERTYPE_VLAN || etherType === ETHERTYPE_QINQ) {
        if (frame.length < offset + VLAN_TAG_LENGTH) return null
        etherType = (frame[offset + 2]! << 8) | frame[offset + 3]!
        offset += VLAN_TAG_LENGTH
      }
      return etherType === ETHERTYPE_IPV4 ? offset : null
    }

    default:
      return null
  }
}

function parseIpv4(frame: Uint8Array, at: number): TcpSegment | null {
  if (frame.length < at + 20) return null

  const versionAndLength = frame[at]!
  if (versionAndLength >> 4 !== 4) return null

  const ipHeaderLength = (versionAndLength & 0x0f) * 4
  if (ipHeaderLength < 20 || frame.length < at + ipHeaderLength) return null
  if (frame[at + 9] !== IP_PROTOCOL_TCP) return null

  // A non-zero fragment offset means the TCP header is in an earlier fragment.
  const fragmentOffset = ((frame[at + 6]! & 0x1f) << 8) | frame[at + 7]!
  if (fragmentOffset !== 0) return null

  const totalLength = (frame[at + 2]! << 8) | frame[at + 3]!
  const sourceAddress = ipv4At(frame, at + 12)
  const destinationAddress = ipv4At(frame, at + 16)

  const tcpAt = at + ipHeaderLength
  if (frame.length < tcpAt + 20) return null

  const tcpHeaderLength = ((frame[tcpAt + 12]! >> 4) & 0x0f) * 4
  if (tcpHeaderLength < 20 || frame.length < tcpAt + tcpHeaderLength) return null

  const payloadAt = tcpAt + tcpHeaderLength

  // The captured frame is the authority on how many bytes are present. The IP
  // total length is the authority on how many are real. Segmentation offload
  // makes the total length 0 or smaller than the frame, so take the smaller of
  // the two whenever the header gives a usable number.
  const capturedPayload = Math.max(0, frame.length - payloadAt)
  const declaredPayload = totalLength - ipHeaderLength - tcpHeaderLength
  const payloadLength =
    totalLength > 0 && declaredPayload >= 0
      ? Math.min(capturedPayload, declaredPayload)
      : capturedPayload

  return {
    sourceAddress,
    sourcePort: (frame[tcpAt]! << 8) | frame[tcpAt + 1]!,
    destinationAddress,
    destinationPort: (frame[tcpAt + 2]! << 8) | frame[tcpAt + 3]!,
    sequence: readU32(frame, tcpAt + 4),
    flags: frame[tcpAt + 13]!,
    payload: frame.slice(payloadAt, payloadAt + payloadLength)
  }
}

function ipv4At(frame: Uint8Array, at: number): string {
  return `${frame[at]}.${frame[at + 1]}.${frame[at + 2]}.${frame[at + 3]}`
}

function readU32(frame: Uint8Array, at: number): number {
  return (
    (frame[at]! * 0x1000000 + (frame[at + 1]! << 16) + (frame[at + 2]! << 8) + frame[at + 3]!) >>> 0
  )
}
