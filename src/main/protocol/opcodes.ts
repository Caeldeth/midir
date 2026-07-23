import type { Direction } from './cipher'

/**
 * Which transform an opcode uses.
 *
 * The opcode selects the transform, and the two directions have different
 * lists. Source: darkages-741-re/docs/network/packet-transforms.md, section
 * "Mode by direction". The document repo's docs/protocol/PROTOCOL.md agrees.
 *
 * These are transport rules. They do not prove that every opcode has a packet
 * class, and an opcode that is absent from both lists is a session packet.
 */
export type Transform = 'none' | 'startup' | 'session'

const CLIENT_TO_SERVER_NONE = [0x00, 0x10, 0x48] as const

const CLIENT_TO_SERVER_STARTUP = [
  0x02, 0x03, 0x04, 0x0b, 0x26, 0x2d, 0x3a, 0x42, 0x43, 0x4b, 0x57, 0x62, 0x68, 0x71, 0x73, 0x7b
] as const

const SERVER_TO_CLIENT_NONE = [0x00, 0x03, 0x40] as const

const SERVER_TO_CLIENT_STARTUP = [0x01, 0x02, 0x0a, 0x56, 0x60, 0x62, 0x66, 0x6f] as const

const TRANSFORMS: Record<Direction, { none: Set<number>; startup: Set<number> }> = {
  clientToServer: {
    none: new Set(CLIENT_TO_SERVER_NONE),
    startup: new Set(CLIENT_TO_SERVER_STARTUP)
  },
  serverToClient: {
    none: new Set(SERVER_TO_CLIENT_NONE),
    startup: new Set(SERVER_TO_CLIENT_STARTUP)
  }
}

/** Return the transform that `opcode` uses in `direction`. */
export function transformFor(opcode: number, direction: Direction): Transform {
  const table = TRANSFORMS[direction]
  if (table.none.has(opcode)) return 'none'
  if (table.startup.has(opcode)) return 'startup'
  return 'session'
}

/**
 * The client opcodes that carry the dialog-response inner wrapper under their
 * transform. There are only two, and nothing in the server direction has one.
 *
 * This is a transport rule, like the transform tables above. See
 * dialogWrapper.ts for the layout.
 */
export const DIALOG_WRAPPED_CLIENT_OPCODES: ReadonlySet<number> = new Set([0x39, 0x3a])

/** True when `opcode` carries the inner wrapper in `direction`. */
export function isDialogWrapped(opcode: number, direction: Direction): boolean {
  return direction === 'clientToServer' && DIALOG_WRAPPED_CLIENT_OPCODES.has(opcode)
}

/**
 * The greeting the server sends on a new connection.
 *
 * It is a standard binary frame on the wire, but the client consumes it with
 * its terminal handler before it turns on frame parsing. No session key exists
 * yet, so Midir must not try to decrypt it.
 */
export const SERVER_HELLO = 0x7e

/**
 * Server opcodes that Midir reads. The names are the client's own RTTI class
 * names, without the leading `S`.
 */
export const ServerOpcode = {
  VersionCheck: 0x00,
  TransferServer: 0x03,
  UserPosition: 0x04,
  UserAppearance: 0x05,
  Status: 0x08,
  AddInventory: 0x0f,
  RemoveInventory: 0x10,
  AddSpell: 0x17,
  RemoveSpell: 0x18,
  AddSkill: 0x2c,
  RemoveSkill: 0x2d,
  ScreenMenu: 0x2f,
  PursuitMessage: 0x30,
  DrawHumanObjects: 0x33,
  ObjectInfo: 0x34,
  AddEquip: 0x37,
  RemoveEquip: 0x38,
  SelfLook: 0x39,
  Hello: SERVER_HELLO
} as const

/** Client opcodes that Midir reads or acts on. */
export const ClientOpcode = {
  Version: 0x00,
  /** Creates an account. Carries a password and an email. See scrub.ts. */
  NewUser: 0x02,
  /** Signs in. Carries a password. See scrub.ts. */
  Login: 0x03,
  /** Announces the quit dialog, then confirms the exit. See decode/client.ts. */
  ClientExit: 0x0b,
  /** Checks a password. Wire format unknown. See scrub.ts. */
  CheckPassword: 0x15,
  ClientJoin: 0x10,
  /** Replaces a password. Carries two of them. See scrub.ts. */
  ChangePassword: 0x26,
  /** Answers an NPC menu. Wrapped. See decode/merchant.ts. */
  MerchantResponse: 0x39,
  /** Answers an NPC conversation step. Wrapped. See decode/merchant.ts. */
  PursuitResponse: 0x3a,
  /** Submits a replacement password. Wire format unknown. See scrub.ts. */
  NewPassword: 0x27,
  /** Verifies a one-time password. Wire format unknown. See scrub.ts. */
  Otp: 0x8f
} as const

const SERVER_OPCODE_NAMES = new Map<number, string>(
  Object.entries(ServerOpcode).map(([name, opcode]) => [opcode, name])
)

const CLIENT_OPCODE_NAMES = new Map<number, string>(
  Object.entries(ClientOpcode).map(([name, opcode]) => [opcode, name])
)

/**
 * A readable name for an opcode, for logs and the packet inspector. An opcode
 * Midir does not model gets its hexadecimal value.
 */
export function opcodeName(opcode: number, direction: Direction): string {
  const names = direction === 'serverToClient' ? SERVER_OPCODE_NAMES : CLIENT_OPCODE_NAMES
  return names.get(opcode) ?? `0x${opcode.toString(16).padStart(2, '0')}`
}
