import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { can } from '@/modules/auth';
import { AppHeader, type NavItem } from '@/ui/components/app-header';
import { logoutAction } from '../ubah-password/actions';
import { requirePageSession } from '../_lib/session';

/** Semua halaman ber-sesi bersifat dinamis dan tidak boleh di-cache. */
export const dynamic = 'force-dynamic';

/**
 * Kerangka halaman ber-sesi: memastikan ada sesi (dan bukan akun wajib ganti password), lalu menampilkan header
 * dengan menu sesuai peran. Menu hanya memuat layar yang sudah tersedia (Dashboard, Project, Kanban, Riwayat, Master); menu lain ditambahkan pada irisan berikutnya.
 * Masukan: isi halaman. Keluaran: kerangka dengan header.
 * Efek samping: memvalidasi sesi di server pada setiap permintaan (bukan hanya di middleware, TD-10).
 * Rujukan: FR-01-04, Screen [025].
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { actor } = await requirePageSession();
  const items: NavItem[] = [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Project', href: '/project' }, { label: 'Kanban', href: '/kanban' }, { label: 'Riwayat', href: '/riwayat' }];
  if (can(actor, 'master.manage')) items.push({ label: 'Master', href: '/master' });
  const roleLabel = actor.role === 'MANAGER' ? 'Head of BA dan Head QA' : `PIC ${actor.picStage === 'QA' ? 'Quality Assurance' : 'Business Analyst'}`;
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppHeader items={items} userName={actor.label} roleLabel={roleLabel} logoutAction={logoutAction} />
      <Box component="main" sx={{ maxWidth: 1100, mx: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
    </Box>
  );
}
