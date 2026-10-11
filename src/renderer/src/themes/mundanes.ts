import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { plainTypography } from './plainTypography'
import { midirOverrides } from './midirOverrides'

// Mundanes — the light "corporate/boring" theme. White and light-gray
// surfaces, dark text, a single restrained slate-blue accent, plain
// sans-serif type (plainTypography), and flat 1px gray borders with no
// keyline shadows. Deliberately the plainest theme in the app.
const mundanesTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      primary: {
        // HTOO-355: a slightly darker blue. The old #1976d2 was 2.89:1 on the grey page;
        // this is 3.10:1 on the page, 4.95:1 on paper, and white is 4.95:1 on it.
        main: '#1871c9',
        light: '#4a97e0',
        dark: '#115293',
        contrastText: '#ffffff'
      },
      // secondary is the title-bar / chrome color in every theme. Mundanes
      // uses the classic Windows active-title navy (#0a246a) so the corporate
      // look has a real anchor of color instead of a near-white bar.
      secondary: {
        main: '#0a246a',
        light: '#2f4f8f',
        dark: '#061a4f',
        contrastText: '#ffffff'
      },
      background: {
        // A clearly cool light-gray canvas so white paper/cards read as raised
        // surfaces (the old #f5f5f5-on-#ffffff had almost no contrast).
        default: '#c9cdd4',
        gray: '#e4e8ee',
        paper: '#ffffff',
        paperMedium: '#f3f5f8',
        paperLight: '#ffffff',
        paperDark: '#d3d9e1',
        tableLight: '#ffffff',
        tableDark: '#eef1f5',
        tableBorderL: 'rgba(0,0,0,0.08)',
        tableBorderD: 'rgba(0,0,0,0.16)',
        scrollbarDark: '#b0b6bb',
        scrollbarLight: '#8a9198'
      },
      text: {
        primary: '#1a1a1a',
        secondary: '#5f6368',
        disabled: '#9aa0a6',
        headline: '#1a1a1a',
        link: '#1871c9',
        linkHover: '#115293',
        visited: '#6a4fb0',
        // Headings on the page and on cards. White was 1.6:1 on the grey page and
        // 1:1 on the white cards (HTOO-355). The navy bars use secondary.contrastText.
        button: '#1a1a1a',
        dark: '#1a1a1a'
      },
      divider: 'rgba(0,0,0,0.12)',
      error: { main: '#d32f2f' },
      warning: { main: '#ed6c02' },
      info: { main: '#0288d1' },
      success: { main: '#2e7d32' }
    },

    typography: plainTypography,

    shape: { borderRadius: 6 },

    components: {
      ...midirOverrides,
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: '1px solid rgba(0,0,0,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: '#ffffff',
            backgroundImage: 'none',
            color: '#1a1a1a',
            borderBottom: '1px solid rgba(0,0,0,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#ffffff',
            borderRight: '1px solid rgba(0,0,0,0.12)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            color: '#5f6368',
            '&.Mui-selected': {
              backgroundColor: 'rgba(24,113,201,0.08)',
              borderLeft: '2px solid #1871c9',
              color: '#1871c9'
            },
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: '#ffffff',
            border: '1px solid rgba(0,0,0,0.12)',
            backgroundImage: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&:hover': { borderColor: 'rgba(0,0,0,0.24)', boxShadow: '0 2px 6px rgba(0,0,0,0.14)' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(0,0,0,0.12)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            border: '1px solid rgba(0,0,0,0.12)',
            // The tint is for a plain chip only. On `root` it beat MUI's own fill
            // for every colour, so a warning or a selected chip looked plain
            // (HTOO-572).
            '&.MuiChip-colorDefault': {
              backgroundColor: '#eceff1',
              color: '#455a64'
            },
            // A selected chip (color="primary", filled) takes the accent and its
            // label, as MUI's own fill does, and keeps the accent on hover.
            '&.MuiChip-filled.MuiChip-colorPrimary': {
              backgroundColor: '#1871c9',
              color: '#ffffff',
              borderColor: '#1871c9',
              '&.MuiChip-clickable:hover': { backgroundColor: '#1871c9' }
            }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#1871c9' } } },
      MuiTab: {
        styleOverrides: {
          root: {
            color: '#5f6368',
            '&.Mui-selected': { color: '#1871c9' }
          }
        }
      },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#1871c9' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(0,0,0,0.4)',
            '&.Mui-checked': { color: '#1871c9' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.23)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.5)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#1871c9' }
          }
        }
      },
      MuiLink: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.text.link,
            textDecoration: 'none',
            '&:hover': { color: theme.palette.text.linkHover, textDecoration: 'underline' },
            '&:visited': { color: theme.palette.text.visited }
          })
        }
      }
    }
  })
)

export default mundanesTheme
