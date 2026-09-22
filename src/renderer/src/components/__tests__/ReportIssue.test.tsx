import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AboutCard from '@renderer/components/AboutCard'
import ReportIssueDialog from '@renderer/components/ReportIssueDialog'
import TitleBar from '@renderer/components/TitleBar'
import { useReportStore } from '@renderer/store/reportStore'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The house Report Issue module on Midir: the two openers and the dialog. */

beforeEach(() => {
  useReportStore.setState({ open: false })
})

describe('the two openers', () => {
  it('the title bar bug button opens the report', async () => {
    render(<TitleBar />)
    await userEvent.click(screen.getByTestId('report-issue'))
    expect(useReportStore.getState().open).toBe(true)
  })

  it('the About card shows the version and opens the report', async () => {
    window.api.getAppVersion = vi.fn(async () => '1.2.3')
    render(<AboutCard />)
    expect(await screen.findByText(/Version 1\.2\.3/)).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('about-report'))
    expect(useReportStore.getState().open).toBe(true)
  })
})

describe('the report dialog', () => {
  it('fetches the block on open, shows it editable, and sends what the user reviewed', async () => {
    window.api.diagnostics.buildReport = vi.fn(async () => 'App: Midir 1.2.3\nOS: windows')
    const openIssue = vi.fn(async () => ({ ok: true as const, truncated: false }))
    window.api.diagnostics.openIssue = openIssue
    render(<ReportIssueDialog open onClose={() => undefined} />)
    const block = await screen.findByLabelText('Diagnostics (editable)')
    expect(block).toHaveValue('App: Midir 1.2.3\nOS: windows')
    await userEvent.type(screen.getByLabelText('Title'), 'It broke')
    await userEvent.type(screen.getByLabelText('What happened?'), 'The bank did not show.')
    await userEvent.click(screen.getByRole('button', { name: 'Open GitHub issue' }))
    expect(openIssue).toHaveBeenCalledWith(
      'It broke',
      'The bank did not show.\n\n```\nApp: Midir 1.2.3\nOS: windows\n```'
    )
    expect(await screen.findByText(/Issue opened in your browser/)).toBeInTheDocument()
  })

  it('copies the report without a title, under the default one', async () => {
    const copyReport = vi.fn(async () => ({ ok: true as const }))
    window.api.diagnostics.copyReport = copyReport
    render(<ReportIssueDialog open onClose={() => undefined} />)
    await screen.findByLabelText('Diagnostics (editable)')
    await userEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(copyReport).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Report copied to your clipboard.')).toBeInTheDocument()
  })

  it('reveals the logs folder from the dialog', async () => {
    render(<ReportIssueDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reveal logs folder' }))
    expect(window.api.diagnostics.openLogsFolder).toHaveBeenCalled()
  })
})
