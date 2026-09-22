import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import PushPinOutlined from '@mui/icons-material/PushPinOutlined'
import InfoTip from '@renderer/components/InfoTip'
import { useCaptureStore } from '@renderer/store/captureStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { outcomeMessage, useWalkerStore } from '@renderer/store/walkerStore'
import {
  formatHotkey,
  parseDestination,
  type WalkerPosition,
  type WalkOutcome
} from '@shared/types'
import React, { useEffect } from 'react'

/**
 * The Walker: name a place, and the character walks there across maps.
 *
 * It ships off. Nothing moves until the user picks a window, names a place, and
 * presses Go. Every step is a step-and-confirm: Midir posts one arrow key, waits
 * for the wire to move the character, and re-plans when it does not. It sends no
 * packet and reads no memory — the map and the position both come off the wire
 * and the game's own map cache. The one stop halts it within one step.
 */

const cardSx = { p: 3, display: 'flex', flexDirection: 'column' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const

function Walker(): React.JSX.Element {
  const windows = useWalkerStore((s) => s.windows)
  const destinations = useWalkerStore((s) => s.destinations)
  const running = useWalkerStore((s) => s.running)
  const stopped = useWalkerStore((s) => s.stopped)
  const stopReason = useWalkerStore((s) => s.stopReason)
  const busy = useWalkerStore((s) => s.busy)
  const error = useWalkerStore((s) => s.error)
  const lastOutcome = useWalkerStore((s) => s.lastOutcome)
  const selected = useWalkerStore((s) => s.selected)
  const setSelected = useWalkerStore((s) => s.setSelected)
  const destination = useWalkerStore((s) => s.destination)
  const setDestination = useWalkerStore((s) => s.setDestination)
  // A store from before the fields (a dev reload) has no end tile yet.
  const endX = useWalkerStore((s) => s.endX ?? '')
  const endY = useWalkerStore((s) => s.endY ?? '')
  const setEndTile = useWalkerStore((s) => s.setEndTile)
  const refresh = useWalkerStore((s) => s.refresh)
  const refreshWindows = useWalkerStore((s) => s.refreshWindows)
  const go = useWalkerStore((s) => s.go)
  const stop = useWalkerStore((s) => s.stop)
  const stopAll = useWalkerStore((s) => s.stopAll)
  const clearStop = useWalkerStore((s) => s.clearStop)

  const assistStopHotkey = useSettingsStore((s) => s.assistStopHotkey)
  const assistStopOnFocusLoss = useSettingsStore((s) => s.assistStopOnFocusLoss)
  const setAssistStopOnFocusLoss = useSettingsStore((s) => s.setAssistStopOnFocusLoss)
  const pinned = useSettingsStore((s) => s.walkerPinnedDestinations)
  const setPinned = useSettingsStore((s) => s.setWalkerPinnedDestinations)
  const rightClick = useSettingsStore((s) => s.walkerRightClick)
  const setRightClick = useSettingsStore((s) => s.setWalkerRightClick)

  const captureStatus = useCaptureStore((s) => s.status)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows, captureStatus])

  // A selection that names a window that is gone collapses to empty.
  const selectedValue = windows.some((w) => w.connectionId === selected) ? selected : ''
  const run = selectedValue !== '' ? running[selectedValue] : undefined
  const isRunning = run?.running === true

  const windowLabel = (w: (typeof windows)[number]): string =>
    w.characterName !== undefined ? w.characterName : w.title || 'A game window'

  // The end tile: both fields filled and whole numbers, or none. One field
  // alone is half a tile, and Go stays off until it is whole or empty.
  const tileOf = (x: string, y: string): { x: number; y: number } | undefined =>
    /^\d{1,3}$/.test(x.trim()) && /^\d{1,3}$/.test(y.trim())
      ? { x: Number(x.trim()), y: Number(y.trim()) }
      : undefined
  const endTile = tileOf(endX, endY)
  const endEmpty = endX.trim() === '' && endY.trim() === ''
  const endValid = endEmpty || endTile !== undefined

  // The place the text names, when it names one the picker lists. A map id or
  // a name the graph resolves by itself is not matched here, and is left to
  // main: this is for the warning, not for the walk.
  const named = destinations.find(
    (d) => (d.gameName ?? d.name).toLowerCase() === destination.trim().toLowerCase()
  )
  // Midir knows the place and knows no way to walk there from where the
  // character stands. `reachable` is absent until a character is logged in.
  const unreachable = named?.reachable === false
  const noWayText = `Midir knows no way to walk there from where the character stands. Walk a warp it has not seen yet, or add one on the Map tab.`

  const onGo = (): void => {
    if (selectedValue === '' || destination.trim() === '' || !endValid || unreachable) return
    go(selectedValue, destination.trim(), endTile)
  }

  const trimmed = destination.trim()
  // A pin keeps the end tile with the place, as `Place @ x,y`.
  const pinText = endTile !== undefined ? `${trimmed} @ ${endTile.x},${endTile.y}` : trimmed
  const alreadyPinned = pinned.some((d) => d.toLowerCase() === pinText.toLowerCase())

  const onPin = (): void => {
    if (trimmed === '' || !endValid || alreadyPinned) return
    setPinned([...pinned, pinText])
  }

  const onUnpin = (value: string): void => {
    setPinned(pinned.filter((d) => d !== value))
  }

  /** A pin fills the place and the end tile it carries, if any. */
  const onPick = (place: string): void => {
    const parsed = parseDestination(place)
    setDestination(parsed.destination)
    setEndTile(
      parsed.tile !== undefined ? String(parsed.tile.x) : '',
      parsed.tile !== undefined ? String(parsed.tile.y) : ''
    )
  }

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      <Paper sx={cardSx} data-testid="walker-panel">
        <Typography variant="h6" sx={headingSx}>
          Walker
        </Typography>
        {stopped ? (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => void clearStop()}>
                Clear
              </Button>
            }
          >
            A stop is in force{stopReason !== undefined ? `: ${stopReason}` : ''}.
          </Alert>
        ) : null}

        {error !== null ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start', mb: 2 }}>
          <TextField
            select
            fullWidth
            size="small"
            label="Game window"
            value={selectedValue}
            onChange={(event) => setSelected(event.target.value)}
            disabled={isRunning}
            helperText={
              windows.length === 0
                ? 'No game window is open. Log in first, then refresh.'
                : 'Midir drives only this window.'
            }
          >
            {windows.map((w) => (
              <MenuItem key={w.connectionId} value={w.connectionId}>
                {windowLabel(w)}
                {w.characterName !== undefined && w.title !== '' ? ` — ${w.title}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <Button size="small" sx={{ mt: 0.5 }} onClick={() => void refreshWindows()}>
            Refresh
          </Button>
        </Stack>

        <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start', mb: 1.5 }}>
          <Autocomplete
            freeSolo
            fullWidth
            options={destinations.map((d) => d.gameName ?? d.name)}
            value={destination}
            onInputChange={(_event, value) => setDestination(value)}
            disabled={isRunning}
            // A place with no route is shown and dimmed, never hidden: the
            // player is told why it cannot be walked to, and the Map tab is
            // where a missing warp is added (WP39).
            getOptionDisabled={(option) =>
              destinations.find((d) => (d.gameName ?? d.name) === option)?.reachable === false
            }
            renderOption={(props, option) => {
              const place = destinations.find((d) => (d.gameName ?? d.name) === option)
              const { key, ...rest } = props as typeof props & { key: string }
              return (
                <Box component="li" key={key} {...rest}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {option}
                    </Typography>
                    {place?.reachable === false ? (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        No route Midir knows
                      </Typography>
                    ) : null}
                  </Box>
                </Box>
              )
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="Destination"
                placeholder="A place name or map id"
                error={!endValid || unreachable}
                helperText={
                  !endValid
                    ? 'Give both End x and End y, or neither.'
                    : unreachable
                      ? noWayText
                      : 'Pick a known place, or type a map name or number. End x and y are optional: a tile to stand on.'
                }
              />
            )}
          />
          <TextField
            size="small"
            label="End x"
            value={endX}
            onChange={(event) => setEndTile(event.target.value, endY)}
            disabled={isRunning}
            error={!endValid}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'walker-end-x' } }}
            sx={{ width: 96 }}
          />
          <TextField
            size="small"
            label="End y"
            value={endY}
            onChange={(event) => setEndTile(endX, event.target.value)}
            disabled={isRunning}
            error={!endValid}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'walker-end-y' } }}
            sx={{ width: 96 }}
          />
          <Tooltip title={alreadyPinned ? 'Already pinned' : 'Pin this destination'}>
            <span>
              <IconButton
                aria-label="Pin this destination"
                onClick={onPin}
                disabled={trimmed === '' || !endValid || alreadyPinned}
                sx={{ mt: 0.25 }}
              >
                <PushPinOutlined />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {pinned.length > 0 ? (
          <Box
            data-testid="walker-pinned"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}
          >
            {pinned.map((place) => (
              <Chip
                key={place}
                label={place}
                variant="outlined"
                onClick={() => onPick(place)}
                onDelete={() => onUnpin(place)}
                icon={<PushPinOutlined fontSize="small" />}
                data-testid="walker-pin"
              />
            ))}
          </Box>
        ) : null}

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          {isRunning ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void stop(selectedValue)}
              data-testid="walker-stop"
            >
              Stop
            </Button>
          ) : (
            <Tooltip title={unreachable ? noWayText : ''}>
              <span>
                <Button
                  variant="contained"
                  disabled={selectedValue === '' || destination.trim() === '' || unreachable}
                  onClick={onGo}
                  data-testid="walker-go"
                >
                  Go
                </Button>
              </span>
            </Tooltip>
          )}

          <InfoTip
            label="About the stop hotkey"
            title={`Global hotkey — stop everything: ${formatHotkey(
              assistStopHotkey
            )}. Change it in Settings.`}
          />

          <Button
            variant="outlined"
            color="error"
            onClick={() => void stopAll()}
            data-testid="assist-stop-all"
          >
            Stop everything
          </Button>

          <FormControlLabel
            sx={{ ml: 1 }}
            control={
              <Switch
                checked={assistStopOnFocusLoss}
                onChange={(event) => setAssistStopOnFocusLoss(event.target.checked)}
              />
            }
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                Stop on focus loss
                <InfoTip
                  label="About stop on focus loss"
                  title="With this on, an assistant stops the moment you click away from the game window."
                />
              </Box>
            }
          />

          <FormControlLabel
            sx={{ ml: 1 }}
            control={
              <Switch
                checked={rightClick}
                onChange={(event) => setRightClick(event.target.checked)}
                data-testid="walker-right-click"
              />
            }
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                Walk by right-click
                <InfoTip
                  label="About walking by right-click"
                  title="With this on, the walker right-clicks a tile up to eight steps ahead and the game walks there by itself, which is smoother than one arrow key per tile. Every tile is still confirmed from the wire. A stop halts Midir at once; the game finishes the stretch it was given, at most eight tiles."
                />
              </Box>
            }
          />
        </Stack>

        <WalkerStatus
          isRunning={isRunning}
          position={run?.position}
          nextWarp={run?.nextWarp}
          stepsTaken={run?.stepsTaken}
          reason={run?.reason}
          lastOutcome={lastOutcome}
        />
      </Paper>
    </Box>
  )
}

interface WalkerStatusProps {
  isRunning: boolean
  position?: WalkerPosition
  nextWarp?: { toMapId: number; x: number; y: number }
  stepsTaken?: number
  reason?: string
  lastOutcome?: WalkOutcome
}

/** The live line under the controls: where the character is, and how it is going. */
function WalkerStatus({
  isRunning,
  position,
  nextWarp,
  stepsTaken,
  reason,
  lastOutcome
}: WalkerStatusProps): React.JSX.Element | null {
  if (!isRunning && lastOutcome === undefined) return null

  return (
    <Box
      data-testid="walker-status"
      sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, color: 'text.secondary' }}
    >
      {isRunning ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            Walking
            {stepsTaken !== undefined ? ` — ${stepsTaken} step${stepsTaken === 1 ? '' : 's'}` : ''}.
          </Typography>
          {position !== undefined ? (
            <Typography variant="body2">
              On {position.mapName ?? `map ${position.mapId}`} at ({position.x}, {position.y})
              {position.confidence !== 'confirmed' ? ` (${position.confidence})` : ''}.
            </Typography>
          ) : null}
          {nextWarp !== undefined ? (
            <Typography variant="body2">
              Heading for the warp to map {nextWarp.toMapId} at ({nextWarp.x}, {nextWarp.y}).
            </Typography>
          ) : null}
        </Stack>
      ) : (
        <Typography variant="body2" data-testid="walker-outcome">
          {reason !== undefined
            ? `Stopped: ${reason}.`
            : lastOutcome !== undefined
              ? outcomeMessage(lastOutcome)
              : ''}
        </Typography>
      )}
    </Box>
  )
}

export default Walker
