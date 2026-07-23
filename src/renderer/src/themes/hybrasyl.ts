import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { baseTypography } from './baseTypography'

const hybrasylTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#0d182f',
        light: '#4d84d1',
        dark: '#2a4a6e',
        contrastText: '#f0e6cc'
      },
      secondary: {
        main: '#1e5e56',
        light: '#3a9e90',
        dark: '#5ecfbe',
        contrastText: '#f0e6cc'
      },
      background: {
        default: '#0d182f',
        gray: '#0d182f',
        paper: 'rgba(6,12,18,0.82)',
        paperMedium: 'rgba(4,9,14,0.90)',
        paperLight: 'rgba(12,22,34,0.70)',
        paperDark: 'rgba(2,5,10,0.95)',
        tableLight: 'rgba(13,24,47,0.60)',
        tableDark: 'rgba(6,12,24,0.75)',
        tableBorderL: 'rgba(58,158,144,0.15)',
        tableBorderD: 'rgba(58,158,144,0.30)',
        scrollbarDark: '#1e5e56',
        scrollbarLight: '#3a9e90'
      },
      text: {
        primary: '#f0e6cc',
        secondary: '#a8b8c4',
        disabled: '#a8b8c4',
        headline: '#f0e6cc',
        link: '#60ebd8',
        linkHover: '#5ecfbe',
        visited: '#399086',
        button: '#f0e6cc',
        dark: '#0c1018'
      },
      divider: 'rgba(58,158,144,0.22)',
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
            backgroundColor: 'rgba(6,12,18,0.82)',
            border: '1px solid rgba(58,158,144,0.32)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #1e5e56, 2px 2px 0 0 #1e5e56'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #3a9e90',
            color: '#5ecfbe',
            '&:hover': { backgroundColor: 'rgba(58,158,144,0.15)', borderColor: '#5ecfbe' }
          },
          contained: {
            backgroundColor: 'rgba(58,158,144,0.2)',
            '&:hover': { backgroundColor: 'rgba(58,158,144,0.35)' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(4,8,14,0.97)',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(58,158,144,0.22)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: 'rgba(6,12,18,0.92)',
            borderRight: '1px solid rgba(58,158,144,0.32)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            color: '#a8b8c4',
            borderBottom: '1px solid rgba(58,158,144,0.08)',
            '&.Mui-selected': {
              backgroundColor: 'rgba(58,158,144,0.12)',
              borderLeft: '2px solid #3a9e90',
              color: '#5ecfbe'
            },
            '&:hover': { backgroundColor: 'rgba(58,158,144,0.08)', paddingLeft: '20px' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(10,18,26,0.92)',
            border: '1px solid rgba(58,158,144,0.16)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s',
            '&:hover': { borderColor: '#3a9e90' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(58,158,144,0.15)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            backgroundColor: 'rgba(58,158,144,0.14)',
            color: '#3a9e90',
            border: '1px solid rgba(58,158,144,0.3)'
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
            backgroundColor: '#1e5e56',
            color: '#f0e6cc',
            border: '1px solid #3a9e90',
            '&:hover': { backgroundColor: '#3a9e90', borderColor: '#5ecfbe' },
            '&.Mui-selected': {
              backgroundColor: '#3a9e90',
              borderColor: '#5ecfbe',
              color: '#f0e6cc'
            },
            '&.Mui-disabled': {
              backgroundColor: 'rgba(30,94,86,0.3)',
              color: 'rgba(240,230,204,0.4)'
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
            color: '#506070',
            '&.Mui-selected': { color: '#5ecfbe' }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#3a9e90' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#3a9e90' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(58,158,144,0.5)',
            '&.Mui-checked': { color: '#3a9e90' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(58,158,144,0.3)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(58,158,144,0.6)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3a9e90' }
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
            color: '#3a9e90',
            textDecoration: 'none',
            '&:hover': { color: '#5ecfbe' },
            '&:visited': { color: '#1e5e56' }
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

export default hybrasylTheme
