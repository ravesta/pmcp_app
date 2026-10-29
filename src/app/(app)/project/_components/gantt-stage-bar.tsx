import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { StageView } from '@/modules/project';
import { formatDisplayDate } from '@/shared/iso-date';
import { formatAssignees, formatRange, STAGE_STATUS_TEXT } from '@/ui/format/project-labels';
import { placeRange, type Span, type Timeline } from '@/ui/gantt/timeline';
import styles from './gantt.module.css';
import { StageEditTrigger, type StageEditContext } from './stage-edit-trigger';

/** Tinggi baris tahapan yang punya timeline dan yang tidak (piksel). */
export const ROW_HEIGHT = 36;
export const EMPTY_ROW_HEIGHT = 34;

/** Properti satu baris bar tahapan. */
interface GanttStageBarProps {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageView;
  readonly timeline: Timeline;
  /** Menampilkan lapisan estimasi awal, aktual, dan catatan (FR-12-02 butir 7). */
  readonly showLayers: boolean;
  /** Data dialog Perbarui Tahapan; bila ada, bar dan "Atur" bagi pelaku yang berhak membuka dialog di tempat. */
  readonly editContext?: StageEditContext;
  /** True bila Gantt tidak berada di Detail Project (dialog menampilkan "Lihat detail project"). */
  readonly showDetailLink?: boolean;
}

/**
 * Menulis tanggal sebagai "dd/mm" untuk catatan pendek pada bar.
 * Masukan: tanggal bisnis. Keluaran: teks dd/mm.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-12-02 butir 4 ("Selesai 05/10").
 */
function shortDate(date: string): string {
  return formatDisplayDate(date as Parameters<typeof formatDisplayDate>[0]).slice(0, 5);
}

/**
 * Menyusun teks di dalam bar: PIC, progres, dan penanda (lanjut di luar periode, hold, selesai, Tertinggal, revisi).
 * Masukan: tahapan dan apakah bar berlanjut sebelum atau sesudah periode. Keluaran: teks.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-12-02 butir 6, BL-17, mockup v0.2 (variabel cl pada ganttHtml).
 */
function barText(stage: StageView, continuesBefore: boolean, continuesAfter: boolean): string {
  const parts = [
    `${continuesBefore ? '◀ ' : ''}${stage.status === 'HELD' ? '⏸ ' : ''}${stage.status === 'DONE' ? '✓ ' : ''}${formatAssignees(stage.assignees)}`,
    `${stage.progress.effective}%${stage.progress.manual !== null ? '*' : ''}`,
  ];
  if (stage.progress.lagging) parts.push('tertinggal');
  if (stage.revisionCount > 0) parts.push(`R${stage.revisionCount}${stage.revisionAtLimit ? '⚠' : ''}`);
  return `${parts.join(' · ')}${continuesAfter ? ' ▶' : ''}`;
}

/**
 * Menyusun teks ringkas (tooltip dan teks alternatif) satu bar: project, tahapan, PIC, estimasi, aktual, revisi, status.
 * Masukan: nama project dan tahapan. Keluaran: teks dipisah " | ".
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: handoff UX/UI §9 (setiap bar memiliki teks alternatif ringkas), mockup v0.2 (variabel tip).
 */
function barTip(projectName: string, stage: StageView): string {
  return [
    projectName,
    stage.label,
    formatAssignees(stage.assignees),
    `Estimasi terkini ${formatRange(stage.estimate)}`,
    stage.baseline ? `Estimasi awal ${formatRange(stage.baseline)}` : '',
    stage.actualStart ? `Aktual mulai ${formatDisplayDate(stage.actualStart)}${stage.actualEnd ? `, selesai ${formatDisplayDate(stage.actualEnd)}` : ''}` : '',
    stage.revisionCount > 0 ? `Direvisi ${stage.revisionCount}x` : '',
    stage.status === 'HELD' && stage.holdSince ? `Ditahan sejak ${formatDisplayDate(stage.holdSince)}: ${stage.holdReason ?? ''}` : '',
    `${stage.progress.effective}%`,
    STAGE_STATUS_TEXT[stage.status],
  ]
    .filter(Boolean)
    .join(' | ');
}

/** Satu catatan di samping bar (chip atau teks). */
interface Note {
  readonly text: string;
  readonly kind: 'ok' | 'late' | 'warn' | 'rev' | 'muted';
}

/**
 * Menyusun catatan di samping bar bagi tahapan selesai atau yang pernah direvisi: Selesai dd/mm, Telat atau Lewat
 * estimasi awal, jumlah revisi, dan estimasi awal.
 * Masukan: tahapan. Keluaran: daftar catatan (kosong bila tidak ada yang perlu ditampilkan).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-12-02 butir 4 dan 5, CL-026, mockup v0.2 (variabel notes).
 */
function buildNotes(stage: StageView): Note[] {
  const done = stage.status === 'DONE';
  if (!done && stage.revisionCount === 0) return [];
  const notes: Note[] = [];
  if (done) notes.push({ text: `✓ Selesai ${shortDate(stage.actualEnd ?? stage.estimate?.end ?? '')}`, kind: 'ok' });
  if (stage.completion?.kind === 'LATE') notes.push({ text: `Telat +${stage.completion.days} hr`, kind: 'late' });
  else if (stage.completion?.kind === 'PAST_BASELINE') notes.push({ text: `Lewat estimasi awal +${stage.completion.days} hr`, kind: 'warn' });
  notes.push(stage.revisionCount > 0 ? { text: `Direvisi ${stage.revisionCount}×${stage.revisionAtLimit ? ' ⚠' : ''}`, kind: stage.revisionAtLimit ? 'late' : 'rev' } : { text: 'Tanpa revisi', kind: 'muted' });
  if (stage.baseline) notes.push({ text: `Estimasi awal ${shortDate(stage.baseline.start)}–${shortDate(stage.baseline.end)}`, kind: 'muted' });
  return notes;
}

/** Gaya inline chip catatan menurut jenisnya (token mockup). */
const NOTE_STYLE: Record<Note['kind'], CSSProperties> = {
  ok: { background: 'var(--ok-bg)', color: 'var(--ok)', padding: '1px 8px', borderRadius: 10 },
  late: { background: 'var(--late-bg)', color: 'var(--late)', padding: '1px 8px', borderRadius: 10 },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn)', padding: '1px 8px', borderRadius: 10 },
  rev: { background: 'var(--soft)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '1px 8px', borderRadius: 10 },
  muted: { color: 'var(--muted)' },
};

/**
 * Menentukan posisi catatan: di kanan bar; dibalik ke kiri bila tidak muat; tidak keluar dari grafik.
 * Masukan: ujung kanan bar (piksel), kiri bar, lebar catatan perkiraan, dan lebar jalur. Keluaran: gaya posisi.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: mockup v0.2 (variabel nPos).
 */
function notePosition(endPx: number, leftPx: number, noteWidth: number, trackWidth: number): CSSProperties {
  if (endPx + 8 + noteWidth <= trackWidth) return { left: endPx + 8 };
  if (leftPx - 8 - noteWidth >= 0) return { right: trackWidth - leftPx + 8 };
  return { left: endPx + 8, maxWidth: Math.max(120, trackWidth - endPx - 12), overflow: 'hidden' };
}

/**
 * Bar Gantt satu tahapan seperti mockup: bar estimasi terkini berisi PIC dan progres, estimasi awal (kotak putus-putus),
 * tambahan waktu hasil revisi (bergaris kuning), telat murni (bergaris merah "+n hr"), hold (bergaris ungu), garis aktual,
 * catatan di samping bar, dan garis hari ini. Tahapan tanpa timeline menampilkan teks "Belum ada timeline" beserta tautan Atur.
 * Masukan: kode dan nama project, tahapan, skala waktu, penanda lapisan, dan data dialog. Keluaran: sel jalur satu baris.
 * Efek samping: tidak ada pada komponen ini; bar dan "Atur" bagi pelaku yang berhak membuka dialog Perbarui Tahapan
 * (komponen klien `StageEditTrigger`), selain itu berupa tautan ke Detail Project.
 * Rujukan: FR-12-01 butir 1 dan 7, FR-12-02, BL-17, CL-026, CL-027, handoff UX/UI §9, mockup v0.2.
 */
export function GanttStageBar({ projectCode, projectName, stage, timeline, showLayers, editContext, showDetailLink = true }: GanttStageBarProps) {
  const bar = stage.bar;
  const canEdit = stage.rights.update || stage.rights.reopen || stage.rights.fillTimeline || stage.rights.editAssignees;
  const href = canEdit ? `/project/${projectCode}?ubah=${stage.kind}` : `/project/${projectCode}#tahap-${stage.kind}`;
  const opensDialog = canEdit && editContext !== undefined;

  if (!bar) {
    return (
      <span className={styles.gnt}>
        Belum ada timeline · {stage.assignees.length > 0 ? formatAssignees(stage.assignees) : 'belum ada PIC'}
        {opensDialog ? <> <StageEditTrigger projectCode={projectCode} projectName={projectName} stage={stage} context={editContext} variant="link" showDetailLink={showDetailLink}>Atur</StageEditTrigger></> : canEdit ? <> <Link href={href}>Atur</Link></> : null}
      </span>
    );
  }

  const main = placeRange(timeline, bar.estimate);
  const baseline = showLayers && bar.baseline ? placeRange(timeline, bar.baseline) : null;
  const extension = showLayers && bar.extension ? placeRange(timeline, bar.extension) : null;
  const overrun = bar.overrun ? placeRange(timeline, bar.overrun) : null;
  const actual = showLayers && bar.actual ? placeRange(timeline, bar.actual) : null;
  const holds = bar.holdSegments.map((segment) => placeRange(timeline, segment)).filter((span): span is Span => span !== null);
  const done = stage.status === 'DONE';
  const held = stage.status === 'HELD';
  const doneLate = done && (stage.completion?.kind === 'LATE' || stage.completion?.kind === 'PAST_BASELINE');
  const classes = [styles.gb, styles[stage.kind], bar.lateOutline && !done ? styles.late : '', done ? styles.done : '', doneLate ? styles.dlate : '', stage.isMine ? styles.mine : '', held ? styles.hold : ''].filter(Boolean).join(' ');

  const notes = showLayers ? buildNotes(stage) : [];
  const noteWidth = notes.reduce((total, note) => total + note.text.length * 6.3 + 22, 0);
  const endPx = Math.max((main?.leftPx ?? 0) + (main?.widthPx ?? 0), overrun ? overrun.leftPx + overrun.widthPx : 0);
  const tip = `${barTip(projectName, stage)}${extension ? ' | Termasuk tambahan waktu setelah estimasi awal' : ''}`;

  return (
    <>
      {baseline ? <div className={styles.gbase} style={{ left: baseline.leftPx, width: baseline.widthPx }} title={`Estimasi awal ${formatRange(bar.baseline)}`} /> : null}
      {main ? (() => {
        const content = (
          <>
            <i className={styles.pg} style={{ width: `${stage.progress.effective}%` }} />
            {extension ? <i className={styles.sext} style={{ left: extension.leftPx - main.leftPx, width: Math.max(0, Math.min(extension.widthPx, main.widthPx - (extension.leftPx - main.leftPx))) }} /> : null}
            <span className={styles.txt}>{barText(stage, bar.estimate.start < timeline.start, bar.estimate.end > timeline.end)}</span>
          </>
        );
        const position = { left: main.leftPx, width: main.widthPx };
        return opensDialog ? (
          <StageEditTrigger projectCode={projectCode} projectName={projectName} stage={stage} context={editContext} variant="bar" className={classes} style={position} title={tip} ariaLabel={tip} showDetailLink={showDetailLink}>{content}</StageEditTrigger>
        ) : (
          <Link href={href} className={classes} style={position} title={tip} aria-label={tip}>{content}</Link>
        );
      })() : null}
      {overrun && bar.overrun ? (
        <div className={styles.gover} style={{ left: overrun.leftPx, width: overrun.widthPx }} title={`Telat ${bar.overrun.days} hari dari estimasi terkini`}>
          <span>+{bar.overrun.days} hr</span>
        </div>
      ) : null}
      {actual ? <div className={`${styles.gact} ${!done && !held ? styles.live : ''}`} style={{ left: actual.leftPx, width: actual.widthPx }} title="Aktual" /> : null}
      {showLayers ? holds.map((span, index) => <div key={index} className={`${styles.gact} ${styles.hld}`} style={{ left: span.leftPx, width: span.widthPx }} title="Ditahan" />) : null}
      {notes.length > 0 ? (
        <div className={styles.gnote} style={notePosition(endPx, main?.leftPx ?? 0, noteWidth, timeline.widthPx)}>
          {notes.map((note) => <span key={note.text} style={NOTE_STYLE[note.kind]}>{note.text}</span>)}
        </div>
      ) : null}
    </>
  );
}
