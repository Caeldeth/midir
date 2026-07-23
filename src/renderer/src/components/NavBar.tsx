import { Box, Tab, Tabs } from '@mui/material'
import React from 'react'

/** The top-level views. Midir uses a view name and no router, as the siblings do. */
export type ViewName = 'live' | 'items' | 'characters' | 'settings'

export const VIEWS: readonly { name: ViewName; label: string }[] = [
  { name: 'live', label: 'Live' },
  { name: 'items', label: 'Items' },
  { name: 'characters', label: 'Characters' },
  { name: 'settings', label: 'Settings' }
]

interface NavBarProps {
  value: ViewName
  onChange: (view: ViewName) => void
}

function NavBar({ value, onChange }: NavBarProps): React.JSX.Element {
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
      <Tabs
        value={value}
        onChange={(_event, next: ViewName) => onChange(next)}
        aria-label="Views"
        data-testid="nav-bar"
      >
        {VIEWS.map((view) => (
          <Tab key={view.name} value={view.name} label={view.label} />
        ))}
      </Tabs>
    </Box>
  )
}

export default NavBar
