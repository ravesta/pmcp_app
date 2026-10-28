import type { ProjectLogPage } from '@/modules/kanban';
import { formatDisplayDate } from '@/shared/iso-date';
import { PaginationBar } from '@/ui/components/pagination-bar';
import { PlainField } from '@/ui/components/plain-field';
import { UrlParamSelect } from '@/ui/components/url-param-select';
import { formatClock, formatDuration } from '@/ui/format/kanban-labels';
import { STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import styles from './detail.module.css';

/** Properti bagian Log activity pada detail project. */
interface ProjectLogsProps {
  readonly page: ProjectLogPage;
  readonly pageNumber: number;
  readonly pageSize: number;
  /** Filter yang sedang dipilih (kosong = semua). */
  readonly stage: string;
  readonly picId: string;
  /** Pembuat alamat untuk nomor halaman log. */
  readonly hrefFor: (page: number) => string;
}

/**
 * Log activity seluruh kartu sebuah project: filter tahapan dan PIC yang langsung berlaku, ringkasan total waktu per tahapan
 * dan per PIC (seluruh project), serta tabel log berhalaman (tanggal, waktu, durasi, PIC, tahapan, item rencana, step, uraian). Hanya baca.
 * Masukan: halaman log, nomor halaman, ukuran, filter terpilih, dan pembuat alamat halaman. Keluaran: bagian log.
 * Efek samping: tidak ada selain navigasi saat filter dipilih (parameter URL).
 * Rujukan: FR-20-01; AC: filter PIC Rina hanya menampilkan log Rina dan ringkasan project tidak berubah.
 */
export function ProjectLogs({ page, pageNumber, pageSize, stage, picId, hrefFor }: ProjectLogsProps) {
  const hasLogs = page.totalMinutes > 0 || page.rows.length > 0 || stage !== '' || picId !== '';
  if (!hasLogs) {
    return <div className={`${styles.muted} ${styles.small}`} style={{ padding: 16, textAlign: 'center' }}>Belum ada log activity pada project ini. Log dicatat PIC lewat kartu Kanban.</div>;
  }
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', alignItems: 'end' }}>
        <PlainField label="Tahapan" htmlFor="log-tahapan">
          <UrlParamSelect plain id="log-tahapan" param="lstage" label="Tahapan" value={stage} defaultValue="" resetParams={['lhal']} options={[{ value: '', label: 'Semua tahapan' }, ...page.perStage.map((s) => ({ value: s.stage, label: STAGE_FULL_TEXT[s.stage] }))]} />
        </PlainField>
        <PlainField label="PIC" htmlFor="log-pic">
          <UrlParamSelect plain id="log-pic" param="lpic" label="PIC" value={picId} defaultValue="" resetParams={['lhal']} options={[{ value: '', label: 'Semua PIC' }, ...page.perPic.map((p) => ({ value: String(p.picId), label: p.name }))]} />
        </PlainField>
        {page.totalMinutes > 0 ? (
          <div className={styles.small} style={{ alignSelf: 'center' }}>
            <b>{formatDuration(page.totalMinutes)}</b> dari {page.total} log
            <span className={styles.muted}> · {page.perStage.map((s) => `${s.stage} ${formatDuration(s.minutes)}`).join(', ')}</span>
            {page.perPic.length > 1 ? <span className={styles.muted}> · {page.perPic.map((p) => `${p.name} ${formatDuration(p.minutes)}`).join(', ')}</span> : null}
          </div>
        ) : null}
      </div>
      {page.rows.length > 0 ? (
        <>
          <div className={styles.wrap}>
            <table className={styles.at} aria-label="Log activity project" style={{ minWidth: 720 }}>
              <thead><tr><th>Tanggal</th><th>Waktu</th><th>Durasi</th><th>PIC</th><th>Tahapan</th><th>Item rencana</th><th>Step</th><th>Uraian</th></tr></thead>
              <tbody>
                {page.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={`${styles.mono} ${styles.small}`} style={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(row.workDate)}</td>
                    <td className={`${styles.mono} ${styles.small}`} style={{ whiteSpace: 'nowrap' }}>{formatClock(row.span.start)}-{formatClock(row.span.end)}</td>
                    <td className={`${styles.mono} ${styles.small}`} style={{ whiteSpace: 'nowrap' }}>{formatDuration(row.span.end - row.span.start)}</td>
                    <td className={styles.small}>{row.picName}</td>
                    <td className={styles.small}><span className={`${styles.kst} ${styles[row.stage]}`}>{row.stage}</span></td>
                    <td className={styles.small}>{row.cardTitle}</td>
                    <td className={styles.small}>{row.stepName ?? '-'}</td>
                    <td className={styles.small}>{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={pageNumber} pageSize={pageSize} total={page.total} pageSizeOptions={[5, 10, 20]} hrefFor={hrefFor} unit="log" sizeParam="lper" pageParam="lhal" defaultSize={10} />
        </>
      ) : (
        <div className={`${styles.muted} ${styles.small}`} style={{ padding: 16, textAlign: 'center' }}>Tidak ada log untuk filter ini.</div>
      )}
    </>
  );
}
