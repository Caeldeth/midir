import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { baseTypography } from './baseTypography'

const danaanTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: '#b8922a',
        // Darker gold so primary text reads against parchment.
        light: '#9a6e10',
        dark: '#7a5e18',
        contrastText: '#1a1008'
      },
      secondary: {
        main: '#c8a030',
        light: '#f0d070',
        dark: '#8a6820',
        contrastText: '#1a1008'
      },
      background: {
        default: '#f5e8c0',
        gray: '#f5e8c0',
        paper: 'rgba(250,242,220,0.94)',
        paperMedium: 'rgba(245,235,205,0.96)',
        paperLight: 'rgba(255,248,230,0.90)',
        paperDark: 'rgba(235,220,185,0.98)',
        tableLight: 'rgba(255,250,235,0.80)',
        tableDark: 'rgba(240,228,195,0.90)',
        tableBorderL: 'rgba(122,94,24,0.25)',
        tableBorderD: 'rgba(122,94,24,0.45)',
        scrollbarDark: '#7a5e18',
        scrollbarLight: '#b8922a'
      },
      text: {
        primary: '#2a1e08',
        secondary: '#4a3c20',
        disabled: '#6a5840',
        headline: '#b88a1c',
        link: '#7a5e18',
        linkHover: '#b8922a',
        visited: '#4a3c20',
        button: '#2a1e08',
        dark: '#1a1008'
      },
      divider: 'rgba(122,94,24,0.38)',
      error: { main: '#ff0000' },
      warning: { main: '#FFFF00' },
      info: { main: '#6de7f7' },
      success: { main: '#38ff4f' }
    },

    typography: baseTypography,

    shape: { borderRadius: 2 },

    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: 'rgba(250,242,220,0.94)',
            border: '1px solid rgba(122,94,24,0.55)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #b8922a, 2px 2px 0 0 #b8922a'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #b8922a',
            color: '#7a5e18',
            '&:hover': { backgroundColor: 'rgba(184,146,42,0.12)', borderColor: '#e8c060' }
          },
          contained: {
            backgroundColor: '#b8922a',
            color: '#fff8e8',
            '&:hover': { backgroundColor: '#d4a843' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(255,248,225,0.97)',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(122,94,24,0.50)',
            boxShadow: 'none',
            color: '#2a1e08'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: 'rgba(250,242,220,0.97)',
            borderRight: '1px solid rgba(122,94,24,0.55)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            color: '#4a3c20',
            borderBottom: '1px solid rgba(122,94,24,0.22)',
            '&.Mui-selected': {
              backgroundColor: 'rgba(184,146,42,0.15)',
              borderLeft: '2px solid #b8922a',
              color: '#7a5e18'
            },
            '&:hover': { backgroundColor: 'rgba(184,146,42,0.1)', paddingLeft: '20px' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(255,250,235,0.96)',
            border: '1px solid rgba(122,94,24,0.42)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: '#b8922a' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(122,94,24,0.38)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            backgroundColor: 'rgba(184,146,42,0.22)',
            color: '#7a5e18',
            border: '1px solid rgba(122,94,24,0.50)'
          }
        }
      },
      MuiPaginationItem: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '1rem',
            borderRadius: 2,
            textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
            '& .MuiPaginationItem-icon': {
              filter:
                'drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000)'
            },
            backgroundColor: '#c8a030',
            color: '#1a1008',
            border: '1px solid #b8922a',
            '&:hover': { backgroundColor: '#e8c060', borderColor: '#f0d070' },
            '&.Mui-selected': {
              backgroundColor: '#b8922a',
              borderColor: '#e8c060',
              color: '#fff8e8'
            },
            '&.Mui-disabled': {
              backgroundColor: 'rgba(200,160,48,0.3)',
              color: 'rgba(26,16,8,0.4)'
            }
          }
        }
      },
      MuiTab: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.7rem',
            letterSpacing: '0.14em',
            color: '#6a5840',
            '&.Mui-selected': { color: '#7a5e18' }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#b8922a' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#b8922a' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(184,146,42,0.5)',
            '&.Mui-checked': { color: '#b8922a' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.45)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.70)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#b8922a' }
          }
        }
      },
      MuiLink: {
        styleOverrides: {
          root: ({ theme }) => ({
            color: theme.palette.text.link,
            textDecoration: 'none',
            '&:hover': { color: theme.palette.text.linkHover },
            '&:visited': { color: theme.palette.text.visited }
          })
        }
      },
      MuiCssBaseline: {
        styleOverrides: {
          a: {
            color: '#7a5e18',
            textDecoration: 'none',
            '&:hover': { color: '#b8922a' },
            '&:visited': { color: '#4a3c20' }
          }
        }
      },
      MuiSvgIcon: {
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.secondary.dark })
        }
      },
      MuiCircularProgress: {
        defaultProps: { color: 'inherit' },
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.text.headline })
        }
      }
    }
  })
)

export default danaanTheme
