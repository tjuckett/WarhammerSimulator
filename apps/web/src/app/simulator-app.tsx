'use client';

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from '../App';

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
      default: '#071017',
      paper: '#0d1b26',
    },
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 700,
        },
      },
    },
  },
});

export default function SimulatorApp() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}
