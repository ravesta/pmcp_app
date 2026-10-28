/**
 * Tema MUI PMCP, disetel dari token visual mockup (handoff UX/UI §4): warna aksen, status, jarak, radius.
 * Mendukung tema terang dan gelap mengikuti preferensi sistem, dengan kontras sesuai WCAG 2.2 AA (NFR-05).
 */
import { createTheme } from '@mui/material/styles';

/**
 * Membuat tema aplikasi.
 * Masukan: tidak ada. Keluaran: objek tema MUI dengan variabel CSS dan skema terang/gelap.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: handoff UX/UI §4, NFR-05.
 */
export function createAppTheme() {
  return createTheme({
    cssVariables: { colorSchemeSelector: 'data-theme' },
    colorSchemes: {
      light: {
        palette: {
          primary: { main: '#1f4fbf' },
          error: { main: '#c0392b' },
          warning: { main: '#a15c00' },
          success: { main: '#17794f' },
          background: { default: '#f3f5f8', paper: '#ffffff' },
          text: { primary: '#17212b', secondary: '#566272' },
          divider: '#dbe1e8',
        },
      },
      dark: {
        palette: {
          primary: { main: '#7aa2ff' },
          error: { main: '#ff8a7e' },
          warning: { main: '#f0b35a' },
          success: { main: '#58cf9b' },
          background: { default: '#10151b', paper: '#192029' },
          text: { primary: '#e7ecf2', secondary: '#9aa7b5' },
          divider: '#2c3743',
        },
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: 14,
      // ukuran dasar 14px seperti mockup v0.2 (body{font-size:14px}); tanpa ini MUI memakai 16px
      body1: { fontSize: '0.875rem', lineHeight: 1.45 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.45 },
      caption: { fontSize: '0.75rem' },
      h1: { fontSize: '1.375rem', fontWeight: 600 },
      h2: { fontSize: '1.0625rem', fontWeight: 600 },
      h3: { fontSize: '0.9375rem', fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 500 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 36 } } },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiChip: { defaultProps: { size: 'small' } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: '1px solid var(--line)' },
          head: { fontWeight: 600, fontSize: '0.75rem', color: 'var(--muted)', backgroundColor: 'var(--soft)', whiteSpace: 'nowrap' },
        },
      },
    },
  });
}
