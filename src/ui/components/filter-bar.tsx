import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { AdvancedFilters } from './advanced-filters';
import { AutoSubmitForm } from './auto-submit-form';
import { LinkButton } from './link-controls';

/** Satu filter aktif yang dapat dilepas. */
export interface ActiveFilter {
  readonly label: string;
  /** Alamat tanpa filter ini. */
  readonly removeHref: string;
}

/** Properti bar filter. */
interface FilterBarProps {
  /** Alamat tujuan formulir (GET). */
  readonly action: string;
  /** Nilai tetap yang ikut terkirim agar keadaan lain (tampilan, zoom) tidak hilang saat filter diterapkan. */
  readonly preserve?: Readonly<Record<string, string>>;
  readonly title?: string;
  readonly hint?: string;
  /** Isian utama yang selalu tampil. */
  readonly primary: ReactNode;
  /** Isian lanjutan di balik tombol "Filter lanjutan". */
  readonly advanced?: ReactNode;
  readonly advancedActiveCount?: number;
  /** Filter yang sedang aktif beserta alamat untuk melepasnya satu per satu. */
  readonly activeFilters?: ReadonlyArray<ActiveFilter>;
  /** Alamat Reset semua. */
  readonly resetHref: string;
}

/**
 * Bar filter bersama berbasis formulir GET: judul dan petunjuk, isian utama, filter lanjutan yang dapat dibuka,
 * pengiriman otomatis saat isian berubah (tanpa tombol Terapkan), serta penanda filter aktif yang dapat dilepas satu per satu atau sekaligus (Reset semua).
 * Masukan: tujuan, nilai yang dipertahankan, isian utama dan lanjutan, filter aktif, dan alamat reset. Keluaran: bar.
 * Efek samping: tidak ada (komponen murni; pengiriman lewat navigasi GET).
 * Rujukan: BL-41 (satu bar filter bersama), Screen [010] (penanda filter aktif, Reset semua), mockup v0.2 (fbar), NFR-05.
 */
export function FilterBar({ action, preserve = {}, title = 'Filter tampilan', hint = 'Berlaku untuk tampilan Daftar dan Gantt', primary, advanced, advancedActiveCount = 0, activeFilters = [], resetHref }: FilterBarProps) {
  return (
    <AutoSubmitForm action={action} label="Filter" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', background: 'var(--soft)', borderRadius: 8 }}>
      {Object.entries(preserve).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline', pr: { sm: 18 } }}>
        <Box component="b" sx={{ fontSize: 13 }}>{title}</Box>
        <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px,1.2fr) minmax(300px,1fr)' }, gap: '12px 20px', alignItems: 'end' }}>{primary}</Box>
      {advanced ? <AdvancedFilters id="filter-lanjutan" activeCount={advancedActiveCount}>{advanced}</AdvancedFilters> : null}
      {activeFilters.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'center', pt: 1.25, borderTop: '1px solid var(--line)' }}>
          <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>Filter aktif:</Box>
          {activeFilters.map((filter) => (
            <Box key={filter.label} component="span" sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'var(--run-bg)', color: 'var(--run)', borderRadius: '14px', p: '2px 4px 2px 10px', fontSize: 12 }}>
              {filter.label}
              <LinkButton href={filter.removeHref} aria-label={`Hapus filter ${filter.label}`} sx={{ minWidth: 22, minHeight: 22, p: 0, color: 'inherit', borderRadius: '50%', fontSize: 15, lineHeight: 1, textDecoration: 'none', '&:hover': { textDecoration: 'none' } }}>×</LinkButton>
            </Box>
          ))}
          <LinkButton href={resetHref} size="small">Reset semua</LinkButton>
        </Box>
      ) : null}
    </AutoSubmitForm>
  );
}
