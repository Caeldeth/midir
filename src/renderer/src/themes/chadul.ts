import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { baseTypography } from './baseTypography'

const chadulTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#4a2870',
        light: '#7a5a9a',
        dark: '#2e1a4a',
        contrastText: '#ede4f5'
      },
      secondary: {
        main: '#2e7a3a',
        light: '#4ab858',
        dark: '#1a4a22',
        contrastText: '#c7f5bf'
      },
      background: {
        default: '#020804',
        gray: '#020804',
        paper: 'rgba(4,14,6,0.90)',
        paperMedium: 'rgba(4,12,5,0.93)',
        paperLight: 'rgba(6,20,8,0.80)',
        paperDark: 'rgba(2,8,4,0.97)',
        tableLight: 'rgba(5,16,7,0.70)',
        tableDark: 'rgba(3,10,5,0.85)',
        tableBorderL: 'rgba(154,122,208,0.18)',
        tableBorderD: 'rgba(154,122,208,0.32)',
        scrollbarDark: '#1a4a22',
        scrollbarLight: '#2e7a3a'
      },
      text: {
        primary: '#e0d8ea',
        secondary: '#c0a8d8',
        disabled: '#c0a8d8',
        headline: '#a8d8a0',
        link: '#c0a0e8',
        linkHover: '#d4b8f0',
        visited: '#4a2870',
        button: '#a8d8a0',
        dark: '#020804'
      },
      divider: 'rgba(46,122,58,0.28)',
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
            backgroundColor: 'rgba(4,14,6,0.90)',
            border: '1px solid rgba(154,122,208,0.45)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #4a2870, 2px 2px 0 0 #4a2870'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #7a5a9a',
            color: '#c0a0e8',
            '&:hover': {
              backgroundColor: 'rgba(154,122,208,0.15)',
              borderColor: '#b89ad8',
              boxShadow: '0 0 10px rgba(154,122,208,0.45)'
            }
          },
          contained: {
            backgroundColor: 'rgba(46,122,58,0.25)',
            color: '#a8d8a0',
            '&:hover': { backgroundColor: 'rgba(46,122,58,0.4)' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(2,8,4,0.97)',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(46,122,58,0.25)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: 'rgba(4,14,6,0.95)',
            borderRight: '1px solid rgba(46,122,58,0.32)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
            color: '#6a9870',
            borderBottom: '1px solid rgba(154,122,208,0.10)',
            '&.Mui-selected': {
              backgroundColor: 'rgba(74,40,112,0.22)',
              borderLeft: '2px solid #9a7ad0',
              color: '#d4b8f0'
            },
            '&:hover': { backgroundColor: 'rgba(74,40,112,0.14)', paddingLeft: '20px' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(6,18,8,0.94)',
            border: '1px solid rgba(154,122,208,0.22)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&:hover': {
              borderColor: '#9a7ad0',
              boxShadow: '0 4px 20px rgba(154,122,208,0.28)'
            }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(154,122,208,0.22)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            backgroundColor: 'rgba(74,40,112,0.22)',
            color: '#c0a0e8',
            border: '1px solid rgba(154,122,208,0.4)'
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
            backgroundColor: '#2e1a4a',
            color: '#a8d8a0',
            border: '1px solid #2e7a3a',
            '&:hover': { backgroundColor: '#4a2870', borderColor: '#4ab858' },
            '&.Mui-selected': {
              backgroundColor: '#2e7a3a',
              borderColor: '#4ab858',
              color: '#a8d8a0'
            },
            '&.Mui-disabled': {
              backgroundColor: 'rgba(46,26,74,0.3)',
              color: 'rgba(168,216,160,0.4)'
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
            color: '#3a5840',
            '&.Mui-selected': { color: '#4ab858' }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#2e7a3a' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#2e7a3a' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(46,122,58,0.5)',
            '&.Mui-checked': { color: '#2e7a3a' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(46,122,58,0.3)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(46,122,58,0.6)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#2e7a3a' }
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
            color: '#c0a0e8',
            textDecoration: 'none',
            '&:hover': { color: '#d4b8f0' },
            '&:visited': { color: '#7a5a9a' }
          }
        }
      },
      MuiSvgIcon: {
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.primary.light })
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

export default chadulTheme
