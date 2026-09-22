import { Box, IconButton, Tab, Tabs, Tooltip } from '@mui/material'
import BugReportOutlined from '@mui/icons-material/BugReportOutlined'
import React from 'react'
import { useReportStore } from '@renderer/store/reportStore'

/** The top-level views. Midir uses a view name and no router, as the siblings do. */
export type ViewName =
  | 'live'
  | 'items'
  | 'characters'
  | 'boards'
  | 'speaker'
  | 'walker'
  | 'map'
  | 'laborer'
  | 'diagnostics'
  | 'settings'

export const VIEWS: readonly { name: ViewName; label: string }[] = [
  { name: 'live', label: 'Live' },
  { name: 'items', label: 'Items' },
  { name: 'characters', label: 'Characters' },
  { name: 'boards', label: 'Boards' },
  { name: 'speaker', label: 'Speaker' },
  { name: 'walker', label: 'Walker' },
  { name: 'map', label: 'Map' },
  { name: 'laborer', label: 'Errands' },
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
  const openReport = useReportStore((s) => s.setOpen)
  return (
    <Box
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center'
      }}
    >
      <Tabs
        value={value}
        onChange={(_event, next: ViewName) => onChange(next)}
        aria-label="Views"
        data-testid="nav-bar"
        sx={{ flexGrow: 1, minWidth: 0 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        {views.map((view) => (
          <Tab key={view.name} value={view.name} label={view.label} />
        ))}
      </Tabs>
      {/* Report an issue: the house module's bug button. It sits at the end of
          the tab row rather than in the window chrome, where it read as a
          window control (Sabrael, 2026-09-22). */}
      <Tooltip title="Report an issue">
        <IconButton
          size="small"
          aria-label="Report an issue"
          sx={{ mr: 1, ml: 1, flexShrink: 0 }}
          onClick={() => openReport(true)}
          data-testid="report-issue"
        >
          <BugReportOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export default NavBar
