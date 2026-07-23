import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { baseTypography } from './baseTypography'

const grinnealTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#6a7a50',
        light: '#8a9a68',
        dark: '#4a5838',
        contrastText: '#f0dcb8'
      },
      secondary: {
        main: '#907858',
        light: '#b89870',
        dark: '#604830',
        contrastText: '#f8f0df'
      },
      background: {
        default: '#27221c',
        gray: '#27221c',
        paper: 'rgba(22,18,14,0.88)',
        paperMedium: 'rgba(20,16,12,0.92)',
        paperLight: 'rgba(28,22,16,0.78)',
        paperDark: 'rgba(14,10,8,0.96)',
        tableLight: 'rgba(26,20,14,0.65)',
        tableDark: 'rgba(18,14,10,0.82)',
        tableBorderL: 'rgba(122,106,80,0.15)',
        tableBorderD: 'rgba(122,106,80,0.30)',
        scrollbarDark: '#4a5838',
        scrollbarLight: '#6a7a50'
      },
      text: {
        primary: '#d4c4a8',
        secondary: '#b0a088',
        disabled: '#b0a088',
        headline: '#dcb864',
        link: '#a0b078',
        linkHover: '#c0d090',
        visited: '#6a7a50',
        button: '#d4c4a8',
        dark: '#1a1408'
      },
      divider: 'rgba(160,140,100,0.40)',
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
            backgroundColor: 'rgba(22,18,14,0.88)',
            border: '1px solid rgba(160,140,100,0.48)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #4a5838, 2px 2px 0 0 #504030'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #8a9a68',
            color: '#b0c088',
            '&:hover': {
              backgroundColor: 'rgba(106,122,80,0.18)',
              borderColor: '#c0d090',
              color: '#c8d898'
            }
          },
          contained: {
            backgroundColor: 'rgba(106,122,80,0.22)',
            color: '#d4c4a8',
            '&:hover': { backgroundColor: 'rgba(106,122,80,0.36)' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(10,8,6,0.97)',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(160,140,100,0.38)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: 'rgba(18,14,10,0.96)',
            borderRight: '1px solid rgba(160,140,100,0.42)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            color: '#9a8a70',
            borderBottom: '1px solid rgba(122,106,80,0.08)',
            '&.Mui-selected': {
              backgroundColor: 'rgba(106,122,80,0.12)',
              borderLeft: '2px solid #6a7a50',
              color: '#8a9a68'
            },
            '&:hover': { backgroundColor: 'rgba(122,106,80,0.1)', paddingLeft: '20px' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(28,22,16,0.93)',
            border: '1px solid rgba(160,140,100,0.32)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: '#a0b078' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(160,140,100,0.35)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            backgroundColor: 'rgba(106,122,80,0.22)',
            color: '#b0c088',
            border: '1px solid rgba(160,140,100,0.48)'
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
            backgroundColor: '#907858',
            color: '#d4c4a8',
            border: '1px solid #6a7a50',
            '&:hover': { backgroundColor: '#b89870', borderColor: '#8a9a68' },
            '&.Mui-selected': {
              backgroundColor: '#6a7a50',
              borderColor: '#8a9a68',
              color: '#d4c4a8'
            },
            '&.Mui-disabled': {
              backgroundColor: 'rgba(144,120,88,0.3)',
              color: 'rgba(212,196,168,0.4)'
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
            color: '#9a8a70',
            '&.Mui-selected': { color: '#b8c890' }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#6a7a50' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#6a7a50' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(106,122,80,0.5)',
            '&.Mui-checked': { color: '#6a7a50' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,106,80,0.3)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,106,80,0.6)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#6a7a50' }
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
            color: '#a0b078',
            textDecoration: 'none',
            '&:hover': { color: '#c0d090' },
            '&:visited': { color: '#6a7a50' }
          }
        }
      },
      MuiSvgIcon: {
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.secondary.light })
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

export default grinnealTheme
