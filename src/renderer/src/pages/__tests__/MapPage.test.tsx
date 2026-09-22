import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMapStore } from '@renderer/store/mapStore'
import type { MapView } from '@shared/map'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MapPage, { drawTiles, scaleFor } from '../MapPage'

/** The map viewer over a fixed view (WP30). The canvas is jsdom's null; the overlay is read. */

const TOWN: MapView = {
  mapId: 1,
  mapName: 'Town',
  width: 4,
  height: 3,
  collision: [0, 0, 0, 0, 0, 0x0f, 0x08, 0, 0, 0, 0, 0],
  warps: [
    { x: 3, y: 0, toMapId: 2, toMapName: 'Field', source: 'authored', observations: 3 },
    { x: 0, y: 2, toMapId: 5, toMapName: '', via: 'dialog', source: 'authored' },
    { x: 1, y: 0, toMapId: 2, toMapName: 'Field', source: 'learned', observations: 2 }
  ],
  sizeSource: 'graph'
}

beforeEach(() => {
  // jsdom has no canvas and says so on every render; the page draws nothing then.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  useMapStore.setState({
    maps: [
      { mapId: 1, name: 'Town', drawable: true },
      { mapId: 2, name: 'Field', drawable: false }
    ],
    selected: null,
    view: null,
    failure: null,
    loading: false,
    positions: [],
    walkers: {},
    follow: true
  })
  window.api.map.list = vi.fn(async () => useMapStore.getState().maps)
  window.api.map.positions = vi.fn(async () => [])
  window.api.map.view = vi.fn(async (mapId: number) =>
    mapId === 1
      ? { ok: true as const, view: TOWN }
      : { ok: false as const, failure: { kind: 'noSize' as const } }
  )
})

describe('the Map page', () => {
  it('asks for a map until one is picked', () => {
    render(<MapPage />)
    expect(screen.getByText('Pick a map')).toBeInTheDocument()
  })

  it('draws the picked map with its warps, each naming its destination', async () => {
    render(<MapPage />)
    await useMapStore.getState().select(1)
    expect(await screen.findByTestId('map-view')).toBeInTheDocument()
    expect(screen.getByTestId('map-caption')).toHaveTextContent(
      '4 × 3 tiles, size from the world map · 3 warps'
    )
    const warps = screen.getAllByTestId('map-warp')
    expect(warps).toHaveLength(3)
    await userEvent.hover(warps[0]!)
    expect(
      await screen.findByText('→ Field · confirmed by the wire, seen 3 times')
    ).toBeInTheDocument()
    await userEvent.unhover(warps[0]!)
    // A warp the wire learned says so, and is drawn apart (WP29).
    await userEvent.hover(warps[2]!)
    expect(
      await screen.findByText('→ Field · learned from the wire, seen 2 times')
    ).toBeInTheDocument()
  })

  it('the picker opens its list, names every map, greys the undrawable, and picks one', async () => {
    // The renderInput override once replaced the Autocomplete's slot props
    // and dropped the input slot's ref, so the list never opened.
    render(<MapPage />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Map' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Town (1)', 'Field (2)'])
    expect(options[1]).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(options[0]!)
    expect(await screen.findByTestId('map-view')).toBeInTheDocument()
    expect(useMapStore.getState().follow).toBe(false)
  })

  it('says why a map cannot be drawn', async () => {
    render(<MapPage />)
    await useMapStore.getState().select(2)
    expect(await screen.findByText('This map cannot be drawn')).toBeInTheDocument()
    expect(screen.getByText(/not known yet/)).toBeInTheDocument()
  })

  it('shows a dot for each character on this map, with its confidence', async () => {
    render(<MapPage />)
    await useMapStore.getState().select(1)
    useMapStore.setState({
      positions: [
        { connectionId: 'a', name: 'Fintan', mapId: 1, x: 2, y: 1, confidence: 'confirmed' },
        { connectionId: 'b', name: 'Sabrael', mapId: 1, x: 0, y: 0, confidence: 'predicted' },
        { connectionId: 'c', name: 'Elsewhere', mapId: 9, x: 0, y: 0, confidence: 'confirmed' }
      ]
    })
    await waitFor(() => expect(screen.getAllByTestId('map-position')).toHaveLength(2))
    const dots = screen.getAllByTestId('map-position')
    expect(dots.map((d) => d.getAttribute('data-confidence'))).toEqual(['confirmed', 'predicted'])
  })

  it('draws a running walker’s path, and its stop with the reason', async () => {
    render(<MapPage />)
    await useMapStore.getState().select(1)
    useMapStore.setState({
      walkers: {
        a: {
          connectionId: 'a',
          running: true,
          position: { mapId: 1, x: 0, y: 0, confidence: 'confirmed' },
          path: [
            { x: 1, y: 0 },
            { x: 2, y: 0 }
          ],
          stepsTaken: 0
        }
      }
    })
    expect(await screen.findByTestId('walker-path')).toBeInTheDocument()
    expect(screen.queryByTestId('walker-stop')).not.toBeInTheDocument()

    useMapStore.setState({
      walkers: {
        a: {
          connectionId: 'a',
          running: false,
          position: { mapId: 1, x: 2, y: 0, confidence: 'confirmed' },
          stepsTaken: 2,
          reason: 'the walker could not get through'
        }
      }
    })
    expect(await screen.findByTestId('walker-stop')).toHaveTextContent('could not get through')
    expect(screen.queryByTestId('walker-path')).not.toBeInTheDocument()
  })

  it('follows the character onto its map, until a map is picked by hand', async () => {
    window.api.map.positions = vi.fn(async () => [
      { connectionId: 'a', name: 'Fintan', mapId: 1, x: 1, y: 1, confidence: 'confirmed' as const }
    ])
    render(<MapPage />)
    await waitFor(() => expect(useMapStore.getState().selected).toBe(1))
    expect(await screen.findByTestId('map-view')).toBeInTheDocument()
  })
})

describe('the tile drawing', () => {
  it('fits the map to the box within the scale limits', () => {
    expect(scaleFor(TOWN, { width: 400, height: 300 })).toBe(14)
    expect(scaleFor(TOWN, { width: 20, height: 300 })).toBe(5)
    expect(scaleFor(TOWN, { width: 4, height: 3 })).toBe(3)
  })

  it('fills a full wall and strokes the blocked sides of a part wall', () => {
    const calls: string[] = []
    const context = {
      fillRect: (...a: number[]) => calls.push(`fill ${a.join(',')}`),
      beginPath: () => calls.push('begin'),
      moveTo: (...a: number[]) => calls.push(`move ${a.join(',')}`),
      lineTo: (...a: number[]) => calls.push(`line ${a.join(',')}`),
      stroke: () => calls.push('stroke')
    } as unknown as CanvasRenderingContext2D
    drawTiles(context, TOWN, 10, { open: 'a', wall: 'b', edge: 'c' })
    // The background, the full wall at (1,1), then the north edge at (2,1).
    expect(calls).toEqual([
      'fill 0,0,40,30',
      'fill 10,10,10,10',
      'begin',
      'move 20,10',
      'line 30,10',
      'stroke'
    ])
  })
})
