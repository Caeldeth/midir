import { describe, expect, it } from 'vitest'
import { BANK_WITHDRAW_REQUEST_PURSUIT, type DecodedPacket } from '../../protocol/decode'
import {
  BANK_REPLY_WINDOW_MS,
  isIdentified,
  newSession,
  reduce,
  resolvePendingBank,
  type CharacterSession
} from '../character'

const CHARACTER = 'Sabrael'
const USER_ID = 0x0000beef

/** Apply a run of packets and return the state. */
function run(
  packets: DecodedPacket[],
  options: { keyName?: string; from?: CharacterSession; startMs?: number } = {}
): CharacterSession {
  let state = options.from ?? newSession(options.startMs ?? 1000)
  let clock = options.startMs ?? 1000
  for (const packet of packets) {
    clock += 10
    state = reduce(state, {
      packet,
      timestampMs: clock,
      ...(options.keyName !== undefined ? { keyName: options.keyName } : {})
    })
  }
  return state
}

const userAppearance = (userId = USER_ID): DecodedPacket => ({
  kind: 'userAppearance',
  userId,
  facing: 0,
  guildValue: 0,
  characterClass: 3,
  actionState: 0
})

const drawSelf = (name: string, entityId = USER_ID): DecodedPacket => ({
  kind: 'drawHumanObjects',
  x: 10,
  y: 20,
  direction: 1,
  entityId,
  name,
  nameStyle: 0,
  groupAdText: '',
  human: {
    bodyShape: 2,
    pantsDye: 1,
    headSprite: 0x0100,
    armsSprite: 0,
    bootsSprite: 5,
    armorSprite: 0x0202,
    shieldSprite: 3,
    weaponSprite: 0x0303,
    hairColor: 9,
    bootsColor: 4,
    accessory1: { sprite: 0, color: 0 },
    accessory2: { sprite: 0, color: 0 },
    accessory3: { sprite: 0, color: 0 },
    lightMaskId: 0,
    restPosition: 0,
    overcoatSprite: 0x0044,
    overcoatColor: 6,
    skinColor: 2,
    isTranslucent: false,
    faceShape: 1
  }
})

const fullStatus: DecodedPacket = {
  kind: 'status',
  fields: 0x3d,
  privilege: 0,
  mailActive: true,
  coreStats: {
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
  },
  vitals: { health: 2431, mana: 1799 },
  currency: {
    totalExperience: 1234567890,
    toNextLevel: 4000,
    totalAbility: 88000,
    toNextAbility: 1200,
    gamePoints: 45,
    gold: 3000000000
  },
  modifiers: {
    blinded: false,
    mailState: 1,
    attackElement: 1,
    defenseElement: 2,
    magicResistUnits: 30,
    armorClass: -10,
    damageModifier: 12,
    hitModifier: 9
  }
}

const item = (slot: number, name: string, count = 1): DecodedPacket => ({
  kind: 'addInventory',
  slot,
  sprite: 0x0134,
  dyeColor: 7,
  name,
  quantity: count,
  canStack: count > 1,
  durability: 9500,
  maxDurability: 10000
})

const equip = (slot: number, name: string): DecodedPacket => ({
  kind: 'addEquip',
  slot,
  sprite: 0x00c8,
  dyeColor: 3,
  name,
  durability: 400,
  maxDurability: 500
})

const selfLook: DecodedPacket = {
  kind: 'selfLook',
  nation: 4,
  guildRank: 'Elder',
  title: 'Grand Master',
  groupMembers: '',
  isGroupOpen: true,
  characterClass: 3,
  showAbilityMetadata: true,
  showMasterMetadata: false,
  displayClass: 'Gardcorp',
  guild: 'Solid Union',
  legend: [{ icon: 3, color: 1, key: 'mark_wiz', text: 'Became a Wizard' }]
}

describe('naming the character', () => {
  it('has no name before anything identifies it', () => {
    expect(isIdentified(run([fullStatus]))).toBe(false)
  })

  it('never files the pre-login placeholder as a character', () => {
    // The connections before the world server are keyed from a placeholder.
    // It is a real key seed and a real nobody.
    for (const placeholder of ['socket', 'socket[256]', 'socket[295]', 'SOCKET[1]']) {
      const state = run([fullStatus, item(1, 'Stick')], { keyName: placeholder })
      expect(state.name, placeholder).toBeNull()
      expect(isIdentified(state), placeholder).toBe(false)
      expect(state.record.name, placeholder).toBe('')
    }
  })

  it('still files a name that merely contains the word socket', () => {
    // The rule matches the placeholder's shape, not the word.
    expect(run([fullStatus], { keyName: 'Socketeer' }).name).toBe('Socketeer')
    expect(run([fullStatus], { keyName: 'socket[295]x' }).name).toBe('socket[295]x')
  })

  it('needs the server to have described the character, not just named it', () => {
    // Traffic that carries a key but says nothing about a character must not
    // file one. This is the shape of a pre-login connection.
    const named = run([{ kind: 'versionCheck', subtype: 1 }], { keyName: 'Taurael' })
    expect(named.name).toBe('Taurael')
    expect(named.hasCharacterData).toBe(false)
    expect(isIdentified(named)).toBe(false)

    // One packet describing the character is enough.
    const described = run([fullStatus], { from: named, keyName: 'Taurael' })
    expect(described.hasCharacterData).toBe(true)
    expect(isIdentified(described)).toBe(true)
  })

  it('takes the name from the redirect the session key was built from', () => {
    const state = run([fullStatus], { keyName: CHARACTER })
    expect(state.name).toBe(CHARACTER)
    expect(state.record.name).toBe(CHARACTER)
    expect(isIdentified(state)).toBe(true)
  })

  it('confirms the name from the entity the world drew for us', () => {
    const state = run([userAppearance(), drawSelf(CHARACTER)])
    expect(state.name).toBe(CHARACTER)
    expect(state.nameIsConfirmed).toBe(true)
  })

  it('lets a drawn entity correct a name the redirect gave', () => {
    // The redirect name is a good first answer. The world is the authority.
    const state = run([userAppearance(), drawSelf('Fintan')], { keyName: 'socket[256]' })
    expect(state.name).toBe('Fintan')
    expect(state.record.name).toBe('Fintan')
    expect(state.nameIsConfirmed).toBe(true)
  })

  it('keeps the confirmed name when the redirect name arrives afterwards', () => {
    const confirmed = run([userAppearance(), drawSelf(CHARACTER)])
    const later = run([fullStatus], { from: confirmed, keyName: 'socket[256]' })
    expect(later.name).toBe(CHARACTER)
  })

  it('ignores another player the world drew', () => {
    const state = run([userAppearance(USER_ID), drawSelf('Someone Else', 0x1234)])
    expect(state.name).toBeNull()
    // Another player's appearance must not become ours either.
    expect(state.record.appearance.hairColor).toBe(0)
  })

  it('ignores a drawn entity before we know our own id', () => {
    expect(run([drawSelf(CHARACTER)]).name).toBeNull()
  })
})

describe('SStatus merges rather than replaces', () => {
  it('reads a full login snapshot', () => {
    const { record } = run([fullStatus], { keyName: CHARACTER })
    expect(record.stats).toMatchObject({
      level: 99,
      abilityLevel: 12,
      maxHealth: 2500,
      currentHealth: 2431,
      maxMana: 1800,
      currentMana: 1799,
      strength: 150,
      statPoints: 3,
      weight: 742,
      maxWeight: 1000,
      gold: 3000000000,
      totalExperience: 1234567890,
      armorClass: -10,
      magicResistance: 30,
      damageModifier: 12,
      hitModifier: 9
    })
    expect(record.hasMail).toBe(true)
  })

  it('keeps everything else when only the vitals arrive', () => {
    // This is the packet that follows every point of damage. If it replaced
    // the record, the sheet would empty each time the character was hit.
    const after = run(
      [
        {
          kind: 'status',
          fields: 0x10,
          privilege: 0,
          mailActive: false,
          vitals: { health: 12, mana: 3 }
        }
      ],
      { from: run([fullStatus, item(1, 'Stick')], { keyName: CHARACTER }) }
    )

    expect(after.record.stats.currentHealth).toBe(12)
    expect(after.record.stats.currentMana).toBe(3)
    expect(after.record.stats.level).toBe(99)
    expect(after.record.stats.gold).toBe(3000000000)
    expect(after.record.stats.maxHealth).toBe(2500)
    expect(after.record.inventory[1]?.name).toBe('Stick')
  })

  it('keeps everything else when only the gold changes', () => {
    const after = run(
      [
        {
          kind: 'status',
          fields: 0x08,
          privilege: 0,
          mailActive: false,
          currency: {
            totalExperience: 1234567890,
            toNextLevel: 4000,
            totalAbility: 88000,
            toNextAbility: 1200,
            gamePoints: 45,
            gold: 17
          }
        }
      ],
      { from: run([fullStatus], { keyName: CHARACTER }) }
    )
    expect(after.record.stats.gold).toBe(17)
    expect(after.record.stats.level).toBe(99)
    expect(after.record.stats.currentHealth).toBe(2431)
  })

  it('shows no unspent points when the server says there are none to spend', () => {
    const state = run([
      {
        kind: 'status',
        fields: 0x20,
        privilege: 0,
        mailActive: false,
        coreStats: { ...fullStatus.coreStats!, hasStatPoints: false, statPoints: 7 }
      }
    ])
    expect(state.record.stats.statPoints).toBe(0)
  })

  it('reads the mail state only when the flag byte makes it active', () => {
    const inactive = run([
      { ...fullStatus, mailActive: false, modifiers: { ...fullStatus.modifiers!, mailState: 1 } }
    ])
    expect(inactive.record.hasMail).toBe(false)

    const active = run([fullStatus])
    expect(active.record.hasMail).toBe(true)
  })
})

describe('inventory and equipment', () => {
  it('places an item and reads its stack count', () => {
    const { record } = run([item(1, 'Raw Fish', 65)])
    expect(record.inventory[1]).toEqual({
      name: 'Raw Fish',
      sprite: 0x0134,
      color: 7,
      count: 65,
      canStack: true,
      durability: 9500,
      maxDurability: 10000
    })
  })

  it('replaces the item in a slot that already held one', () => {
    const { record } = run([item(4, 'Old'), item(4, 'New')])
    expect(record.inventory[4]?.name).toBe('New')
    expect(Object.keys(record.inventory)).toEqual(['4'])
  })

  it('clears a slot', () => {
    const { record } = run([item(2, 'Stick'), { kind: 'removeInventory', slot: 2 }])
    expect(record.inventory[2]).toBeUndefined()
  })

  it('does nothing when clearing a slot that is already empty', () => {
    const before = run([item(1, 'Stick')])
    const after = run([{ kind: 'removeInventory', slot: 9 }], { from: before })
    expect(after.record.inventory).toEqual(before.record.inventory)
  })

  it('places and clears equipment', () => {
    const equipped = run([equip(1, 'Staff of Ages')])
    expect(equipped.record.equipment[1]).toMatchObject({
      name: 'Staff of Ages',
      count: 1,
      canStack: false,
      durability: 400,
      maxDurability: 500
    })

    const bare = run([{ kind: 'removeEquip', slot: 1 }], { from: equipped })
    expect(bare.record.equipment[1]).toBeUndefined()
  })

  it('ignores a slot outside the range the client can show', () => {
    const { record } = run([
      item(0, 'Nowhere'),
      item(61, 'Nowhere'),
      equip(0, 'Sentinel'),
      equip(19, 'Nowhere')
    ])
    expect(record.inventory).toEqual({})
    expect(record.equipment).toEqual({})
  })

  it('accepts every real slot', () => {
    const inventory = Array.from({ length: 60 }, (_, i) => item(i + 1, `item ${i + 1}`))
    const equipment = Array.from({ length: 18 }, (_, i) => equip(i + 1, `equip ${i + 1}`))
    const { record } = run([...inventory, ...equipment])
    expect(Object.keys(record.inventory)).toHaveLength(60)
    expect(Object.keys(record.equipment)).toHaveLength(18)
  })
})

describe('profile and appearance', () => {
  it('reads the profile and its legend marks', () => {
    const { record } = run([selfLook])
    expect(record).toMatchObject({
      title: 'Grand Master',
      guild: 'Solid Union',
      guildRank: 'Elder',
      displayClass: 'Gardcorp'
    })
    expect(record.appearance.nation).toBe(4)
    expect(record.appearance.characterClass).toBe(3)
    expect(record.legend).toEqual([{ icon: 3, color: 1, key: 'mark_wiz', text: 'Became a Wizard' }])
  })

  it('replaces the whole legend, because the server always sends all of it', () => {
    const first = run([selfLook])
    const second = run([{ ...selfLook, legend: [] }], { from: first })
    expect(second.record.legend).toEqual([])
  })

  it('reads our own appearance from the entity the world drew', () => {
    const { record } = run([userAppearance(), drawSelf(CHARACTER)])
    expect(record.appearance).toMatchObject({
      hairStyle: 0x0100,
      hairColor: 9,
      bodyShape: 2,
      faceShape: 1,
      skinColor: 2,
      armorSprite: 0x0202,
      weaponSprite: 0x0303,
      shieldSprite: 3,
      bootsSprite: 5,
      overcoatSprite: 0x0044,
      overcoatColor: 6
    })
  })

  it('ignores a monster disguise, which carries no human sprites', () => {
    const before = run([userAppearance(), drawSelf(CHARACTER)])
    const disguised = run(
      [
        {
          kind: 'drawHumanObjects',
          x: 1,
          y: 1,
          direction: 0,
          entityId: USER_ID,
          name: CHARACTER,
          nameStyle: 0,
          groupAdText: '',
          monster: { monsterSprite: 0x00a0, monsterColor: 5 }
        }
      ],
      { from: before }
    )
    expect(disguised.record.appearance).toEqual(before.record.appearance)
  })
})

describe('the reducer as a whole', () => {
  it('never changes the state it was given', () => {
    const before = run([fullStatus, item(1, 'Stick')], { keyName: CHARACTER })
    const snapshot = JSON.parse(JSON.stringify(before.record))
    run([item(2, 'Rope'), { kind: 'removeInventory', slot: 1 }], { from: before })
    expect(JSON.parse(JSON.stringify(before.record))).toEqual(snapshot)
  })

  it('moves lastSeen forward only when something changed', () => {
    const before = run([fullStatus], { keyName: CHARACTER, startMs: 1000 })
    const seenAt = before.record.lastSeenMs

    // An opcode the record does not care about must not disturb the clock.
    const after = reduce(before, {
      packet: { kind: 'versionCheck', subtype: 1 },
      timestampMs: seenAt + 60000
    })
    expect(after.record.lastSeenMs).toBe(seenAt)

    const changed = reduce(before, { packet: item(1, 'Stick'), timestampMs: seenAt + 60000 })
    expect(changed.record.lastSeenMs).toBe(seenAt + 60000)
  })

  it('replays a whole login into one record', () => {
    const state = run(
      [
        userAppearance(),
        fullStatus,
        selfLook,
        drawSelf(CHARACTER),
        equip(1, 'Staff of Ages'),
        equip(2, 'Bardocle'),
        item(1, 'Raw Fish', 65),
        item(2, 'Stick'),
        { kind: 'removeInventory', slot: 2 }
      ],
      { keyName: CHARACTER }
    )

    expect(isIdentified(state)).toBe(true)
    expect(state.record.name).toBe(CHARACTER)
    expect(state.record.stats.level).toBe(99)
    expect(state.record.stats.gold).toBe(3000000000)
    expect(state.record.title).toBe('Grand Master')
    expect(state.record.legend).toHaveLength(1)
    expect(Object.keys(state.record.equipment)).toEqual(['1', '2'])
    expect(Object.keys(state.record.inventory)).toEqual(['1'])
    expect(state.record.inventory[1]?.count).toBe(65)
    expect(state.record.appearance.hairColor).toBe(9)
  })
})

describe('the bank', () => {
  const bankPacket = (
    items: { name: string; count: number }[],
    npcName = 'Antonio'
  ): DecodedPacket => ({
    kind: 'bankContents',
    sourceId: 0x1f6f,
    npcName,
    items: items.map((item) => ({ name: item.name, sprite: 1, color: 0, count: item.count }))
  })

  it('is absent until a bank list arrives', () => {
    // An unread bank is not an empty one, so there is nothing to record yet.
    const state = run([fullStatus], { keyName: CHARACTER })
    expect(state.record.bank).toBeUndefined()
  })

  it('records what the bank held, the banker, and when it was read', () => {
    const state = run([fullStatus, bankPacket([{ name: 'Stick', count: 4 }])], {
      keyName: CHARACTER,
      startMs: 5000
    })

    expect(state.record.bank).toMatchObject({ npcName: 'Antonio', readAtMs: 5020 })
    expect(state.record.bank!.items).toEqual([{ name: 'Stick', sprite: 1, color: 0, count: 4 }])
  })

  it('replaces the list rather than merging it', () => {
    // The whole bank arrives at once. Merging would keep an item the player
    // has since withdrawn, and there is no per-item update to correct it.
    const state = run(
      [
        fullStatus,
        bankPacket([
          { name: 'Stick', count: 4 },
          { name: 'Beryl', count: 1 }
        ]),
        bankPacket([{ name: 'Beryl', count: 1 }])
      ],
      { keyName: CHARACTER }
    )

    expect(state.record.bank!.items.map((entry) => entry.name)).toEqual(['Beryl'])
  })

  it('records a bank that came back with nothing in it', () => {
    // Distinct from never having read one. Silence never reaches the reducer.
    const state = run([fullStatus, bankPacket([])], { keyName: CHARACTER })
    expect(state.record.bank).not.toBeUndefined()
    expect(state.record.bank!.items).toEqual([])
  })
})

describe('the bank the player asked for', () => {
  const BANKER = 0x1f6f

  const request = (pursuit = BANK_WITHDRAW_REQUEST_PURSUIT): DecodedPacket => ({
    kind: 'merchantResponse',
    objectType: 1,
    objectId: BANKER,
    pursuit,
    tail: new Uint8Array(0)
  })

  const bankList = (): DecodedPacket => ({
    kind: 'bankContents',
    sourceId: BANKER,
    npcName: 'Antonio',
    items: [{ name: 'Stick', sprite: 1, color: 0, count: 4 }]
  })

  /** A packet that says nothing about this record, such as somebody else. */
  const idle: DecodedPacket = drawSelf('Someone', 0x1234)

  /** Apply one packet at an exact time. */
  function at(
    state: CharacterSession,
    packet: DecodedPacket,
    timestampMs: number,
    sawLoss = false
  ): CharacterSession {
    return reduce(state, { packet, timestampMs, keyName: CHARACTER, sawLoss })
  }

  const started = (): CharacterSession => at(newSession(1000), fullStatus, 1000)

  it('waits rather than deciding when the request goes out', () => {
    const state = at(started(), request(), 2000)
    expect(state.record.bank).toBeUndefined()
    expect(state.pendingBank).toMatchObject({ atMs: 2000, objectId: BANKER })
  })

  it('fills the bank when the list arrives, and stops waiting', () => {
    const asked = at(started(), request(), 2000)
    const answered = at(asked, bankList(), 2200)
    expect(answered.record.bank!.items).toHaveLength(1)
    expect(answered.pendingBank).toBeUndefined()
  })

  it('records an empty bank once the wait has passed', () => {
    // The request is the evidence. Nothing came back, so the bank was empty,
    // and the reading belongs to the moment the player looked.
    const asked = at(started(), request(), 2000)
    const later = at(asked, idle, 2000 + BANK_REPLY_WINDOW_MS)
    expect(later.record.bank).toMatchObject({ readAtMs: 2000 })
    expect(later.record.bank!.items).toEqual([])
    expect(later.record.bank!.npcName).toBeUndefined()
    expect(later.pendingBank).toBeUndefined()
  })

  it('keeps waiting while the wait has not passed', () => {
    const asked = at(started(), request(), 2000)
    const soon = at(asked, idle, 2000 + BANK_REPLY_WINDOW_MS - 1)
    expect(soon.record.bank).toBeUndefined()
    expect(soon.pendingBank).not.toBeUndefined()
  })

  it('ignores a request to a menu that is not the bank', () => {
    // Pursuit 0x40 is a shop's buy list from the same NPC.
    const state = at(started(), request(0x40), 2000)
    expect(state.pendingBank).toBeUndefined()
  })

  it('says nothing at all when bytes were lost', () => {
    // A missed list looks exactly like an empty bank. Neither may be claimed.
    const asked = at(started(), request(), 2000)
    const lossy = at(asked, idle, 2100, true)
    const later = at(lossy, idle, 2000 + BANK_REPLY_WINDOW_MS)
    expect(later.record.bank).toBeUndefined()
    expect(later.pendingBank).toBeUndefined()
  })

  it('leaves an earlier reading alone while it waits', () => {
    const read = at(started(), bankList(), 1500)
    const asked = at(read, request(), 2000)
    expect(asked.record.bank!.items).toHaveLength(1)
  })

  it('settles a request the connection ended on', () => {
    const asked = at(started(), request(), 2000)
    const settled = resolvePendingBank(asked, 2000 + BANK_REPLY_WINDOW_MS)
    expect(settled.record.bank).toMatchObject({ readAtMs: 2000 })
    expect(settled.record.bank!.items).toEqual([])
    expect(settled.pendingBank).toBeUndefined()
  })

  it('leaves a request alone when the connection ended sooner than the wait', () => {
    // The list could still have been on its way.
    const asked = at(started(), request(), 2000)
    expect(resolvePendingBank(asked, 2100)).toBe(asked)
  })

  it('does nothing on close when nothing was asked for', () => {
    const state = started()
    expect(resolvePendingBank(state, 9999)).toBe(state)
  })
})
