import Link from 'next/link';
import type { DoneStagesResult } from '@/modules/dashboard';
import { AutoSubmitForm } from '@/ui/components/auto-submit-form';
import { PaginationBar } from '@/ui/components/pagination-bar';
import { PlainInput, PlainSelect } from '@/ui/components/plain-field';
import { formatHours } from '@/ui/format/dashboard-labels';
import { formatDateOrDash, formatRange, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import type { RiwayatParams } from '../_lib/search-params';
import styles from '../../dashboard/_components/dashboard.module.css';

/** Properti tab Tahapan selesai. */
interface DoneStagesProps {
  readonly result: DoneStagesResult;
  readonly params: RiwayatParams;
  readonly isManager: boolean;
  /** Pembuat alamat halaman daftar (mempertahankan filter). */
  readonly hrefFor: (page: number) => string;
}

/**
 * Tab Tahapan selesai: pencarian dan filter (tahapan dan selesai pada, berlaku langsung tanpa tombol; PIC dipilih Manager
 * pada baris di atas), tabel tahapan Selesai dengan output (judul kartu Done) dan jam terencana dibanding aktual,
 * berhalaman. Hanya baca.
 * Masukan: hasil, keadaan halaman, penanda Manager, dan pembuat alamat halaman. Keluaran: filter dan tabel.
 * Efek samping: tidak ada (komponen murni; filter lewat formulir GET).
 * Rujukan: FR-07-08; AC: PIC tidak melihat tahapan selesai milik PIC lain.
 */
export function DoneStages({ result, params, isManager, hrefFor }: DoneStagesProps) {
  return (
    <>
      <AutoSubmitForm action="/riwayat" label="Filter tahapan selesai" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 16px', alignItems: 'end', padding: '12px 14px', background: 'var(--soft)', borderRadius: 8 }}>
        <input type="hidden" name="tab" value="tahapan" />
        {result.picId !== null ? <input type="hidden" name="pic" value={result.picId} /> : null}
        <PlainInput id="riwayat-cari" name="q" label="Cari nama atau ID project" defaultValue={params.q} maxLength={100} />
        <PlainSelect id="riwayat-tahap" name="tahap" label="Tahapan" defaultValue={params.stage ?? ''} emptyLabel="Semua tahapan" options={[{ value: 'BA', label: 'Business Analyst' }, { value: 'DEV', label: 'Development' }, { value: 'QA', label: 'Quality Assurance' }]} />
        <PlainSelect id="riwayat-selesai" name="selesai" label="Selesai pada" emptyLabel="Semua waktu" defaultValue={params.period === 'LAST_30' ? '30' : params.period === 'THIS_MONTH' ? 'bulan' : params.period === 'LAST_90' ? '90' : ''} options={[{ value: '30', label: '30 hari terakhir' }, { value: 'bulan', label: 'Bulan ini' }, { value: '90', label: '90 hari terakhir' }]} />
      </AutoSubmitForm>
      {result.rows.length === 0 ? <div className={`${styles.muted} ${styles.small}`} style={{ padding: 16, textAlign: 'center' }}>Belum ada tahapan selesai yang sesuai.</div> : (
        <div className={styles.wrap}>
          <table className={styles.table} aria-label="Tahapan selesai" style={{ minWidth: 780 }}>
            <thead><tr><th>Project</th><th>Tahapan{isManager ? ' / PIC' : ''}</th><th>Estimasi</th><th>Selesai</th><th>Output (kartu selesai)</th><th>Jam terencana / aktual</th></tr></thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={`${row.projectId}-${row.stage}`}>
                  <td><Link href={`/project/${row.projectCode}`} className="pn">{row.projectName}</Link><div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div></td>
                  <td>{STAGE_FULL_TEXT[row.stage]}{isManager ? <div className={`${styles.small} ${styles.muted}`}>{row.pics.join(', ') || '-'}</div> : null}</td>
                  <td className={`${styles.mono} ${styles.small}`}>{formatRange(row.estimateStart && row.estimateEnd ? { start: row.estimateStart, end: row.estimateEnd } : null, '-')}</td>
                  <td className={`${styles.mono} ${styles.small}`}>{formatDateOrDash(row.doneOn)}</td>
                  <td className={styles.small}>{row.detail.outputs.length > 0 ? row.detail.outputs.join('; ') : '-'}</td>
                  <td className={styles.mono}>{formatHours(row.detail.plannedMinutes)} / {formatHours(row.detail.actualMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationBar page={result.page} pageSize={result.pageSize} total={result.total} pageSizeOptions={[10, 20, 50]} hrefFor={hrefFor} unit="tahapan" defaultSize={10} />
    </>
  );
}
