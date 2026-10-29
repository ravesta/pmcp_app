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

/** Nama bulan untuk label periode bulanan. */
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const;

/**
 * Menyusun label periode kapasitas: "Minggu ini · 26/10 - 01/11" atau "Oktober 2026 (bulan ini)".
 * Masukan: mode, pergeseran, dan rentang. Keluaran: teks label.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: mockup v0.2 (fungsi capLabel), FR-04-04 butir 3.
 */
export function capacityLabel(mode: CapacityMode, offset: number, range: { start: IsoDate; end: IsoDate }): string {
  if (mode === 'MONTH') return `${MONTHS[Number(range.start.slice(5, 7)) - 1]} ${range.start.slice(0, 4)}${offset === 0 ? ' (bulan ini)' : ''}`;
  const name = offset === 0 ? 'Minggu ini' : offset === 1 ? 'Minggu depan' : offset === -1 ? 'Minggu lalu' : 'Minggu';
  return `${name} · ${formatDisplayDate(range.start).slice(0, 5)} - ${formatDisplayDate(range.end).slice(0, 5)}`;
}

/**
 * Pemilih periode kapasitas: Minggu atau Bulan, panah sebelumnya, label periode, panah berikutnya, dan tombol
 * "Minggu ini/Bulan ini" (urutan mockup). Berbasis tautan sehingga halaman dirender server.
 * Masukan: mode, pergeseran, rentang, dan pembuat alamat. Keluaran: baris kontrol.
 * Efek samping: tidak ada (komponen murni; navigasi lewat tautan).
 * Rujukan: FR-07-05 (tampilan PIC), FR-04-04 butir 3, mockup v0.2 (fungsi capCtl).
 */
export function CapacityNav({ mode, offset, range, hrefFor }: CapacityNavProps) {
  const unit = mode === 'WEEK' ? 'Minggu' : 'Bulan';
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center' }}>
      <SegmentedLinks label="Periode kapasitas" active={mode} options={[{ key: 'WEEK', label: 'Minggu', href: hrefFor('WEEK', 0) }, { key: 'MONTH', label: 'Bulan', href: hrefFor('MONTH', 0) }]} />
      <LinkButton href={hrefFor(mode, offset - 1)} size="small" variant="outlined" aria-label="Periode sebelumnya" sx={{ minWidth: 32 }}>‹</LinkButton>
      <Box component="span" aria-live="polite" sx={{ fontWeight: 600, minWidth: 150, textAlign: 'center' }}>{capacityLabel(mode, offset, range)}</Box>
      <LinkButton href={hrefFor(mode, offset + 1)} size="small" variant="outlined" aria-label="Periode berikutnya" sx={{ minWidth: 32 }}>›</LinkButton>
      <LinkButton href={hrefFor(mode, 0)} size="small" variant="outlined">{unit} ini</LinkButton>
    </Box>
  );
}
