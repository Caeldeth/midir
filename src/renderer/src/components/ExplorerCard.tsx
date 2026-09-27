import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import InfoTip from '@renderer/components/InfoTip'
import { runMessage, useExplorerStore } from '@renderer/store/explorerStore'
import { useWalkerStore } from '@renderer/store/walkerStore'
import {
  connectionOf,
  explorerScopeLabel,
  MAX_EXPLORER_MAPS,
  MAX_EXPLORER_MINUTES,
  windowKey,
  type ExplorerScope
} from '@shared/types'
import React, { useEffect } from 'react'

/**
 * The explorer (WP41): walk to maps nothing has read yet.
 *
 * It sits under the Walker, on the Walker's own tab, because it is the Walker
 * with a queue in front of it and it drives the window the Walker is pointed at.
 * It ships off, like every driving feature: nothing moves until Start.
 *
 * The panel states the budget and what the run has done, because a run that
 * nobody watches is a run nobody should start.
 */

const cardSx = { p: 3, display: 'flex', flexDirection: 'column', mt: 2.5 } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const

function ExplorerCard(): React.JSX.Element {
  const selectedWindow = useWalkerStore((s) => s.selectedWindow)
  const windows = useWalkerStore((s) => s.windows)
  const running = useExplorerStore((s) => s.running)
  const maps = useExplorerStore((s) => s.maps)
  const minutes = useExplorerStore((s) => s.minutes)
  const avoidHostile = useExplorerStore((s) => s.avoidHostile)
  const scope = useExplorerStore((s) => s.scope)
  const staleDays = useExplorerStore((s) => s.staleDays)
  const busy = useExplorerStore((s) => s.busy)
  const error = useExplorerStore((s) => s.error)
  const lastOutcome = useExplorerStore((s) => s.lastOutcome)
  const setBudget = useExplorerStore((s) => s.setBudget)
  const setAvoidHostile = useExplorerStore((s) => s.setAvoidHostile)
  const setScope = useExplorerStore((s) => s.setScope)
  const setStaleDays = useExplorerStore((s) => s.setStaleDays)
  const refresh = useExplorerStore((s) => s.refresh)
  const start = useExplorerStore((s) => s.start)
  const stop = useExplorerStore((s) => s.stop)
  const subscribe = useExplorerStore((s) => s.subscribe)

  useEffect(() => {
    void refresh()
    return subscribe()
  }, [refresh, subscribe])

  // The pick survives a logout, because it names the window and not the
  // connection. What it cannot survive is the client closing, and a client with
  // nobody logged in has nothing to drive yet.
  const selectedValue = windows.some((w) => windowKey(w) === selectedWindow) ? selectedWindow : ''
  const connectionId = connectionOf(windows, selectedValue)
  const run = connectionId === '' ? undefined : running[connectionId]
  const isRunning = run?.running === true

  return (
    <Paper sx={cardSx} data-testid="explorer-panel">
      <Typography variant="h6" sx={headingSx}>
        Explorer
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Midir walks to maps it has read nothing about, nearest first, and the wire names and sizes
        each one as the character arrives. Stay at the keyboard while it runs.
      </Typography>

      {error !== null ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <Stack direction="row" sx={{ gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Looking for"
          value={scope}
          onChange={(event) => setScope(event.target.value as ExplorerScope)}
          disabled={isRunning}
          sx={{ minWidth: 260 }}
          slotProps={{ htmlInput: { 'aria-label': 'Looking for' } }}
        >
          {(['unread', 'unconfirmed', 'stale'] as const).map((value) => (
            <MenuItem key={value} value={value}>
              {explorerScopeLabel(value)}
            </MenuItem>
          ))}
        </TextField>
        {scope === 'stale' ? (
          <TextField
            type="number"
            size="small"
            label="Older than (days)"
            value={staleDays}
            onChange={(event) => setStaleDays(event.target.value)}
            disabled={isRunning}
            sx={{ maxWidth: 160 }}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
          />
        ) : null}
        <TextField
          type="number"
          size="small"
          label="Maps"
          value={maps}
          onChange={(event) => setBudget(event.target.value, minutes)}
          disabled={isRunning}
          sx={{ maxWidth: 120 }}
          slotProps={{ htmlInput: { min: 1, max: MAX_EXPLORER_MAPS, step: 1 } }}
        />
        <TextField
          type="number"
          size="small"
          label="Minutes"
          value={minutes}
          onChange={(event) => setBudget(maps, event.target.value)}
          disabled={isRunning}
          sx={{ maxWidth: 120 }}
          slotProps={{ htmlInput: { min: 1, max: MAX_EXPLORER_MINUTES, step: 1 } }}
        />
        <InfoTip
          label="About the budget"
          title={`The run stops when it reaches either limit, whichever comes first. At most ${MAX_EXPLORER_MAPS} maps and ${MAX_EXPLORER_MINUTES} minutes: the explorer has no unattended mode.`}
        />
        {isRunning ? (
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void stop(connectionId)}
            data-testid="explorer-stop"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || connectionId === ''}
            onClick={() => start(connectionId)}
            data-testid="explorer-start"
          >
            Explore
          </Button>
        )}
      </Stack>

      <FormControlLabel
        sx={{ mb: 1 }}
        control={
          <Switch
            checked={avoidHostile}
            onChange={(event) => setAvoidHostile(event.target.checked)}
            disabled={isRunning}
            data-testid="explorer-avoid-hostile"
          />
        }
        label={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            Keep out of hostile maps
            <InfoTip
              label="About hostile maps"
              title="The crypts, the dungeons, the woodlands, the caves and the other maps that hold monsters are neither visited nor walked through. The run cannot fight, so this is how it stays alive; it costs reach, because a map behind hostile ground is then out of the run's way. The list lives in route/hostile.ts."
            />
          </Box>
        }
      />

      <Box data-testid="explorer-status">
        {run !== undefined ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {run.target !== undefined
              ? `Walking to ${run.target.name} (${run.target.mapId}).`
              : 'Choosing a map.'}
            {` ${run.visited} visited of ${run.budget.maps}`}
            {`, ${run.remaining} unread within reach`}
            {run.skipped > 0 ? `, ${run.skipped} set aside` : ''}
            {run.avoidingHostile ? ', keeping out of hostile maps' : ''}.
          </Typography>
        ) : null}
        {run === undefined && lastOutcome !== undefined ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {runMessage(lastOutcome)}
          </Typography>
        ) : null}
        {run === undefined && lastOutcome === undefined && connectionId === '' ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {selectedValue === ''
              ? 'Pick a game window above to explore from.'
              : 'Log in on that client to explore from it.'}
          </Typography>
        ) : null}
      </Box>
    </Paper>
  )
}

export default ExplorerCard
