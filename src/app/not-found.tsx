import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { LinkButton } from '@/ui/components/link-controls';

/**
 * Halaman untuk alamat yang tidak ada: pesan jelas dan tautan kembali ke Dashboard.
 * Masukan: tidak ada. Keluaran: pesan dan tombol.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: EC-11-01.01 (pesan tidak ditemukan), handoff UX/UI §6.
 */
export default function NotFound() {
  return (
    <Box component="main" sx={{ maxWidth: 560, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="warning" role="alert">Halaman tidak ditemukan.</Alert>
      <Box><LinkButton href="/dashboard" variant="contained">Kembali ke Dashboard</LinkButton></Box>
    </Box>
  );
}
