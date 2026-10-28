import type { PicRef } from '@/modules/project';
import { LinkButton } from '@/ui/components/link-controls';
import { MultiSelectField } from '@/ui/components/multi-select-field';
import { PlainCheckbox, PlainInput, PlainSelect } from '@/ui/components/plain-field';
import { UrlParamSelect } from '@/ui/components/url-param-select';
import { PROJECT_STATUS_ORDER, PROJECT_STATUS_TEXT, PROJECT_TYPE_TEXT } from '@/ui/format/project-labels';
import { monthOptions, type MonthWindow } from '@/ui/gantt/timeline';
import type { IsoDate } from '@/shared/iso-date';
import type { ProjectPageParams } from '../_lib/search-params';

/** Pilihan kelengkapan perencanaan (FR-10-01 butir 2), sama dengan mockup v0.2. */
export const COMPLETENESS_OPTIONS = [
  { value: 'INCOMPLETE', label: 'Belum lengkap (PIC/timeline)' },
  { value: 'NO_PIC', label: 'Belum ada PIC' },
  { value: 'NO_TIMELINE', label: 'Belum ada timeline' },
  { value: 'COMPLETE', label: 'Sudah lengkap' },
] as const;

/** Properti isian utama. */
interface PrimaryFiltersProps {
  readonly params: ProjectPageParams;
  readonly projectOptions: ReadonlyArray<{ id: number; code: string; name: string }>;
}

/**
 * Isian utama bar filter: Cari dan Nama project (pilihan ganda, dapat dicari).
 * Masukan: keadaan halaman dan pilihan project. Keluaran: dua isian.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: BL-41, Screen [010] field 1 dan 2, mockup v0.2.
 */
export function ProjectPrimaryFilters({ params, projectOptions }: PrimaryFiltersProps) {
  return (
    <>
      <PlainInput id="filter-cari" name="q" label="Cari" defaultValue={params.filter.q} placeholder="ID, nama, referensi, aplikasi, atau PIC" maxLength={100} />
      <MultiSelectField plain name="proyek" label="Nama project" placeholder="Semua project" options={projectOptions.map((p) => ({ id: p.id, label: `${p.name} (${p.code})` }))} defaultIds={params.filter.projectIds} />
    </>
  );
}

/** Properti pemilih periode Gantt. */
interface PeriodPickerProps {
  readonly window: MonthWindow;
  readonly defaults: MonthWindow;
  readonly today: IsoDate;
  readonly previousHref: string;
  readonly nextHref: string;
  readonly nowHref: string;
}

/**
 * Pemilih periode Gantt: geser satu bulan ke belakang, dropdown Dari dan Sampai bulan, geser ke depan, dan "Bulan ini".
 * Dropdown langsung mengubah URL; tombol geser dan "Bulan ini" berupa tautan.
 * Masukan: jendela, bawaan, hari ini, dan alamat geser. Keluaran: kontrol periode.
 * Efek samping: tidak ada selain navigasi saat dipakai.
 * Rujukan: FR-12-01 butir 2, Screen [011] (Table 21), mockup v0.2 (fper).
 */
export function PeriodPicker({ window, defaults, today, previousHref, nextHref, nowHref }: PeriodPickerProps) {
  const options = monthOptions(today);
  // jendela yang sedang dilihat boleh di luar rentang pilihan standar (hasil geser): tetap tampil sebagai pilihan
  const withCurrent = (key: string) => (options.some((o) => o.value === key) ? options : [...options, { value: key, label: key }].sort((a, b) => a.value.localeCompare(b.value)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }} id="periode-label">Periode tampilan</span>
      <div role="group" aria-labelledby="periode-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <LinkButton href={previousHref} size="small" variant="outlined" sx={{ minWidth: 34, px: 0 }} aria-label="Geser periode satu bulan ke belakang" title="Geser 1 bulan ke belakang">←</LinkButton>
        <UrlParamSelect param="dari" value={window.from} label="Dari bulan" options={withCurrent(window.from)} resetParams={['hal']} defaultValue={defaults.from} />
        <span aria-hidden>–</span>
        <UrlParamSelect param="sampai" value={window.to} label="Sampai bulan" options={withCurrent(window.to)} resetParams={['hal']} defaultValue={defaults.to} />
        <LinkButton href={nextHref} size="small" variant="outlined" sx={{ minWidth: 34, px: 0 }} aria-label="Geser periode satu bulan ke depan" title="Geser 1 bulan ke depan">→</LinkButton>
        <LinkButton href={nowHref} size="small">Bulan ini</LinkButton>
      </div>
    </div>
  );
}

/** Properti isian lanjutan. */
interface AdvancedFiltersFieldsProps {
  readonly params: ProjectPageParams;
  readonly pics: ReadonlyArray<PicRef>;
  /** True bila pelaku adalah PIC (menampilkan "Hanya milik saya"). */
  readonly isPic: boolean;
}

/**
 * Isian filter lanjutan: PIC, Tahapan, Status tahapan, Jenis project, Kelengkapan perencanaan, dan "Hanya milik saya"
 * (PIC). Nilai awal mengikuti URL.
 * Masukan: keadaan halaman, daftar PIC, dan penanda PIC. Keluaran: kumpulan isian lanjutan.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: BL-41, Screen [010] field 4 sampai 9, FR-12-03, mockup v0.2 (fr2).
 */
export function ProjectAdvancedFilters({ params, pics, isPic }: AdvancedFiltersFieldsProps) {
  const { filter } = params;
  return (
    <>
      <PlainSelect id="filter-pic" name="pic" label="PIC" emptyLabel="Semua PIC" defaultValue={filter.picId === undefined ? '' : String(filter.picId)} options={pics.map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage === 'DEV' ? 'Dev' : pic.stage})` }))} />
      <PlainSelect id="filter-tahap" name="tahap" label="Tahapan" emptyLabel="Semua tahapan" defaultValue={filter.stage} options={[{ value: 'BA', label: 'Business Analyst' }, { value: 'DEV', label: 'Development' }, { value: 'QA', label: 'Quality Assurance' }]} />
      <PlainSelect
        id="filter-sts"
        name="sts"
        label="Status tahapan"
        emptyLabel="Semua status"
        defaultValue={filter.stageStatus}
        options={[
          { value: 'OPEN', label: 'Belum selesai' },
          { value: 'RUNNING', label: 'Berjalan' },
          { value: 'LATE', label: 'Terlambat' },
          { value: 'LAGGING', label: 'Tertinggal dari laju' },
          { value: 'HELD', label: 'Ditahan' },
          { value: 'DONE', label: 'Selesai' },
        ]}
      />
      <PlainSelect id="filter-jenis" name="jenis" label="Jenis project" emptyLabel="Semua jenis" defaultValue={filter.projectType} options={Object.entries(PROJECT_TYPE_TEXT).map(([value, label]) => ({ value, label }))} />
      <PlainSelect id="filter-lengkap" name="lengkap" label="Kelengkapan perencanaan" defaultValue={filter.completeness} options={[...COMPLETENESS_OPTIONS]} />
      {isPic ? <PlainCheckbox name="milik" label="Hanya milik saya" defaultChecked={params.mineOnly} /> : null}
    </>
  );
}

/** Pilihan status project untuk label filter aktif. */
export const PROJECT_STATUS_LABELS = Object.fromEntries(PROJECT_STATUS_ORDER.map((s) => [s, PROJECT_STATUS_TEXT[s]]));
