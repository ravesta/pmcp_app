import Link from 'next/link';
import type { PicDashboard } from '@/modules/dashboard';
import { addDays, calendarDaysBetween } from '@/shared/calendar';
import { formatDisplayDate, type IsoDate } from '@/shared/iso-date';
import { Card, CardHeader, Section } from '@/ui/components/card';
import { LinkButton } from '@/ui/components/link-controls';
import { ToneChip } from '@/ui/components/tone-chip';
import { CAPACITY_STATUS, formatHours } from '@/ui/format/dashboard-labels';
import { formatDuration } from '@/ui/format/kanban-labels';
import { displayStatusBadge, formatDateOrDash, formatRange, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import { CapacityNav } from './capacity-nav';
import styles from './dashboard.module.css';
import { KpiCard } from './kpi-card';

/** Properti tampilan Dashboard PIC. */
interface PicViewProps {
  readonly data: PicDashboard;
  readonly name: string;
  readonly today: IsoDate;
  readonly hrefFor: Parameters<typeof CapacityNav>[0]['hrefFor'];
}

/**
 * Garis waktu ringkas tahapan PIC pada rentang bulan berjalan sampai dua bulan ke depan: satu baris per tahapan dengan
 * batang pada posisi dan lebar proporsional serta penanda hari ini.
 * Masukan: tahapan bertimeline, rentang, dan hari ini. Keluaran: daftar baris garis waktu.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-07-04 butir 1 (dirancang ringan; bar penuh Gantt ada di tab Project).
 */
function MiniTimeline({ data, today }: { readonly data: PicDashboard['timeline']; readonly today: IsoDate }) {
  const total = Math.max(1, calendarDaysBetween(data.range.start, data.range.end) + 1);
  const pct = (days: number) => `${Math.min(100, Math.max(0, (days / total) * 100))}%`;
  const offset = (date: IsoDate) => calendarDaysBetween(data.range.start, date);
  const todayOffset = offset(today);
  return (
    <div role="list" aria-label="Timeline proyek saya" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.stages.map((stage) => {
        const start = Math.max(0, offset(stage.estimate.start));
        const end = Math.min(total - 1, offset(stage.estimate.end));
        if (end < 0 || start > total - 1) return null;
        return (
          <div role="listitem" key={`${stage.projectCode}-${stage.stage}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr', gap: 8, alignItems: 'center' }}>
            <div className={styles.small}><b>{stage.projectName}</b> <span className={styles.muted}>{stage.stage}</span></div>
            <div style={{ position: 'relative', height: 18, background: 'var(--soft)', borderRadius: 4 }}>
              <div title={formatRange(stage.estimate)} style={{ position: 'absolute', left: pct(start), width: pct(end - start + 1), top: 2, bottom: 2, borderRadius: 3, background: stage.stage === 'QA' ? 'var(--qa)' : 'var(--ba)' }} />
              {todayOffset >= 0 && todayOffset < total ? <div aria-hidden style={{ position: 'absolute', left: pct(todayOffset), top: 0, bottom: 0, width: 2, background: 'var(--late)' }} /> : null}
            </div>
          </div>
        );
      })}
      <div className={`${styles.small} ${styles.muted}`}>{formatDisplayDate(data.range.start)} - {formatDisplayDate(data.range.end)} · garis merah = hari ini</div>
    </div>
  );
}

/**
 * Dashboard PIC: lima kartu pribadi, Assignment baru (bila ada), Antrean pekerjaan, Timeline proyek saya dengan benturan
 * jadwal, kapasitas pribadi, ringkasan aktivitas harian (tanpa daftar), dan ringkasan riwayat.
 * Masukan: data dashboard, nama PIC, hari ini, dan pembuat alamat kapasitas. Keluaran: kartu dashboard.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-07-01 sampai FR-07-07, BL-44, BL-45, mockup v0.2 (fungsi dashPic).
 */
export function PicView({ data, name, today, hrefFor }: PicViewProps) {
  const { cards, capacity, activity } = data;
  const cap = capacity.value;
  return (
    <>
      <div className={styles.kpis}>
        <KpiCard value={cards.newAssignments} label="Assignment baru" emphasis="new" />
        <KpiCard value={cards.activeWork} label="Pekerjaan aktif" />
        <KpiCard value={cards.late} label="Terlambat" emphasis="bad" />
        <KpiCard value={cards.due7} label="Jatuh tempo 7 hari" emphasis="warn" />
        <KpiCard value={cards.todayLogs} label={`Aktivitas hari ini · ${formatDuration(cards.todayMinutes)}`} />
      </div>
      <Card>
        <CardHeader level={1} title={`Dashboard ${name}`} subtitle={`Posisi ${formatDisplayDate(today)}`} />

        {data.assignments.length > 0 ? (
          <Section title="Assignment baru">
            <p className={styles.hint}>{data.assignments.length} tahapan baru ditugaskan kepada Anda. Buka detail project; setelah itu tidak lagi dihitung baru dan pindah ke Pekerjaan aktif.</p>
            <div className={styles.asg}>
              {data.assignments.map((row) => (
                <div key={`${row.projectCode}-${row.stage}`} className={styles.asgCard}>
                  <div className={styles.row} style={{ justifyContent: 'space-between' }}><b>{row.stage}</b><ToneChip text="Baru" tone="info" /></div>
                  <div>{row.projectName}</div>
                  <div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div>
                  <div className={`${styles.mono} ${styles.small}`}>{formatRange(row.estimate)}</div>
                  <div className={`${styles.small} ${styles.muted}`}>Ditugaskan oleh {row.assignedByLabel} · {formatDisplayDate(row.assignedAt.toISOString().slice(0, 10) as IsoDate)}</div>
                  <LinkButton href={`/project/${row.projectCode}`} size="small" variant="outlined">Buka detail</LinkButton>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Antrean pekerjaan">
          <p className={styles.hint}>Urut dari yang paling terlambat, tertinggal dari laju, lalu tenggat terdekat.</p>
          {data.queue.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Belum ada tahapan aktif untuk Anda.</div> : (
            <div className={styles.wrap}>
              <table className={styles.table} aria-label="Antrean pekerjaan" style={{ minWidth: 760 }}>
                <thead><tr><th>#</th><th>Project</th><th>Tahapan</th><th>Tenggat</th><th>Keterangan</th><th>Progres</th><th>Dependency</th><th><span style={{ position: 'absolute', left: -9999 }}>Aksi</span></th></tr></thead>
                <tbody>
                  {data.queue.map((row, index) => {
                    const badge = displayStatusBadge(row.display);
                    return (
                      <tr key={`${row.projectCode}-${row.stage}`}>
                        <td className={styles.mono}>{index + 1}</td>
                        <td><Link href={`/project/${row.projectCode}`}>{row.projectName}</Link> {row.isNew ? <ToneChip text="Baru" tone="info" /> : null}<div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div></td>
                        <td>{row.stage}{row.focusStep ? <div className={`${styles.small} ${styles.muted}`}>Fokus: {row.focusStep}</div> : null}</td>
                        <td className={`${styles.mono} ${styles.small}`}>{formatDateOrDash(row.estimate?.end ?? null)}</td>
                        <td><span className={styles.chips}><ToneChip text={badge.text} tone={badge.tone} />{row.lagging ? <ToneChip text="Tertinggal" tone="warn" /> : null}</span></td>
                        <td className={styles.mono}>{row.progress}%</td>
                        <td className={styles.small}>{row.waitingFor ? <>Menunggu {STAGE_FULL_TEXT[row.waitingFor.stage]}{row.waitingFor.end ? <span className={styles.muted}> ({formatDateOrDash(row.waitingFor.end)})</span> : null}</> : '-'}</td>
                        <td>{row.canUpdate ? <LinkButton href={`/project/${row.projectCode}?ubah=${row.stage}`} size="small" variant="outlined">Perbarui</LinkButton> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Timeline proyek saya">
          {data.timeline.stages.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Belum ada tahapan bertimeline.</div> : <MiniTimeline data={data.timeline} today={today} />}
          <div>
            <b className={styles.small}>Benturan jadwal</b>
            {data.timeline.conflicts.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Tidak ada benturan jadwal antar tahapan Anda.</div> : (
              <ul className={styles.small} style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {data.timeline.conflicts.map((conflict, index) => <li key={index}>{conflict.first} dan {conflict.second} tumpang tindih <span className={styles.mono}>{formatDisplayDate(conflict.overlap.start)} - {formatDisplayDate(conflict.overlap.end)}</span></li>)}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Kapasitas saya">
          <CapacityNav mode={capacity.mode} offset={capacity.offset} range={{ start: capacity.range.start, end: capacity.range.end }} hrefFor={hrefFor} />
          <div className={styles.capStats}>
            <div><span>Tersedia</span><b className={styles.mono}>{formatHours(cap.summary.availableMinutes)}</b></div>
            <div><span>Terencana</span><b className={styles.mono}>{formatHours(cap.summary.plannedMinutes)}</b></div>
            <div><span>Aktual</span><b className={styles.mono}>{formatHours(cap.summary.actualMinutes)}</b></div>
            <div><span>Utilisasi</span><b className={styles.mono}>{cap.summary.utilizationPercent}%</b></div>
            <div><span>Sisa kapasitas</span><b className={styles.mono}>{formatHours(cap.summary.remainingMinutes)}</b></div>
          </div>
          <div className={styles.meter} role="img" aria-label={`Utilisasi ${cap.summary.utilizationPercent}%`}><i style={{ width: `${Math.min(100, cap.summary.utilizationPercent)}%`, background: cap.summary.status === 'OVER' ? 'var(--late)' : cap.summary.status === 'NEAR' ? 'var(--warn)' : 'var(--ok)' }} /></div>
          <ToneChip text={CAPACITY_STATUS[cap.summary.status].text} tone={CAPACITY_STATUS[cap.summary.status].tone} />
          {cap.summary.cardsWithoutEstimate > 0 ? <div className={`${styles.small} ${styles.muted}`}>{cap.summary.cardsWithoutEstimate} kartu tanpa estimasi jam tidak dihitung.</div> : null}
          <div className={styles.wrap}>
            <table className={styles.table} aria-label="Rincian kapasitas" style={{ minWidth: 420 }}>
              <thead><tr><th>{capacity.mode === 'WEEK' ? 'Hari' : 'Minggu kerja'}</th><th>Terencana / tersedia</th><th>Aktual</th><th>Status</th></tr></thead>
              <tbody>
                {cap.slices.map((slice) => (
                  <tr key={slice.range.start} style={slice.range.start <= today && today <= slice.range.end ? { background: 'var(--run-bg)' } : undefined}>
                    <td className={`${styles.mono} ${styles.small}`}>{capacity.mode === 'WEEK' ? formatDisplayDate(slice.range.start) : `${formatDisplayDate(slice.range.start).slice(0, 5)} - ${formatDisplayDate(slice.range.end).slice(0, 5)}`}</td>
                    <td className={styles.mono}>{formatHours(slice.capacity.plannedMinutes)} / {formatHours(slice.capacity.availableMinutes)}</td>
                    <td className={styles.mono}>{formatHours(slice.capacity.actualMinutes)}</td>
                    <td><ToneChip text={CAPACITY_STATUS[slice.capacity.status].text} tone={CAPACITY_STATUS[slice.capacity.status].tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>Jam terencana per hari adalah perkiraan karena estimasi kartu dibagi rata per hari kerja rencana.</p>
        </Section>

        <Section title="Aktivitas harian">
          <div className={styles.panels}>
            {([['Kartu project', 'project', activity.project], ['Kartu di luar project (activity)', 'activity', activity.activity]] as const).map(([title, kind, summary]) => (
              <div key={kind} className={styles.panel}>
                <b>{title}</b>
                <div className={styles.sumn}>
                  <Link href={`/kanban?jenis=${kind}`}><b>{summary.planned}</b><span>Planned</span></Link>
                  <Link href={`/kanban?jenis=${kind}`}><b>{summary.inProgress}</b><span>In Progress</span></Link>
                  <Link href={`/kanban?jenis=${kind}`} className={summary.late > 0 ? styles.late : ''}><b>{summary.late}</b><span>Terlambat</span></Link>
                </div>
                <div className={`${styles.small} ${styles.muted}`}>{summary.open} kartu terbuka · Selesai hari ini: {summary.doneToday} kartu</div>
              </div>
            ))}
          </div>
          <div className={styles.row}>
            <LinkButton href="/kanban?buat=project" variant="contained" size="small">+ Buat kartu</LinkButton>
            <LinkButton href="/kanban?buat=activity" variant="outlined" size="small">+ Kartu activity</LinkButton>
          </div>
          <p className={styles.hint}>Terlambat = tanggal selesai rencana sudah lewat; jumlahnya sudah termasuk dalam Planned atau In Progress. Rincian per hari ada di menu Riwayat.</p>
        </Section>

        <Section title="Riwayat">
          <div className={styles.row} style={{ justifyContent: 'space-between' }}>
            <span className={styles.small}>
              {data.history.doneCount} tahapan selesai
              {data.history.latest ? <> · terbaru {formatDateOrDash(data.history.latest.date)} {data.history.latest.projectName} ({data.history.latest.stage})</> : null}
            </span>
            <LinkButton href="/riwayat" size="small" variant="outlined">Buka Riwayat</LinkButton>
          </div>
        </Section>
      </Card>
    </>
  );
}
