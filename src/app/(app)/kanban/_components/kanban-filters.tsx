import Box from '@mui/material/Box';
import type { PeriodKey } from '@/modules/kanban';
import { AutoSubmitForm } from '@/ui/components/auto-submit-form';
import { PlainDateField } from '@/ui/components/plain-date-field';
import { PlainCheckbox, PlainInput, PlainSelect } from '@/ui/components/plain-field';
import type { KanbanPageParams } from '../_lib/search-params';

/** Properti bar filter Kanban. */
interface KanbanFiltersProps {
  readonly params: KanbanPageParams;
  readonly pics: ReadonlyArray<{ id: number; name: string; stage: string }>;
  /** True bila pelaku PIC (pilihan "Saya" tersedia). */
  readonly isPic: boolean;
  /** Rentang tanggal yang sedang berlaku (mengisi Dari dan Sampai saat periode "Rentang tanggal"). */
  readonly range: { readonly start: string; readonly end: string };
}

/** Nilai parameter alamat untuk tiap periode. */
const PERIOD_PARAM: Readonly<Record<PeriodKey, string>> = { THIS_WEEK: 'minggu', LAST_WEEK: 'minggu-lalu', THIS_MONTH: 'bulan', RANGE: 'rentang' };

/**
 * Bar filter papan Kanban sebagai formulir GET (dirender server) yang langsung berlaku saat diubah, tanpa tombol
 * Terapkan: periode, PIC, jenis kartu, pencarian, dan "Hanya kartu yang memperpanjang estimasi tahapan". Isian Dari
 * dan Sampai hanya tampil untuk periode "Rentang tanggal". Seluruh keadaan ada di URL.
 * Masukan: keadaan halaman, daftar PIC, penanda PIC, dan rentang berlaku. Keluaran: bar filter.
 * Efek samping: tidak ada (komponen murni; pengiriman lewat navigasi GET oleh `AutoSubmitForm`).
 * Rujukan: FR-16-01 butir 4 dan 5, mockup v0.2 (fbar pada Kanban).
 */
export function KanbanFilters({ params, pics, isPic, range }: KanbanFiltersProps) {
  const { board } = params;
  const picOptions = [
    ...(isPic ? [{ value: 'saya', label: 'Saya' }] : []),
    { value: 'semua', label: 'Semua PIC' },
    ...pics.map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage})` })),
  ];
  return (
    <AutoSubmitForm action="/kanban" label="Filter Kanban" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', background: 'var(--soft)', borderRadius: 8 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
        <Box component="b" sx={{ fontSize: 13 }}>Filter tampilan</Box>
        <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>Pilih periode, PIC, dan jenis kartu</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 16px', alignItems: 'end' }}>
        <PlainSelect id="kanban-periode" name="periode" label="Periode" emptyLabel={null} defaultValue={PERIOD_PARAM[board.period]} options={[{ value: 'minggu', label: 'Minggu ini' }, { value: 'minggu-lalu', label: 'Minggu lalu' }, { value: 'bulan', label: 'Bulan ini' }, { value: 'rentang', label: 'Rentang tanggal' }]} />
        {board.period === 'RANGE' ? (
          <>
            <PlainDateField id="kanban-dari" name="dari" label="Dari (dd/mm/yyyy)" defaultValue={board.from ?? range.start} />
            <PlainDateField id="kanban-sampai" name="sampai" label="Sampai (dd/mm/yyyy)" defaultValue={board.to ?? range.end} />
          </>
        ) : null}
        <PlainSelect id="kanban-pic" name="pic" label="PIC" emptyLabel={null} defaultValue={params.picChoice} options={picOptions} />
        <PlainSelect id="kanban-jenis" name="jenis" label="Jenis" defaultValue={board.kind === 'PROJECT' ? 'project' : board.kind === 'ACTIVITY' ? 'activity' : ''} emptyLabel="Semua jenis" options={[{ value: 'project', label: 'Project' }, { value: 'activity', label: 'Activity (di luar project)' }]} />
        <PlainInput id="kanban-cari" name="q" label="Cari" defaultValue={board.q} placeholder="Judul, ID, atau nama project" maxLength={100} />
      </Box>
      <PlainCheckbox standalone name="perpanjang" label="Hanya kartu yang memperpanjang estimasi tahapan" defaultChecked={board.extendsOnly} />
    </AutoSubmitForm>
  );
}
