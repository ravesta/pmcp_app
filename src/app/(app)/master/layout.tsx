import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { can } from '@/modules/auth';
import { Card, CardHeader } from '@/ui/components/card';
import { recordDenied } from '../../_lib/denied-access';
import { requirePageSession } from '../../_lib/session';
import { MasterNav } from './master-nav';

/**
 * Kerangka menu Master: hanya Manager (hak dicek di server, bukan hanya disembunyikan di menu).
 * Masukan: isi sub menu. Keluaran: judul, sub menu, dan isi; PIC melihat pesan tanpa akses.
 * Efek samping: memvalidasi sesi di server.
 * Rujukan: FR-01-04 butir 4, EC-01-04.01, FR-08-06.
 */
export default async function MasterLayout({ children }: { children: ReactNode }) {
  const { actor } = await requirePageSession();
  if (!can(actor, 'master.manage')) {
    await recordDenied(actor, 'membuka menu Master');
    return <Alert severity="error" role="alert">Anda tidak memiliki akses ke halaman ini.</Alert>;
  }
  return (
    <>
      <Card>
        <CardHeader level={1} title="Master" subtitle="Pilih data master yang ingin dikelola" />
        <MasterNav />
      </Card>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
    </>
  );
}
