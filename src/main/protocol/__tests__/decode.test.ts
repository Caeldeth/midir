import { describe, expect, it } from 'vitest'
import {
  decodeAddEquip,
  decodeAddInventory,
  decodeDrawHumanObjects,
  decodeRemoveEquip,
  decodeRemoveInventory,
  decodeSelfLook,
  decodeServerPacket,
  decodeStatus,
  decodeTransferServer,
  decodeUserAppearance,
  decodeVersionCheck,
  hasServerDecoder,
  StatusField
} from '../decode'
import { ServerOpcode } from '../opcodes'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const str8 = (text: string): number[] => [text.length, ...[...text].map((c) => c.charCodeAt(0))]
const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]
const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff
]

describe('decodeVersionCheck', () => {
  it('reads the salt selector and the replacement startup key', () => {
    const body = bytes(
      ServerOpcode.VersionCheck,
      0x00, // subtype: key update
      ...u32(0xdeadbeef),
      0x02, // salt selector
      0x09, // key length
      0x5e,
      0x6b,
      0x62,
      0x70,
      0x56,
      0x5b,
      0x5f,
      0x7d,
      0x71
    )
    const packet = decodeVersionCheck(body)
    expect(packet.subtype).toBe(0)
    expect(packet.keyUpdate).toMatchObject({ configurationCrc: 0xdeadbeef, saltSelector: 2 })
    expect([...packet.keyUpdate!.startupKey]).toEqual([
      0x5e, 0x6b, 0x62, 0x70, 0x56, 0x5b, 0x5f, 0x7d, 0x71
    ])
  })

  it('records a subtype it does not model and reads no further', () => {
    // Subtype 1 is a lobby notice; subtype 2 is a patch directive. Neither
    // carries cipher state, and neither must throw.
    for (const subtype of [1, 2]) {
      const packet = decodeVersionCheck(bytes(ServerOpcode.VersionCheck, subtype))
      expect(packet).toEqual({ kind: 'versionCheck', subtype })
    }
  })
})

describe('decodeTransferServer', () => {
  // The exact redirect observed in the RE capture, token included.
  const OBSERVED_TOKEN = [
    0x02, 0x09, 0x5e, 0x6b, 0x62, 0x70, 0x56, 0x5b, 0x5f, 0x7d, 0x71, 0x0b, 0x73, 0x6f, 0x63, 0x6b,
    0x65, 0x74, 0x5b, 0x32, 0x35, 0x36, 0x5d, 0x00, 0x00, 0x07, 0x22
  ]

  it('reads the observed capture, address, port, and token', () => {
    const body = bytes(
      ServerOpcode.TransferServer,
      0x01,
      0x00,
      0x00,
      0x7f, // reversed octets: 127.0.0.1
      0x0a,
      0x32, // port 2610
      OBSERVED_TOKEN.length,
      ...OBSERVED_TOKEN
    )
    expect(OBSERVED_TOKEN).toHaveLength(0x1b)

    const packet = decodeTransferServer(body)
    expect(packet.address).toBe('127.0.0.1')
    expect(packet.port).toBe(2610)
    expect(packet.saltSelector).toBe(2)
    expect([...packet.startupKey!]).toEqual([0x5e, 0x6b, 0x62, 0x70, 0x56, 0x5b, 0x5f, 0x7d, 0x71])
    expect(packet.name).toBe('socket[256]')
    expect(packet.redirectId).toBe(0x00000722)
    expect([...packet.token]).toEqual(OBSERVED_TOKEN)
  })

  it('reads the character name from a login to world redirect', () => {
    const token = [0x05, 0x09, ...new Array<number>(9).fill(0x41), ...str8('Sabrael'), ...u32(99)]
    const body = bytes(
      ServerOpcode.TransferServer,
      0x04,
      0x03,
      0x02,
      0x01,
      ...u16(2612),
      token.length,
      ...token
    )
    const packet = decodeTransferServer(body)
    expect(packet.address).toBe('1.2.3.4')
    expect(packet.port).toBe(2612)
    expect(packet.name).toBe('Sabrael')
    expect(packet.saltSelector).toBe(5)
  })

  it('still reads the address and port when the token does not parse', () => {
    // The client treats the token as opaque, so its shape is not guaranteed.
    // A token Midir cannot parse must not cost it the redirect.
    const token = [0xff, 0xff]
    const body = bytes(
      ServerOpcode.TransferServer,
      0x0a,
      0x00,
      0x00,
      0x7f,
      ...u16(2611),
      token.length,
      ...token
    )
    const packet = decodeTransferServer(body)
    expect(packet.address).toBe('127.0.0.10')
    expect(packet.port).toBe(2611)
    expect(packet.name).toBeUndefined()
    expect([...packet.token]).toEqual(token)
  })
})

describe('decodeStatus', () => {
  const coreStats = [
    0x02,
    0x00,
    0x00, // three retained bytes
    99, // level
    12, // ability level
    ...u32(2500), // max health
    ...u32(1800), // max mana
    150, // strength
    88, // intelligence
    120, // wisdom
    200, // constitution
    75, // dexterity
    0x01, // has stat points
    3, // stat points
    ...u16(1000), // max weight
    ...u16(742), // weight
    ...u32(0) // opaque status word
  ]
  const vitals = [...u32(2431), ...u32(1799)]
  const currency = [
    ...u32(1234567890),
    ...u32(4000),
    ...u32(88000),
    ...u32(1200),
    ...u32(45),
    ...u32(3000000000) // gold above 2^31
  ]
  const modifiers = [
    0x00, // retained modifier 0
    0x08, // blind code: blinded
    0x00,
    0x00,
    0x00, // retained modifiers 1 to 3
    0x01, // mail state
    0x01, // attack element: fire
    0x02, // defense element: water
    30, // magic resist units
    0x00, // unknown modifier 4
    0xf6, // armour class -10, signed
    12, // damage modifier
    9 // hit modifier
  ]

  it('reads a full login snapshot', () => {
    const fields =
      StatusField.CoreStats |
      StatusField.Vitals |
      StatusField.Currency |
      StatusField.Modifiers |
      StatusField.MailActive
    const packet = decodeStatus(
      bytes(ServerOpcode.Status, fields, ...coreStats, ...vitals, ...currency, ...modifiers)
    )

    expect(packet.coreStats).toEqual({
      level: 99,
      abilityLevel: 12,
      maxHealth: 2500,
      maxMana: 1800,
      strength: 150,
      intelligence: 88,
      wisdom: 120,
      constitution: 200,
      dexterity: 75,
      hasStatPoints: true,
      statPoints: 3,
      maxWeight: 1000,
      weight: 742
    })
    expect(packet.vitals).toEqual({ health: 2431, mana: 1799 })
    expect(packet.currency).toEqual({
      totalExperience: 1234567890,
      toNextLevel: 4000,
      totalAbility: 88000,
      toNextAbility: 1200,
      gamePoints: 45,
      gold: 3000000000
    })
    expect(packet.modifiers).toEqual({
      blinded: true,
      mailState: 1,
      attackElement: 1,
      defenseElement: 2,
      magicResistUnits: 30,
      armorClass: -10,
      damageModifier: 12,
      hitModifier: 9
    })
    expect(packet.mailActive).toBe(true)
  })

  it('leaves absent blocks undefined so a caller can merge', () => {
    // The vitals-only update is the common case after damage. It must not be
    // mistaken for a character with no stats, no gold, and no modifiers.
    const packet = decodeStatus(bytes(ServerOpcode.Status, StatusField.Vitals, ...vitals))
    expect(packet.vitals).toEqual({ health: 2431, mana: 1799 })
    expect(packet.coreStats).toBeUndefined()
    expect(packet.currency).toBeUndefined()
    expect(packet.modifiers).toBeUndefined()
  })

  it('reads each block on its own', () => {
    expect(
      decodeStatus(bytes(ServerOpcode.Status, StatusField.CoreStats, ...coreStats)).coreStats?.level
    ).toBe(99)
    expect(
      decodeStatus(bytes(ServerOpcode.Status, StatusField.Currency, ...currency)).currency?.gold
    ).toBe(3000000000)
    expect(
      decodeStatus(bytes(ServerOpcode.Status, StatusField.Modifiers, ...modifiers)).modifiers
        ?.armorClass
    ).toBe(-10)
  })

  it('reads blocks in wire order when only some are present', () => {
    // Currency follows core stats directly when vitals are absent.
    const fields = StatusField.CoreStats | StatusField.Currency
    const packet = decodeStatus(bytes(ServerOpcode.Status, fields, ...coreStats, ...currency))
    expect(packet.coreStats?.weight).toBe(742)
    expect(packet.currency?.totalExperience).toBe(1234567890)
    expect(packet.vitals).toBeUndefined()
  })

  it('reads the privilege level from the two high bits', () => {
    for (const level of [0, 1, 2, 3]) {
      const fields = (level << 6) | StatusField.Vitals
      expect(decodeStatus(bytes(ServerOpcode.Status, fields, ...vitals)).privilege).toBe(level)
    }
  })

  it('treats only blind code 0x08 as blinded', () => {
    for (const code of [0x00, 0x01, 0x07, 0x09, 0xff]) {
      const withCode = [...modifiers]
      withCode[1] = code
      const packet = decodeStatus(bytes(ServerOpcode.Status, StatusField.Modifiers, ...withCode))
      expect(packet.modifiers?.blinded, `code 0x${code.toString(16)}`).toBe(false)
    }
  })

  it('keeps the raw flag byte so an unmodelled bit is not lost', () => {
    const fields = StatusField.Standalone | StatusField.Vitals
    expect(decodeStatus(bytes(ServerOpcode.Status, fields, ...vitals)).fields).toBe(fields)
  })

  it('accepts the receive-side zero that may follow the blocks', () => {
    const packet = decodeStatus(bytes(ServerOpcode.Status, StatusField.Vitals, ...vitals, 0x00))
    expect(packet.vitals).toEqual({ health: 2431, mana: 1799 })
  })
})

describe('decodeAddInventory', () => {
  it('reads every field in wire order', () => {
    const body = bytes(
      ServerOpcode.AddInventory,
      5, // slot
      ...u16(0x0134), // sprite
      7, // dye colour
      ...str8('Blue Dragon Scale Mail'),
      ...u32(1), // quantity
      0x00, // cannot stack
      ...u32(9500), // durability
      ...u32(10000) // maximum durability
    )
    expect(decodeAddInventory(body)).toEqual({
      kind: 'addInventory',
      slot: 5,
      sprite: 0x0134,
      dyeColor: 7,
      name: 'Blue Dragon Scale Mail',
      quantity: 1,
      canStack: false,
      durability: 9500,
      maxDurability: 10000
    })
  })

  it('reads a stack', () => {
    const body = bytes(
      ServerOpcode.AddInventory,
      1,
      ...u16(0x0021),
      0,
      ...str8('Raw Fish'),
      ...u32(65),
      0x01,
      ...u32(0),
      ...u32(0)
    )
    expect(decodeAddInventory(body)).toMatchObject({ quantity: 65, canStack: true })
  })

  it('reads an empty name and a maximum-length name', () => {
    const long = 'x'.repeat(255)
    const build = (name: string): Uint8Array =>
      bytes(
        ServerOpcode.AddInventory,
        1,
        ...u16(1),
        0,
        ...str8(name),
        ...u32(1),
        0,
        ...u32(1),
        ...u32(1)
      )
    expect(decodeAddInventory(build('')).name).toBe('')
    expect(decodeAddInventory(build(long)).name).toBe(long)
  })

  it('accepts trailing bytes the client never reads', () => {
    // Hybrasyl writes four trailing zeros; Chaos writes one. The retail
    // parser reads its nine fields and stops. Neither tail may fail a decode.
    const head = [
      ServerOpcode.AddInventory,
      2,
      ...u16(9),
      0,
      ...str8('Stick'),
      ...u32(1),
      0,
      ...u32(50),
      ...u32(50)
    ]
    expect(decodeAddInventory(bytes(...head, 0, 0, 0, 0)).name).toBe('Stick')
    expect(decodeAddInventory(bytes(...head, 0)).name).toBe('Stick')
  })

  it('throws when the body stops early', () => {
    expect(() => decodeAddInventory(bytes(ServerOpcode.AddInventory, 1, 0x00))).toThrow(RangeError)
  })
})

describe('decodeAddEquip', () => {
  it('steps over the byte after the name', () => {
    const body = bytes(
      ServerOpcode.AddEquip,
      1, // weapon
      ...u16(0x00c8),
      3,
      ...str8('Staff of Ages'),
      0x00, // the byte the client advances over without checking
      ...u32(400),
      ...u32(500)
    )
    expect(decodeAddEquip(body)).toEqual({
      kind: 'addEquip',
      slot: 1,
      sprite: 0x00c8,
      dyeColor: 3,
      name: 'Staff of Ages',
      durability: 400,
      maxDurability: 500
    })
  })

  it('accepts the trailing zero some bodies carry', () => {
    const body = bytes(
      ServerOpcode.AddEquip,
      2,
      ...u16(1),
      0,
      ...str8('Robe'),
      0x00,
      ...u32(1),
      ...u32(1),
      0x00
    )
    expect(decodeAddEquip(body).name).toBe('Robe')
  })
})

describe('the two clear packets', () => {
  it('reads an inventory slot', () => {
    expect(decodeRemoveInventory(bytes(ServerOpcode.RemoveInventory, 60))).toEqual({
      kind: 'removeInventory',
      slot: 60
    })
  })

  it('reads an equipment slot', () => {
    expect(decodeRemoveEquip(bytes(ServerOpcode.RemoveEquip, 18))).toEqual({
      kind: 'removeEquip',
      slot: 18
    })
  })

  it('accepts a trailing zero', () => {
    expect(decodeRemoveEquip(bytes(ServerOpcode.RemoveEquip, 1, 0x00)).slot).toBe(1)
  })
})

describe('decodeUserAppearance', () => {
  it('reads the five bytes after the id', () => {
    const body = bytes(ServerOpcode.UserAppearance, ...u32(0x0000a1b2), 2, 1, 3, 0x10, 0x00)
    expect(decodeUserAppearance(body)).toEqual({
      kind: 'userAppearance',
      userId: 0x0000a1b2,
      facing: 2,
      guildValue: 1,
      characterClass: 3,
      actionState: 0x10
    })
  })
})

describe('decodeSelfLook', () => {
  const head = [
    ServerOpcode.SelfLook,
    4, // nation: Mileth
    ...str8('Elder'),
    ...str8('Grand Master'),
    ...str8('Sabrael, Fintan')
  ]
  const tail = [
    3, // character class: Wizard
    0x01, // show ability metadata
    0x00, // show master metadata
    ...str8('Gardcorp'),
    ...str8('Solid Union')
  ]

  it('reads a profile with no recruiting block and two legend marks', () => {
    const body = bytes(
      ...head,
      0x01, // group is open
      0x00, // not recruiting
      ...tail,
      2, // legend mark count
      3,
      0x01,
      ...str8('mark_wiz'),
      ...str8('Became a Wizard'),
      6,
      0x02,
      ...str8('mark_wed'),
      ...str8('Married someone')
    )
    const packet = decodeSelfLook(body)
    expect(packet).toMatchObject({
      nation: 4,
      guildRank: 'Elder',
      title: 'Grand Master',
      groupMembers: 'Sabrael, Fintan',
      isGroupOpen: true,
      characterClass: 3,
      displayClass: 'Gardcorp',
      guild: 'Solid Union'
    })
    expect(packet.recruiting).toBeUndefined()
    expect(packet.legend).toEqual([
      { icon: 3, color: 1, key: 'mark_wiz', text: 'Became a Wizard' },
      { icon: 6, color: 2, key: 'mark_wed', text: 'Married someone' }
    ])
  })

  it('reads the recruiting block and its five class rows in order', () => {
    const body = bytes(
      ...head,
      0x01,
      0x01, // recruiting
      ...str8('Sabrael'),
      ...str8('Dawn Patrol'),
      ...str8('Meet at Mileth'),
      50, // minimum level
      99, // maximum level
      2,
      1, // Warrior
      3,
      0, // Wizard
      1,
      1, // Rogue
      2,
      2, // Priest
      0,
      0, // Monk
      ...tail,
      0 // no legend marks
    )
    const packet = decodeSelfLook(body)
    expect(packet.recruiting).toEqual({
      leader: 'Sabrael',
      groupName: 'Dawn Patrol',
      note: 'Meet at Mileth',
      minimumLevel: 50,
      maximumLevel: 99,
      classes: [
        { wanted: 2, current: 1 },
        { wanted: 3, current: 0 },
        { wanted: 1, current: 1 },
        { wanted: 2, current: 2 },
        { wanted: 0, current: 0 }
      ]
    })
    expect(packet.characterClass).toBe(3)
    expect(packet.legend).toEqual([])
  })

  it('opens the recruiting block only for the exact value 1', () => {
    // Any other value means no block follows. Reading one would desynchronise
    // everything after it.
    for (const flag of [0x00, 0x02, 0xff]) {
      const packet = decodeSelfLook(bytes(...head, 0x00, flag, ...tail, 0))
      expect(packet.recruiting, `flag 0x${flag.toString(16)}`).toBeUndefined()
      expect(packet.guild).toBe('Solid Union')
    }
  })
})

describe('decodeDrawHumanObjects', () => {
  const humanForm = [
    0x21, // packed body: shape 2, pants dye 1
    ...u16(0x0101), // arms
    0x05, // boots
    ...u16(0x0202), // armor
    0x03, // shield
    ...u16(0x0303), // weapon
    9, // hair colour
    4, // boots colour
    1,
    ...u16(0x0011), // accessory 1
    2,
    ...u16(0x0022), // accessory 2
    3,
    ...u16(0x0033), // accessory 3
    0, // light mask
    0, // rest position
    ...u16(0x0044), // overcoat
    6, // overcoat colour
    2, // skin colour
    0x00, // not translucent
    1 // face shape
  ]

  it('reads the human form', () => {
    const body = bytes(
      ServerOpcode.DrawHumanObjects,
      ...u16(42),
      ...u16(17),
      1,
      ...u32(0x0000beef),
      ...u16(0x0100), // head sprite
      ...humanForm,
      0, // name style
      ...str8('Sabrael'),
      ...str8('')
    )
    const packet = decodeDrawHumanObjects(body)
    expect(packet).toMatchObject({ x: 42, y: 17, direction: 1, entityId: 0x0000beef })
    expect(packet.name).toBe('Sabrael')
    expect(packet.monster).toBeUndefined()
    expect(packet.human).toMatchObject({
      bodyShape: 2,
      pantsDye: 1,
      headSprite: 0x0100,
      armsSprite: 0x0101,
      bootsSprite: 0x05,
      armorSprite: 0x0202,
      shieldSprite: 0x03,
      weaponSprite: 0x0303,
      hairColor: 9,
      accessory1: { color: 1, sprite: 0x0011 },
      accessory3: { color: 3, sprite: 0x0033 },
      overcoatSprite: 0x0044,
      isTranslucent: false,
      faceShape: 1
    })
  })

  it('reads the monster disguise form and still finds the name', () => {
    const body = bytes(
      ServerOpcode.DrawHumanObjects,
      ...u16(1),
      ...u16(2),
      0,
      ...u32(7),
      0xff,
      0xff, // head sprite selects the disguise
      ...u16(0x00a0), // monster sprite
      5, // monster colour
      0, // ignored colour
      0,
      0,
      0,
      0,
      0,
      0, // six unknown bytes
      0,
      ...str8('Something Wicked'),
      ...str8('LFG')
    )
    const packet = decodeDrawHumanObjects(body)
    expect(packet.human).toBeUndefined()
    expect(packet.monster).toEqual({ monsterSprite: 0x00a0, monsterColor: 5 })
    expect(packet.name).toBe('Something Wicked')
    expect(packet.groupAdText).toBe('LFG')
  })

  it('is 43 bytes long in the normal form when both strings are empty', () => {
    // The RE notes give this exact size, so it pins every fixed field.
    const body = bytes(
      ServerOpcode.DrawHumanObjects,
      ...u16(0),
      ...u16(0),
      0,
      ...u32(0),
      ...u16(1),
      ...humanForm,
      0,
      ...str8(''),
      ...str8('')
    )
    expect(body).toHaveLength(43)
    expect(decodeDrawHumanObjects(body).name).toBe('')
  })
})

describe('decodeServerPacket', () => {
  it('dispatches on the opcode', () => {
    expect(decodeServerPacket(bytes(ServerOpcode.RemoveInventory, 4))).toEqual({
      kind: 'removeInventory',
      slot: 4
    })
  })

  it('returns null for an opcode Midir does not model', () => {
    expect(decodeServerPacket(bytes(0x5b, 0x01, 0x02))).toBeNull()
    expect(hasServerDecoder(0x5b)).toBe(false)
  })

  it('returns null for an empty body', () => {
    expect(decodeServerPacket(new Uint8Array(0))).toBeNull()
  })

  it('has a decoder for every opcode it claims', () => {
    for (const opcode of [
      ServerOpcode.VersionCheck,
      ServerOpcode.TransferServer,
      ServerOpcode.UserAppearance,
      ServerOpcode.Status,
      ServerOpcode.AddInventory,
      ServerOpcode.RemoveInventory,
      ServerOpcode.AddEquip,
      ServerOpcode.RemoveEquip,
      ServerOpcode.DrawHumanObjects,
      ServerOpcode.SelfLook
    ]) {
      expect(hasServerDecoder(opcode), `0x${opcode.toString(16)}`).toBe(true)
    }
  })
})
