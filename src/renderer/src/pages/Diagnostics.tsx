import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { formatAgo, formatBytes, formatNumber, plural } from '@renderer/lib/format'
import { filterEntries, useDiagnosticsStore } from '@renderer/store/diagnosticsStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { LOG_LEVELS, type LogEntry, type LogLevel } from '@shared/types'
import React, { useEffect, useMemo, useState } from 'react'

/**
 * Every file Midir writes for diagnosis, in one place.
 *
 * A packaged build has no console, so the log file is the only way a user can
 * say why something failed. The recordings sit beside it because they are the
 * other thing Midir writes and the only one that grows without limit.
 *
 * A recording still holds the character name and that session's encryption
 * keys after the credential scrub. Every surface that offers to share or
 * delete one says so.
 */

// `flexShrink: 0` keeps a card at its content height. Without it the two cards
// compete for the column and the shorter one is squeezed.
const cardSx = { p: 3, display: 'flex', flexDirection: 'column', flexShrink: 0 } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const
const descriptionSx = { color: 'text.secondary', mb: 2 } as const

/** The colour each level takes, so a failure is found by scanning. */
const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text.secondary',
  warn: 'warning.main',
  error: 'error.main'
}

/** The time of day, which is what a reader compares against their own memory. */
function formatTime(timeMs: number): string {
  return new Date(timeMs).toLocaleTimeString(undefined, { hour12: false })
}

function LogSection(): React.JSX.Element {
  const logFiles = useDiagnosticsStore((s) => s.logFiles)
  const selectedLog = useDiagnosticsStore((s) => s.selectedLog)
  const entries = useDiagnosticsStore((s) => s.entries)
  const selectLog = useDiagnosticsStore((s) => s.selectLog)
  const openLogsFolder = useDiagnosticsStore((s) => s.openLogsFolder)

  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS])
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const shown = useMemo(() => filterEntries(entries, levels, query), [entries, levels, query])

  function toggleLevel(level: LogLevel): void {
    // Never leave every level off. An empty list reads as a broken log rather
    // than as a filter the user set.
    const next = levels.includes(level)
      ? levels.filter((kept) => kept !== level)
      : [...levels, level]
    if (next.length > 0) setLevels(next)
  }

  async function copyShown(): Promise<void> {
    const text = shown
      .map(
        (entry: LogEntry) =>
          `${formatTime(entry.timeMs)} [${entry.level}] (${entry.scope}) ${entry.message}`
      )
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Paper sx={cardSx} data-testid="log-section">
      <Typography variant="h6" sx={headingSx}>
        Log
      </Typography>
      <Typography variant="body2" sx={descriptionSx}>
        Midir writes one file for each time it opens, and keeps the last ten. Copy the lines here
        when you report a problem.
      </Typography>

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <TextField
          select
          size="small"
          label="Session"
          value={selectedLog ?? ''}
          onChange={(event) => void selectLog(event.target.value)}
          disabled={logFiles.length === 0}
          sx={{ minWidth: 280 }}
        >
          {logFiles.map((file) => (
            <MenuItem key={file.name} value={file.name}>
              {file.current ? 'This session' : formatAgo(file.modifiedMs)} —{' '}
              {formatBytes(file.sizeBytes)}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" sx={{ gap: 0.75 }}>
          {LOG_LEVELS.map((level) => (
            <Chip
              key={level}
              size="small"
              label={level}
              onClick={() => toggleLevel(level)}
              variant={levels.includes(level) ? 'filled' : 'outlined'}
              sx={{ textTransform: 'uppercase' }}
            />
          ))}
        </Stack>

        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the log"
          sx={{ minWidth: 220, flexGrow: 1 }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search the log' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />

        <Button
          size="small"
          startIcon={<ContentCopyOutlinedIcon />}
          onClick={() => void copyShown()}
          disabled={shown.length === 0}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="small"
          startIcon={<FolderOpenOutlinedIcon />}
          onClick={() => void openLogsFolder()}
        >
          Open folder
        </Button>
      </Stack>

      {shown.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {entries.length === 0
            ? 'This session has written nothing yet.'
            : 'No line matches the filter.'}
        </Typography>
      ) : (
        <Box
          data-testid="log-lines"
          sx={{
            // A bounded height, not a share of the column. The lines scroll
            // inside the card; a long log used to grow the card past the page.
            maxHeight: 420,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            bgcolor: 'background.paperDark',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1
          }}
        >
          {shown.map((entry, index) => (
            <Box
              key={`${entry.timeMs}-${index}`}
              sx={{ display: 'flex', gap: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              <Box component="span" sx={{ color: 'text.disabled' }}>
                {formatTime(entry.timeMs)}
              </Box>
              <Box component="span" sx={{ color: LEVEL_COLOR[entry.level], minWidth: '3.5em' }}>
                {entry.level}
              </Box>
              <Box component="span" sx={{ color: 'text.link' }}>
                {entry.scope}
              </Box>
              <Box component="span">{entry.message}</Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}

function RecordingsSection(): React.JSX.Element {
  const recordings = useDiagnosticsStore((s) => s.recordings)
  const removeRecording = useDiagnosticsStore((s) => s.removeRecording)
  const removeAllRecordings = useDiagnosticsStore((s) => s.removeAllRecordings)
  const openRecordingsFolder = useDiagnosticsStore((s) => s.openRecordingsFolder)
  const capMb = useSettingsStore((s) => s.recordingCapMb)

  const totalBytes = recordings.reduce((sum, recording) => sum + recording.sizeBytes, 0)
  const deletable = recordings.filter((recording) => !recording.active).length

  return (
    <Paper sx={cardSx} data-testid="recordings-section">
      <Typography variant="h6" sx={headingSx}>
        Recordings
      </Typography>
      <Typography variant="body2" sx={descriptionSx}>
        A recording replays a session offline, which is how a packet Midir does not understand yet
        gets worked out. Midir removes the account password before it writes, but a recording still
        holds your character name and that session&apos;s encryption keys. Treat one as private, and
        read the caveats in the readme before you share it.
      </Typography>

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="recordings-total">
          {`${plural(recordings.length, 'recording')} · ${formatBytes(totalBytes)}${
            capMb > 0 ? ` of ${formatNumber(capMb)} MB` : ' · no limit set'
          }`}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineOutlinedIcon />}
          onClick={() => void removeAllRecordings()}
          disabled={deletable === 0}
        >
          Delete all
        </Button>
        <Button
          size="small"
          startIcon={<FolderOpenOutlinedIcon />}
          onClick={() => void openRecordingsFolder()}
        >
          Open folder
        </Button>
      </Stack>

      {recordings.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          There are no recordings. Turn on “Record sessions” in Settings, then capture a session.
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 320 }}>
          <Table size="small" stickyHeader data-testid="recordings-table">
            <TableHead>
              <TableRow>
                <TableCell>Started</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell align="right">Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recordings.map((recording) => (
                <TableRow key={recording.name} hover>
                  <TableCell>
                    <Typography variant="body2">
                      {new Date(recording.startedAtMs).toLocaleString()}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {recording.active ? 'Recording now' : formatAgo(recording.startedAtMs)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatBytes(recording.sizeBytes)}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip
                      title={
                        recording.active
                          ? 'Capture is writing this file. Stop capture first.'
                          : 'Delete this recording'
                      }
                    >
                      <Box component="span">
                        <IconButton
                          size="small"
                          aria-label={`Delete the recording from ${new Date(recording.startedAtMs).toLocaleString()}`}
                          disabled={recording.active}
                          onClick={() => void removeRecording(recording.name)}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  )
}

function Diagnostics(): React.JSX.Element {
  const refresh = useDiagnosticsStore((s) => s.refresh)
  const error = useDiagnosticsStore((s) => s.error)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    // `flex: 1` with `minHeight: 0` makes this the element that scrolls. As a
    // plain flex child it sized to its content instead, and the cards ran off
    // the bottom of the window.
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        p: 2.5,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 3
      }}
    >
      {error !== null ? <Alert severity="error">{error}</Alert> : null}
      <LogSection />
      <RecordingsSection />
    </Box>
  )
}

export default Diagnostics
