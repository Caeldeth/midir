import React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Typography
} from '@mui/material'

/**
 * The obligatory ERISCO™ parody-ad About dialog (house style — see balor,
 * oghma, mabon, taliesin, creidhne). The version comes from main through
 * `getAppVersion`.
 *
 * Read on OPEN and not at mount: a dialog nobody opens costs nothing, and
 * `<React.StrictMode>` double-invokes effects in dev.
 *
 * Every line states a real rule from CLAUDE.md. Midir reads from the wire, it
 * posts keys and clicks to the client's own window, and it sends no packet
 * until WP18 says how. Keep it that way if you rewrite the copy: an ad that
 * promises what Midir refuses to do is worse than no ad.
 */
function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [version, setVersion] = React.useState('')

  React.useEffect(() => {
    if (open) void window.api.getAppVersion().then(setVersion)
  }, [open])

  const sections: [string, string[]][] = [
    [
      'FEATURES',
      [
        'Every character you have ever logged in, in one list',
        'The bank, the boards and the legend, kept while you sleep',
        'A walker that reads each step off the wire before it takes the next'
      ]
    ],
    [
      'DELIVERABLES',
      [
        'One search across every character for that one item',
        'Errands worked by the words of the dialog, not by the pixel',
        'A map of the world it learned by walking it'
      ]
    ],
    [
      'INCLUDES',
      [
        'Freedom from the question "which one had the stone"',
        'Total abstinence from your client memory',
        'Not one forged packet'
      ]
    ],
    [
      'SIDE EFFECTS',
      [
        'Sudden knowledge of how much gold is in that bank',
        'Uncontrollable urge to read the town board',
        'Mild disappointment that it will not play for you'
      ]
    ]
  ]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' }}>
        About Midir
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" gutterBottom sx={{ color: 'text.secondary' }}>
          Version {version}
        </Typography>
        {/* target="_blank" goes through setWindowOpenHandler → isSafeExternalUrl
            → shell.openExternal, so these open in the system browser rather
            than in a Midir window. See windowSecurity.ts. */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Link
            href="https://www.hybrasyl.com"
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ color: 'info.light' }}
          >
            hybrasyl.com
          </Link>
          <Link
            href="https://github.com/Caeldeth/midir"
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ color: 'info.light' }}
          >
            GitHub
          </Link>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box
          sx={{
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            fontSize: '0.8rem',
            lineHeight: 1.7
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: 'inherit', fontWeight: 'bold', letterSpacing: 1 }}
          >
            NEW FROM ERISCO™
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'inherit', fontWeight: 'bold', fontSize: '1.1rem', mt: 1 }}
          >
            MIDIR
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'inherit', fontStyle: 'italic', mb: 1 }}>
            THE COMPANION THAT ONLY LISTENS
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'inherit', mb: 2 }}>
            EVERY CHARACTER YOU HAVE, OFF THE WIRE, AND NOT ONE PACKET OF ITS OWN
          </Typography>

          {sections.map(([heading, items]) => (
            <Box key={heading} sx={{ mb: 1.5 }}>
              <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
                {heading}:
              </Typography>
              {items.map((item) => (
                <Typography key={item} variant="body2" sx={{ fontFamily: 'inherit', pl: 1 }}>
                  - {item}
                </Typography>
              ))}
            </Box>
          ))}

          <Box sx={{ mt: 2, borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
              WARNING:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'inherit' }}>
              Start Midir before you log in. It learns the keys from the handshake,
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'inherit' }}>
              and it will not guess them.
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default AboutDialog
