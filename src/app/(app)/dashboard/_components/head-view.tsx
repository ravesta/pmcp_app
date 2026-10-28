import Link from 'next/link';
import type { HeadDashboard } from '@/modules/dashboard';
import { formatDisplayDate } from '@/shared/iso-date';
import { Card, CardHeader, Section } from '@/ui/components/card';
import { ToneChip } from '@/ui/components/tone-chip';
import { CAPACITY_STATUS, formatDaysLeft, formatHours, LOG_QUALITY } from '@/ui/format/dashboard-labels';
import { formatDateOrDash } from '@/ui/format/project-labels';
import { CapacityNav } from './capacity-nav';
import styles from './dashboard.module.css';
import { KpiCard } from './kpi-card';

/** Properti tampilan Dashboard Head. */
interface HeadViewProps {
  readonly data: HeadDashboard;
  readonly today: string;
  readonly weekLabel: string;
  readonly hrefFor: Parameters<typeof CapacityNav>[0]['hrefFor'];
}

/**
 * Dashboard Head BA & QA: tujuh kartu ringkasan (yang dapat diklik membuka layar terfilter), lalu lima bagian: project
 * terlambat atau berisiko, tahapan jatuh tempo 7 hari, beban dan kapasitas, pekerjaan per peran, dan pencatatan aktivitas.
 * Masukan: data dashboard, tanggal hari ini, label minggu, dan pembuat alamat kapasitas. Keluaran: kartu dashboard.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-04-01 sampai FR-04-06, BL-43, mockup v0.2 (fungsi dashMgr).
 */
export function HeadView({ data, today, weekLabel, hrefFor }: HeadViewProps) {
  const { cards } = data;
  return (
    <>
      <div className={styles.kpis}>
        <KpiCard value={cards.late} label="Tahapan terlambat" href="/project?sts=LATE" emphasis="bad" title="Lihat tahapan terlambat di Gantt" />
        <KpiCard value={cards.lagging} label="Tertinggal dari laju" href="/project?sts=LAGGING" emphasis="warn" title="Lihat tahapan tertinggal dari laju di Gantt" />
        <KpiCard value={cards.due7} label="Jatuh tempo 7 hari" emphasis="warn" />
        <KpiCard value={cards.overloaded} label="PIC kelebihan beban" emphasis="bad" />
        <KpiCard value={cards.held} label="Tahapan ditahan" href="/project?sts=HELD" title="Lihat tahapan ditahan di Gantt" />
        <KpiCard value={cards.extending} label="Estimasi diperpanjang lewat rencana" href="/kanban?pic=semua&perpanjang=1" emphasis="warn" title="Buka Kanban: kartu rencana yang memperpanjang estimasi tahapan" />
        <KpiCard value={cards.incomplete} label="Perlu dilengkapi (PIC/timeline)" href="/project?v=daftar&lengkap=INCOMPLETE" emphasis="warn" title="Buka Daftar Project dengan filter belum lengkap" />
      </div>
      <Card>
        <CardHeader level={1} title="Dashboard Head BA & QA" subtitle={`Posisi ${formatDisplayDate(today as never)} · minggu ${weekLabel}`} />

        <Section title="1. Project terlambat atau berisiko">
          <p className={styles.hint}>Tahapan yang perlu perhatian Head, diurut dari keterlambatan terlama.</p>
          {data.risks.rows.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Tidak ada tahapan terlambat atau berisiko.</div> : (
            <div className={styles.wrap}>
              <table className={styles.table} aria-label="Project terlambat atau berisiko">
                <thead><tr><th>Project</th><th>Tahapan</th><th>PIC</th><th>Tenggat</th><th>Progres</th><th>Risiko</th></tr></thead>
                <tbody>
                  {data.risks.rows.map((row) => (
                    <tr key={`${row.projectCode}-${row.stage}`}>
                      <td><Link href={`/project/${row.projectCode}`}>{row.projectName}</Link><div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div></td>
                      <td>{row.stage}</td>
                      <td className={styles.small}>{row.pics.join(', ') || '-'}</td>
                      <td className={`${styles.mono} ${styles.small}`}>{formatDateOrDash(row.end)}</td>
                      <td className={styles.mono}>{row.progress}%</td>
                      <td>
                        <span className={styles.chips}>
                          {row.lateDays > 0 ? <ToneChip text={`Terlambat ${row.lateDays} hari`} tone="late" /> : null}
                          {row.lagging ? <ToneChip text="Tertinggal dari laju" tone="warn" /> : null}
                          {row.held ? <ToneChip text="Ditahan" tone="hold" /> : null}
                          {row.revisionAtLimit !== null ? <ToneChip text={`Revisi ${row.revisionAtLimit}×`} tone="rev" /> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>Menampilkan {data.risks.rows.length} dari {data.risks.total}. Selengkapnya di tab <Link href="/project">Project</Link>.</p>
        </Section>

        <Section title="2. Tahapan jatuh tempo dalam 7 hari">
          {data.due.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Tidak ada tahapan yang jatuh tempo dalam 7 hari.</div> : (
            <div className={styles.wrap}>
              <table className={styles.table} aria-label="Tahapan jatuh tempo 7 hari">
                <thead><tr><th>Project</th><th>Tahapan</th><th>PIC</th><th>Tenggat</th><th>Progres</th></tr></thead>
                <tbody>
                  {data.due.map((row) => (
                    <tr key={`${row.projectCode}-${row.stage}`}>
                      <td><Link href={`/project/${row.projectCode}`}>{row.projectName}</Link><div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div></td>
                      <td>{row.stage}</td>
                      <td className={styles.small}>{row.pics.join(', ') || '-'}</td>
                      <td><span className={`${styles.mono} ${styles.small}`}>{formatDateOrDash(row.end)}</span> <span className={`${styles.small} ${styles.muted}`}>{formatDaysLeft(row.daysLeft)}</span> {row.lagging ? <ToneChip text="Tertinggal" tone="warn" /> : null}</td>
                      <td className={styles.mono}>{row.progress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="3. Beban dan kapasitas tim">
          <p className={styles.hint}>Siapa yang kelebihan beban dan siapa yang masih punya kapasitas. Kartu &quot;PIC kelebihan beban&quot; di atas selalu minggu berjalan.</p>
          <CapacityNav mode={data.capacity.mode} offset={data.capacity.offset} range={data.capacity.range} hrefFor={hrefFor} />
          <div className={styles.wrap}>
            <table className={styles.table} aria-label="Beban dan kapasitas tim">
              <thead><tr><th>PIC</th><th>Tersedia</th><th>Terencana</th><th>Aktual</th><th>Utilisasi</th><th>Status</th><th>Sisa kapasitas</th></tr></thead>
              <tbody>
                {data.capacity.rows.map(({ pic, capacity }) => (
                  <tr key={pic.id}>
                    <td>{pic.name} <span className={`${styles.muted} ${styles.small}`}>{pic.stage}</span>{capacity.cardsWithoutEstimate > 0 ? <div className={`${styles.small} ${styles.muted}`}>{capacity.cardsWithoutEstimate} kartu tanpa estimasi jam</div> : null}</td>
                    <td className={styles.mono}>{formatHours(capacity.availableMinutes)}</td>
                    <td className={styles.mono}>{formatHours(capacity.plannedMinutes)}</td>
                    <td className={styles.mono}>{formatHours(capacity.actualMinutes)}</td>
                    <td className={styles.mono}>{capacity.utilizationPercent}%</td>
                    <td><ToneChip text={CAPACITY_STATUS[capacity.status].text} tone={CAPACITY_STATUS[capacity.status].tone} /></td>
                    <td className={styles.mono}>{formatHours(capacity.remainingMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="4. Pekerjaan yang sedang ditangani">
          <div className={styles.wrap}>
            <table className={styles.table} aria-label="Pekerjaan per peran">
              <thead><tr><th>Peran</th><th>PIC aktif</th><th>Tahapan berjalan</th><th>Belum mulai</th><th>Planned</th><th>In Progress</th><th>Done</th><th>Dadakan</th></tr></thead>
              <tbody>
                {data.roles.map((row) => (
                  <tr key={row.role}>
                    <td>{row.role === 'BA' ? 'Business Analyst' : 'Quality Assurance'}</td>
                    <td className={styles.mono}>{row.picCount}</td><td className={styles.mono}>{row.running}</td><td className={styles.mono}>{row.notStarted}</td>
                    <td className={styles.mono}>{row.planned}</td><td className={styles.mono}>{row.inProgress}</td><td className={styles.mono}>{row.done}</td><td className={styles.mono}>{row.adhoc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>Kartu yang dihitung: kartu rencana (tidak dibatalkan) yang rentangnya beririsan dengan minggu berjalan.</p>
        </Section>

        <Section title="5. Pencatatan aktivitas dan realisasi">
          <div className={styles.wrap}>
            <table className={styles.table} aria-label="Kualitas pencatatan">
              <thead><tr><th>PIC</th><th>Jam tercatat minggu ini</th><th>Terhadap jam kerja berjalan</th><th>Kartu berjalan tanpa log 3 hari atau lebih</th><th>Kepatuhan rencana</th></tr></thead>
              <tbody>
                {data.quality.map((row) => (
                  <tr key={row.picId}>
                    <td>{row.name}</td>
                    <td className={styles.mono}>{formatHours(row.weekMinutes)}</td>
                    <td><span className={styles.mono}>{row.percent}%</span> <ToneChip text={LOG_QUALITY[row.quality].text} tone={LOG_QUALITY[row.quality].tone} /></td>
                    <td className={styles.mono}>{row.staleCards > 0 ? <b style={{ color: 'var(--warn)' }}>{row.staleCards}</b> : 0}</td>
                    <td className={styles.mono}>{row.compliance === null ? '-' : `${row.compliance}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>Jam tercatat dibandingkan jam kerja berjalan pada minggu ini (8 jam per hari kerja). Baik 80% atau lebih, Kurang 50%-79%, Rendah di bawah 50%.</p>
        </Section>
      </Card>
    </>
  );
}
