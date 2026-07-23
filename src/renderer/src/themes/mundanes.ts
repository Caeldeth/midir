import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { plainTypography } from './plainTypography'

// Mundanes — the light "corporate/boring" theme. White and light-gray
// surfaces, dark text, a single restrained slate-blue accent, plain
// sans-serif type (plainTypography), and flat 1px gray borders with no
// keyline shadows. Deliberately the plainest theme in the app.
const mundanesTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: '#1976d2',
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
        link: '#1976d2',
        linkHover: '#115293',
        visited: '#6a4fb0',
        button: '#ffffff',
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
              backgroundColor: 'rgba(25,118,210,0.08)',
              borderLeft: '2px solid #1976d2',
              color: '#1976d2'
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
            backgroundColor: '#eceff1',
            color: '#455a64',
            border: '1px solid rgba(0,0,0,0.12)'
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#1976d2' } } },
      MuiTab: {
        styleOverrides: {
          root: {
            color: '#5f6368',
            '&.Mui-selected': { color: '#1976d2' }
          }
        }
      },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#1976d2' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(0,0,0,0.4)',
            '&.Mui-checked': { color: '#1976d2' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.23)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.5)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#1976d2' }
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
