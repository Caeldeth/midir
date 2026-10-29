import { Box, Tooltip, Typography } from '@mui/material'
import { useCaptureStore } from '@renderer/store/captureStore'
import React from 'react'

/**
 * What capture is doing, shown in the title bar.
 *
 * Three states, and a warning that outranks all of them. The warning is the
 * only failure the user can fix, so it must be the loudest thing on the bar.
 */

const DOT_SIZE = 9

interface Appearance {
  color: string
  label: string
  tooltip: string
}

function appearanceFor(
  state: 'stopped' | 'listening' | 'decoding',
  characters: string[],
  missedHandshake: boolean
): Appearance {
  if (missedHandshake) {
    return {
      color: 'warning.main',
      label: 'Idle',
      tooltip:
        'Midir joined this session after the login handshake, so it cannot read it. ' +
        'Log out, then log back in with Midir already running.'
    }
  }
  switch (state) {
    case 'decoding':
      // One client reads as the name, exactly as before. Two or more read as a
      // count, because the title bar has no room and a truncated list is worse
      // than a number; the names go to the tooltip.
      if (characters.length > 1) {
        return {
          color: 'success.main',
          label: `${characters.length} characters`,
          tooltip: `Reading packets for ${characters.join(', ')}.`
        }
      }
      return {
        color: 'success.main',
        label: characters[0] ?? 'Decoding',
        tooltip: `Reading packets for ${characters[0] ?? 'a character'}.`
      }
    case 'listening':
      return {
        color: 'info.main',
        label: 'Listening',
        tooltip: 'Capture is running. Start Dark Ages and log in.'
      }
    default:
      return {
        color: 'text.disabled',
        label: 'Not capturing',
        tooltip: 'Capture is stopped. Turn it on from Settings.'
      }
  }
}

function CaptureIndicator(): React.JSX.Element {
  const status = useCaptureStore((s) => s.status)
  const { color, label, tooltip } = appearanceFor(
    status.state,
    status.characters,
    status.missedHandshake
  )

  return (
    <Tooltip title={tooltip}>
      <Box
        data-testid="capture-indicator"
        data-state={status.missedHandshake ? 'warning' : status.state}
        sx={{
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          cursor: 'default'
        }}
      >
        <Box
          sx={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: '50%',
            bgcolor: color,
            flexShrink: 0,
            // A status colour can be close to the bar: the success dot was
            // about 1.7:1 on danaan's bronze bar and 2.0:1 on mundanes' navy
            // one. A ring in the bar's text colour (4.5:1 on every bar) keeps
            // the dot visible (Sabrael, 2026-10-24).
            boxShadow: (theme) => `0 0 0 1.5px ${theme.palette.secondary.contrastText}`
          }}
        />
        <Typography variant="caption" sx={{ color: 'secondary.contrastText', fontWeight: 'bold' }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  )
}

export default CaptureIndicator
