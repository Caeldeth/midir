import { ServerOpcode } from '../opcodes'
import {
  decodeDrawHumanObjects,
  decodeSelfLook,
  decodeStatus,
  decodeUserAppearance,
  type DrawHumanObjects,
  type SelfLook,
  type Status,
  type UserAppearance
} from './character'
import {
  decodeTransferServer,
  decodeVersionCheck,
  type TransferServer,
  type VersionCheck
} from './handshake'
import {
  decodeAddEquip,
  decodeAddInventory,
  decodeRemoveEquip,
  decodeRemoveInventory,
  type AddEquip,
  type AddInventory,
  type RemoveEquip,
  type RemoveInventory
} from './items'

export * from './character'
export * from './handshake'
export * from './items'

/** A server packet Midir models. */
export type DecodedPacket =
  | VersionCheck
  | TransferServer
  | UserAppearance
  | Status
  | AddInventory
  | RemoveInventory
  | AddEquip
  | RemoveEquip
  | DrawHumanObjects
  | SelfLook

type Decoder = (body: Uint8Array) => DecodedPacket

const DECODERS = new Map<number, Decoder>([
  [ServerOpcode.VersionCheck, decodeVersionCheck],
  [ServerOpcode.TransferServer, decodeTransferServer],
  [ServerOpcode.UserAppearance, decodeUserAppearance],
  [ServerOpcode.Status, decodeStatus],
  [ServerOpcode.AddInventory, decodeAddInventory],
  [ServerOpcode.RemoveInventory, decodeRemoveInventory],
  [ServerOpcode.AddEquip, decodeAddEquip],
  [ServerOpcode.RemoveEquip, decodeRemoveEquip],
  [ServerOpcode.DrawHumanObjects, decodeDrawHumanObjects],
  [ServerOpcode.SelfLook, decodeSelfLook]
])

/** True while Midir has a decoder for `opcode`. */
export function hasServerDecoder(opcode: number): boolean {
  return DECODERS.has(opcode)
}

/**
 * Decode one plaintext server body, opcode first.
 *
 * Returns null when Midir does not model the opcode. A decoder that throws
 * means the body did not match the wire format; the caller reports that as a
 * decode failure and carries on with the next packet.
 */
export function decodeServerPacket(body: Uint8Array): DecodedPacket | null {
  if (body.length === 0) return null
  const decoder = DECODERS.get(body[0]!)
  return decoder ? decoder(body) : null
}
