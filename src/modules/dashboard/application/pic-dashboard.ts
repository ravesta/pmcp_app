/**
 * Dashboard PIC: lima kartu pribadi, Assignment baru, Antrean pekerjaan, Timeline proyek saya beserta benturan jadwal,
 * kapasitas pribadi, ringkasan aktivitas harian, dan ringkasan riwayat (FR-07-01 sampai FR-07-07; BL-44, BL-45).
 */
import type { Actor } from '@/modules/auth';
import { listActiveProjectViews, listNewAssignments, type DisplayStatus, type Estimate, type NewAssignmentRow, type ProjectView, type StageKind, type StageView } from '@/modules/project';
import { addDays, monthRange, type DateRange } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import { findScheduleConflicts, type ScheduleConflict } from '../domain/schedule';
import { capacityRange, picCapacity, type CapacityMode, type PicCapacity } from './capacity-view';
import type { DashboardDeps } from './ports';

/** Urutan tahapan project untuk ketergantungan (BL-02). */
const STAGE_SEQUENCE: ReadonlyArray<StageKind> = ['BA', 'DEV', 'QA'];

/** Nama tahapan untuk pesan benturan jadwal. */
const STAGE_LABEL: Readonly<Record<StageKind, string>> = { BA: 'Business Analyst', DEV: 'Development', QA: 'Quality Assurance' };

/** Satu baris Antrean pekerjaan. */
export interface QueueRow {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly isNew: boolean;
  /** Step dari kartu PIC yang belum Done pada tahapan itu ("Fokus"). */
  readonly focusStep: string | null;
  readonly estimate: Estimate | null;
  readonly display: DisplayStatus;
  readonly lateDays: number;
  readonly lagging: boolean;
  readonly progress: number;
  /** True bila angka progres adalah penyesuaian manual (ditandai `*`). */
  readonly progressManual: boolean;
  /** Tahapan sebelumnya yang belum Selesai (informasi, tidak memblokir). */
  readonly waitingFor: { readonly stage: StageKind; readonly end: IsoDate | null } | null;
  readonly canUpdate: boolean;
  /** Tahapan lengkap untuk dialog Perbarui Tahapan yang dibuka dari antrean. */
  readonly stageView: StageView;
}

/** Tahapan pada Timeline proyek saya. */
export interface TimelineStage {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly estimate: Estimate;
  readonly progress: number;
  readonly display: DisplayStatus;
}

/** Ringkasan kartu Kanban per jenis (FR-07-06). */
export interface CardSummary {
  readonly planned: number;
  readonly inProgress: number;
  readonly late: number;
  readonly open: number;
  readonly doneToday: number;
}

/** Dashboard PIC lengkap. */
export interface PicDashboard {
  readonly cards: { readonly newAssignments: number; readonly activeWork: number; readonly late: number; readonly due7: number; readonly todayMinutes: number; readonly todayLogs: number };
  readonly assignments: ReadonlyArray<NewAssignmentRow>;
  readonly queue: ReadonlyArray<QueueRow>;
  readonly timeline: { readonly range: DateRange; readonly stages: ReadonlyArray<TimelineStage>; readonly conflicts: ReadonlyArray<ScheduleConflict>; readonly projects: ReadonlyArray<ProjectView> };
  /** Batas peringatan revisi berulang untuk dialog Perbarui Tahapan. */
  readonly revisionThreshold: number;
  readonly capacity: { readonly mode: CapacityMode; readonly offset: number; readonly range: DateRange; readonly value: PicCapacity };
  readonly activity: { readonly project: CardSummary; readonly activity: CardSummary };
  readonly history: { readonly doneCount: number; readonly latest: { readonly date: IsoDate | null; readonly projectCode: string; readonly projectName: string; readonly stage: StageKind } | null };
}

/**
 * Mencari tahapan sebelumnya yang belum Selesai pada project yang sama (ketergantungan informatif).
 * Masukan: project dan tahapan. Keluaran: tahapan yang ditunggu beserta estimasi selesainya, atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-03 butir 3 (tidak memblokir, CL-042e); AC: QA yang BA-nya belum selesai = "Menunggu Business Analyst".
 */
function waitingFor(project: ProjectView, stage: StageView): QueueRow['waitingFor'] {
  const before = STAGE_SEQUENCE.slice(0, STAGE_SEQUENCE.indexOf(stage.kind));
  const pending = project.stages.filter((s) => before.includes(s.kind) && s.status !== 'DONE');
  const last = pending.at(-1);
  return last ? { stage: last.kind, end: last.estimate?.end ?? null } : null;
}

/**
 * Menyusun ringkasan kartu satu jenis dari kartu terbuka dan jumlah selesai hari ini.
 * Masukan: kartu terbuka (satu jenis), jumlah selesai hari ini, dan hari ini. Keluaran: `CardSummary`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-06 butir 2; AC: 2 Planned dan 1 In Progress terlambat menampilkan 2, 1, 1.
 */
function summarize(cards: ReadonlyArray<{ column: string; planEnd: IsoDate }>, doneToday: number, today: IsoDate): CardSummary {
  return {
    planned: cards.filter((card) => card.column === 'PLANNED').length,
    inProgress: cards.filter((card) => card.column === 'IN_PROGRESS').length,
    late: cards.filter((card) => card.planEnd < today).length,
    open: cards.length,
    doneToday,
  };
}

/**
 * Menyusun Dashboard PIC bagi akun PIC yang login. Penanda Assignment baru hilang saat PIC membuka detail project.
 * Masukan: dependensi, pelaku PIC, mode dan pergeseran kapasitas. Keluaran: `PicDashboard`.
 * Efek samping: tidak ada (hanya baca; tidak menandai penugasan sebagai dilihat).
 * Rujukan: FR-07-01 sampai FR-07-07, BL-44, BL-45.
 */
export async function getPicDashboard(deps: DashboardDeps, actor: Actor, input: { mode: CapacityMode; offset: number }): Promise<PicDashboard> {
  const picId = actor.picId as number;
  const today = deps.clock.today();
  const range = capacityRange(input.mode, input.offset, today);
  const timelineRange = { start: monthRange(today).start, end: monthRange(today, 2).end };
  const [projects, assignments, rangeCards, openCards, rangeLogs, dayTotals, doneKinds, doneStages] = await Promise.all([
    listActiveProjectViews(deps.project, actor),
    listNewAssignments(deps.project, actor),
    deps.reads.listCardsOverlapping(range),
    deps.reads.listOpenCards(picId),
    deps.reads.listLogs(picId, range),
    deps.reads.dayLogTotals(picId, today),
    deps.reads.doneOnByKind(picId, today),
    deps.reads.listDoneStages({ q: '', stage: null, doneRange: null, picId, page: 1, pageSize: 1 }),
  ]);

  const mine = projects.flatMap((project) => project.stages.filter((stage) => stage.status !== 'DONE' && stage.kind !== 'DEV' && stage.assignees.some((a) => a.picId === picId)).map((stage) => ({ project, stage })));
  const newKeys = new Set(assignments.map((row) => `${row.projectCode}:${row.stage}`));
  const isNew = (project: ProjectView, stage: StageView) => newKeys.has(`${project.code}:${stage.kind}`);
  const limit = addDays(today, 7);

  const stepByStage = await focusSteps(deps, picId);
  const revisionThreshold = await deps.project.reference.getRevisionWarnThreshold();

  const queue: QueueRow[] = mine
    .map(({ project, stage }) => ({
      projectCode: project.code,
      projectName: project.name,
      stage: stage.kind,
      isNew: isNew(project, stage),
      focusStep: stepByStage.get(`${project.id}:${stage.kind}`) ?? null,
      estimate: stage.estimate,
      display: stage.display,
      lateDays: stage.lateness.daysPastCurrent,
      lagging: stage.progress.lagging,
      progress: stage.progress.effective,
      progressManual: stage.progress.manual !== null,
      waitingFor: waitingFor(project, stage),
      canUpdate: stage.rights.update || stage.rights.editAssignees || stage.rights.fillTimeline,
      stageView: stage,
    }))
    .sort((a, b) => b.lateDays - a.lateDays || Number(b.lagging) - Number(a.lagging) || (a.estimate?.end ?? '9999').localeCompare(b.estimate?.end ?? '9999') || (a.estimate?.start ?? '9999').localeCompare(b.estimate?.start ?? '9999'));

  const timelineStages: TimelineStage[] = mine
    .filter(({ stage }) => stage.estimate !== null)
    .map(({ project, stage }) => ({ projectCode: project.code, projectName: project.name, stage: stage.kind, estimate: stage.estimate as Estimate, progress: stage.progress.effective, display: stage.display }));
  // project dengan hanya tahapan milik PIC yang beririsan dengan rentang timeline, diurut menurut estimasi mulai (untuk Gantt)
  const ganttProjects = projects
    .map((project) => ({ ...project, stages: mine.filter((entry) => entry.project.id === project.id && entry.stage.estimate !== null && entry.stage.estimate.end >= timelineRange.start && entry.stage.estimate.start <= timelineRange.end).map((entry) => entry.stage) }))
    .filter((project) => project.stages.length > 0)
    .sort((a, b) => (a.stages[0]?.estimate?.start ?? '').localeCompare(b.stages[0]?.estimate?.start ?? ''));
  const conflicts = findScheduleConflicts(timelineStages.map((s) => ({ key: `${s.projectCode}:${s.stage}`, label: `${s.projectName} (${STAGE_LABEL[s.stage]})`, start: s.estimate.start, end: s.estimate.end })));

  const minutesIn = (slice: DateRange) => rangeLogs.filter((log) => log.date >= slice.start && log.date <= slice.end).reduce((sum, log) => sum + (log.endMinute - log.startMinute), 0);
  const ownCards = rangeCards.filter((card) => card.picId === picId);
  const byKind = (kind: 'PROJECT' | 'ACTIVITY') => openCards.filter((card) => card.kind === kind);
  const latest = doneStages.rows[0];

  return {
    cards: {
      newAssignments: assignments.length,
      activeWork: mine.length - mine.filter(({ project, stage }) => isNew(project, stage)).length,
      late: mine.filter(({ stage }) => stage.lateness.isLate).length,
      due7: mine.filter(({ stage }) => stage.estimate !== null && stage.estimate.end >= today && stage.estimate.end <= limit).length,
      todayMinutes: dayTotals.minutes,
      todayLogs: dayTotals.count,
    },
    assignments,
    queue,
    revisionThreshold,
    timeline: { range: timelineRange, stages: timelineStages, conflicts, projects: ganttProjects },
    capacity: { mode: input.mode, offset: input.offset, range, value: picCapacity(ownCards, range, input.mode, minutesIn) },
    activity: { project: summarize(byKind('PROJECT'), doneKinds.PROJECT, today), activity: summarize(byKind('ACTIVITY'), doneKinds.ACTIVITY, today) },
    history: {
      doneCount: doneStages.total,
      latest: latest ? { date: latest.doneOn, projectCode: latest.projectCode, projectName: latest.projectName, stage: latest.stage } : null,
    },
  };
}

/**
 * Membaca step "Fokus" tiap tahapan PIC: step kartu project PIC yang belum Done dan paling awal rencananya.
 * Masukan: dependensi dan id PIC. Keluaran: peta "projectId:tahapan" ke nama step.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-07-03 butir 1 ("Fokus: step").
 */
async function focusSteps(deps: DashboardDeps, picId: number): Promise<Map<string, string>> {
  const rows = await deps.kanban.queries.listBoard({ range: null, picId, kind: 'PROJECT', q: '', extendsOnly: false });
  const result = new Map<string, string>();
  for (const row of rows) {
    const { card } = row;
    if (card.column === 'DONE' || !card.stepName || card.projectId === null || card.stage === null) continue;
    const key = `${card.projectId}:${card.stage}`;
    if (!result.has(key)) result.set(key, card.stepName);
  }
  return result;
}
