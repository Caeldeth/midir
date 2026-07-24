import { Box, Tab, Tabs } from '@mui/material'
import React from 'react'

/** The top-level views. Midir uses a view name and no router, as the siblings do. */
export type ViewName = 'live' | 'items' | 'characters' | 'diagnostics' | 'settings'

export const VIEWS: readonly { name: ViewName; label: string }[] = [
  { name: 'live', label: 'Live' },
  { name: 'items', label: 'Items' },
  { name: 'characters', label: 'Characters' },
  { name: 'diagnostics', label: 'Diagnostics' },
  { name: 'settings', label: 'Settings' }
]

interface NavBarProps {
  value: ViewName
  onChange: (view: ViewName) => void
  /** Show the Diagnostics tab. The user turns it off in Settings. */
  showDiagnostics: boolean
}

function NavBar({ value, onChange, showDiagnostics }: NavBarProps): React.JSX.Element {
  const views = VIEWS.filter((view) => view.name !== 'diagnostics' || showDiagnostics)
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
      <Tabs
        value={value}
        onChange={(_event, next: ViewName) => onChange(next)}
        aria-label="Views"
        data-testid="nav-bar"
      >
        {views.map((view) => (
          <Tab key={view.name} value={view.name} label={view.label} />
        ))}
      </Tabs>
    </Box>
  )
}

export default NavBar
