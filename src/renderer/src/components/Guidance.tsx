import { Box, Paper, Typography } from '@mui/material'
import React from 'react'

/**
 * A centred card that says what to do next.
 *
 * Midir shows this wherever a view has nothing to draw yet. Every one of those
 * states is normal, not an error: capture is off, nobody has logged in, or no
 * character has been recorded. An empty page would leave the user guessing, so
 * each state names its own next step instead.
 */

interface GuidanceProps {
  title: string
  detail: string
  /** An optional button that performs the next step. */
  action?: React.ReactNode
}

function Guidance({ title, detail, action }: GuidanceProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
      <Paper sx={{ p: 4, maxWidth: 620, textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: action ? 3 : 0 }}>
          {detail}
        </Typography>
        {action}
      </Paper>
    </Box>
  )
}

export default Guidance
