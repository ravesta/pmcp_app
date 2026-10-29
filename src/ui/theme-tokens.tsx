'use client';

import GlobalStyles from '@mui/material/GlobalStyles';

/** Token warna terang, sama dengan variabel CSS pada mockup v0.2 (acuan visual UX/UI). */
const LIGHT = {
  '--bg': '#f3f5f8', '--surface': '#fff', '--ink': '#17212b', '--muted': '#566272', '--line': '#dbe1e8', '--soft': '#eaeef3',
  '--accent': '#1f4fbf', '--on-accent': '#fff',
  '--ba': '#2f6fd0', '--dev': '#b36b00', '--qa': '#16825f',
  '--late': '#c0392b', '--late-bg': '#fbe9e6', '--warn': '#a15c00', '--warn-bg': '#fdf1dc', '--ok': '#17794f', '--ok-bg': '#e1f3ea',
  '--run-bg': '#e3ecfb', '--run': '#1f4fbf', '--today': '#c2185b', '--hold': '#6b4fb8', '--hold-bg': '#ece7f8',
  '--bk': '#5b6776', '--bk-bg': '#e8ebf0', '--cancel': '#8a3535', '--cancel-bg': '#f2e2e2',
  '--mono': '"IBM Plex Mono", ui-monospace, Consolas, monospace',
} as const;

/** Token warna gelap, sama dengan mockup v0.2. */
const DARK = {
  '--bg': '#10151b', '--surface': '#192029', '--ink': '#e7ecf2', '--muted': '#9aa7b5', '--line': '#2c3743', '--soft': '#222b35',
  '--accent': '#7aa2ff', '--on-accent': '#0b1220', '--ba': '#6a9bf0', '--dev': '#e3a548', '--qa': '#4cc3a0',
  '--late': '#ff8a7e', '--late-bg': '#3a1f1c', '--warn': '#f0b35a', '--warn-bg': '#3a2c12', '--ok': '#58cf9b', '--ok-bg': '#12301f',
  '--run-bg': '#1d2a45', '--run': '#9db9ff', '--today': '#ff6fa5', '--hold': '#b9a4f0', '--hold-bg': '#2a2147',
  '--bk': '#a9b4c2', '--bk-bg': '#2a323c', '--cancel': '#e49a9a', '--cancel-bg': '#3a2224',
} as const;

/**
 * Menyuntikkan token warna mockup (variabel CSS) untuk tema terang dan gelap, mengikuti pilihan tema sistem atau
 * atribut `data-theme`. Tautan: `a` memakai warna aksen dan `a.pn` dipakai nama project. Komponen layar memakai variabel ini (mis. `var(--ba)`) agar warna status, tahapan, dan Gantt
 * sama dengan mockup yang disetujui.
 * Masukan: tidak ada. Keluaran: gaya global.
 * Efek samping: menambahkan aturan CSS global saat dirender.
 * Rujukan: handoff UX/UI §4 (token warna mengikuti variabel CSS mockup), NFR-05 (kontras terang dan gelap).
 */
export function ThemeTokens() {
  return (
    <GlobalStyles
      styles={{
        ':root': LIGHT,
        '@media (prefers-color-scheme: dark)': { ':root:not([data-theme="light"])': DARK },
        ':root[data-theme="dark"]': DARK,
        '.mono': { fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums' },
        // Tautan biasa mengikuti `.lnk` mockup (warna aksen, bergaris bawah); nama project (`a.pn`) tegas tanpa garis bawah.
        a: { color: 'var(--accent)' },
        'a.pn': { color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' },
        'a.pn:hover': { color: 'var(--accent)', textDecoration: 'underline' },
      }}
    />
  );
}
