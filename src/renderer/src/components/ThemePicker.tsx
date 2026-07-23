import React from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { THEME_NAMES, type ThemeName } from '@shared/types'
import { themesByName } from '@renderer/themes'

// House theme picker: the themes as selectable preview cards (a swatch of each
// palette + its name) rather than a bare dropdown. Shared idiom across the
// Erisco/Hybrasyl apps (creidhne, taliesin, mabon) — copy this file into a new
// app as-is; it only depends on @shared/types and the themesByName barrel.

const THEME_LABELS: Record<ThemeName, string> = {
  hybrasyl: 'Hybrasyl',
  chadul: 'Chadul',
  danaan: 'Danaan',
  grinneal: 'Grinneal',
  mundanes: 'Mundanes (light)',
  dubhaimid: 'Dubhaimid (dark)'
}

// A live mini-preview of one theme, painted in THAT theme's own palette (not the
// active one) so each card shows what it would look like.
function ThemeSwatch({ name, label }: { name: ThemeName; label: string }): React.JSX.Element {
  const p = themesByName[name].palette
  const chips = [p.secondary.light, p.info.main, p.warning.main, p.primary.light]
  return (
    <Box
      sx={{
        bgcolor: p.background.default,
        p: 1.25,
        minHeight: 78,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 1,
        width: '100%'
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        {chips.map((c, i) => (
          <Box
            key={i}
            sx={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              bgcolor: c,
              border: '1px solid rgba(0,0,0,0.35)'
            }}
          />
        ))}
      </Box>
      <Typography sx={{ color: p.text.primary, fontWeight: 600, fontSize: '0.82rem' }}>
        {label}
      </Typography>
    </Box>
  )
}

interface Props {
  value: ThemeName
  onChange: (theme: ThemeName) => void
}

function ThemePicker({ value, onChange }: Props): React.JSX.Element {
  return (
    <Box
      role="radiogroup"
      aria-label="Theme"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 1.5
      }}
    >
      {THEME_NAMES.map((name) => {
        const selected = value === name
        return (
          <ButtonBase
            key={name}
            role="radio"
            aria-checked={selected}
            aria-label={THEME_LABELS[name]}
            onClick={() => onChange(name)}
            sx={{
              display: 'block',
              textAlign: 'left',
              borderRadius: 1,
              overflow: 'hidden',
              position: 'relative',
              border: '2px solid',
              borderColor: selected ? 'primary.light' : 'divider',
              transition: 'border-color 0.15s',
              '&:hover': { borderColor: selected ? 'primary.light' : 'text.secondary' }
            }}
          >
            <ThemeSwatch name={name} label={THEME_LABELS[name]} />
            {selected && (
              <CheckCircleIcon
                sx={{
                  position: 'absolute',
                  top: 5,
                  right: 5,
                  fontSize: 20,
                  color: 'primary.light',
                  filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))'
                }}
              />
            )}
          </ButtonBase>
        )
      })}
    </Box>
  )
}

export default ThemePicker
