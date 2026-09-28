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

  it('guides rather than showing an empty search when a character holds nothing', async () => {
    // One SStatus files a record, and it arrives before the first item
    // packet. That character used to reach the "no item matches" branch with
    // an empty query, which read as a failed search nobody had run.
    window.api.characters.list = vi.fn(async () => [character('Newborn')])
    render(<Items />)

    expect(await screen.findByText('No items yet')).toBeInTheDocument()
    expect(screen.queryByText(/No item matches/)).not.toBeInTheDocument()
    expect(screen.getByText(/has not read an item/)).toBeInTheDocument()
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
    expect(
      within(row)
        .getAllByTestId('item-holder')
        .map((tag) => tag.textContent)
    ).toEqual(['Fintan×5', 'Sabrael×65'])
  })

  it('names a character once, however many slots hold the item', async () => {
    // One character is one answer. Three slots used to draw three separate
    // labels for the same person, which read as three different holders.
    const hoarder = character('Taurael', {
      equipment: { 1: item('Claw') },
      inventory: { 2: item('Claw'), 6: item('Claw') }
    })
    await renderWith([hoarder])

    const row = screen.getByText('Claw').closest('tr')!
    const holders = within(row).getAllByTestId('item-holder')
    expect(holders).toHaveLength(1)
    expect(holders[0]).toHaveTextContent('Taurael×3')
  })

  it('marks a worn item, and leaves a carried one unmarked', async () => {
    await renderWith([SABRAEL, FINTAN])
    const worn = screen.getByText('Staff of Ages').closest('tr')!
    expect(within(worn).getByLabelText('worn')).toBeInTheDocument()

    const carried = screen.getByText('Raw Fish').closest('tr')!
    expect(within(carried).queryByLabelText('worn')).not.toBeInTheDocument()
  })

  it('gives the slot and durability on hover, not in the row', async () => {
    await renderWith([SABRAEL])
    const row = screen.getByText('Staff of Ages').closest('tr')!
    await userEvent.hover(within(row).getByTestId('item-holder'))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('400 / 500')
    expect(tooltip).toHaveTextContent('Sabrael')
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

describe('a long index', () => {
  /**
   * Windowing (HTOO-85). A row is not cheap — an icon, and a tooltip for each
   * holder — and the index grows with every character: 25 characters made 703
   * rows and 1375 holders, 9500 DOM nodes, and over a second of mounting before
   * anything reached the screen.
   *
   * jsdom has no layout, so the visible count is not a number a test can assert.
   * What it can assert is that the page does not mount every row, that the rows
   * it does mount are real, and that the height of the rest is reserved.
   */
  function manyItems(count: number): CharacterRecord {
    const inventory: Record<number, ItemRef> = {}
    for (let index = 0; index < count; index++) {
      inventory[index + 1] = item(`Item ${String(index).padStart(4, '0')}`, { sprite: 100 + index })
    }
    return character('Hoarder', { inventory })
  }

  /**
   * A scroller with a size, and something to report it.
   *
   * jsdom has neither: no layout, and no `ResizeObserver`. The page's own
   * fallback means that without both of these it renders every row, which is the
   * behaviour the last test here pins. These two give the window something to
   * measure so the windowed path can be exercised at all.
   */
  function withLayout(height: number): () => void {
    const rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect')
    const observer = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    Element.prototype.getBoundingClientRect = function (): DOMRect {
      const box = { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: height, width: 900, height }
      return { ...box, toJSON: () => box } as DOMRect
    }
    // The virtualizer reads `borderBoxSize` first and `offsetWidth`/`offsetHeight`
    // after it, so both are given here.
    const offsets = ['offsetWidth', 'offsetHeight'] as const
    const held = offsets.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 900 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: height
    })
    class Reporter {
      constructor(private readonly notify: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.notify(
          [
            {
              target,
              borderBoxSize: [{ inlineSize: 900, blockSize: height }]
            } as unknown as ResizeObserverEntry
          ],
          this as unknown as ResizeObserver
        )
      }
      unobserve(): void {
        // Nothing to stop: the size is reported once, on observe.
      }
      disconnect(): void {
        // As above.
      }
    }
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = Reporter
    return () => {
      if (rect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', rect)
      offsets.forEach((name, at) => {
        if (held[at]) Object.defineProperty(HTMLElement.prototype, name, held[at]!)
      })
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = observer
    }
  }

  it('mounts a window of the rows, not all 400 of them', async () => {
    const restore = withLayout(600)
    try {
      await renderWith([manyItems(400)])
      await screen.findByTestId('item-index')
      const rows = within(screen.getByTestId('item-index')).getAllByRole('row')
      // The header, some rows, and the spacers — nowhere near 400.
      expect(rows.length).toBeLessThan(120)
      expect(screen.getByTestId('item-summary')).toHaveTextContent('400 items')
    } finally {
      restore()
    }
  })

  it('reserves the height of the rows it did not mount', async () => {
    const restore = withLayout(600)
    try {
      await renderWith([manyItems(400)])
      await screen.findByTestId('item-index')
      const pad = screen.queryByTestId('item-index-pad-bottom')
      expect(pad).not.toBeNull()
      expect(Number.parseInt(pad!.style.height, 10)).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('renders every row when the index is short, so nothing changes for a small record', async () => {
    await renderWith([manyItems(20)])
    await screen.findByTestId('item-index')
    expect(within(screen.getByTestId('item-index')).getAllByRole('row')).toHaveLength(21)
    expect(screen.queryByTestId('item-index-pad-top')).toBeNull()
    expect(screen.queryByTestId('item-index-pad-bottom')).toBeNull()
  })

  it('still searches a windowed index', async () => {
    const restore = withLayout(600)
    try {
      await renderWith([manyItems(400)])
      await screen.findByTestId('item-index')
      await userEvent.type(screen.getByLabelText('Search items'), 'Item 0007')
      expect(screen.getByTestId('item-summary')).toHaveTextContent('1 item')
      expect(await screen.findByText('Item 0007')).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
