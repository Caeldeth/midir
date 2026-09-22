import { ClientOpcode, ServerOpcode } from '../opcodes'
import {
  decodeClientExit,
  decodeClientTransfer,
  decodeLogin,
  type ClientExit,
  type ClientLogin,
  type ClientTransfer
} from './client'
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
import { decodeScreenMenu, type BankContents, type NpcMenu, type PlayerItemMenu } from './dialog'
import { decodeFieldMap, decodeFieldMapClick, type FieldMap, type FieldMapClick } from './fieldMap'
import { decodeSystemMessage, type SystemMessage } from './message'
import {
  decodeExchange,
  decodeExchangeRequest,
  type Exchange,
  type ExchangeRequest
} from './exchange'
import { decodePursuitMessage, type PursuitMessage } from './pursuit'
import { decodeStaticObjectState, type StaticObjectState } from './staticObject'
import { decodeBulletin, decodeBulletinRequest, type Bulletin, type BulletinRequest } from './board'
import {
  decodeAddWorldObjects,
  decodeCreatureMove,
  decodeRemoveWorldObject,
  type AddWorldObjects,
  type CreatureMove,
  type RemoveWorldObject
} from './world'
import {
  decodeMapInfo,
  decodeTurn,
  decodeUserMove,
  decodeUserPosition,
  decodeWalk,
  type MapInfo,
  type Turn,
  type UserMove,
  type UserPosition,
  type Walk
} from './movement'
import {
  decodeMerchantResponse,
  decodePursuitResponse,
  type MerchantResponse,
  type PursuitResponse
} from './merchant'
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

export * from './board'
export * from './character'
export * from './client'
export * from './dialog'
export * from './fieldMap'
export * from './message'
export * from './handshake'
export * from './items'
export * from './merchant'
export * from './movement'
export * from './pursuit'
export * from './staticObject'
export * from './world'

/** A packet Midir models, in either direction. */
export type DecodedPacket =
  | ClientLogin
  | ClientTransfer
  | VersionCheck
  | TransferServer
  | UserAppearance
  | UserPosition
  | UserMove
  | AddWorldObjects
  | CreatureMove
  | RemoveWorldObject
  | MapInfo
  | Walk
  | Turn
  | Status
  | AddInventory
  | RemoveInventory
  | AddEquip
  | RemoveEquip
  | DrawHumanObjects
  | SelfLook
  | BankContents
  | PlayerItemMenu
  | NpcMenu
  | PursuitMessage
  | FieldMap
  | FieldMapClick
  | Bulletin
  | BulletinRequest
  | SystemMessage
  | Exchange
  | ExchangeRequest
  | StaticObjectState
  | ClientExit
  | MerchantResponse
  | PursuitResponse

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
  [ServerOpcode.UserPosition, decodeUserPosition],
  [ServerOpcode.Move, decodeUserMove],
  [ServerOpcode.AddWorldObjects, decodeAddWorldObjects],
  [ServerOpcode.CreatureMove, decodeCreatureMove],
  [ServerOpcode.RemoveWorldObject, decodeRemoveWorldObject],
  [ServerOpcode.MapInfo, decodeMapInfo],
  [ServerOpcode.Status, decodeStatus],
  [ServerOpcode.AddInventory, decodeAddInventory],
  [ServerOpcode.RemoveInventory, decodeRemoveInventory],
  [ServerOpcode.AddEquip, decodeAddEquip],
  [ServerOpcode.RemoveEquip, decodeRemoveEquip],
  [ServerOpcode.DrawHumanObjects, decodeDrawHumanObjects],
  [ServerOpcode.SelfLook, decodeSelfLook],
  [ServerOpcode.ScreenMenu, decodeScreenMenu],
  [ServerOpcode.PursuitMessage, decodePursuitMessage],
  [ServerOpcode.FieldMap, decodeFieldMap],
  [ServerOpcode.Bulletin, decodeBulletin],
  [ServerOpcode.SystemMessage, decodeSystemMessage],
  [ServerOpcode.Exchange, decodeExchange],
  [ServerOpcode.StaticObjectState, decodeStaticObjectState]
])

const CLIENT_DECODERS = new Map<number, Decoder>([
  [ClientOpcode.Login, decodeLogin],
  [ClientOpcode.ClientJoin, decodeClientTransfer],
  [ClientOpcode.ClientExit, decodeClientExit],
  [ClientOpcode.Walk, decodeWalk],
  [ClientOpcode.Turn, decodeTurn],
  [ClientOpcode.MerchantResponse, decodeMerchantResponse],
  [ClientOpcode.PursuitResponse, decodePursuitResponse],
  [ClientOpcode.FieldMapClick, decodeFieldMapClick],
  [ClientOpcode.Bulletin, decodeBulletinRequest],
  [ClientOpcode.Exchange, decodeExchangeRequest]
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
