import { render, screen, within } from '@testing-library/react'
import { emptyCharacter, type CharacterRecord, type ItemRef } from '@shared/character'
import React from 'react'
import { describe, expect, it } from 'vitest'
import CharacterSheet from '../CharacterSheet'

const item = (name: string, extra: Partial<ItemRef> = {}): ItemRef => ({
  name,
  sprite: 1,
  color: 0,
  count: 1,
  canStack: false,
  durability: 400,
  maxDurability: 500,
  ...extra
})

function build(): CharacterRecord {
  const record = emptyCharacter('Sabrael', 1000)
  return {
    ...record,
    lastSeenMs: Date.now(),
    title: 'Grand Master',
    guild: 'Solid Union',
    guildRank: 'Elder',
    displayClass: 'Gardcorp',
    hasMail: true,
    stats: {
      ...record.stats,
      level: 99,
      abilityLevel: 12,
      currentHealth: 2431,
      maxHealth: 2500,
      currentMana: 1799,
      maxMana: 1800,
      strength: 150,
      gold: 3000000000,
      weight: 742,
      maxWeight: 1000,
      statPoints: 3,
      armorClass: -10,
      damageModifier: 12,
      attackElement: 1
    },
    appearance: { ...record.appearance, characterClass: 3, nation: 4, hairColor: 9 },
    equipment: { 1: item('Staff of Ages'), 2: item('Bardocle') },
    inventory: { 1: item('Raw Fish', { count: 65, canStack: true }), 5: item('Stick') },
    legend: [{ icon: 3, color: 1, key: 'mark_wiz', text: 'Became a Wizard' }]
  }
}

describe('CharacterSheet', () => {
  it('shows the name, level, and class', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('Sabrael')).toBeInTheDocument()
    expect(screen.getByText(/Level 99/)).toBeInTheDocument()
    expect(screen.getByText(/Gardcorp/)).toBeInTheDocument()
  })

  it('formats large numbers with separators', () => {
    // Gold above 2^31 is normal in retail. It must read as a number, not a
    // negative one or an exponent.
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('3,000,000,000')).toBeInTheDocument()
  })

  it('signs the armour class, because a lower one is better', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('-10')).toBeInTheDocument()
    expect(screen.getByText('+12')).toBeInTheDocument()
  })

  it('lists equipment by slot name', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('Weapon')).toBeInTheDocument()
    expect(screen.getByText('Staff of Ages')).toBeInTheDocument()
    expect(screen.getByText('Armor')).toBeInTheDocument()
  })

  it('shows a stack count and leaves a single item bare', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('[65]')).toBeInTheDocument()
    expect(screen.getByText('Stick')).toBeInTheDocument()
  })

  it('counts the inventory slots in use', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('2 of 60 slots used')).toBeInTheDocument()
  })

  it('shows the legend marks', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('Became a Wizard')).toBeInTheDocument()
  })

  it('shows the title, guild, nation, and waiting mail', () => {
    render(<CharacterSheet record={build()} />)
    expect(screen.getByText('Grand Master')).toBeInTheDocument()
    expect(screen.getByText('Solid Union · Elder')).toBeInTheDocument()
    expect(screen.getByText('Mail waiting')).toBeInTheDocument()
    // The nation is both a chip on the identity card and a row on the
    // appearance card, so two matches are correct here.
    expect(screen.getAllByText('Mileth')).toHaveLength(2)
  })

  it('says plainly when a section is empty, rather than showing nothing', () => {
    const bare = emptyCharacter('Newborn', Date.now())
    render(<CharacterSheet record={bare} />)
    expect(screen.getByText('Nothing equipped yet.')).toBeInTheDocument()
    expect(screen.getByText('No items seen yet.')).toBeInTheDocument()
    expect(screen.getByText('No legend marks seen yet.')).toBeInTheDocument()
  })

  it('never calls an unread bank an empty one', () => {
    // An empty bank sends no reply at all, so silence and an empty bank are
    // the same on the wire. Saying "empty" here would be a claim Midir cannot
    // make, and it would read as "you have nothing" to a player who does.
    const bare = emptyCharacter('Newborn', Date.now())
    render(<CharacterSheet record={bare} />)

    expect(screen.getByText(/Not read yet/)).toBeInTheDocument()
    expect(screen.queryByText(/bank is empty/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No items in the bank/i)).not.toBeInTheDocument()
  })

  it('says a bank was empty when the player asked and nothing came back', () => {
    // This is the other case, and it is a reading rather than a silence: the
    // request is on the wire, so Midir knows the player looked.
    const record = {
      ...emptyCharacter('Sabrael', Date.now()),
      bank: { readAtMs: Date.now() - 60 * 60 * 1000, items: [] }
    }
    render(<CharacterSheet record={record} />)

    expect(screen.getByText(/Empty when you last looked/)).toBeInTheDocument()
    expect(screen.queryByText(/Not read yet/)).not.toBeInTheDocument()
  })

  it('shows the bank with the banker and how old the reading is', () => {
    const record = {
      ...emptyCharacter('Sabrael', Date.now()),
      bank: {
        readAtMs: Date.now() - 3 * 24 * 60 * 60 * 1000,
        npcName: 'Drave',
        items: [
          { name: 'Andor Aiquilon', sprite: 0x87ee, color: 0, count: 10 },
          { name: 'Bent Crux', sprite: 0x8053, color: 0, count: 1 }
        ]
      }
    }
    render(<CharacterSheet record={record} />)

    expect(screen.getByText('Andor Aiquilon')).toBeInTheDocument()
    expect(screen.getByText('×10')).toBeInTheDocument()
    expect(screen.getByText(/Drave/)).toBeInTheDocument()
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument()
  })

  it('does not crash when the maximums are zero', () => {
    // A record with only a name has no maximum health, so the bars must not
    // divide by zero.
    const bare = emptyCharacter('Newborn', Date.now())
    const { container } = render(<CharacterSheet record={bare} />)
    expect(within(container).getByText('Newborn')).toBeInTheDocument()
  })
})
