import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete,
  Box,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'
import Guidance from '@renderer/components/Guidance'
import { useMapStore } from '@renderer/store/mapStore'
import { mapViewFailureMessage, type MapSummary, type MapView, type MapWarp } from '@shared/map'
import type { WalkerState } from '@shared/actionLayer'

/**
 * One map, drawn from the client's own map cache: its passable and blocked
 * tiles, the warps the route graph holds for it, where each live character
 * stands, and, while a walker runs, the path it planned and where it stopped
 * (WP30).
 *
 * The grid is drawn top-down, one square per tile, not in the client's
 * isometric view: this is the walker's picture of the map, and the walker
 * plans on a grid. The tiles go on a canvas, because a map is up to a hundred
 * tiles a side; everything that moves or is few (warps, dots, the path) is a
 * positioned element over it, so a test can find it. A warp the wire proved
 * (WP29) is drawn in its own colour, and its hover says how often; one the
 * imported file holds and the wire has confirmed says so too. The view is
 * read-only: the edit that accepts or nudges a warp waits for WP30's second
 * half.
 */

/** Where a warp came from, for its hover: the wire's word, when it has one. */
function warpProvenance(warp: MapWarp): string {
  const times = (n: number): string => `${n} time${n === 1 ? '' : 's'}`
  if (warp.source === 'learned')
    return ` · learned from the wire, seen ${times(warp.observations ?? 0)}`
  if (warp.observations !== undefined)
    return ` · confirmed by the wire, seen ${times(warp.observations)}`
  return ''
}

/** The SOTP nibble: 0x08 North, 0x04 East, 0x02 South, 0x01 West. */
const NORTH = 0x08
const EAST = 0x04
const SOUTH = 0x02
const WEST = 0x01
const ALL = 0x0f

const MIN_SCALE = 3
const MAX_SCALE = 14

function labelOf(map: MapSummary): string {
  return map.name !== '' ? `${map.name} (${map.mapId})` : `map ${map.mapId}`
}

/** The pixel size of one tile that fits the map in `box`. */
export function scaleFor(view: MapView, box: { width: number; height: number }): number {
  const fit = Math.floor(Math.min(box.width / view.width, box.height / view.height))
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit))
}

/** Draw the tiles: a full wall filled, a part wall as lines on its blocked sides. */
export function drawTiles(
  context: CanvasRenderingContext2D,
  view: MapView,
  scale: number,
  colors: { open: string; wall: string; edge: string }
): void {
  context.fillStyle = colors.open
  context.fillRect(0, 0, view.width * scale, view.height * scale)
  context.fillStyle = colors.wall
  context.strokeStyle = colors.edge
  context.lineWidth = Math.max(1, Math.floor(scale / 4))
  for (let y = 0; y < view.height; y++) {
    for (let x = 0; x < view.width; x++) {
      const bits = view.collision[y * view.width + x] ?? 0
      if (bits === 0) continue
      const px = x * scale
      const py = y * scale
      if (bits === ALL) {
        context.fillRect(px, py, scale, scale)
        continue
      }
      context.beginPath()
      if (bits & NORTH) {
        context.moveTo(px, py)
        context.lineTo(px + scale, py)
      }
      if (bits & SOUTH) {
        context.moveTo(px, py + scale)
        context.lineTo(px + scale, py + scale)
      }
      if (bits & WEST) {
        context.moveTo(px, py)
        context.lineTo(px, py + scale)
      }
      if (bits & EAST) {
        context.moveTo(px + scale, py)
        context.lineTo(px + scale, py + scale)
      }
      context.stroke()
    }
  }
}

function TileCanvas({ view, scale }: { view: MapView; scale: number }): React.JSX.Element {
  const theme = useTheme()
  const ref = useRef<HTMLCanvasElement | null>(null)
  const colors = useMemo(
    () => ({
      open: theme.palette.background.paper,
      wall: theme.palette.text.secondary,
      edge: theme.palette.text.primary
    }),
    [theme]
  )
  useEffect(() => {
    // jsdom has no canvas; the overlay is what a test reads.
    const context = ref.current?.getContext('2d') ?? null
    if (context === null) return
    drawTiles(context, view, scale, colors)
  }, [view, scale, colors])
  return (
    <canvas
      ref={ref}
      width={view.width * scale}
      height={view.height * scale}
      style={{ display: 'block' }}
      data-testid="map-canvas"
    />
  )
}

/** The walker's path as a polyline over the tiles. */
function PathLayer({
  walker,
  scale
}: {
  walker: WalkerState
  scale: number
}): React.JSX.Element | null {
  const theme = useTheme()
  const path = walker.path
  if (path === undefined || path.length === 0 || walker.position === undefined) return null
  const points = [walker.position, ...path]
    .map((p) => `${p.x * scale + scale / 2},${p.y * scale + scale / 2}`)
    .join(' ')
  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      width="100%"
      height="100%"
      data-testid="walker-path"
    >
      <polyline
        points={points}
        fill="none"
        stroke={theme.palette.primary.light}
        strokeWidth={Math.max(2, scale / 3)}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  )
}

function MapPage(): React.JSX.Element {
  const theme = useTheme()
  const maps = useMapStore((s) => s.maps)
  const selected = useMapStore((s) => s.selected)
  const view = useMapStore((s) => s.view)
  const failure = useMapStore((s) => s.failure)
  const loading = useMapStore((s) => s.loading)
  const positions = useMapStore((s) => s.positions)
  const walkers = useMapStore((s) => s.walkers)
  const follow = useMapStore((s) => s.follow)
  const setFollow = useMapStore((s) => s.setFollow)
  const refresh = useMapStore((s) => s.refresh)
  const select = useMapStore((s) => s.select)
  const subscribe = useMapStore((s) => s.subscribe)

  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 800, height: 600 })
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void refresh()
    return subscribe()
  }, [refresh, subscribe])

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

  const scale =
    view === null ? MIN_SCALE : scaleFor(view, { width: box.width - 16, height: box.height - 16 })
  const picked = maps.find((m) => m.mapId === selected) ?? null
  const here = view === null ? [] : positions.filter((p) => p.mapId === view.mapId)
  const walkersHere =
    view === null
      ? []
      : Object.values(walkers).filter(
          (w) => w.position?.mapId === view.mapId && (w.running || w.reason !== undefined)
        )

  const onMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.floor((event.clientX - rect.left) / scale)
    const y = Math.floor((event.clientY - rect.top) / scale)
    if (view !== null && x >= 0 && y >= 0 && x < view.width && y < view.height) setHover({ x, y })
    else setHover(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, p: 2.5, gap: 1.5 }}>
      <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          sx={{ minWidth: 320 }}
          options={maps}
          getOptionLabel={labelOf}
          getOptionDisabled={(m) => !m.drawable}
          value={picked}
          onChange={(_event, value) => {
            if (value !== null) setFollow(false)
            void select(value?.mapId ?? null)
          }}
          isOptionEqualToValue={(a, b) => a.mapId === b.mapId}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Map"
              placeholder="A map name or id"
              // Merge, never replace: `params.slotProps.input` carries the ref
              // the listbox anchors to and the arrow and clear adornments.
              // Replacing the object dropped them and the picker did not open.
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, 'data-testid': 'map-picker' }
              }}
            />
          )}
        />
        <FormControlLabel
          control={<Switch checked={follow} onChange={(e) => setFollow(e.target.checked)} />}
          label="Follow the character"
        />
        {view !== null ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="map-caption">
            {view.width} × {view.height} tiles, size from{' '}
            {view.sizeSource === 'wire'
              ? 'the wire'
              : view.sizeSource === 'graph'
                ? 'the world map'
                : 'the live map'}
            {' · '}
            {view.warps.length} warp{view.warps.length === 1 ? '' : 's'}
            {hover !== null ? ` · (${hover.x}, ${hover.y})` : ''}
          </Typography>
        ) : null}
      </Stack>

      <Box
        ref={boxRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1
        }}
      >
        {view === null ? (
          <Guidance
            title={
              failure !== null
                ? 'This map cannot be drawn'
                : loading
                  ? 'Reading the map…'
                  : 'Pick a map'
            }
            detail={
              failure !== null
                ? mapViewFailureMessage(failure)
                : 'The map is read from the client’s own map cache. With capture on, the view follows the character.'
            }
          />
        ) : (
          <Box
            sx={{
              position: 'relative',
              width: view.width * scale,
              height: view.height * scale,
              m: 1
            }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            data-testid="map-view"
          >
            <TileCanvas view={view} scale={scale} />

            {view.warps.map((warp) => (
              <Tooltip
                key={`${warp.x}:${warp.y}:${warp.toMapId}`}
                title={`→ ${warp.toMapName !== '' ? warp.toMapName : `map ${warp.toMapId}`}${
                  warp.via !== undefined ? ` (${warp.via})` : ''
                }${warpProvenance(warp)}`}
              >
                <Box
                  data-testid="map-warp"
                  sx={{
                    position: 'absolute',
                    left: warp.x * scale,
                    top: warp.y * scale,
                    width: scale,
                    height: scale,
                    bgcolor:
                      warp.via === 'dialog'
                        ? 'warning.main'
                        : warp.source === 'learned'
                          ? 'success.main'
                          : 'secondary.main',
                    opacity: 0.85,
                    cursor: 'help'
                  }}
                />
              </Tooltip>
            ))}

            {walkersHere.map((walker) => (
              <PathLayer key={walker.connectionId} walker={walker} scale={scale} />
            ))}

            {here.map((p) => (
              <Tooltip
                key={p.connectionId}
                title={`${p.name} at (${p.x}, ${p.y})${p.confidence !== 'confirmed' ? `, ${p.confidence}` : ''}`}
              >
                <Box
                  data-testid="map-position"
                  data-confidence={p.confidence}
                  sx={{
                    position: 'absolute',
                    left: p.x * scale + scale / 2 - Math.max(4, scale / 2),
                    top: p.y * scale + scale / 2 - Math.max(4, scale / 2),
                    width: Math.max(8, scale),
                    height: Math.max(8, scale),
                    borderRadius: '50%',
                    bgcolor: p.confidence === 'confirmed' ? 'primary.main' : 'transparent',
                    border: 2,
                    borderColor: p.confidence === 'unknown' ? 'text.disabled' : 'primary.main',
                    boxShadow: `0 0 0 2px ${theme.palette.background.default}`
                  }}
                />
              </Tooltip>
            ))}

            {walkersHere
              .filter((w) => !w.running && w.reason !== undefined && w.position !== undefined)
              .map((w) => (
                <Chip
                  key={`stop-${w.connectionId}`}
                  size="small"
                  color="warning"
                  label={w.reason}
                  data-testid="walker-stop"
                  sx={{
                    position: 'absolute',
                    left: (w.position?.x ?? 0) * scale + scale,
                    top: (w.position?.y ?? 0) * scale - 12,
                    maxWidth: 320
                  }}
                />
              ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default MapPage
