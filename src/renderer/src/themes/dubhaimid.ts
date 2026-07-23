import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { plainTypography } from './plainTypography'

// Dubhaimid — the dark "corporate/boring" theme. Neutral charcoal grays
// (VS Code-ish), light-gray text, a single muted blue accent, plain
// sans-serif type (plainTypography), and flat subtle borders with no
// keyline shadows. The dark sibling of Mundanes.
const dubhaimidTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#5c8bc4',
        light: '#82a9d6',
        dark: '#3f6a9e',
        contrastText: '#ffffff'
      },
      // secondary is the title-bar / chrome color. Dubhaimid shares Mundanes'
      // classic Windows active-title navy (#0a246a) so both corporate themes
      // read as the same family, just light vs dark.
      secondary: {
        main: '#0a246a',
        light: '#2f4f8f',
        dark: '#061a4f',
        contrastText: '#ffffff'
      },
      background: {
        default: '#1e1e1e',
        gray: '#1e1e1e',
        paper: '#252526',
        paperMedium: '#212122',
        paperLight: '#2d2d30',
        paperDark: '#1a1a1b',
        tableLight: '#252526',
        tableDark: '#2a2a2b',
        tableBorderL: 'rgba(255,255,255,0.08)',
        tableBorderD: 'rgba(255,255,255,0.16)',
        scrollbarDark: '#3e3e42',
        scrollbarLight: '#5a5a5f'
      },
      text: {
        primary: '#e0e0e0',
        secondary: '#9aa0a6',
        disabled: '#6a6a6e',
        headline: '#e0e0e0',
        link: '#5c8bc4',
        linkHover: '#82a9d6',
        visited: '#9a8bc4',
        button: '#ffffff',
        dark: '#1a1a1b'
      },
      divider: 'rgba(255,255,255,0.12)',
      error: { main: '#f44336' },
      warning: { main: '#ffa726' },
      info: { main: '#29b6f6' },
      success: { main: '#66bb6a' }
    },

    typography: plainTypography,

    shape: { borderRadius: 6 },

    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: '#252526',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: '#252526',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#252526',
            borderRight: '1px solid rgba(255,255,255,0.12)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            color: '#9aa0a6',
            '&.Mui-selected': {
              backgroundColor: 'rgba(92,139,196,0.16)',
              borderLeft: '2px solid #5c8bc4',
              color: '#82a9d6'
            },
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.06)' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: '#2d2d30',
            border: '1px solid rgba(255,255,255,0.12)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: 'rgba(255,255,255,0.24)' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(255,255,255,0.12)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            backgroundColor: '#3e3e42',
            color: '#c4c8cc',
            border: '1px solid rgba(255,255,255,0.12)'
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#5c8bc4' } } },
      MuiTab: {
        styleOverrides: {
          root: {
            color: '#9aa0a6',
            '&.Mui-selected': { color: '#82a9d6' }
          }
        }
      },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#5c8bc4' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(255,255,255,0.4)',
            '&.Mui-checked': { color: '#5c8bc4' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.23)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#5c8bc4' }
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

export default dubhaimidTheme
