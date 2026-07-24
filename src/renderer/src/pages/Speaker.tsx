import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  InputAdornment,
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
import { useSpeakerStore } from '@renderer/store/speakerStore'
import { formatHotkey, MAX_CHAT_CHARS, MIN_SPEAKER_INTERVAL_MS } from '@shared/types'
import React, { useEffect, useMemo } from 'react'

/**
 * The Speaker: type a list of lines into one selected game window.
 *
 * It ships off. Nothing is typed until the user picks a window and presses
 * Start. The one stop halts it at once, and works from any window through the
 * global hotkey. Midir posts keys to the window's own input queue; it sends no
 * packet and changes nothing in the client.
 */

const cardSx = { p: 3, display: 'flex', flexDirection: 'column' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const
const descriptionSx = { color: 'text.secondary', mb: 2 } as const

const MIN_SECONDS = Math.ceil(MIN_SPEAKER_INTERVAL_MS / 1000)

function Speaker(): React.JSX.Element {
  const windows = useSpeakerStore((s) => s.windows)
  const running = useSpeakerStore((s) => s.running)
  const stopped = useSpeakerStore((s) => s.stopped)
  const stopReason = useSpeakerStore((s) => s.stopReason)
  const busy = useSpeakerStore((s) => s.busy)
  const error = useSpeakerStore((s) => s.error)
  const refresh = useSpeakerStore((s) => s.refresh)
  const refreshWindows = useSpeakerStore((s) => s.refreshWindows)
  const start = useSpeakerStore((s) => s.start)
  const stop = useSpeakerStore((s) => s.stop)
  const stopAll = useSpeakerStore((s) => s.stopAll)
  const clearStop = useSpeakerStore((s) => s.clearStop)
  const selected = useSpeakerStore((s) => s.selected)
  const setSelected = useSpeakerStore((s) => s.setSelected)

  const speakerLines = useSettingsStore((s) => s.speakerLines)
  const setSpeakerLines = useSettingsStore((s) => s.setSpeakerLines)
  const speakerIntervalMs = useSettingsStore((s) => s.speakerIntervalMs)
  const setSpeakerIntervalMs = useSettingsStore((s) => s.setSpeakerIntervalMs)
  const speakerRepeat = useSettingsStore((s) => s.speakerRepeat)
  const setSpeakerRepeat = useSettingsStore((s) => s.setSpeakerRepeat)
  const assistStopHotkey = useSettingsStore((s) => s.assistStopHotkey)
  const speakerToggleHotkey = useSettingsStore((s) => s.speakerToggleHotkey)
  const assistStopOnFocusLoss = useSettingsStore((s) => s.assistStopOnFocusLoss)
  const setAssistStopOnFocusLoss = useSettingsStore((s) => s.setAssistStopOnFocusLoss)

  // The list of open windows updates when a client opens, closes, or a
  // character logs in — all of which change what capture reports.
  const captureStatus = useCaptureStore((s) => s.status)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void refreshWindows()
  }, [refreshWindows, captureStatus])

  // A selection that names a window that is gone collapses to empty, so the
  // picker never points at a window that closed.
  const selectedValue = windows.some((w) => w.connectionId === selected) ? selected : ''
  const isRunning = selectedValue !== '' && running[selectedValue]?.running === true
  const hasLines = useMemo(
    () => speakerLines.some((line) => line.trim().length > 0),
    [speakerLines]
  )
  // How many rows are longer than the client's one-line limit and so split.
  const oversizedCount = useMemo(
    () => speakerLines.filter((line) => line.trim().length > MAX_CHAT_CHARS).length,
    [speakerLines]
  )

  const intervalSeconds = Math.round(speakerIntervalMs / 1000)

  const onStart = (): void => {
    if (selectedValue === '') return
    void start({
      lines: speakerLines,
      intervalMs: speakerIntervalMs,
      repeat: speakerRepeat,
      connectionId: selectedValue
    })
  }

  const windowLabel = (w: (typeof windows)[number]): string =>
    w.characterName !== undefined ? w.characterName : w.title || 'A game window'

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      <Paper sx={cardSx} data-testid="speaker-panel">
        <Typography variant="h6" sx={headingSx}>
          Speaker
        </Typography>
        <Typography variant="body2" sx={descriptionSx}>
          Type a list of lines into one game window on a timer. Midir posts the keys to the window
          you pick, so it works while you do something else. It sends no packet and changes nothing
          in the client. A character must be logged in on the window, or the Speaker does not start.
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
          multiline
          minRows={4}
          maxRows={12}
          fullWidth
          size="small"
          label="Lines"
          placeholder="One line to each row"
          value={speakerLines.join('\n')}
          onChange={(event) => setSpeakerLines(event.target.value.split('\n'))}
          disabled={isRunning}
          helperText={
            oversizedCount > 0
              ? `The client sends at most ${MAX_CHAT_CHARS} characters. ${oversizedCount} row${
                  oversizedCount === 1 ? ' is' : 's are'
                } longer and split across sends, with a hyphen at the break.`
              : `Midir sends these in order. One row is one line, up to ${MAX_CHAT_CHARS} characters. Blank rows are skipped.`
          }
          sx={{ mb: 2 }}
        />

        <Stack direction="row" sx={{ gap: 3, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                checked={speakerRepeat}
                onChange={(event) => setSpeakerRepeat(event.target.checked)}
                disabled={isRunning}
              />
            }
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                Repeat the list
                <InfoTip
                  label="About repeat"
                  title="With repeat on, Midir rotates through the lines forever. With it off, Midir sends each line once, in order, then stops."
                />
              </Box>
            }
          />

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">Wait at least</Typography>
            <TextField
              type="number"
              size="small"
              value={intervalSeconds}
              onChange={(event) =>
                setSpeakerIntervalMs(
                  Math.max(MIN_SPEAKER_INTERVAL_MS, (Number(event.target.value) || 0) * 1000)
                )
              }
              disabled={isRunning}
              sx={{ maxWidth: 140 }}
              slotProps={{
                htmlInput: { min: MIN_SECONDS, step: 1, 'aria-label': 'Wait at least, seconds' },
                input: { endAdornment: <InputAdornment position="end">sec</InputAdornment> }
              }}
            />
          </Box>
        </Stack>

        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          {isRunning ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void stop(selectedValue)}
              data-testid="speaker-stop"
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy || selectedValue === '' || !hasLines}
              onClick={onStart}
              data-testid="speaker-start"
            >
              Start
            </Button>
          )}

          <InfoTip
            label="About the hotkeys"
            title={`Global hotkeys — start or stop the Speaker: ${formatHotkey(
              speakerToggleHotkey
            )}; stop everything: ${formatHotkey(assistStopHotkey)}. Change them in Settings.`}
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
                  title="With this on, an assistant stops the moment you click away from the game window. Leave it off to keep an assistant running while you use another window."
                />
              </Box>
            }
          />
        </Stack>
      </Paper>
    </Box>
  )
}

export default Speaker
