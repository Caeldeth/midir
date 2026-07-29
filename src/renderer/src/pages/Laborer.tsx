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
import { useCaptureStore } from '@renderer/store/captureStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { errandOutcomeMessage, useLaborerStore } from '@renderer/store/laborerStore'
import { formatHotkey, type ErrandOutcome, type LaborerState } from '@shared/types'
import React, { useEffect } from 'react'

/**
 * The Laborer: walk to an NPC and work its dialog, the errand that is pure
 * repetition.
 *
 * It ships off. Nothing runs until the user picks a window, chooses an errand,
 * and presses Run. The Laborer walks there with the Walker, then reads the
 * dialog off the wire and posts the keys to choose each option. It chooses by
 * what the row says, stops on any dialog it does not expect, and never works a
 * login or password dialog. It sends no packet and reads no memory. The one stop
 * halts it between steps.
 */

const cardSx = { p: 3, display: 'flex', flexDirection: 'column' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const
const descriptionSx = { color: 'text.secondary', mb: 2 } as const

function Laborer(): React.JSX.Element {
  const windows = useLaborerStore((s) => s.windows)
  const errands = useLaborerStore((s) => s.errands)
  const running = useLaborerStore((s) => s.running)
  const stopped = useLaborerStore((s) => s.stopped)
  const stopReason = useLaborerStore((s) => s.stopReason)
  const busy = useLaborerStore((s) => s.busy)
  const error = useLaborerStore((s) => s.error)
  const lastOutcome = useLaborerStore((s) => s.lastOutcome)
  const selected = useLaborerStore((s) => s.selected)
  const setSelected = useLaborerStore((s) => s.setSelected)
  const errand = useLaborerStore((s) => s.errand)
  const setErrand = useLaborerStore((s) => s.setErrand)
  const refresh = useLaborerStore((s) => s.refresh)
  const refreshWindows = useLaborerStore((s) => s.refreshWindows)
  const run = useLaborerStore((s) => s.run)
  const stop = useLaborerStore((s) => s.stop)
  const stopAll = useLaborerStore((s) => s.stopAll)
  const clearStop = useLaborerStore((s) => s.clearStop)

  const assistStopHotkey = useSettingsStore((s) => s.assistStopHotkey)
  const assistStopOnFocusLoss = useSettingsStore((s) => s.assistStopOnFocusLoss)
  const setAssistStopOnFocusLoss = useSettingsStore((s) => s.setAssistStopOnFocusLoss)

  const captureStatus = useCaptureStore((s) => s.status)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows, captureStatus])

  // A selection that names a window that is gone collapses to empty.
  const selectedValue = windows.some((w) => w.connectionId === selected) ? selected : ''
  const activeRun = selectedValue !== '' ? running[selectedValue] : undefined
  const isRunning = activeRun?.running === true

  // An errand name that is no longer offered collapses to empty.
  const errandValue = errands.some((e) => e.name === errand) ? errand : ''

  const windowLabel = (w: (typeof windows)[number]): string =>
    w.characterName !== undefined ? w.characterName : w.title || 'A game window'

  const onRun = (): void => {
    if (selectedValue === '' || errandValue === '') return
    run(selectedValue, errandValue)
  }

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      <Paper sx={cardSx} data-testid="laborer-panel">
        <Typography variant="h6" sx={headingSx}>
          Laborer
        </Typography>
        <Typography variant="body2" sx={descriptionSx}>
          Choose an errand, and the Laborer walks to the NPC and works the dialog. It reads the
          conversation off the wire and posts the keys to choose each option by what the option
          says, not by where it is on the screen. It stops on any dialog it does not expect, and it
          never works a login or password dialog. It sends no packet and reads no memory. A
          character must be logged in on the window.
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

        <TextField
          select
          fullWidth
          size="small"
          label="Errand"
          value={errandValue}
          onChange={(event) => setErrand(event.target.value)}
          disabled={isRunning}
          helperText={
            errands.length === 0
              ? 'No errands are set up yet.'
              : 'Each errand names one NPC and the steps to work.'
          }
          sx={{ mb: 2 }}
        >
          {errands.map((e) => (
            <MenuItem key={e.name} value={e.name}>
              {e.name}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          {isRunning ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void stop(selectedValue)}
              data-testid="laborer-stop"
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={selectedValue === '' || errandValue === ''}
              onClick={onRun}
              data-testid="laborer-run"
            >
              Run
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

        <LaborerStatus isRunning={isRunning} run={activeRun} lastOutcome={lastOutcome} />
      </Paper>
    </Box>
  )
}

interface LaborerStatusProps {
  isRunning: boolean
  run?: LaborerState
  lastOutcome?: ErrandOutcome
}

/** The live line under the controls: the step, what it waits for, and how it ended. */
function LaborerStatus({
  isRunning,
  run,
  lastOutcome
}: LaborerStatusProps): React.JSX.Element | null {
  if (!isRunning && lastOutcome === undefined && run?.reason === undefined) return null

  return (
    <Box
      data-testid="laborer-status"
      sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, color: 'text.secondary' }}
    >
      {isRunning ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            Running {run?.errand ?? 'an errand'}
            {run?.step !== undefined ? ` — step ${run.step + 1}` : ''}.
          </Typography>
          {run?.waitingFor !== undefined ? (
            <Typography variant="body2">Waiting for {run.waitingFor}.</Typography>
          ) : null}
        </Stack>
      ) : (
        <Typography variant="body2" data-testid="laborer-outcome">
          {run?.reason !== undefined
            ? `Stopped: ${run.reason}.`
            : lastOutcome !== undefined
              ? errandOutcomeMessage(lastOutcome)
              : ''}
        </Typography>
      )}
    </Box>
  )
}

export default Laborer
