import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { baseTypography } from './baseTypography'
import { midirOverrides } from './midirOverrides'

const danaanTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      // HTOO-355: an older gold. The old #b8922a was 2.39:1 on the parchment; this is
      // 3.13:1 on the page, 3.43:1 on paper, and the label is 4.89:1 on it.
      // `light` is lighter than `main` again (HTOO-572): a filled button hovers
      // to it under its dark label (10.82:1). Text and selection marks on the
      // parchment use `main`, which the palette test holds at 3:1.
      primary: {
        main: '#9f7e24',
        light: '#e8c060',
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
        scrollbarLight: '#9f7e24'
      },
      text: {
        primary: '#2a1e08',
        secondary: '#4a3c20',
        disabled: '#6a5840',
        headline: '#b88a1c',
        link: '#7a5e18',
        linkHover: '#9f7e24',
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
      ...midirOverrides,
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: 'rgba(250,242,220,0.94)',
            border: '1px solid rgba(122,94,24,0.55)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #9f7e24, 2px 2px 0 0 #9f7e24'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #9f7e24',
            color: '#7a5e18',
            '&:hover': { backgroundColor: 'rgba(159,126,36,0.12)', borderColor: '#e8c060' }
          },
          contained: {
            backgroundColor: '#9f7e24',
            // The palette's contrastText (4.89:1); the cream was 2.76:1. The hover
            // goes LIGHTER, to primary.light, so the dark label keeps its contrast.
            color: '#1a1008',
            '&:hover': { backgroundColor: '#e8c060' }
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
              backgroundColor: 'rgba(159,126,36,0.15)',
              borderLeft: '2px solid #9f7e24',
              color: '#7a5e18'
            },
            '&:hover': { backgroundColor: 'rgba(159,126,36,0.1)', paddingLeft: '20px' }
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
            '&:hover': { borderColor: '#9f7e24' }
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
            border: '1px solid rgba(122,94,24,0.50)',
            // The tint is for a plain chip only. On `root` it beat MUI's own fill
            // for every colour, so a warning or a selected chip looked plain
            // (HTOO-572).
            '&.MuiChip-colorDefault': {
              backgroundColor: 'rgba(159,126,36,0.22)',
              color: '#7a5e18'
            },
            // A selected chip (color="primary", filled) takes the accent and its
            // label, as MUI's own fill does, and keeps the accent on hover.
            '&.MuiChip-filled.MuiChip-colorPrimary': {
              backgroundColor: '#9f7e24',
              color: '#1a1008',
              borderColor: '#9f7e24',
              '&.MuiChip-clickable:hover': { backgroundColor: '#9f7e24' }
            }
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
            border: '1px solid #9f7e24',
            '&:hover': { backgroundColor: '#e8c060', borderColor: '#f0d070' },
            '&.Mui-selected': {
              backgroundColor: '#9f7e24',
              borderColor: '#e8c060',
              color: '#1a1008'
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
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#9f7e24' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#9f7e24' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(159,126,36,0.5)',
            '&.Mui-checked': { color: '#9f7e24' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.45)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.70)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#9f7e24' }
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
            '&:hover': { color: '#9f7e24' },
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
