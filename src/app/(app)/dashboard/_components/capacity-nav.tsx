import Box from '@mui/material/Box';
import type { CapacityMode } from '@/modules/dashboard';
import { LinkButton } from '@/ui/components/link-controls';
import { SegmentedLinks } from '@/ui/components/segmented-links';
import { formatDisplayDate, type IsoDate } from '@/shared/iso-date';

/** Properti pemilih periode kapasitas. */
interface CapacityNavProps {
  readonly mode: CapacityMode;
  readonly offset: number;
  readonly range: { start: IsoDate; end: IsoDate };
  /** Pembuat alamat dengan mode dan pergeseran tertentu. */
  readonly hrefFor: (mode: CapacityMode, offset: number) => string;
}

/**
 * Pemilih periode kapasitas: Minggu atau Bulan, tombol sebelumnya dan berikutnya, dan "Minggu ini/Bulan ini", beserta
 * rentang tanggal terpilih. Berbasis tautan sehingga halaman dirender server.
 * Masukan: mode, pergeseran, rentang, dan pembuat alamat. Keluaran: baris kontrol.
 * Efek samping: tidak ada (komponen murni; navigasi lewat tautan).
 * Rujukan: FR-07-05 (tampilan PIC), FR-04-04 butir 3.
 */
export function CapacityNav({ mode, offset, range, hrefFor }: CapacityNavProps) {
  const unit = mode === 'WEEK' ? 'Minggu' : 'Bulan';
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
      <SegmentedLinks label="Periode kapasitas" active={mode} options={[{ key: 'WEEK', label: 'Minggu', href: hrefFor('WEEK', 0) }, { key: 'MONTH', label: 'Bulan', href: hrefFor('MONTH', 0) }]} />
      <LinkButton href={hrefFor(mode, offset - 1)} size="small" variant="outlined" aria-label={`${unit} sebelumnya`}>‹</LinkButton>
      <LinkButton href={hrefFor(mode, 0)} size="small" variant="outlined">{unit} ini</LinkButton>
      <LinkButton href={hrefFor(mode, offset + 1)} size="small" variant="outlined" aria-label={`${unit} berikutnya`}>›</LinkButton>
      <Box component="span" className="mono" sx={{ fontSize: 12, color: 'var(--muted)' }}>{formatDisplayDate(range.start)} - {formatDisplayDate(range.end)}</Box>
    </Box>
  );
}
