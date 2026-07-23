import { ClientOpcode, ServerOpcode } from '../opcodes'
import { decodeClientTransfer, decodeLogin, type ClientLogin, type ClientTransfer } from './client'
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
import { decodeBankContents, type BankContents } from './dialog'
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
export * from './client'
export * from './dialog'
export * from './handshake'
export * from './items'

/** A packet Midir models, in either direction. */
export type DecodedPacket =
  | ClientLogin
  | ClientTransfer
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
  | BankContents

/**
 * A decoder returns null when the body is an opcode Midir models but a variant
 * it does not read. SScreenMenu is the case: every NPC conversation uses it,
 * and only the bank list is data.
 */
type Decoder = (body: Uint8Array) => DecodedPacket | null

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
  [ServerOpcode.SelfLook, decodeSelfLook],
  [ServerOpcode.ScreenMenu, decodeBankContents]
])

const CLIENT_DECODERS = new Map<number, Decoder>([
  [ClientOpcode.Login, decodeLogin],
  [ClientOpcode.ClientJoin, decodeClientTransfer]
])

/** True while Midir has a decoder for `opcode`. */
export function hasServerDecoder(opcode: number): boolean {
  return DECODERS.has(opcode)
}

/** True while Midir has a decoder for a client-direction `opcode`. */
export function hasClientDecoder(opcode: number): boolean {
  return CLIENT_DECODERS.has(opcode)
}

/**
 * Decode one plaintext client body, opcode first.
 *
 * Returns null when Midir does not model the opcode, which is the usual case:
 * Midir reads the client's side only to learn the character name.
 */
export function decodeClientPacket(body: Uint8Array): DecodedPacket | null {
  if (body.length === 0) return null
  const decoder = CLIENT_DECODERS.get(body[0]!)
  return decoder ? decoder(body) : null
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
