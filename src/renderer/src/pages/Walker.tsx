import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import ExplorerCard from '@renderer/components/ExplorerCard'
import { useCaptureStore } from '@renderer/store/captureStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { outcomeMessage, useWalkerStore } from '@renderer/store/walkerStore'
import {
  connectionOf,
  formatHotkey,
  windowKey,
  type WalkerPin,
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
  const selectedWindow = useWalkerStore((s) => s.selectedWindow)
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
  /** Who is logged in, as one string, so a re-read keys on a login and not on a connection. */
  const liveCharacters = useCaptureStore((s) => s.status.characters.join(','))

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows, captureStatus])

  // A login or a logout changes every destination's mark, because reachability
  // is from where the character stands (WP39). So the whole refresh runs again
  // on a change to who is logged in, and this effect covers the first read as
  // well. The key is the names and not the whole status: a connection that
  // opens and closes moves nobody, and the destinations are a long list.
  useEffect(() => {
    void refresh()
  }, [refresh, liveCharacters])

  // A selection that names a window that is gone collapses to empty.
  // A pick collapses to empty only when that client has closed. A logout keeps
  // the window in the list, with nothing to drive until the next login.
  const selectedValue = windows.some((w) => windowKey(w) === selectedWindow) ? selectedWindow : ''
  const connectionId = connectionOf(windows, selectedValue)
  const run = connectionId !== '' ? running[connectionId] : undefined
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
  // Midir has a way, but only over a warp the imported world data proposes and
  // the wire has never crossed. The walk is offered: crossing it is what
  // confirms it, and a tile that is a tile off stops the leg and nothing worse.
  const unconfirmed = named?.viaUnconfirmed === true
  const noWayText = `Midir knows no way to walk there from where the character stands. Walk a warp it has not seen yet, or add one on the Map tab.`
  const unconfirmedText = `The only way Midir knows there comes from its imported map data, which no walk has confirmed yet. The walk may stop early; crossing it is what proves it.`

  const onGo = (): void => {
    if (connectionId === '' || destination.trim() === '' || !endValid || unreachable) return
    go(connectionId, destination.trim(), endTile)
  }

  const trimmed = destination.trim()
  /** The place and tile a pin would hold, as text, for comparing two pins. */
  const spotOf = (pin: WalkerPin): string =>
    `${pin.destination.toLowerCase()}@${pin.tile?.x ?? ''},${pin.tile?.y ?? ''}`
  const spotNow = `${trimmed.toLowerCase()}@${endTile?.x ?? ''},${endTile?.y ?? ''}`
  const alreadyPinned = pinned.some((pin) => spotOf(pin) === spotNow)

  // Naming a pin is its own step, because the name is the point: a map's name is
  // often not what the player calls the spot on it (Sabrael, 2026-09-27).
  const [pinOpen, setPinOpen] = React.useState(false)
  const [pinLabel, setPinLabel] = React.useState('')

  const onPin = (): void => {
    if (trimmed === '' || !endValid || alreadyPinned) return
    setPinLabel(trimmed)
    setPinOpen(true)
  }

  const savePin = (): void => {
    const label = pinLabel.trim()
    if (label === '' || trimmed === '') return
    setPinned([
      ...pinned,
      { label, destination: trimmed, ...(endTile !== undefined ? { tile: endTile } : {}) }
    ])
    setPinOpen(false)
  }

  const onUnpin = (pin: WalkerPin): void => {
    setPinned(pinned.filter((held) => held !== pin))
  }

  /** A pin fills the place and the end tile it carries, if any. */
  const onPick = (pin: WalkerPin): void => {
    setDestination(pin.destination)
    setEndTile(
      pin.tile !== undefined ? String(pin.tile.x) : '',
      pin.tile !== undefined ? String(pin.tile.y) : ''
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
                ? 'No game window is open. Start Dark Ages, then refresh.'
                : selectedValue !== '' && connectionId === ''
                  ? 'Nobody is logged in on this client. Log in to drive it.'
                  : 'Midir drives only this window.'
            }
          >
            {windows.map((w) => (
              <MenuItem key={windowKey(w)} value={windowKey(w)}>
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
                    ) : place?.viaUnconfirmed === true ? (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Route not confirmed yet
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
                      : unconfirmed
                        ? unconfirmedText
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
            {pinned.map((pin) => (
              <Tooltip
                key={`${pin.label}:${spotOf(pin)}`}
                title={
                  pin.tile !== undefined
                    ? `${pin.destination} at ${pin.tile.x}, ${pin.tile.y}`
                    : pin.destination
                }
              >
                <Chip
                  label={pin.label}
                  variant="outlined"
                  onClick={() => onPick(pin)}
                  onDelete={() => onUnpin(pin)}
                  icon={<PushPinOutlined fontSize="small" />}
                  data-testid="walker-pin"
                />
              </Tooltip>
            ))}
          </Box>
        ) : null}

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          {isRunning ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void stop(connectionId)}
              data-testid="walker-stop"
            >
              Stop
            </Button>
          ) : (
            <Tooltip title={unreachable ? noWayText : ''}>
              <span>
                <Button
                  variant="contained"
                  disabled={connectionId === '' || destination.trim() === '' || unreachable}
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

      <Dialog open={pinOpen} onClose={() => setPinOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Name this pin</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Pin name"
            value={pinLabel}
            onChange={(event) => setPinLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') savePin()
            }}
            helperText={
              endTile !== undefined
                ? `${trimmed} at ${endTile.x}, ${endTile.y}`
                : `${trimmed}, anywhere the route arrives`
            }
            slotProps={{ htmlInput: { maxLength: 60 } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={savePin}
            disabled={pinLabel.trim() === ''}
            data-testid="walker-pin-save"
          >
            Pin
          </Button>
        </DialogActions>
      </Dialog>

      <ExplorerCard />
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
