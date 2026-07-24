import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import NavBar from '../NavBar'

describe('NavBar', () => {
  it('shows the Diagnostics tab when it is on', () => {
    render(<NavBar value="live" onChange={vi.fn()} showDiagnostics />)
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toBeInTheDocument()
  })

  it('hides the Diagnostics tab when it is off', () => {
    render(<NavBar value="live" onChange={vi.fn()} showDiagnostics={false} />)
    expect(screen.queryByRole('tab', { name: 'Diagnostics' })).not.toBeInTheDocument()
    // The other tabs stay.
    expect(screen.getByRole('tab', { name: 'Live' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument()
  })
})
