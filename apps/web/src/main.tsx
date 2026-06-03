import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import './index.css'
import App from './App.tsx'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#8ab4ff',
    },
    secondary: {
      main: '#78d786',
    },
    error: {
      main: '#ff6f6f',
    },
    warning: {
      main: '#d8b54c',
    },
    background: {
      default: '#0f0f1a',
      paper: '#151525',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#9a9ab2',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Segoe UI", system-ui, sans-serif',
    button: {
      fontWeight: 700,
      textTransform: 'none',
    },
  },
  shape: {
    borderRadius: 4,
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small',
        variant: 'outlined',
      },
      styleOverrides: {
        root: {
          minHeight: 30,
        },
      },
    },
    MuiFormControl: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: 12,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: 12,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          minHeight: 30,
          padding: '4px 10px',
          color: '#9a9ab2',
          borderColor: '#2f2f55',
          '&.Mui-selected': {
            backgroundColor: '#25254a',
            color: '#ffffff',
          },
          '&.Mui-selected:hover': {
            backgroundColor: '#2d2d5b',
          },
        },
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
