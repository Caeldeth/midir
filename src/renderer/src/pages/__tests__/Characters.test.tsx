import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCharacterStore } from '@renderer/store/characterStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { emptyCharacter, type CharacterRecord } from '@shared/character'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Characters from '../Characters'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function character(name: string, lastSeenMs: number): CharacterRecord {
  return { ...emptyCharacter(name, 1000), lastSeenMs }
}

const TODAY = character('Sabrael', NOW)
const LAST_WEEK = character('Fintan', NOW - 8 * DAY)
const LAST_YEAR = character('Eolathe', NOW - 400 * DAY)

async function renderWith(records: CharacterRecord[]): Promise<void> {
  window.api.characters.list = vi.fn(async () => records)
  render(<Characters />)
  if (records.length > 0) await screen.findByTestId('character-list')
}

async function pick(label: string): Promise<void> {
  await userEvent.click(screen.getByRole('combobox', { name: 'Hide unseen' }))
  await userEvent.click(await screen.findByRole('option', { name: label }))
}

function listedNames(): string[] {
  return within(screen.getByTestId('character-list'))
    .getAllByRole('button')
    .filter((el) => el.tagName === 'DIV')
    .map((el) => el.textContent?.split('Level')[0] ?? '')
}

beforeEach(() => {
  useCharacterStore.setState({ characters: [], selected: null, loading: false })
  useSettingsStore.setState({ hideUnseenDays: 0 })
})

describe('the Characters page hide-unseen filter (WP25)', () => {
  it('lists every character when the filter is off', async () => {
    await renderWith([TODAY, LAST_WEEK, LAST_YEAR])
    expect(listedNames()).toEqual(['Sabrael', 'Fintan', 'Eolathe'])
    expect(screen.queryByTestId('hidden-count')).not.toBeInTheDocument()
  })

  it('hides a character not seen within the threshold, and says how many', async () => {
    useSettingsStore.setState({ hideUnseenDays: 30 })
    await renderWith([TODAY, LAST_WEEK, LAST_YEAR])
    expect(listedNames()).toEqual(['Sabrael', 'Fintan'])
    expect(screen.getByTestId('hidden-count')).toHaveTextContent('1 hidden, still on file')
  })

  it('counts back from the newest sighting, so an old record set still shows its newest', async () => {
    useSettingsStore.setState({ hideUnseenDays: 7 })
    const old = [LAST_WEEK, LAST_YEAR]
    await renderWith(old)
    expect(listedNames()).toEqual(['Fintan'])
  })

  it('the control writes the setting, and the list follows it', async () => {
    await renderWith([TODAY, LAST_WEEK, LAST_YEAR])
    await pick('Not seen in 7 days')
    expect(useSettingsStore.getState().hideUnseenDays).toBe(7)
    expect(listedNames()).toEqual(['Sabrael'])
    expect(screen.getByTestId('hidden-count')).toHaveTextContent('2 hidden')

    await pick('Off')
    expect(listedNames()).toEqual(['Sabrael', 'Fintan', 'Eolathe'])
  })

  it('a selection the filter hid falls back to the newest listed character', async () => {
    await renderWith([TODAY, LAST_YEAR])
    await userEvent.click(screen.getByText('Eolathe'))
    expect(useCharacterStore.getState().selected).toBe('Eolathe')
    await pick('Not seen in 30 days')
    expect(listedNames()).toEqual(['Sabrael'])
    // The sheet shows the listed character, not the hidden selection.
    expect(screen.getAllByText('Sabrael').length).toBeGreaterThan(1)
  })

  it('hiding removes nothing: Forget is still the only delete', async () => {
    const remove = vi.fn(async () => undefined)
    window.api.characters.remove = remove
    useSettingsStore.setState({ hideUnseenDays: 30 })
    await renderWith([TODAY, LAST_YEAR])
    expect(remove).not.toHaveBeenCalled()
    expect(useCharacterStore.getState().characters).toHaveLength(2)
    await userEvent.click(screen.getByLabelText('Forget Sabrael'))
    expect(remove).toHaveBeenCalledWith('Sabrael')
  })
})
