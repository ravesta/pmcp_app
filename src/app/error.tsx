'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

/**
 * Batas galat untuk semua halaman: bila memuat atau menampilkan layar gagal (mis. koneksi ke server atau database
 * terputus), menampilkan pesan gagal memuat dengan tombol "Coba lagi" dan tidak menampilkan data sebagian.
 * Masukan: galat dan fungsi mencoba ulang dari Next.js. Keluaran: pesan dan tombol.
 * Efek samping: tombol memanggil `reset` untuk merender ulang segmen.
 * Rujukan: EC-15-01.01, handoff UX/UI §6 (keadaan galat).
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Box component="main" sx={{ maxWidth: 560, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="error" role="alert">
        Gagal memuat halaman. Periksa koneksi Anda lalu coba lagi.
        {error.digest ? <Box component="span" sx={{ display: 'block', fontSize: 12, mt: 0.5 }}>Kode galat: {error.digest}</Box> : null}
      </Alert>
      <Box><Button variant="contained" onClick={reset}>Coba lagi</Button></Box>
    </Box>
  );
}
