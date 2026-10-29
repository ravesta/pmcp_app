import Link from 'next/link';
import type { PicDashboard } from '@/modules/dashboard';
import { formatDisplayDate, type IsoDate } from '@/shared/iso-date';
import { Card, CardHeader, Section } from '@/ui/components/card';
import { LinkButton } from '@/ui/components/link-controls';
import { ToneChip } from '@/ui/components/tone-chip';
import { CAPACITY_STATUS, formatHours } from '@/ui/format/dashboard-labels';
import { formatDuration } from '@/ui/format/kanban-labels';
import { displayStatusBadge, formatDateOrDash, formatRange, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import { buildTimelineForRange } from '@/ui/gantt/timeline';
import { GanttChart } from '../../project/_components/gantt-chart';
import { GanttLegend } from '../../project/_components/gantt-legend';
import { StageEditTrigger, type StageEditContext } from '../../project/_components/stage-edit-trigger';
import { CapacityNav } from './capacity-nav';
import { StageProgressBar } from './stage-progress-bar';
import styles from './dashboard.module.css';
import { KpiCard } from './kpi-card';

/** Properti tampilan Dashboard PIC. */
interface PicViewProps {
  readonly data: PicDashboard;
  readonly name: string;
  readonly today: IsoDate;
  readonly hrefFor: Parameters<typeof CapacityNav>[0]['hrefFor'];
  /** Menampilkan lapisan estimasi awal dan aktual pada Timeline proyek saya. */
  readonly showLayers: boolean;
  /** Alamat untuk menyalakan atau mematikan lapisan itu. */
  readonly layersHref: string;
  /** Data dialog Perbarui Tahapan (klik bar timeline atau Perbarui pada antrean membuka dialog di tempat). */
  readonly editContext: StageEditContext;
}

/**
 * Dashboard PIC: lima kartu pribadi, Assignment baru (bila ada), Antrean pekerjaan, Timeline proyek saya dengan benturan
 * jadwal, kapasitas pribadi, ringkasan aktivitas harian (tanpa daftar), dan ringkasan riwayat.
 * Masukan: data dashboard, nama PIC, hari ini, dan pembuat alamat kapasitas. Keluaran: kartu dashboard.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-07-01 sampai FR-07-07, BL-44, BL-45, mockup v0.2 (fungsi dashPic).
 */
export function PicView({ data, name, today, hrefFor, showLayers, layersHref, editContext }: PicViewProps) {
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
        <CardHeader level={1} title="Dashboard saya" subtitle={`${name} · Posisi ${formatDisplayDate(today)}`} />

        {data.assignments.length > 0 ? (
          <Section title="Assignment baru" description={`${data.assignments.length} tahapan baru ditugaskan kepada Anda. Buka detail project, setelah itu tidak lagi dihitung sebagai baru dan pindah ke Pekerjaan aktif.`}>
            <div className={styles.asg}>
              {data.assignments.map((row) => (
                <div key={`${row.projectCode}-${row.stage}`} className={styles.asgCard}>
                  <div className={styles.row} style={{ justifyContent: 'space-between' }}><span className={styles.asgStage}>{row.stage}</span><span className={styles.asgNew}>Baru</span></div>
                  <b>{row.projectName}</b>
                  <div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div>
                  <div className={styles.small}>{STAGE_FULL_TEXT[row.stage]} · estimasi <span className={styles.mono}>{formatRange(row.estimate)}</span></div>
                  <div className={`${styles.small} ${styles.muted}`}>Ditugaskan oleh {row.assignedByLabel} · {formatDisplayDate(row.assignedAt.toISOString().slice(0, 10) as IsoDate)}</div>
                  <LinkButton href={`/project/${row.projectCode}`} size="small" variant="contained" sx={{ alignSelf: 'flex-start' }}>Buka detail</LinkButton>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Antrean pekerjaan saya" description="Tahapan menurut prioritas, tenggat, dan dependency">
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
                        <td><Link href={`/project/${row.projectCode}`} className="pn">{row.projectName}</Link> {row.isNew ? <ToneChip text="Baru" tone="info" /> : null}<div className={`${styles.mono} ${styles.small} ${styles.muted}`}>{row.projectCode}</div></td>
                        <td>{STAGE_FULL_TEXT[row.stage]}{row.focusStep ? <div className={`${styles.small} ${styles.muted}`}>Fokus: {row.focusStep}</div> : null}</td>
                        <td className={`${styles.mono} ${styles.small}`}>{formatDateOrDash(row.estimate?.end ?? null)}</td>
                        <td><span className={styles.chips}><ToneChip text={badge.text} tone={badge.tone} />{row.lagging ? <ToneChip text="Tertinggal" tone="warn" /> : null}</span></td>
                        <td><StageProgressBar value={row.progress} manual={row.progressManual} /></td>
                        <td className={styles.small}>{row.waitingFor ? <>Menunggu {STAGE_FULL_TEXT[row.waitingFor.stage]}{row.waitingFor.end ? <span className={styles.muted}> ({formatDateOrDash(row.waitingFor.end)})</span> : null}</> : '-'}</td>
                        <td>{row.canUpdate ? <StageEditTrigger projectCode={row.projectCode} projectName={row.projectName} stage={row.stageView} context={editContext} variant="button" showDetailLink>Perbarui</StageEditTrigger> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.queue.length > 0 ? <div className={`${styles.small} ${styles.muted}`}>Urutan prioritas: paling terlambat, tertinggal dari laju, lalu tenggat terdekat. Fokus = step pada kartu Anda yang belum selesai.</div> : null}
        </Section>

        <Section title="Timeline proyek saya" description="Penugasan pribadi untuk melihat benturan jadwal">
          {data.timeline.projects.length === 0 ? <div className={`${styles.muted} ${styles.small}`}>Belum ada tahapan bertimeline.</div> : (
            <>
              <GanttChart projects={data.timeline.projects} timeline={buildTimelineForRange(data.timeline.range.start, data.timeline.range.end, 'WEEK', today)} showLayers={showLayers} editContext={editContext} />
              <GanttLegend showLayers={showLayers} toggleHref={layersHref} />
            </>
          )}
          {data.timeline.conflicts.length === 0 ? (
            <div className={`${styles.small} ${styles.muted}`}>Tidak ada benturan jadwal antar tahapan Anda.</div>
          ) : (
            <div className={styles.conflict} role="status">
              <b>Benturan jadwal:</b>
              <ul>
                {data.timeline.conflicts.map((conflict, index) => <li key={index}>{conflict.first} dan {conflict.second} tumpang tindih {formatDisplayDate(conflict.overlap.start).slice(0, 5)} - {formatDisplayDate(conflict.overlap.end).slice(0, 5)}</li>)}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Kapasitas saya" description="Jam tersedia, terencana, aktual, dan sisa kapasitas menurut periode yang dipilih">
          <CapacityNav mode={capacity.mode} offset={capacity.offset} range={{ start: capacity.range.start, end: capacity.range.end }} hrefFor={hrefFor} />
          <div className={styles.capSum}>
            <div><span>Tersedia</span><b>{formatHours(cap.summary.availableMinutes)}</b></div>
            <div><span>Terencana</span><b>{formatHours(cap.summary.plannedMinutes)}</b></div>
            <div><span>Aktual</span><b>{formatHours(cap.summary.actualMinutes)}</b></div>
            <div><span>Sisa kapasitas</span><b>{formatHours(cap.summary.remainingMinutes)}</b></div>
            <div><span>Utilisasi</span><b>{Math.round(cap.summary.utilizationPercent)}%</b><span style={{ alignSelf: 'flex-start' }}><ToneChip text={CAPACITY_STATUS[cap.summary.status].text} tone={CAPACITY_STATUS[cap.summary.status].tone} /></span></div>
          </div>
          <div className={styles.meter} role="img" aria-label={`Utilisasi ${cap.summary.utilizationPercent}%`}><i style={{ width: `${Math.min(100, cap.summary.utilizationPercent)}%`, background: cap.summary.status === 'OVER' ? 'var(--late)' : cap.summary.status === 'NEAR' ? 'var(--warn)' : 'var(--ok)' }} /></div>
          <div className={`${styles.small} ${styles.muted}`}>{capacity.mode === 'WEEK' ? 'Rincian per hari kerja' : 'Rincian per minggu kerja'}</div>
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
          <div className={`${styles.small} ${styles.muted}`}>Tersedia = hari kerja x 8 jam. Terencana = estimasi jam kartu, dibagi rata per hari kerja rencana (rincian harian adalah perkiraan).{cap.summary.cardsWithoutEstimate > 0 ? ` ${cap.summary.cardsWithoutEstimate} kartu tanpa estimasi jam tidak dihitung.` : ''} Cuti dan libur nasional belum dihitung.</div>
        </Section>

        <Section title="Aktivitas harian" description="Ringkasan kartu Kanban Anda: project dan di luar project">
          <div className={styles.panels}>
            {([['Kartu project', 'project', activity.project], ['Kartu di luar project', 'activity', activity.activity]] as const).map(([title, kind, summary]) => (
              <div key={kind} className={`${styles.panel} ${kind === 'activity' ? styles.panelA : ''}`}>
                <div className={styles.row} style={{ justifyContent: 'space-between' }}><span><span className={`${styles.ktype} ${kind === 'activity' ? styles.ktypeA : ''}`}>{kind === 'project' ? 'Project' : 'Activity'}</span> <b>{title}</b></span><span className={`${styles.muted} ${styles.small}`}>{summary.open} kartu terbuka</span></div>
                <div className={styles.sumn}>
                  <Link href={`/kanban?jenis=${kind}`}><b>{summary.planned}</b><span>Planned</span></Link>
                  <Link href={`/kanban?jenis=${kind}`}><b>{summary.inProgress}</b><span>In Progress</span></Link>
                  <Link href={`/kanban?jenis=${kind}`} className={summary.late > 0 ? styles.late : ''}><b>{summary.late}</b><span>Terlambat</span></Link>
                </div>
                <div className={`${styles.small} ${styles.muted}`}>{summary.doneToday > 0 ? <>Selesai hari ini: <b>{summary.doneToday}</b> kartu</> : 'Belum ada kartu selesai hari ini'}</div>
              </div>
            ))}
          </div>
          <div className={styles.row}>
            <LinkButton href="/kanban?buat=project" variant="contained" size="small">+ Buat kartu</LinkButton>
            <LinkButton href="/kanban?buat=activity" variant="outlined" size="small">+ Kartu activity</LinkButton>
          </div>
          <p className={styles.hint}>Dihitung dari semua kartu Kanban Anda yang belum Done. Terlambat = tanggal selesai rencana sudah lewat; jumlahnya sudah termasuk dalam Planned atau In Progress. Klik angka untuk membuka Kanban. Rincian aktivitas per hari ada di menu Riwayat.</p>
        </Section>

        <Section title="Riwayat proyek saya" description="Ringkasan pekerjaan yang telah selesai">
          <div className={styles.hnote}>
            <div>
              <b className={styles.mono}>{data.history.doneCount}</b> tahapan selesai
              {data.history.latest ? <> · terakhir <span className={styles.mono}>{data.history.latest.date ? formatDisplayDate(data.history.latest.date).slice(0, 5) : '-'}</span> ({data.history.latest.projectName}, {STAGE_FULL_TEXT[data.history.latest.stage]})</> : null}
            </div>
            <LinkButton href="/riwayat" size="small" variant="outlined">Buka Riwayat</LinkButton>
          </div>
        </Section>
      </Card>
    </>
  );
}
