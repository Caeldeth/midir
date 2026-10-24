import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { filledControls } from './filledControls'
import { midirOverrides } from './midirOverrides'
import { baseTypography } from './baseTypography'

const danaanTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      // MUI picks a status label (a filled chip or alert) by this ratio. Its
      // default, 3, takes white on #ff0000 at 4.00:1; labels are text, so 4.5.
      contrastThreshold: 4.5,
      // The accent is text on the parchment too (text buttons, links), so 4.5:1 on
      // the page and on paper (HTOO-572): 4.53:1 and 4.91:1. The label is the
      // parchment, 4.53:1; the old dark label was 3.4:1 on this gold. A filled
      // button hovers DARKER, to `dark`, under its light label (5.94:1).
      // `light` cannot read as text on the parchment: it is lighter than `main`.
      primary: {
        main: '#80651d',
        light: '#e8c060',
        dark: '#6a5418',
        contrastText: '#f5e8c0'
      },
      // The bar: a dark bronze with the parchment as its text (7.74:1), keylined
      // like the other decorated bars (Sabrael, 2026-10-23). The gold bar's dark
      // text needed an engrave of its own.
      secondary: {
        main: '#5a4210',
        light: '#f0d070',
        dark: '#3a2810',
        contrastText: '#f5e8c0'
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
        scrollbarLight: '#80651d'
      },
      text: {
        primary: '#2a1e08',
        secondary: '#4a3c20',
        disabled: '#6a5840',
        headline: '#846314',
        link: '#7a5e18',
        linkHover: '#80651d',
        visited: '#4a3c20',
        button: '#2a1e08',
        dark: '#1a1008'
      },
      divider: 'rgba(122,94,24,0.38)',
      // Status colours are text on the page as well as fills (outlined chips,
      // text buttons), so each reads 4.5:1 on the page and on paper (HTOO-572).
      error: { main: '#d40000' },
      warning: { main: '#6c6c00' },
      info: { main: '#357179' },
      success: { main: '#1b7926' }
    },

    typography: baseTypography,

    shape: { borderRadius: 2 },

    components: {
      ...filledControls,
      ...midirOverrides,
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: 'rgba(250,242,220,0.94)',
            border: '1px solid rgba(122,94,24,0.55)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #80651d, 2px 2px 0 0 #80651d'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #80651d',
            color: '#7a5e18',
            '&:hover': { backgroundColor: 'rgba(128,101,29,0.12)', borderColor: '#e8c060' }
          },
          contained: {
            backgroundColor: '#80651d',
            // The root's gold text is for text and outlined buttons. A filled one
            // takes the palette's contrastText, and hovers darker, to primary.dark
            // (5.94:1), under its light label.
            color: '#f5e8c0',
            '&:hover': { backgroundColor: '#6a5418' },
            // color="inherit" is not the accent: the plain tint, with the text
            // colour around it. The accent fill drew it at 2.95:1.
            '&.MuiButton-colorInherit': {
              backgroundColor: 'rgba(128,101,29,0.22)',
              color: 'inherit'
            }
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
              backgroundColor: 'rgba(128,101,29,0.15)',
              borderLeft: '2px solid #80651d',
              color: '#7a5e18'
            },
            '&:hover': { backgroundColor: 'rgba(128,101,29,0.1)', paddingLeft: '20px' }
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
            '&:hover': { borderColor: '#80651d' }
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
              backgroundColor: 'rgba(128,101,29,0.22)',
              // 4.60:1 on the tint over the page; #7a5e18 was 4.02:1.
              color: '#6a5215'
            },
            // A selected chip (color="primary", filled) takes the accent and its
            // label, as MUI's own fill does, and keeps the accent on hover.
            '&.MuiChip-filled.MuiChip-colorPrimary': {
              backgroundColor: '#80651d',
              color: '#f5e8c0',
              borderColor: '#80651d',
              '&.MuiChip-clickable:hover': { backgroundColor: '#80651d' }
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
            border: '1px solid #80651d',
            '&:hover': { backgroundColor: '#e8c060', borderColor: '#f0d070' },
            '&.Mui-selected': {
              backgroundColor: '#80651d',
              borderColor: '#e8c060',
              color: '#f5e8c0'
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
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#80651d' } } },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#80651d' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(128,101,29,0.5)',
            '&.Mui-checked': { color: '#80651d' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.45)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,94,24,0.70)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#80651d' }
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
            '&:hover': { color: '#80651d' },
            '&:visited': { color: '#4a3c20' }
          }
        }
      },
      MuiSvgIcon: {
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.primary.main })
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
