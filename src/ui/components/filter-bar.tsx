'use client';

import Box from '@mui/material/Box';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition, type ReactNode } from 'react';
import { AdvancedFilters } from './advanced-filters';
import { LinkButton } from './link-controls';
import { MULTI_SELECT_CHANGE_EVENT } from './multi-select-field';

/** Jeda (ms) setelah pengetikan terakhir sebelum filter diterapkan. */
const TYPING_DELAY_MS = 400;

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
 * Bar filter bersama seperti mockup v0.2: judul dan petunjuk, isian utama, filter lanjutan yang dapat dibuka, serta penanda
 * filter aktif yang dapat dilepas satu per satu atau sekaligus (Reset semua). Perubahan isian langsung berlaku (pencarian
 * ditunda sebentar) tanpa tombol Terapkan; keadaan tetap berada di URL sehingga halaman dirender server.
 * Masukan: tujuan, nilai yang dipertahankan, isian utama dan lanjutan, filter aktif, dan alamat reset. Keluaran: bar.
 * Efek samping: mengganti alamat halaman (`router.replace`) setiap kali isian bernama berubah; halaman kembali ke nomor 1.
 * Rujukan: BL-41 (satu bar filter bersama), Screen [010] (penanda filter aktif, Reset semua), mockup v0.2 (fbar), NFR-05.
 */
export function FilterBar({ action, preserve = {}, title = 'Filter tampilan', hint = 'Berlaku untuk tampilan Daftar dan Gantt', primary, advanced, advancedActiveCount = 0, activeFilters = [], resetHref }: FilterBarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Menerapkan isi formulir ke alamat: parameter milik formulir diganti, parameter lain (mis. status project) dipertahankan,
   * isian kosong dibuang, dan nomor halaman direset.
   * Masukan: tidak ada. Keluaran: tidak ada.
   * Efek samping: `router.replace` ke alamat baru tanpa menggulir ke atas.
   * Rujukan: BL-41, FR-10-01.
   */
  function apply() {
    const form = formRef.current;
    if (!form) return;
    const query = new URLSearchParams(window.location.search);
    for (const element of Array.from(form.elements)) {
      const name = (element as HTMLInputElement).name;
      if (name) query.delete(name);
    }
    query.delete('hal');
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim() !== '') query.append(key, value.trim());
    }
    const text = query.toString();
    startTransition(() => router.replace(text ? `${action}?${text}` : action, { scroll: false }));
  }

  /**
   * Menjadwalkan penerapan filter, segera atau setelah jeda pengetikan.
   * Masukan: penanda segera. Keluaran: tidak ada.
   * Efek samping: mengatur ulang pewaktu.
   * Rujukan: mockup v0.2 (pencarian langsung).
   */
  function schedule(immediate: boolean) {
    if (timer.current) clearTimeout(timer.current);
    if (immediate) apply();
    else timer.current = setTimeout(apply, TYPING_DELAY_MS);
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form) return undefined;
    const onMultiSelect = () => schedule(true);
    form.addEventListener(MULTI_SELECT_CHANGE_EVENT, onMultiSelect);
    return () => {
      form.removeEventListener(MULTI_SELECT_CHANGE_EVENT, onMultiSelect);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply dan schedule hanya memakai ref dan router yang stabil
  }, []);

  /**
   * Menanggapi perubahan isian bernama: pencarian teks ditunda, isian lain langsung diterapkan. Isian tanpa nama
   * (mis. dropdown periode yang mengubah URL sendiri) diabaikan.
   * Masukan: peristiwa perubahan formulir. Keluaran: tidak ada.
   * Efek samping: menjadwalkan penerapan filter.
   * Rujukan: BL-41.
   */
  function handleChange(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    if (!target.name) return;
    schedule(target.type !== 'search' && target.type !== 'text');
  }

  return (
    <Box
      component="form"
      ref={formRef}
      method="get"
      action={action}
      role="search"
      aria-label="Filter"
      aria-busy={pending}
      onChange={handleChange}
      onSubmit={(event: React.FormEvent) => { event.preventDefault(); schedule(true); }}
      sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1.5, p: '12px 14px', bgcolor: 'var(--soft)', borderRadius: '8px' }}
    >
      {Object.entries(preserve).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline', pr: { sm: 18 } }}>
        <Box component="b" sx={{ fontSize: 13 }}>{title}</Box>
        <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px,1.2fr) minmax(300px,1fr)' }, gap: '12px 20px', alignItems: 'end' }}>{primary}</Box>
      {advanced ? <AdvancedFilters id="filter-lanjutan" activeCount={advancedActiveCount}>{advanced}</AdvancedFilters> : null}
      <noscript><button type="submit">Terapkan</button></noscript>
      {activeFilters.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'center', pt: 1.25, borderTop: '1px solid var(--line)' }}>
          <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>Filter aktif:</Box>
          {activeFilters.map((filter) => (
            <Box key={filter.label} component="span" sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: 'var(--run-bg)', color: 'var(--run)', borderRadius: '14px', p: '2px 4px 2px 10px', fontSize: 12 }}>
              {filter.label}
              <LinkButton href={filter.removeHref} aria-label={`Hapus filter ${filter.label}`} sx={{ minWidth: 22, minHeight: 22, p: 0, color: 'inherit', borderRadius: '50%', fontSize: 15, lineHeight: 1 }}>×</LinkButton>
            </Box>
          ))}
          <LinkButton href={resetHref} size="small">Reset semua</LinkButton>
        </Box>
      ) : null}
    </Box>
  );
}
