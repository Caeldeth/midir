import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDiagnosticsStore } from '@renderer/store/diagnosticsStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import {
  DEFAULT_SETTINGS,
  type LogEntry,
  type LogFileInfo,
  type RecordingInfo
} from '@shared/types'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Diagnostics from '../Diagnostics'

const THIS_SESSION: LogFileInfo = {
  name: 'session-20260723-164215-123.log',
  sizeBytes: 2048,
  modifiedMs: Date.now(),
  current: true
}

const OLDER: LogFileInfo = {
  name: 'session-20260722-101500-000.log',
  sizeBytes: 1024,
  modifiedMs: Date.now() - 86_400_000,
  current: false
}

const ENTRIES: LogEntry[] = [
  { timeMs: Date.now(), level: 'info', scope: 'app', message: 'Midir started.' },
  { timeMs: Date.now(), level: 'warn', scope: 'capture', message: 'No adapter was chosen.' },
  { timeMs: Date.now(), level: 'error', scope: 'settings', message: 'The save failed.' }
]

const ACTIVE: RecordingInfo = {
  name: 'session-2026-07-23T16-42-15-123Z.ndjson',
  sizeBytes: 5 * 1024 * 1024,
  startedAtMs: Date.now(),
  active: true
}

const FINISHED: RecordingInfo = {
  name: 'session-2026-07-22T10-15-00-000Z.ndjson',
  sizeBytes: 12 * 1024 * 1024,
  startedAtMs: Date.now() - 86_400_000,
  active: false
}

/** Load the store the way main would, then render the page. */
async function renderWith(
  options: {
    logFiles?: LogFileInfo[]
    entries?: LogEntry[]
    recordings?: RecordingInfo[]
  } = {}
): Promise<void> {
  window.api.diagnostics.listLogs = vi.fn(async () => options.logFiles ?? [])
  window.api.diagnostics.readLog = vi.fn(async () => options.entries ?? [])
  window.api.diagnostics.listRecordings = vi.fn(async () => options.recordings ?? [])
  render(<Diagnostics />)
  await screen.findByTestId('log-section')
  await screen.findByTestId('recordings-section')
}

beforeEach(() => {
  useDiagnosticsStore.setState({
    logFiles: [],
    selectedLog: null,
    entries: [],
    recordings: [],
    loading: false,
    error: null
  })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
})

describe('the Diagnostics page', () => {
  it('says plainly when this session has written nothing', async () => {
    await renderWith({ logFiles: [THIS_SESSION] })
    expect(await screen.findByText(/has written nothing yet/)).toBeInTheDocument()
  })

  it('shows the log for this session, newest last', async () => {
    await renderWith({ logFiles: [THIS_SESSION, OLDER], entries: ENTRIES })

    const lines = await screen.findByTestId('log-lines')
    expect(lines).toHaveTextContent('Midir started.')
    expect(lines).toHaveTextContent('No adapter was chosen.')
    expect(lines).toHaveTextContent('The save failed.')
  })

  it('reads this launch first, not the oldest file on disk', async () => {
    await renderWith({ logFiles: [OLDER, THIS_SESSION], entries: ENTRIES })
    await waitFor(() =>
      expect(window.api.diagnostics.readLog).toHaveBeenCalledWith(THIS_SESSION.name)
    )
  })

  it('filters the log by level', async () => {
    await renderWith({ logFiles: [THIS_SESSION], entries: ENTRIES })
    await screen.findByTestId('log-lines')

    // Turning INFO off must drop its line and keep the rest.
    await userEvent.click(screen.getByRole('button', { name: 'info' }))
    await waitFor(() =>
      expect(screen.getByTestId('log-lines')).not.toHaveTextContent('Midir started.')
    )
    expect(screen.getByTestId('log-lines')).toHaveTextContent('The save failed.')
  })

  it('never leaves every level off, because an empty log reads as a broken one', async () => {
    await renderWith({ logFiles: [THIS_SESSION], entries: ENTRIES })
    await screen.findByTestId('log-lines')

    for (const level of ['info', 'warn', 'error']) {
      await userEvent.click(screen.getByRole('button', { name: level }))
    }
    expect(screen.getByTestId('log-lines')).toHaveTextContent('The save failed.')
  })

  it('filters the log by text', async () => {
    await renderWith({ logFiles: [THIS_SESSION], entries: ENTRIES })
    await userEvent.type(screen.getByLabelText('Search the log'), 'adapter')

    await waitFor(() =>
      expect(screen.getByTestId('log-lines')).not.toHaveTextContent('Midir started.')
    )
    expect(screen.getByTestId('log-lines')).toHaveTextContent('No adapter was chosen.')
  })

  it('says how to make a recording when there is none', async () => {
    await renderWith({ logFiles: [THIS_SESSION] })
    expect(screen.getByText(/There are no recordings/)).toBeInTheDocument()
  })

  it('warns that a recording is private, on the surface that deletes one', async () => {
    await renderWith({ logFiles: [THIS_SESSION], recordings: [FINISHED] })
    const section = screen.getByTestId('recordings-section')
    expect(section).toHaveTextContent(/character name and that session's encryption keys/)
  })

  it('totals the recordings against the cap', async () => {
    useSettingsStore.setState({ recordingCapMb: 1024 })
    await renderWith({ logFiles: [THIS_SESSION], recordings: [ACTIVE, FINISHED] })
    expect(screen.getByTestId('recordings-total')).toHaveTextContent(
      '2 recordings · 17.0 MB of 1,024 MB'
    )
  })

  it('will not delete the recording capture is writing', async () => {
    // Removing the file under the recorder would leave the running session
    // with nowhere to go.
    await renderWith({ logFiles: [THIS_SESSION], recordings: [ACTIVE] })

    const table = screen.getByTestId('recordings-table')
    const button = within(table).getByRole('button', { name: /Delete the recording/ })
    expect(button).toBeDisabled()
    expect(table).toHaveTextContent('Recording now')
  })

  it('deletes a finished recording when asked', async () => {
    await renderWith({ logFiles: [THIS_SESSION], recordings: [FINISHED] })

    const table = screen.getByTestId('recordings-table')
    await userEvent.click(within(table).getByRole('button', { name: /Delete the recording/ }))

    expect(window.api.diagnostics.deleteRecording).toHaveBeenCalledWith(FINISHED.name)
    await waitFor(() => expect(screen.getByText(/There are no recordings/)).toBeInTheDocument())
  })

  it('offers "delete all" only when something can go', async () => {
    await renderWith({ logFiles: [THIS_SESSION], recordings: [ACTIVE] })
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeDisabled()
  })
})
