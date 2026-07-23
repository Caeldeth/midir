import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCharacterStore } from '@renderer/store/characterStore'
import { emptyCharacter, type CharacterRecord, type ItemRef } from '@shared/character'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Items from '../Items'

const item = (name: string, extra: Partial<ItemRef> = {}): ItemRef => ({
  name,
  sprite: 1,
  color: 0,
  count: 1,
  canStack: false,
  durability: 0,
  maxDurability: 0,
  ...extra
})

function character(name: string, extra: Partial<CharacterRecord> = {}): CharacterRecord {
  return { ...emptyCharacter(name, 1000), lastSeenMs: Date.now(), ...extra }
}

const SABRAEL = character('Sabrael', {
  equipment: { 1: item('Staff of Ages', { durability: 400, maxDurability: 500 }) },
  inventory: { 1: item('Raw Fish', { count: 65, canStack: true }), 5: item('Stick') }
})

const FINTAN = character('Fintan', {
  inventory: { 2: item('Raw Fish', { count: 5, canStack: true }) }
})

/** Load the store the way main would, then render the page. */
async function renderWith(records: CharacterRecord[]): Promise<void> {
  window.api.characters.list = vi.fn(async () => records)
  render(<Items />)
  if (records.length > 0) await screen.findByTestId('item-index')
}

beforeEach(() => {
  useCharacterStore.setState({ characters: [], selected: null, loading: false })
})

describe('the Items page', () => {
  it('tells the user what to do when nothing is recorded', async () => {
    await renderWith([])
    expect(await screen.findByText('No items yet')).toBeInTheDocument()
  })

  it('lists every item across every character', async () => {
    await renderWith([SABRAEL, FINTAN])
    expect(screen.getByText('Raw Fish')).toBeInTheDocument()
    expect(screen.getByText('Stick')).toBeInTheDocument()
    expect(screen.getByText('Staff of Ages')).toBeInTheDocument()
  })

  it('adds up a stack held by two characters and names both holders', async () => {
    await renderWith([SABRAEL, FINTAN])
    const row = screen.getByText('Raw Fish').closest('tr')!
    expect(within(row).getByText('70')).toBeInTheDocument()
    expect(within(row).getByText('Fintan × 5')).toBeInTheDocument()
    expect(within(row).getByText('Sabrael × 65')).toBeInTheDocument()
  })

  it('summarises what is on screen', async () => {
    await renderWith([SABRAEL, FINTAN])
    expect(screen.getByTestId('item-summary')).toHaveTextContent(
      '3 items · 72 held across 2 characters'
    )
  })

  it('filters as the user types, and resummarises', async () => {
    await renderWith([SABRAEL, FINTAN])
    await userEvent.type(screen.getByLabelText('Search items'), 'fish')

    await waitFor(() => expect(screen.queryByText('Stick')).not.toBeInTheDocument())
    expect(screen.getByText('Raw Fish')).toBeInTheDocument()
    expect(screen.getByTestId('item-summary')).toHaveTextContent(
      '1 item · 70 held across 2 characters'
    )
  })

  it('says plainly when nothing matches', async () => {
    await renderWith([SABRAEL])
    await userEvent.type(screen.getByLabelText('Search items'), 'crown')
    expect(await screen.findByText(/No item matches/)).toBeInTheDocument()
  })

  it('says how long ago each item was seen, so a count is never read as live', async () => {
    const old = character('Ghost', {
      lastSeenMs: Date.now() - 3 * 24 * 60 * 60 * 1000,
      inventory: { 1: item('Beryl') }
    })
    await renderWith([old])
    const row = screen.getByText('Beryl').closest('tr')!
    expect(within(row).getByText('3 days ago')).toBeInTheDocument()
  })
})
