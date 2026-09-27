import { fireEvent, render, screen } from '@testing-library/react'
import { useIconsStore } from '@renderer/store/iconsStore'
import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import LegendBadge from '../LegendBadge'

/**
 * The legend badge (WP42): the client's own art for a mark, or nothing at all.
 * The mark's name stays in the list either way, so nothing is lost when the
 * picture cannot be drawn.
 */

beforeEach(() => {
  useIconsStore.setState({ enabled: true })
})

describe('the legend badge', () => {
  it('asks for the mark icon by its own byte, and names it for a reader', () => {
    render(<LegendBadge icon={6} />)
    const img = screen.getByTestId('legend-badge')
    expect(img).toHaveAttribute('src', 'midir-icon://legend/6')
    expect(img).toHaveAttribute('alt', 'Heart')
    expect(img).toHaveAttribute('title', 'Heart')
  })

  it('draws nothing for the "None" icon, which the sheet has no frame for', () => {
    render(<LegendBadge icon={8} />)
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
  })

  it('draws nothing for an icon off the sheet', () => {
    const { rerender } = render(<LegendBadge icon={9} />)
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
    rerender(<LegendBadge icon={-1} />)
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
  })

  it('draws the stand-in when the legacy data files are off', () => {
    useIconsStore.setState({ enabled: false })
    render(<LegendBadge icon={1} />)
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('legend-stand-in')).toHaveAttribute('aria-label', 'Warrior')
  })

  it('gives the stand-in the mark name, so it reads without the client art', () => {
    useIconsStore.setState({ enabled: false })
    render(<LegendBadge icon={6} />)
    const standIn = screen.getByTestId('legend-stand-in')
    expect(standIn).toHaveAttribute('title', 'Heart')
    expect(standIn).toHaveAttribute('role', 'img')
    // It carries a drawing, not a letter.
    expect(standIn.querySelector('svg')).not.toBeNull()
  })

  it('draws no stand-in for the "None" icon either', () => {
    useIconsStore.setState({ enabled: false })
    render(<LegendBadge icon={8} />)
    expect(screen.queryByTestId('legend-stand-in')).not.toBeInTheDocument()
  })

  it('stays out of the layout until the pixels are in', () => {
    render(<LegendBadge icon={1} />)
    expect(screen.getByTestId('legend-badge')).toHaveStyle({ display: 'none' })
    fireEvent.load(screen.getByTestId('legend-badge'))
    expect(screen.getByTestId('legend-badge')).toHaveStyle({ display: 'inline-block' })
  })

  it('falls back to the stand-in when the client art does not load', () => {
    render(<LegendBadge icon={1} />)
    fireEvent.error(screen.getByTestId('legend-badge'))
    // No broken image, and the mark still carries a badge.
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('legend-stand-in')).toBeInTheDocument()
  })

  it('tries again when it is reused for another mark', () => {
    const { rerender } = render(<LegendBadge icon={1} />)
    fireEvent.error(screen.getByTestId('legend-badge'))
    expect(screen.queryByTestId('legend-badge')).not.toBeInTheDocument()
    rerender(<LegendBadge icon={2} />)
    expect(screen.getByTestId('legend-badge')).toHaveAttribute('src', 'midir-icon://legend/2')
  })
})
