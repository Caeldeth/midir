import type { Components, Theme } from '@mui/material/styles'

/**
 * The component overrides that Midir adds to each of the six house themes.
 * The template does not have them. Each theme file is the template's file,
 * plus one spread of this object at the start of its `components`. Keep them
 * in this one file, so that the next port of the template's palettes is a copy
 * of the six theme files and the spread line.
 *
 * - `MuiAccordion`, `MuiAccordionSummary`, `MuiAccordionDetails`: the
 *   character sheet and the Boards page put their sections in accordions. MUI's
 *   default accordion has a shadow, a top rule, and a gap when it opens. These
 *   give a flat section with a border and a darker header (WP19).
 * - `MuiTooltip`: Midir puts a tooltip on many items (the item holders, the
 *   gold total, the equip screen, the warps on the map). MUI's default tooltip
 *   is grey on every theme. This gives it the theme's own surface and text
 *   (WP19).
 *
 * None of them uses `primary.main`, so the palette tests are not affected.
 * `midirOverrides.test.ts` makes sure that each theme carries them.
 */
export const midirOverrides: Components<Omit<Theme, 'components'>> = {
  MuiAccordion: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundImage: 'none',
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: 'none',
        '&::before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 }
      })
    }
  },
  MuiAccordionSummary: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: theme.palette.background.paperDark,
        minHeight: 0,
        '& .MuiAccordionSummary-content': {
          marginTop: theme.spacing(1),
          marginBottom: theme.spacing(1)
        }
      })
    }
  },
  MuiAccordionDetails: {
    styleOverrides: {
      root: ({ theme }) => ({ padding: theme.spacing(2) })
    }
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: ({ theme }) => ({
        backgroundColor: theme.palette.background.paperDark,
        color: theme.palette.text.primary,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: theme.shape.borderRadius,
        boxShadow: theme.shadows[6],
        fontSize: '0.8rem',
        padding: theme.spacing(0.75, 1)
      }),
      arrow: ({ theme }) => ({ color: theme.palette.background.paperDark })
    }
  }
}
