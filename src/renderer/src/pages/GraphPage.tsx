import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'
import Guidance from '@renderer/components/Guidance'
import { neighboursOf, rootOf, scopedMaps, useGraphStore } from '@renderer/store/graphStore'
import { useMapStore } from '@renderer/store/mapStore'
import { boundsOf, layoutGraph, type LayoutNode } from '@renderer/lib/graphLayout'
import {
  NEAR_HOPS_CHOICES,
  graphScopeLabel,
  type GraphScope,
  type GraphViewEdge,
  type GraphViewNode
} from '@shared/graph'
import type { EdgeSource } from '@shared/map'

/**
 * The world as a graph (WP43): one node for each map, one edge for each warp,
 * and the provenance of every edge in its colour.
 *
 * The Map tab answers questions about one map. This answers the ones a walk
 * fails on, because each is about more than one map at a time: whether a map is
 * joined to the rest of the world, whether a character can get back out of it,
 * and which maps hang off a warp nobody has crossed. The report panel states
 * those as counts, and every row of it selects its map.
 *
 * The nodes are placed by hops from the middle, not by geography: a warp graph
 * has no coordinates, and the Map tab already owns the geographic picture. The
 * whole graph goes on a canvas, because 718 maps and 4000 warps is too many
 * elements for the DOM; the panels beside it are ordinary elements, so a test
 * and a screen reader can both read what the picture says.
 *
 * It writes nothing of its own. Accept and Reject go through `map:editWarp`,
 * the one write path for a warp (WP30), and the edits that need a tile — edit,
 * add, and restore — are on the Map tab, one click away, where the tile is
 * visible.
 */

const cardSx = { p: 2.5, display: 'flex', flexDirection: 'column' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const
const PANEL_WIDTH = 330
/** Above this many maps on screen, only the selected map and its neighbours are named. */
const LABEL_LIMIT = 60
const NODE_RADIUS = 5
const PADDING = 28

export interface GraphPageProps {
  /** Open a map on the Map tab. The page has the tile, and this one does not. */
  onOpenMap: (mapId: number) => void
}

function nameOf(node: GraphViewNode | undefined, mapId: number): string {
  if (node === undefined) return `Map ${mapId}`
  return node.name !== '' ? node.name : `Map ${mapId}`
}

function sourceLabel(source: EdgeSource): string {
  switch (source) {
    case 'authored':
      return 'imported'
    case 'learned':
      return 'the wire'
    case 'curated':
      return 'your edit'
    case 'xml':
      return 'world data'
  }
}

function GraphPage({ onOpenMap }: GraphPageProps): React.JSX.Element {
  const view = useGraphStore((s) => s.view)
  const loading = useGraphStore((s) => s.loading)
  const error = useGraphStore((s) => s.error)
  const scope = useGraphStore((s) => s.scope)
  const nearHops = useGraphStore((s) => s.nearHops)
  const focus = useGraphStore((s) => s.focus)
  const selected = useGraphStore((s) => s.selected)
  const refresh = useGraphStore((s) => s.refresh)
  const setScope = useGraphStore((s) => s.setScope)
  const setNearHops = useGraphStore((s) => s.setNearHops)
  const setFocus = useGraphStore((s) => s.setFocus)
  const select = useGraphStore((s) => s.select)
  const editWarp = useMapStore((s) => s.editWarp)
  const selectMap = useMapStore((s) => s.select)

  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 900, height: 620 })

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const element = boxRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setBox({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const nodesById = useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.mapId, node])),
    [view]
  )
  const neighbours = useMemo(() => neighboursOf(view?.edges ?? []), [view])
  const root = rootOf(view, focus)
  const scoped = useMemo(
    () =>
      scopedMaps(
        scope,
        (view?.nodes ?? []).map((node) => node.mapId),
        neighbours,
        root,
        nearHops
      ),
    [scope, view, neighbours, root, nearHops]
  )
  const inScope = useMemo(() => new Set(scoped), [scoped])
  const placed = useMemo(
    () => layoutGraph({ nodes: scoped, neighbours, ...(root !== null ? { root } : {}) }),
    [scoped, neighbours, root]
  )
  const drawnEdges = useMemo(
    () =>
      (view?.edges ?? []).filter(
        (edge) => inScope.has(edge.fromMapId) && inScope.has(edge.toMapId)
      ),
    [view, inScope]
  )
  /** The pairs with no pair back, for the arrowheads. */
  const oneWay = useMemo(
    () => new Set((view?.report.oneWay ?? []).map((edge) => `${edge.fromMapId}:${edge.toMapId}`)),
    [view]
  )
  const liveMaps = useMemo(
    () => new Set((view?.positions ?? []).map((position) => position.mapId)),
    [view]
  )

  // Draw. Everything the picture shows is derived above, so this is one pass of
  // edges and one of nodes, and it runs again only when one of them changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(box.width * ratio))
    canvas.height = Math.max(1, Math.floor(box.height * ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, box.width, box.height)
    if (placed.size === 0) return

    const bounds = boundsOf(placed)
    const spanX = Math.max(1, bounds.maxX - bounds.minX)
    const spanY = Math.max(1, bounds.maxY - bounds.minY)
    const scale = Math.min(
      (box.width - PADDING * 2) / spanX,
      (box.height - PADDING * 2) / spanY,
      1.4
    )
    const offsetX = (box.width - spanX * scale) / 2 - bounds.minX * scale
    const offsetY = (box.height - spanY * scale) / 2 - bounds.minY * scale
    const at = (node: LayoutNode): { x: number; y: number } => ({
      x: node.x * scale + offsetX,
      y: node.y * scale + offsetY
    })

    const colourOf = (edge: GraphViewEdge): string => {
      if (edge.candidate) return theme.palette.warning.main
      switch (edge.source) {
        case 'learned':
          return theme.palette.success.main
        case 'curated':
          return theme.palette.info.main
        default:
          return theme.palette.text.disabled
      }
    }

    for (const edge of drawnEdges) {
      const from = placed.get(edge.fromMapId)
      const to = placed.get(edge.toMapId)
      if (from === undefined || to === undefined) continue
      const start = at(from)
      const end = at(to)
      context.beginPath()
      context.strokeStyle = colourOf(edge)
      context.lineWidth = edge.candidate ? 1 : 1.4
      context.setLineDash(edge.candidate ? [4, 3] : [])
      context.moveTo(start.x, start.y)
      context.lineTo(end.x, end.y)
      context.stroke()
      context.setLineDash([])
      // An arrowhead only where the warp leads one way. On a pair that goes both
      // ways it would be noise on every edge in the picture.
      if (!oneWay.has(`${edge.fromMapId}:${edge.toMapId}`)) continue
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const tipX = end.x - Math.cos(angle) * (NODE_RADIUS + 2)
      const tipY = end.y - Math.sin(angle) * (NODE_RADIUS + 2)
      context.beginPath()
      context.fillStyle = colourOf(edge)
      context.moveTo(tipX, tipY)
      context.lineTo(tipX - Math.cos(angle - 0.4) * 7, tipY - Math.sin(angle - 0.4) * 7)
      context.lineTo(tipX - Math.cos(angle + 0.4) * 7, tipY - Math.sin(angle + 0.4) * 7)
      context.closePath()
      context.fill()
    }

    const named =
      placed.size <= LABEL_LIMIT
        ? new Set(placed.keys())
        : new Set(
            selected === null
              ? []
              : [selected, ...(neighbours.get(selected) ?? []).filter((id) => inScope.has(id))]
          )

    context.font = '11px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'top'
    for (const [mapId, node] of placed) {
      const point = at(node)
      const record = nodesById.get(mapId)
      const isSelected = mapId === selected
      context.beginPath()
      context.arc(point.x, point.y, isSelected ? NODE_RADIUS + 3 : NODE_RADIUS, 0, Math.PI * 2)
      context.fillStyle =
        record?.read === true ? theme.palette.primary.main : theme.palette.background.paper
      context.fill()
      context.lineWidth = isSelected ? 2.5 : 1.2
      context.strokeStyle = isSelected
        ? theme.palette.text.primary
        : liveMaps.has(mapId)
          ? theme.palette.info.main
          : record?.hostile === true
            ? theme.palette.warning.main
            : theme.palette.text.secondary
      context.stroke()
      if (!named.has(mapId)) continue
      context.fillStyle = theme.palette.text.secondary
      context.fillText(nameOf(record, mapId), point.x, point.y + NODE_RADIUS + 3, 120)
    }
  }, [placed, drawnEdges, box, theme, selected, nodesById, neighbours, inScope, oneWay, liveMaps])

  /** The map nearest the click, when the click is near one. */
  const pick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (canvas === null || placed.size === 0) return
    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    const bounds = boundsOf(placed)
    const spanX = Math.max(1, bounds.maxX - bounds.minX)
    const spanY = Math.max(1, bounds.maxY - bounds.minY)
    const scale = Math.min(
      (box.width - PADDING * 2) / spanX,
      (box.height - PADDING * 2) / spanY,
      1.4
    )
    const offsetX = (box.width - spanX * scale) / 2 - bounds.minX * scale
    const offsetY = (box.height - spanY * scale) / 2 - bounds.minY * scale
    let nearest: number | null = null
    let best = Number.POSITIVE_INFINITY
    for (const [mapId, node] of placed) {
      const distance = Math.hypot(
        node.x * scale + offsetX - clickX,
        node.y * scale + offsetY - clickY
      )
      if (distance < best) {
        best = distance
        nearest = mapId
      }
    }
    if (nearest !== null && best <= NODE_RADIUS + 8) select(nearest)
  }

  const chosen = selected === null ? null : (nodesById.get(selected) ?? null)
  const out = (view?.edges ?? []).filter((edge) => edge.fromMapId === selected)
  const into = (view?.edges ?? []).filter((edge) => edge.toMapId === selected)

  /** Accept or reject one warp, then read the graph again so the picture follows. */
  const curate = async (edge: GraphViewEdge, action: 'accept' | 'reject'): Promise<void> => {
    // The tile is on the map, not on the pair, so the Map tab's own view is
    // what holds it. Selecting the map loads it, and every tile of the pair
    // takes the edit — the pair is as accepted as its tiles.
    await selectMap(edge.fromMapId)
    const tiles = (useMapStore.getState().view?.warps ?? []).filter(
      (warp) => warp.toMapId === edge.toMapId
    )
    for (const tile of tiles) {
      await editWarp({
        action,
        fromMapId: edge.fromMapId,
        x: tile.x,
        y: tile.y,
        toMapId: edge.toMapId
      })
    }
    await refresh()
  }

  if (error !== null) {
    return <Guidance title="The graph could not be read" detail={error} />
  }
  if (view === null) {
    return (
      <Guidance
        title={loading ? 'Reading the graph' : 'No graph yet'}
        detail="Midir builds this from its imported map data and every warp the wire has proved."
      />
    )
  }

  const report = view.report
  const reportRow = (
    key: string,
    label: string,
    ids: readonly number[],
    detail: string
  ): React.JSX.Element => (
    <Box sx={{ mb: 1 }} data-testid={`report-${key}`}>
      <Tooltip title={detail}>
        <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
          {label}: {ids.length}
        </Typography>
      </Tooltip>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {ids.slice(0, 12).map((mapId) => (
          <Chip
            key={mapId}
            size="small"
            variant="outlined"
            label={nameOf(nodesById.get(mapId), mapId)}
            onClick={() => {
              setFocus(mapId)
              select(mapId)
            }}
          />
        ))}
        {ids.length > 12 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', alignSelf: 'center' }}>
            and {ids.length - 12} more
          </Typography>
        ) : null}
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', p: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Show"
            value={scope}
            onChange={(event) => setScope(event.target.value as GraphScope)}
            sx={{ minWidth: 200 }}
          >
            {(['component', 'near', 'all'] as GraphScope[]).map((choice) => (
              <MenuItem key={choice} value={choice}>
                {graphScopeLabel(choice)}
              </MenuItem>
            ))}
          </TextField>
          {scope === 'near' ? (
            <TextField
              select
              size="small"
              label="Warps out"
              value={nearHops}
              onChange={(event) => setNearHops(Number(event.target.value))}
              sx={{ width: 120 }}
            >
              {NEAR_HOPS_CHOICES.map((hops) => (
                <MenuItem key={hops} value={hops}>
                  {hops}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <Autocomplete
            size="small"
            sx={{ minWidth: 260 }}
            options={view.nodes}
            value={root === null ? null : (nodesById.get(root) ?? null)}
            getOptionLabel={(node) => `${nameOf(node, node.mapId)} (${node.mapId})`}
            isOptionEqualToValue={(a, b) => a.mapId === b.mapId}
            onChange={(_event, node) => {
              setFocus(node?.mapId ?? null)
              select(node?.mapId ?? null)
            }}
            renderInput={(params) => <TextField {...params} label="Middle of the picture" />}
          />
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => void refresh()}>
            Reload
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
          {placed.size} of {report.nodes} maps drawn · {drawnEdges.length} warps · a dashed line is
          a warp no walk has crossed · an arrow is a warp with no warp back
        </Typography>
        <Box
          ref={boxRef}
          sx={{
            flex: 1,
            minHeight: 0,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden'
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="graph-canvas"
            onClick={pick}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </Box>
      </Box>

      <Box
        sx={{
          width: PANEL_WIDTH,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'divider',
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
      >
        {chosen !== null ? (
          <Paper sx={cardSx} data-testid="graph-selected">
            <Typography variant="h6" sx={headingSx}>
              {nameOf(chosen, chosen.mapId)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1 }}>
              Map {chosen.mapId} · {chosen.read ? 'read' : 'never read'}
              {chosen.hostile ? ' · holds monsters' : ''}
            </Typography>
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start', mb: 1 }}
              onClick={() => onOpenMap(chosen.mapId)}
            >
              Open on the Map tab
            </Button>
            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
              Warps out: {out.length}
            </Typography>
            {out.map((edge) => (
              <Box key={`out-${edge.toMapId}`} sx={{ py: 0.5 }}>
                <Typography variant="body2">
                  {nameOf(nodesById.get(edge.toMapId), edge.toMapId)}
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 0.25 }}>
                  <Chip
                    size="small"
                    variant={edge.candidate ? 'outlined' : 'filled'}
                    label={`${sourceLabel(edge.source)}${edge.candidate ? ', not crossed' : ''}`}
                  />
                  {edge.tiles > 1 ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {edge.tiles} tiles
                    </Typography>
                  ) : null}
                  {edge.candidate ? (
                    <Button size="small" onClick={() => void curate(edge, 'accept')}>
                      Accept
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      color="warning"
                      onClick={() => void curate(edge, 'reject')}
                    >
                      Reject
                    </Button>
                  )}
                </Stack>
              </Box>
            ))}
            <Typography variant="body2" sx={{ fontWeight: 'medium', mt: 1 }}>
              Warps in: {into.length}
            </Typography>
            {into.map((edge) => (
              <Typography key={`in-${edge.fromMapId}`} variant="body2" sx={{ py: 0.25 }}>
                {nameOf(nodesById.get(edge.fromMapId), edge.fromMapId)}
                {edge.candidate ? ' (not crossed)' : ''}
              </Typography>
            ))}
            {into.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'warning.main' }}>
                Nothing Midir holds leads here.
              </Typography>
            ) : null}
          </Paper>
        ) : null}

        <Paper sx={cardSx} data-testid="graph-report">
          <Typography variant="h6" sx={headingSx}>
            The shape of it
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {report.nodes} maps · {report.routedPairs} warps Midir routes over ·{' '}
            {report.candidatePairs} it has not crossed
          </Typography>
          <Tooltip title="Maps that reach each other. A piece of one map is a map on its own.">
            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
              Pieces: {report.components.length}
              {report.components[0] !== undefined ? `, largest ${report.components[0].size}` : ''}
            </Typography>
          </Tooltip>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {report.componentsWithCandidates.length} once the warps nobody has crossed count
          </Typography>
          {reportRow(
            'no-way-in',
            'No way in at all',
            report.noWayIn,
            'No warp on any layer leads to this map. Walk to it once by hand and the wire teaches the way.'
          )}
          {reportRow(
            'no-way-out',
            'No way out',
            report.noWayOut,
            'A warp leads in and none leads out. A run that arrives here is stranded.'
          )}
          {reportRow(
            'candidate-only',
            'Only an uncrossed warp leads in',
            report.candidateOnly,
            'The world data proposes the only way in. Crossing it once is what confirms it.'
          )}
          <Tooltip title="A warp with no warp back. The picture draws an arrow on each.">
            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
              One-way warps: {report.oneWay.length}
            </Typography>
          </Tooltip>
        </Paper>
      </Box>
    </Box>
  )
}

export default GraphPage
