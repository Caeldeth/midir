import { Box, Button, IconButton, Toolbar, Tooltip } from '@mui/material'
import BugReportOutlined from '@mui/icons-material/BugReportOutlined'
import React from 'react'
import { useReportStore } from '@renderer/store/reportStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { chromeKind, navButtonSx } from '@renderer/components/titleChrome'

/** The top-level views. Midir uses a view name and no router, as the siblings do. */
export type ViewName =
  | 'live'
  | 'items'
  | 'characters'
  | 'boards'
  | 'speaker'
  | 'walker'
  | 'map'
  | 'world'
  | 'laborer'
  | 'diagnostics'
  | 'settings'
  /** The theme gallery. It has no button: the Appearance card in Settings opens it. */
  | 'gallery'

export const VIEWS: readonly { name: ViewName; label: string }[] = [
  { name: 'live', label: 'Live' },
  { name: 'items', label: 'Items' },
  { name: 'characters', label: 'Characters' },
  { name: 'boards', label: 'Boards' },
  { name: 'speaker', label: 'Speaker' },
  { name: 'walker', label: 'Walker' },
  { name: 'map', label: 'Map' },
  { name: 'world', label: 'World' },
  { name: 'laborer', label: 'Errands' },
  { name: 'diagnostics', label: 'Diagnostics' },
  { name: 'settings', label: 'Settings' }
]

interface NavBarProps {
  value: ViewName
  onChange: (view: ViewName) => void
  /** Show the Diagnostics button. The user turns it off in Settings. */
  showDiagnostics: boolean
}

/**
 * The app's second bar, directly under the title bar: the house nav bar
 * (balor `NavToolbar.tsx`, taliesin, creidhne, epona, mabon), a dense
 * `Toolbar` on `tertiary.main` (HTOO-629). Midir puts a word on each button,
 * as mabon does, because eleven views have no clear glyph each. The colours,
 * the hover and the current-view mark are the house nav-bar button,
 * `navButtonSx` (HTOO-572), and `aria-current` says the same in words. The
 * theme gallery has no button, so no button is current while it shows.
 *
 * The bar never wraps. At the narrowest window (1024 px) the eleven buttons fit
 * in every theme with `px: 1`, measured in the built app on 2026-11-01. Cinzel
 * is the widest face: with `px: 1.5` hybrasyl needed 1089 px. If a label grows
 * past that, the bar scrolls sideways, as the tab row did.
 */
function NavBar({ value, onChange, showDiagnostics }: NavBarProps): React.JSX.Element {
  const views = VIEWS.filter((view) => view.name !== 'diagnostics' || showDiagnostics)
  const openReport = useReportStore((s) => s.setOpen)
  const kind = chromeKind(useSettingsStore((s) => s.theme))
  return (
    <Toolbar
      component="nav"
      aria-label="Views"
      data-testid="nav-bar"
      variant="dense"
      disableGutters
      sx={{
        bgcolor: 'tertiary.main',
        color: 'tertiary.contrastText',
        minHeight: 40,
        px: 1,
        gap: 0.5,
        flexShrink: 0,
        overflowX: 'auto'
      }}
    >
      {views.map((view) => (
        // `color="inherit"`: a primary text button takes the themes' accent rule,
        // which beats `sx` (filledControls.ts).
        <Button
          key={view.name}
          size="small"
          color="inherit"
          aria-current={value === view.name ? 'page' : undefined}
          onClick={() => onChange(view.name)}
          sx={{
            ...navButtonSx(kind, value === view.name),
            minWidth: 0,
            px: 1,
            flexShrink: 0,
            whiteSpace: 'nowrap'
          }}
        >
          {view.label}
        </Button>
      ))}
      <Box sx={{ flexGrow: 1 }} />
      {/* Report an issue: the house module's bug button. It sits at the end of
          the nav bar rather than in the window chrome, where it read as a
          window control (Sabrael, 2026-09-22). */}
      <Tooltip title="Report an issue">
        <IconButton
          size="small"
          aria-label="Report an issue"
          sx={{ ...navButtonSx(kind), flexShrink: 0 }}
          onClick={() => openReport(true)}
          data-testid="report-issue"
        >
          <BugReportOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}

export default NavBar
