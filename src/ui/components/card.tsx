import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

/** Properti kartu halaman. */
interface CardProps {
  readonly children: ReactNode;
  readonly sx?: SxProps<Theme>;
}

/**
 * Kartu halaman: latar permukaan, tepi tipis, sudut membulat, dan jarak antar isi seragam seperti pada mockup.
 * Masukan: isi dan gaya tambahan. Keluaran: kotak kartu.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas card dan gtool), handoff UX/UI §4.
 */
export function Card({ children, sx }: CardProps) {
  return (
    <Box
      component="section"
      sx={[{ bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, boxShadow: '0 1px 2px rgba(0,0,0,.04)', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  );
}

/** Properti kepala kartu. */
interface CardHeaderProps {
  readonly title: string;
  /** Keterangan kecil di bawah judul (mis. periode dan jumlah project). */
  readonly subtitle?: ReactNode;
  /** Kontrol di sisi kanan (tombol, pilihan tampilan). */
  readonly actions?: ReactNode;
  /** Level judul: 1 untuk judul halaman, 2 untuk bagian. */
  readonly level?: 1 | 2;
}

/**
 * Kepala kartu: judul dengan keterangan di kiri dan kontrol di kanan, membungkus pada layar sempit.
 * Masukan: judul, keterangan, kontrol, dan level judul. Keluaran: baris kepala.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas ghead), handoff UX/UI §8.
 */
export function CardHeader({ title, subtitle, actions, level = 2 }: CardHeaderProps) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box>
        <Typography variant={level === 1 ? 'h1' : 'h2'} component={level === 1 ? 'h1' : 'h2'} sx={{ fontSize: 15 }}>{title}</Typography>
        {subtitle ? <Box sx={{ color: 'var(--muted)', fontSize: 12, mt: '2px' }}>{subtitle}</Box> : null}
      </Box>
      {actions ? <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</Box> : null}
    </Box>
  );
}

/** Properti bagian bertepi di dalam kartu. */
interface SectionProps {
  readonly title: string;
  /** Keterangan kecil di bawah judul (mis. arti bagian atau periode yang dipakai). */
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** Menempelkan penanda `id` untuk tautan langsung (mis. ke tahapan). */
  readonly id?: string;
}

/**
 * Bagian bertepi di dalam kartu dengan judul kecil dan tombol opsional (Informasi project, Tahapan, Jadwal, dst.).
 * Masukan: judul, keterangan, tombol, isi, dan id. Keluaran: bagian bertepi.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas fsec), Screen [014].
 */
export function Section({ title, description, actions, children, id }: SectionProps) {
  return (
    <Box component="section" id={id} aria-label={title} sx={{ border: '1px solid var(--line)', borderRadius: '10px', p: '14px 16px', display: 'flex', flexDirection: 'column', gap: 1.5, scrollMarginTop: 16 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h3" component="h3" sx={{ fontSize: 13 }}>{title}</Typography>
          {description ? <Box sx={{ fontSize: 12, color: 'var(--muted)' }}>{description}</Box> : null}
        </Box>
        {actions}
      </Box>
      {children}
    </Box>
  );
}
