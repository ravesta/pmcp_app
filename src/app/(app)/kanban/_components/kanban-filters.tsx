'use client';

import Box from '@mui/material/Box';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { PeriodKey } from '@/modules/kanban';
import { isIsoDate } from '@/shared/iso-date';
import { DateField } from '@/ui/components/date-field';
import { PlainCheckbox, PlainInput, PlainSelect } from '@/ui/components/plain-field';
import type { KanbanPageParams } from '../_lib/search-params';

/** Properti bar filter Kanban. */
interface KanbanFiltersProps {
  readonly params: KanbanPageParams;
  readonly pics: ReadonlyArray<{ id: number; name: string; stage: string; isActive: boolean }>;
  /** True bila pelaku PIC (pilihan "Saya" tersedia). */
  readonly isPic: boolean;
}

/** Nilai parameter alamat untuk tiap periode. */
const PERIOD_PARAM: Readonly<Record<PeriodKey, string>> = { THIS_WEEK: 'minggu', LAST_WEEK: 'minggu-lalu', THIS_MONTH: 'bulan', RANGE: 'rentang' };

/** Jeda (ms) setelah pengetikan terakhir sebelum filter diterapkan. */
const TYPING_DELAY_MS = 400;

/**
 * Bar filter papan Kanban seperti mockup v0.2: perubahan langsung berlaku tanpa tombol Terapkan. Keadaan tetap berada di URL,
 * sehingga papan dirender server dan tahan tombol kembali. Isian Dari/Sampai hanya muncul pada periode "Rentang tanggal".
 * Masukan: keadaan halaman, daftar PIC, dan penanda PIC. Keluaran: bar filter.
 * Efek samping: mengganti alamat halaman (`router.replace`) setiap kali filter berubah; pengetikan ditunda sebentar.
 * Rujukan: FR-16-01 butir 4 dan 5, mockup v0.2 (fbar pada Kanban).
 */
export function KanbanFilters({ params, pics, isPic }: KanbanFiltersProps) {
  const { board } = params;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState<string>(PERIOD_PARAM[board.period]);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * Menerapkan isi formulir ke alamat halaman: parameter kosong dibuang, dan Dari/Sampai hanya dikirim pada periode rentang.
   * Masukan: tidak ada. Keluaran: tidak ada.
   * Efek samping: `router.replace` ke `/kanban` dengan parameter baru (tanpa menggulir ke atas).
   * Rujukan: FR-16-01.
   */
  function apply() {
    const form = formRef.current;
    if (!form) return;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim() !== '') query.set(key, value.trim());
    }
    if (query.get('periode') !== 'rentang') {
      query.delete('dari');
      query.delete('sampai');
    }
    startTransition(() => router.replace(query.size > 0 ? `/kanban?${query}` : '/kanban', { scroll: false }));
  }

  /**
   * Menjadwalkan penerapan filter setelah jeda pengetikan (atau segera bila `immediate`).
   * Masukan: penanda segera. Keluaran: tidak ada.
   * Efek samping: mengatur ulang pewaktu penerapan.
   * Rujukan: mockup v0.2 (pencarian langsung).
   */
  function schedule(immediate: boolean) {
    if (timer.current) clearTimeout(timer.current);
    if (immediate) apply();
    else timer.current = setTimeout(apply, TYPING_DELAY_MS);
  }

  /**
   * Menanggapi perubahan isian: pencarian ditunda, isian lain langsung diterapkan.
   * Masukan: peristiwa perubahan dari formulir. Keluaran: tidak ada.
   * Efek samping: memperbarui keadaan periode bila isian periode berubah, lalu menjadwalkan penerapan.
   * Rujukan: FR-16-01.
   */
  function handleChange(event: React.FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLInputElement;
    if (target.name === 'periode') setPeriod(target.value);
    if (target.name === 'periode' && target.value === 'rentang') return; // tunggu tanggal diisi
    schedule(target.name !== 'q');
  }

  /**
   * Menanggapi perubahan isian tanggal: diterapkan hanya bila kosong atau berupa tanggal valid.
   * Masukan: nilai terkirim (`YYYY-MM-DD`, teks mentah, atau kosong). Keluaran: tidak ada.
   * Efek samping: menjadwalkan penerapan filter.
   * Rujukan: FR-16-01, EC-21-05.03.
   */
  function handleDate(value: string) {
    if (value === '' || isIsoDate(value)) schedule(false);
  }

  const picOptions = [
    ...(isPic ? [{ value: 'saya', label: 'Saya' }] : []),
    { value: 'semua', label: 'Semua PIC' },
    ...pics
      .filter((pic) => pic.stage !== 'DEV') // PIC Development tidak punya akun dan kartu
      .map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage})${pic.isActive ? '' : ' - nonaktif'}` })),
  ];
  return (
    <Box
      component="form"
      ref={formRef}
      method="get"
      action="/kanban"
      role="search"
      aria-label="Filter Kanban"
      aria-busy={pending}
      onChange={handleChange}
      onSubmit={(event) => { event.preventDefault(); schedule(true); }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: '12px 14px', bgcolor: 'var(--soft)', borderRadius: '8px' }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
        <Box component="b" sx={{ fontSize: 13 }}>Filter tampilan</Box>
        <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>Pilih periode, PIC, dan jenis kartu</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 16px', alignItems: 'end' }}>
        <PlainSelect id="kanban-periode" name="periode" label="Periode" emptyLabel={null} defaultValue={PERIOD_PARAM[board.period]} options={[{ value: 'minggu', label: 'Minggu ini' }, { value: 'minggu-lalu', label: 'Minggu lalu' }, { value: 'bulan', label: 'Bulan ini' }, { value: 'rentang', label: 'Rentang tanggal' }]} />
        {period === 'rentang' ? (
          <>
            <DateField name="dari" label="Dari (dd/mm/yyyy)" defaultValue={board.from} onValueChange={handleDate} />
            <DateField name="sampai" label="Sampai (dd/mm/yyyy)" defaultValue={board.to} onValueChange={handleDate} />
          </>
        ) : null}
        <PlainSelect id="kanban-pic" name="pic" label="PIC" emptyLabel={null} defaultValue={params.picChoice} options={picOptions} />
        <PlainSelect id="kanban-jenis" name="jenis" label="Jenis" defaultValue={board.kind === 'PROJECT' ? 'project' : board.kind === 'ACTIVITY' ? 'activity' : ''} emptyLabel="Semua jenis" options={[{ value: 'project', label: 'Project' }, { value: 'activity', label: 'Activity (di luar project)' }]} />
        <PlainInput id="kanban-cari" name="q" label="Cari" defaultValue={board.q} placeholder="Judul, ID, atau nama project" maxLength={100} />
      </Box>
      <PlainCheckbox name="perpanjang" label="Hanya kartu yang memperpanjang estimasi tahapan" defaultChecked={board.extendsOnly} inline />
      <noscript><button type="submit">Terapkan</button></noscript>
    </Box>
  );
}
