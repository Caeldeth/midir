import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import InfoTip from '@renderer/components/InfoTip'
import { runMessage, useExplorerStore } from '@renderer/store/explorerStore'
import { useWalkerStore } from '@renderer/store/walkerStore'
import { MAX_EXPLORER_MAPS, MAX_EXPLORER_MINUTES } from '@shared/types'
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
  const selected = useWalkerStore((s) => s.selected)
  const windows = useWalkerStore((s) => s.windows)
  const running = useExplorerStore((s) => s.running)
  const maps = useExplorerStore((s) => s.maps)
  const minutes = useExplorerStore((s) => s.minutes)
  const busy = useExplorerStore((s) => s.busy)
  const error = useExplorerStore((s) => s.error)
  const lastOutcome = useExplorerStore((s) => s.lastOutcome)
  const setBudget = useExplorerStore((s) => s.setBudget)
  const refresh = useExplorerStore((s) => s.refresh)
  const start = useExplorerStore((s) => s.start)
  const stop = useExplorerStore((s) => s.stop)
  const subscribe = useExplorerStore((s) => s.subscribe)

  useEffect(() => {
    void refresh()
    return subscribe()
  }, [refresh, subscribe])

  // A selection naming a window that closed drives nothing.
  const selectedValue = windows.some((w) => w.connectionId === selected) ? selected : ''
  const run = selectedValue === '' ? undefined : running[selectedValue]
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
            onClick={() => void stop(selectedValue)}
            data-testid="explorer-stop"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || selectedValue === ''}
            onClick={() => start(selectedValue)}
            data-testid="explorer-start"
          >
            Explore
          </Button>
        )}
      </Stack>

      <Box data-testid="explorer-status">
        {run !== undefined ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {run.target !== undefined
              ? `Walking to ${run.target.name} (${run.target.mapId}).`
              : 'Choosing a map.'}
            {` ${run.visited} visited of ${run.budget.maps}`}
            {`, ${run.remaining} unread within reach`}
            {run.skipped > 0 ? `, ${run.skipped} set aside` : ''}.
          </Typography>
        ) : null}
        {run === undefined && lastOutcome !== undefined ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {runMessage(lastOutcome)}
          </Typography>
        ) : null}
        {run === undefined && lastOutcome === undefined && selectedValue === '' ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Pick a game window above to explore from.
          </Typography>
        ) : null}
      </Box>
    </Paper>
  )
}

export default ExplorerCard
