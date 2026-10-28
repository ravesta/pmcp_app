import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from 'next/link';
import type { DailyActivityResult } from '@/modules/dashboard';
import { formatDisplayDate, type IsoDate } from '@/shared/iso-date';
import { DateField } from '@/ui/components/date-field';
import { LinkButton } from '@/ui/components/link-controls';
import { PlainSelect } from '@/ui/components/plain-field';
import { SegmentedLinks } from '@/ui/components/segmented-links';
import { ToneChip } from '@/ui/components/tone-chip';
import { LOG_QUALITY } from '@/ui/format/dashboard-labels';
import { formatClock, formatDuration } from '@/ui/format/kanban-labels';
import type { RiwayatParams } from '../_lib/search-params';
import styles from '../../dashboard/_components/dashboard.module.css';

/** Properti tab Aktivitas harian. */
interface DailyActivityProps {
  readonly result: DailyActivityResult;
  readonly params: RiwayatParams;
  readonly isManager: boolean;
  readonly today: IsoDate;
  /** Pembuat alamat dengan perubahan parameter. */
  readonly hrefWith: (changes: Record<string, string | null>) => string;
  readonly previousDate: IsoDate;
  readonly nextDate: IsoDate;
}

/**
 * Tab Aktivitas harian: mode Hari atau Minggu dengan tombol sebelumnya, berikutnya, "Hari ini" dan isian tanggal;
 * ringkasan jam tercatat; dan tiap hari berisi total jam terhadap 8 jam dengan penilaian serta daftar log berurut jam
 * lengkap dengan tautan "Lihat kartu". Hanya baca.
 * Masukan: hasil, keadaan halaman, penanda Manager, hari ini, pembuat alamat, dan tanggal tetangga. Keluaran: tab.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-07-09; AC: hari dengan 4 jam log tampil "4 j dari 8 j" dan chip Kurang.
 */
export function DailyActivity({ result, params, isManager, today, hrefWith, previousDate, nextDate }: DailyActivityProps) {
  const dateOf = (date: IsoDate) => hrefWith({ tab: 'harian', tanggal: date });
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <SegmentedLinks label="Mode" active={params.mode} options={[{ key: 'DAY', label: 'Hari', href: hrefWith({ tab: 'harian', mode: null }) }, { key: 'WEEK', label: 'Minggu', href: hrefWith({ tab: 'harian', mode: 'minggu' }) }]} />
        <LinkButton href={dateOf(previousDate)} size="small" variant="outlined" aria-label="Sebelumnya">‹</LinkButton>
        <LinkButton href={hrefWith({ tab: 'harian', tanggal: null })} size="small" variant="outlined">Hari ini</LinkButton>
        <LinkButton href={dateOf(nextDate)} size="small" variant="outlined" aria-label="Berikutnya">›</LinkButton>
        <span className={`${styles.mono} ${styles.small}`}>{formatDisplayDate(result.range.start)}{result.range.start !== result.range.end ? ` - ${formatDisplayDate(result.range.end)}` : ''}</span>
      </Box>
      <Box component="form" method="get" action="/riwayat" aria-label="Pilih tanggal dan PIC" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'end' }}>
        <input type="hidden" name="tab" value="harian" />
        {params.mode === 'WEEK' ? <input type="hidden" name="mode" value="minggu" /> : null}
        <DateField name="tanggal" label="Ke tanggal" defaultValue={params.date ?? today} />
        {isManager ? <PlainSelect id="harian-pic" name="pic" label="PIC" emptyLabel={null} defaultValue={result.pic ? String(result.pic.id) : ''} options={result.pics.map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage})` }))} /> : null}
        <Button type="submit" variant="outlined" size="small">Tampilkan</Button>
      </Box>
      <div className={styles.row} role="status">
        <b>Total {formatDuration(result.summary.totalMinutes)}</b>
        <span className={styles.small}>{result.summary.logCount} log</span>
        <span className={`${styles.small} ${styles.muted}`}>kartu project {formatDuration(result.summary.projectMinutes)} · activity {formatDuration(result.summary.activityMinutes)}</span>
      </div>
      {result.days.map((day) => (
        <section key={day.date} className={styles.day} aria-label={`Log ${formatDisplayDate(day.date)}`}>
          <div className={styles.row} style={{ justifyContent: 'space-between' }}>
            <b>{formatDisplayDate(day.date)}</b>
            <span className={styles.row}>
              <span className={styles.mono}>{formatDuration(day.totalMinutes)} dari 8 j</span>
              {day.assessment ? <ToneChip text={LOG_QUALITY[day.assessment.quality].text} tone={LOG_QUALITY[day.assessment.quality].tone} /> : null}
            </span>
          </div>
          {day.logs.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Tidak ada log.</div> : (
            <div className={styles.wrap}>
              <table className={styles.table} aria-label={`Log ${formatDisplayDate(day.date)}`} style={{ minWidth: 600 }}>
                <thead><tr><th>Waktu</th><th>Durasi</th><th>Kartu</th><th>Keterangan</th><th><span style={{ position: 'absolute', left: -9999 }}>Tautan</span></th></tr></thead>
                <tbody>
                  {day.logs.map((log) => (
                    <tr key={log.id}>
                      <td className={`${styles.mono} ${styles.small} ${styles.nowrap}`}>{formatClock(log.startMinute)}-{formatClock(log.endMinute)}</td>
                      <td className={`${styles.mono} ${styles.small} ${styles.nowrap}`}>{formatDuration(log.endMinute - log.startMinute)}</td>
                      <td className={styles.small}>
                        <ToneChip text={log.kind === 'PROJECT' ? 'Project' : 'Activity'} tone={log.kind === 'PROJECT' ? 'info' : 'hold'} /> <b>{log.cardTitle}</b>
                        <div className={styles.muted}>{log.kind === 'PROJECT' ? `${log.projectCode} · ${log.projectName} · ${log.stage}${log.stepName ? ` · ${log.stepName}` : ''}` : log.categoryName}</div>
                      </td>
                      <td className={styles.small}>{log.description}</td>
                      <td><Link href={`/kanban?kartu=${log.cardId}&pic=semua`}>Lihat kartu</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
