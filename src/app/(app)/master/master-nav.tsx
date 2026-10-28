'use client';

import Box from '@mui/material/Box';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Sub menu Master, satu master tampil dalam satu waktu (BL-47). */
export const MASTER_TABS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'aplikasi', label: 'Aplikasi Terdampak' },
  { slug: 'kategori-revisi', label: 'Kategori Alasan Revisi' },
  { slug: 'step', label: 'Step Tahapan' },
  { slug: 'kategori-activity', label: 'Kategori Activity' },
  { slug: 'alasan-jadwal-ulang', label: 'Alasan Jadwal Ulang' },
  { slug: 'pic', label: 'PIC' },
  { slug: 'jejak', label: 'Jejak Perubahan' },
];

/**
 * Sub menu Master berupa deretan tombol pil (satu aktif) yang membungkus pada layar sempit, seperti mockup v0.2.
 * Masukan: tidak ada. Keluaran: daftar tautan dengan penanda halaman aktif (`aria-current`).
 * Efek samping: tidak ada (navigasi lewat tautan).
 * Rujukan: FR-08-06, BL-47, mockup v0.2 (kelas pill), handoff UX/UI §4.
 */
export function MasterNav() {
  const pathname = usePathname();
  return (
    <Box component="nav" aria-label="Data master" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {MASTER_TABS.map((tab) => {
        const active = pathname === `/master/${tab.slug}`;
        return (
          <Box
            key={tab.slug}
            component={Link}
            href={`/master/${tab.slug}`}
            aria-current={active ? 'page' : undefined}
            sx={{ px: 2, minHeight: 34, display: 'inline-flex', alignItems: 'center', borderRadius: 17, border: '1px solid var(--line)', fontWeight: 500, textDecoration: 'none', color: active ? 'var(--on-accent)' : 'var(--muted)', bgcolor: active ? 'var(--accent)' : 'var(--surface)', borderColor: active ? 'var(--accent)' : 'var(--line)', '&:hover': { bgcolor: active ? 'var(--accent)' : 'var(--soft)' } }}
          >
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}
