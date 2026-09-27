import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGraphStore } from '@renderer/store/graphStore'
import { useMapStore } from '@renderer/store/mapStore'
import type { WorldGraphView } from '@shared/graph'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GraphPage from '../GraphPage'

/**
 * The world graph view (WP43). The canvas is jsdom's null, so the picture draws
 * nothing here; the panels are ordinary elements and they are what is read.
 */

const VIEW: WorldGraphView = {
  nodes: [
    { mapId: 500, name: 'Mileth', read: true, hostile: false },
    { mapId: 501, name: 'Mileth Inn', read: true, hostile: false },
    { mapId: 2, name: 'Mileth Crypt 2-1', read: false, hostile: true },
    { mapId: 9000, name: 'Loures Garden', read: false, hostile: false }
  ],
  edges: [
    { fromMapId: 500, toMapId: 501, source: 'authored', candidate: false, tiles: 2 },
    {
      fromMapId: 501,
      toMapId: 500,
      source: 'learned',
      candidate: false,
      tiles: 1,
      observations: 4
    },
    { fromMapId: 500, toMapId: 2, source: 'xml', candidate: true, tiles: 1 }
  ],
  report: {
    nodes: 4,
    routedPairs: 2,
    candidatePairs: 1,
    components: [
      { size: 3, mapIds: [2, 500, 501] },
      { size: 1, mapIds: [9000] }
    ],
    componentsWithCandidates: [
      { size: 3, mapIds: [2, 500, 501] },
      { size: 1, mapIds: [9000] }
    ],
    noWayIn: [9000],
    noWayOut: [2],
    oneWay: [{ fromMapId: 500, toMapId: 2 }],
    candidateOnly: [2]
  },
  positions: [{ connectionId: 'c1', name: 'Gabrael', mapId: 500 }]
}

const onOpenMap = vi.fn()

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  onOpenMap.mockClear()
  useGraphStore.setState({
    view: null,
    loading: false,
    error: null,
    scope: 'component',
    nearHops: 2,
    focus: null,
    selected: null
  })
  window.api.graph.view = vi.fn(async () => VIEW)
})

async function renderPage(): Promise<void> {
  render(<GraphPage onOpenMap={onOpenMap} />)
  await waitFor(() => expect(screen.getByTestId('graph-report')).toBeInTheDocument())
}

describe('the world graph view', () => {
  it('reads the graph when it opens', async () => {
    await renderPage()
    expect(window.api.graph.view).toHaveBeenCalled()
  })

  it('states the shape of the graph, which is what one map cannot show', async () => {
    await renderPage()
    const report = within(screen.getByTestId('graph-report'))
    expect(report.getByText(/4 maps/)).toBeInTheDocument()
    expect(report.getByText(/Pieces: 2, largest 3/)).toBeInTheDocument()
    expect(report.getByText('No way in at all: 1')).toBeInTheDocument()
    expect(report.getByText('No way out: 1')).toBeInTheDocument()
    expect(report.getByText('Only an uncrossed warp leads in: 1')).toBeInTheDocument()
    expect(report.getByText('One-way warps: 1')).toBeInTheDocument()
  })

  it('opens on the piece the character stands in, and says how much is drawn', async () => {
    await renderPage()
    // Mileth, its inn, and the crypt: the live character's own piece, and not
    // Loures Garden, which touches nothing.
    expect(screen.getByText(/3 of 4 maps drawn/)).toBeInTheDocument()
  })

  it('draws everything when the scope says so', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('combobox', { name: 'Show' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Everything' }))
    expect(screen.getByText(/4 of 4 maps drawn/)).toBeInTheDocument()
  })

  it('holds the scope to a radius in warps', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('combobox', { name: 'Show' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Near one map' }))
    const hops = screen.getByRole('combobox', { name: 'Warps out' })
    await userEvent.click(hops)
    await userEvent.click(await screen.findByRole('option', { name: '1' }))
    // Mileth and the two maps one warp away.
    expect(screen.getByText(/3 of 4 maps drawn/)).toBeInTheDocument()
  })

  it('selects a map from a report row, and describes it', async () => {
    await renderPage()
    await userEvent.click(
      within(screen.getByTestId('report-no-way-out')).getByText('Mileth Crypt 2-1')
    )
    const panel = within(screen.getByTestId('graph-selected'))
    expect(panel.getByText('Mileth Crypt 2-1')).toBeInTheDocument()
    expect(panel.getByText(/Map 2 · never read · holds monsters/)).toBeInTheDocument()
    // A map with a warp in and none out says so where it matters.
    expect(panel.getByText('Warps out: 0')).toBeInTheDocument()
    expect(panel.getByText('Warps in: 1')).toBeInTheDocument()
  })

  it('says plainly when nothing leads to a map', async () => {
    await renderPage()
    await userEvent.click(within(screen.getByTestId('graph-report')).getByText('Loures Garden'))
    expect(screen.getByText('Nothing Midir holds leads here.')).toBeInTheDocument()
  })

  it('names where each warp came from, and marks the one nobody has crossed', async () => {
    await renderPage()
    await userEvent.click(
      within(screen.getByTestId('report-no-way-out')).getByText('Mileth Crypt 2-1')
    )
    // Selecting the crypt shows its way in, which is the uncrossed one.
    const panel = within(screen.getByTestId('graph-selected'))
    expect(panel.getByText('Mileth (not crossed)')).toBeInTheDocument()
  })

  it('hands a map to the Map tab, where the tiles are', async () => {
    await renderPage()
    await userEvent.click(within(screen.getByTestId('graph-report')).getByText('Loures Garden'))
    await userEvent.click(screen.getByRole('button', { name: 'Open on the Map tab' }))
    expect(onOpenMap).toHaveBeenCalledWith(9000)
  })

  it('accepts an uncrossed warp through the one write path, and reads the graph again', async () => {
    // The tile is on the map and not on the pair, so the edit goes through the
    // Map tab's own view, which is `map:editWarp` (WP30).
    const editWarp = vi.fn(async () => undefined)
    const select = vi.fn(async () => undefined)
    useMapStore.setState({
      editWarp,
      select,
      view: {
        mapId: 500,
        mapName: 'Mileth',
        width: 10,
        height: 10,
        collision: [],
        sizeSource: 'wire',
        warps: [
          {
            x: 7,
            y: 8,
            toMapId: 2,
            toMapName: 'Mileth Crypt 2-1',
            source: 'xml',
            state: 'candidate'
          }
        ]
      }
    })
    // Mileth is the map with the uncrossed warp out, so it is the one selected.
    useGraphStore.setState({ selected: 500 })
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(editWarp).toHaveBeenCalled())
    expect(select).toHaveBeenCalledWith(500)
    expect(editWarp).toHaveBeenCalledWith({
      action: 'accept',
      fromMapId: 500,
      x: 7,
      y: 8,
      toMapId: 2
    })
    // Twice: once when the page opened, once after the edit.
    expect(window.api.graph.view).toHaveBeenCalledTimes(2)
  })

  it('says why when the graph cannot be read', async () => {
    window.api.graph.view = vi.fn(async () => {
      throw new Error('the graph would not build')
    })
    render(<GraphPage onOpenMap={onOpenMap} />)
    expect(await screen.findByText('The graph could not be read')).toBeInTheDocument()
  })
})
