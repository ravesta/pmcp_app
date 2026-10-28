import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { PeriodKey } from '@/modules/kanban';
import { DateField } from '@/ui/components/date-field';
import { LinkButton } from '@/ui/components/link-controls';
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

/**
 * Bar filter papan Kanban sebagai formulir GET (dirender server): periode (dengan rentang bebas), PIC, jenis kartu,
 * pencarian, dan "Hanya kartu yang memperpanjang estimasi tahapan". Seluruh keadaan ada di URL.
 * Masukan: keadaan halaman, daftar PIC, dan penanda PIC. Keluaran: bar filter.
 * Efek samping: tidak ada (komponen murni; pengiriman lewat navigasi GET).
 * Rujukan: FR-16-01 butir 4 dan 5, mockup v0.2 (fbar pada Kanban).
 */
export function KanbanFilters({ params, pics, isPic }: KanbanFiltersProps) {
  const { board } = params;
  const picOptions = [
    ...(isPic ? [{ value: 'saya', label: 'Saya' }] : []),
    { value: 'semua', label: 'Semua PIC' },
    ...pics.map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage})${pic.isActive ? '' : ' - nonaktif'}` })),
  ];
  return (
    <Box component="form" method="get" action="/kanban" role="search" aria-label="Filter Kanban" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: '12px 14px', bgcolor: 'var(--soft)', borderRadius: '8px' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
        <Box component="b" sx={{ fontSize: 13 }}>Filter tampilan</Box>
        <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)' }}>Pilih periode, PIC, dan jenis kartu</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: '12px 16px', alignItems: 'end' }}>
        <PlainSelect id="kanban-periode" name="periode" label="Periode" emptyLabel={null} defaultValue={PERIOD_PARAM[board.period]} options={[{ value: 'minggu', label: 'Minggu ini' }, { value: 'minggu-lalu', label: 'Minggu lalu' }, { value: 'bulan', label: 'Bulan ini' }, { value: 'rentang', label: 'Rentang tanggal' }]} />
        <DateField name="dari" label="Dari (bila rentang tanggal)" defaultValue={board.from} />
        <DateField name="sampai" label="Sampai (bila rentang tanggal)" defaultValue={board.to} />
        <PlainSelect id="kanban-pic" name="pic" label="PIC" emptyLabel={null} defaultValue={params.picChoice} options={picOptions} />
        <PlainSelect id="kanban-jenis" name="jenis" label="Jenis" defaultValue={board.kind === 'PROJECT' ? 'project' : board.kind === 'ACTIVITY' ? 'activity' : ''} emptyLabel="Semua jenis" options={[{ value: 'project', label: 'Project' }, { value: 'activity', label: 'Activity (di luar project)' }]} />
        <PlainInput id="kanban-cari" name="q" label="Cari" defaultValue={board.q} placeholder="Judul, ID, atau nama project" maxLength={100} />
        <PlainCheckbox name="perpanjang" label="Hanya kartu yang memperpanjang estimasi tahapan" defaultChecked={board.extendsOnly} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button type="submit" variant="contained" size="small">Terapkan</Button>
        <LinkButton href="/kanban" size="small">Reset</LinkButton>
      </Box>
    </Box>
  );
}
