import React from 'react'
import { Box, Button, Link, Paper, Stack, Typography } from '@mui/material'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import AboutDialog from '@renderer/components/AboutDialog'
import appIcon from '@renderer/assets/midir.webp'
import { useReportStore } from '@renderer/store/reportStore'

/**
 * What Midir is, which build you are running, and the way to report a fault.
 *
 * The house About card. Report an issue is the one control that does not own
 * its dialog locally: the title bar's bug button opens the same dialog, so the
 * flag is on `reportStore` and `App` mounts the dialog. Reveal logs is on that
 * dialog and not here, the house split: the dialog's open, copy, and reveal
 * triad is the module, and a second button in Settings competes with this
 * card's own job. The recordings folder is here because it is a Midir thing
 * the Diagnostics tab also offers, and a player who wants a recording wants it
 * beside the version they are running.
 */
const cardSx = { p: 3, display: 'flex', flexDirection: 'column', height: '100%' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const

function AboutCard(): React.JSX.Element {
  const [version, setVersion] = React.useState('')
  // About Midir has exactly one opener, so its flag is local state.
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const openReport = useReportStore((s) => s.setOpen)

  React.useEffect(() => {
    let live = true
    void window.api.getAppVersion().then((v) => {
      if (live) setVersion(v)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <Paper sx={cardSx} data-testid="about-card">
      <Typography variant="h6" sx={headingSx}>
        About
      </Typography>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 2, my: 2 }}>
        <Box component="img" src={appIcon} alt="" sx={{ width: 48, height: 48, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
            Midir
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="about-version">
            {version ? `Version ${version}` : 'Version…'} — a companion for retail Dark Ages: your
            characters, their items, the boards, and the map, off the wire.
          </Typography>
          {/* Both go through setWindowOpenHandler → isSafeExternalUrl →
              shell.openExternal, so they open in the system browser. */}
          <Stack direction="row" sx={{ gap: 2, mt: 0.5 }}>
            <Link
              href="https://www.hybrasyl.com"
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
            >
              hybrasyl.com
            </Link>
            <Link
              href="https://github.com/Caeldeth/midir"
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
            >
              github.com/Caeldeth/midir
            </Link>
          </Stack>
        </Box>
      </Stack>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
        <Button
          variant="outlined"
          startIcon={<InfoOutlinedIcon />}
          onClick={() => setAboutOpen(true)}
          data-testid="about-midir"
        >
          About Midir…
        </Button>
        <Button
          variant="outlined"
          startIcon={<BugReportOutlinedIcon />}
          onClick={() => openReport(true)}
          data-testid="about-report"
        >
          Report an issue…
        </Button>
        <Button
          variant="outlined"
          startIcon={<FolderOpenOutlinedIcon />}
          onClick={() => void window.api.diagnostics.openRecordingsFolder()}
        >
          Reveal recordings folder
        </Button>
      </Stack>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" sx={{ color: 'text.secondary', mt: 2 }}>
        Midir reads the game from the wire, and drives it through the game&apos;s own window. Each
        assistant feature waits until you turn it on.
      </Typography>
    </Paper>
  )
}

export default AboutCard
