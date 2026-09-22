import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import ReportIssueDialog from '@renderer/components/ReportIssueDialog'
import React from 'react'

/**
 * Catch a render failure, report it, and say so.
 *
 * Without this a React error unmounts the whole tree and leaves a blank
 * window, which tells the user nothing and leaves no trace in a packaged
 * build. The report goes to the same log the main process writes, so one file
 * answers "why did it fail" whichever process broke.
 */

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  message: string | null
  reportOpen: boolean
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { message: null, reportOpen: false }
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void window.api?.diagnostics?.report({
      source: 'react',
      message: error.message,
      stack: `${error.stack ?? ''}${info.componentStack ?? ''}`
    })
  }

  render(): React.ReactNode {
    if (this.state.message === null) return this.props.children

    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', p: 4 }}
        data-testid="error-boundary-fallback"
      >
        <Paper sx={{ p: 4, maxWidth: 620, textAlign: 'center' }}>
          <Typography variant="h5" gutterBottom>
            Something in this view failed
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
            The failure is written to the log. Report it, open Diagnostics to read it, or restart
            Midir. Capture and your character records are not affected.
          </Typography>
          <Stack direction="row" sx={{ justifyContent: 'center', gap: 1.5 }}>
            <Button variant="contained" onClick={() => this.setState({ message: null })}>
              Try again
            </Button>
            <Button variant="outlined" onClick={() => this.setState({ reportOpen: true })}>
              Report an issue…
            </Button>
          </Stack>
        </Paper>
        {/* Its own instance with its own flag: the tree the report store lives
            beside may be the thing that broke. */}
        <ReportIssueDialog
          open={this.state.reportOpen}
          onClose={() => this.setState({ reportOpen: false })}
        />
      </Box>
    )
  }
}

export default ErrorBoundary
