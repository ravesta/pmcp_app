import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { ProjectView } from '@/modules/project';
import { dayOfWeek } from '@/shared/calendar';
import { formatDisplayDate } from '@/shared/iso-date';
import { PROJECT_STATUS_TEXT, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import type { Timeline } from '@/ui/gantt/timeline';
import styles from './gantt.module.css';
import { EMPTY_ROW_HEIGHT, GanttStageBar, ROW_HEIGHT } from './gantt-stage-bar';

/** Lebar kolom nama (piksel), sama dengan kelas gl pada mockup. */
const NAME_COLUMN = 200;

/** Properti Gantt. */
interface GanttChartProps {
  readonly projects: ReadonlyArray<ProjectView>;
  readonly timeline: Timeline;
  readonly showLayers: boolean;
  /** PIC yang dipilih pada filter: tahapan miliknya disorot, tahapan PIC lain tetap tampil (FR-12-03 butir 1). */
  readonly highlightPicId?: number;
  /** Judul grup hanya nama project (tanpa kode dan status), untuk Detail Project yang sudah memuatnya. */
  readonly compactLabels?: boolean;
  /** Pesan bila tidak ada project pada periode dan filter ini. */
  readonly emptyMessage?: string;
}

/**
 * Menyusun latar jalur (garis Senin dan arsiran akhir pekan) sebagai gradasi CSS sehingga tidak perlu ratusan elemen
 * per baris (menjaga target muat 3 detik).
 * Masukan: skala waktu dan hari dalam pekan tanggal awal (0 = Minggu). Keluaran: gaya inline jalur.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-12-01 butir 4 (akhir pekan diarsir), NFR-08, mockup v0.2 (kelas gwe dan gtk).
 */
function trackStyle(timeline: Timeline, startWeekday: number): CSSProperties {
  const px = timeline.pxPerDay;
  const base: CSSProperties = { width: timeline.widthPx };
  if (timeline.zoom === 'MONTH') return base;
  const firstSaturday = (6 - startWeekday + 7) % 7;
  const firstMonday = (1 - startWeekday + 7) % 7;
  return {
    ...base,
    backgroundImage: `linear-gradient(to right, var(--soft) 0 ${2 * px}px, transparent ${2 * px}px), linear-gradient(to right, var(--line) 0 1px, transparent 1px)`,
    backgroundSize: `${7 * px}px 100%, ${7 * px}px 100%`,
    backgroundPosition: `${firstSaturday * px}px 0, ${firstMonday * px}px 0`,
    backgroundRepeat: 'repeat-x, repeat-x',
  };
}

/**
 * Gantt tahapan semua project seperti mockup v0.2: header tanggal menempel di atas, kolom nama menempel di kiri,
 * baris kelompok per project (nama tertaut, ID, status berwarna) dengan tiga baris tahapan, garis hari ini, dan akhir
 * pekan diarsir. Dapat digulir sendiri.
 * Masukan: project halaman ini, skala waktu, penanda lapisan, dan pesan kosong. Keluaran: grafik Gantt.
 * Efek samping: tidak ada (komponen murni; nama project dan bar berupa tautan ke Detail Project).
 * Rujukan: FR-12-01, FR-12-02, FR-12-03, BL-17, handoff UX/UI §8 (kolom nama tetap) dan §9, mockup v0.2 (ganttHtml).
 */
export function GanttChart({ projects, timeline, showLayers, highlightPicId, compactLabels = false, emptyMessage = 'Tidak ada tahapan pada periode dan filter ini.' }: GanttChartProps) {
  if (projects.length === 0) return <div className={styles.empty}>{emptyMessage}</div>;
  const startWeekday = dayOfWeek(timeline.start);
  const track = trackStyle(timeline, startWeekday);
  const today = timeline.todayPx === null ? null : <div className={styles.gtd} style={{ left: timeline.todayPx }} />;

  return (
    <div className={styles.gt}>
      <div style={{ width: timeline.widthPx + NAME_COLUMN }}>
        <div className={`${styles.gr} ${styles.gh}`}>
          <div className={styles.gl}>{formatDisplayDate(timeline.start)} - {formatDisplayDate(timeline.end)}</div>
          <div className={styles.gc} style={{ width: timeline.widthPx, height: 40 }} aria-hidden>
            {timeline.dayNumbers.map((tick) => <div key={tick.key} className={styles.dayno} style={{ left: tick.leftPx, width: timeline.pxPerDay }}>{tick.label}</div>)}
            {timeline.ticks.map((tick) => <div key={tick.key} className={styles.tick} style={{ left: tick.leftPx }}>{tick.label}</div>)}
          </div>
        </div>

        {projects.map((project) => (
          <section key={project.id} aria-label={`${project.code} ${project.name}`}>
            <div className={`${styles.gr} ${styles.ph}`}>
              <div className={styles.gl}>
                <Link href={`/project/${project.code}`} className={styles.name} title="Buka detail project">{project.name}</Link>
                {compactLabels ? null : <span className={styles.code}>({project.code})</span>}
                {compactLabels ? null : <span className={`${styles.pst} ${styles[project.status]}`}>- {PROJECT_STATUS_TEXT[project.status]}</span>}
              </div>
              <div className={styles.gc} style={track}>{today}</div>
            </div>
            {project.stages.map((stage) => (
              <div key={stage.stageId} className={styles.gr}>
                <div className={styles.gl}>{STAGE_FULL_TEXT[stage.kind]}</div>
                <div className={styles.gc} style={{ ...track, height: stage.bar ? ROW_HEIGHT : EMPTY_ROW_HEIGHT }}>
                  <GanttStageBar projectCode={project.code} projectName={project.name} stage={stage} timeline={timeline} showLayers={showLayers} highlightPicId={highlightPicId} />
                  {today}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
