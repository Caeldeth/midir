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
import { formatHotkey, type WalkerPosition, type WalkOutcome } from '@shared/types'
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
const descriptionSx = { color: 'text.secondary', mb: 2 } as const

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

  const onGo = (): void => {
    if (selectedValue === '' || destination.trim() === '') return
    go(selectedValue, destination.trim())
  }

  const trimmed = destination.trim()
  const alreadyPinned = pinned.some((d) => d.toLowerCase() === trimmed.toLowerCase())

  const onPin = (): void => {
    if (trimmed === '' || alreadyPinned) return
    setPinned([...pinned, trimmed])
  }

  const onUnpin = (value: string): void => {
    setPinned(pinned.filter((d) => d !== value))
  }

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      <Paper sx={cardSx} data-testid="walker-panel">
        <Typography variant="h6" sx={headingSx}>
          Walker
        </Typography>
        <Typography variant="body2" sx={descriptionSx}>
          Name a place, and the character walks there, across maps, by the route the world allows.
          Midir posts the arrow keys to the window you pick and reads each step off the wire, so it
          re-plans when a step does not land and stops when something else moves the character. It
          sends no packet and reads no memory. A character must be logged in on the window.
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
            options={destinations.map((d) => d.name)}
            value={destination}
            onInputChange={(_event, value) => setDestination(value)}
            disabled={isRunning}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="Destination"
                placeholder="A place name, or a map id"
                helperText="Pick a known place, or type a map name or number."
              />
            )}
          />
          <Tooltip title={alreadyPinned ? 'Already pinned' : 'Pin this destination'}>
            <span>
              <IconButton
                aria-label="Pin this destination"
                onClick={onPin}
                disabled={trimmed === '' || alreadyPinned}
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
                onClick={() => setDestination(place)}
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
            <Button
              variant="contained"
              disabled={selectedValue === '' || destination.trim() === ''}
              onClick={onGo}
              data-testid="walker-go"
            >
              Go
            </Button>
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
