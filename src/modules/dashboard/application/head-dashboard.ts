/**
 * Dashboard Head BA dan QA (Manager): tujuh kartu ringkasan, project terlambat atau berisiko, tahapan jatuh tempo 7
 * hari, kapasitas tim, tahapan dan kartu per peran, serta kualitas pencatatan (FR-04-01 sampai FR-04-06).
 *
 * Dasar hitung: tahapan belum Selesai pada project selain Batal dan Selesai. Angka kartu sama dengan layar tujuan
 * (NFR-14) karena memakai tampilan project yang sama dengan Daftar dan Gantt.
 */
import type { Actor } from '@/modules/auth';
import { getCompliance } from '@/modules/kanban';
import { listActiveProjectViews, type ProjectView, type StageKind, type StageView } from '@/modules/project';
import { addDays, calendarDaysBetween, weekRange } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import { isStaleInProgress, weeklyLogQuality, type LogQuality } from '../domain/activity-quality';
import { capacityRange, picCapacity, type CapacityMode, type PicCapacity } from './capacity-view';
import type { DashboardDeps, LoginPic } from './ports';

/** Satu baris tabel risiko. */
export interface RiskRow {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly pics: ReadonlyArray<string>;
  readonly end: IsoDate | null;
  readonly progress: number;
  readonly lateDays: number;
  readonly lagging: boolean;
  readonly held: boolean;
  /** Jumlah revisi bila mencapai batas peringatan; null bila tidak. */
  readonly revisionAtLimit: number | null;
}

/** Satu baris tahapan jatuh tempo dalam 7 hari. */
export interface DueRow {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly pics: ReadonlyArray<string>;
  readonly end: IsoDate;
  /** Hari menuju tenggat (0 = hari ini). */
  readonly daysLeft: number;
  readonly lagging: boolean;
  readonly progress: number;
}

/** Ringkasan per peran (FR-04-05). */
export interface RoleSummary {
  readonly role: 'BA' | 'QA';
  readonly picCount: number;
  readonly running: number;
  readonly notStarted: number;
  readonly planned: number;
  readonly inProgress: number;
  readonly done: number;
  readonly adhoc: number;
}

/** Satu baris kualitas pencatatan (FR-04-06). */
export interface QualityRow {
  readonly picId: number;
  readonly name: string;
  readonly weekMinutes: number;
  readonly percent: number;
  readonly quality: LogQuality;
  readonly staleCards: number;
  /** Kepatuhan rencana minggu ini; null bila tanpa penyebut. */
  readonly compliance: number | null;
}

/** Baris kapasitas satu PIC pada tabel Head. */
export interface CapacityRow {
  readonly pic: LoginPic;
  readonly capacity: PicCapacity['summary'];
}

/** Dashboard Head lengkap. */
export interface HeadDashboard {
  readonly cards: {
    readonly late: number;
    readonly lagging: number;
    readonly due7: number;
    readonly overloaded: number;
    readonly held: number;
    readonly extending: number;
    readonly incomplete: number;
  };
  readonly risks: { readonly rows: ReadonlyArray<RiskRow>; readonly total: number };
  readonly due: ReadonlyArray<DueRow>;
  readonly capacity: { readonly mode: CapacityMode; readonly offset: number; readonly range: { start: IsoDate; end: IsoDate }; readonly rows: ReadonlyArray<CapacityRow> };
  readonly roles: ReadonlyArray<RoleSummary>;
  readonly quality: ReadonlyArray<QualityRow>;
}

/** Jumlah baris tabel risiko yang ditampilkan (FR-04-02 butir 3). */
const RISK_LIMIT = 8;

/**
 * Mengumpulkan tahapan belum Selesai beserta project-nya dari tampilan project aktif.
 * Masukan: project aktif. Keluaran: pasangan project dan tahapan.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-04-01 (dasar hitung).
 */
function openStages(projects: ReadonlyArray<ProjectView>): Array<{ project: ProjectView; stage: StageView }> {
  return projects.flatMap((project) => project.stages.filter((stage) => stage.status !== 'DONE').map((stage) => ({ project, stage })));
}

/**
 * Menyusun tabel risiko: tahapan terlambat, tertinggal, ditahan (project Berjalan), atau revisi mencapai batas, diurut
 * dari keterlambatan terlama lalu jumlah risiko terbanyak.
 * Masukan: tahapan terbuka. Keluaran: seluruh baris terurut.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-04-02; AC: terlambat 5 hari di atas 2 hari; hanya direvisi tanpa mencapai batas tidak tampil.
 */
function buildRisks(stages: ReadonlyArray<{ project: ProjectView; stage: StageView }>): RiskRow[] {
  const rows: RiskRow[] = [];
  for (const { project, stage } of stages) {
    const held = stage.status === 'HELD' && project.status === 'RUNNING';
    const revisionAtLimit = stage.revisionAtLimit ? stage.revisionCount : null;
    if (!stage.lateness.isLate && !stage.progress.lagging && !held && revisionAtLimit === null) continue;
    rows.push({
      projectCode: project.code,
      projectName: project.name,
      stage: stage.kind,
      pics: stage.assignees.map((a) => a.name),
      end: stage.estimate?.end ?? null,
      progress: stage.progress.effective,
      lateDays: stage.lateness.daysPastCurrent,
      lagging: stage.progress.lagging,
      held,
      revisionAtLimit,
    });
  }
  const riskCount = (row: RiskRow) => [row.lateDays > 0, row.lagging, row.held, row.revisionAtLimit !== null].filter(Boolean).length;
  return rows.sort((a, b) => b.lateDays - a.lateDays || riskCount(b) - riskCount(a) || a.projectCode.localeCompare(b.projectCode));
}

/**
 * Menyusun tahapan jatuh tempo dalam 7 hari: bertimeline, project Berjalan, tidak Ditahan, tenggat antara hari ini dan
 * 7 hari ke depan, diurut tenggat terdekat.
 * Masukan: tahapan terbuka dan hari ini. Keluaran: baris terurut.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-04-03, CL-042a; AC: tenggat hari ini = "hari ini"; tahapan Ditahan tidak tampil.
 */
function buildDue(stages: ReadonlyArray<{ project: ProjectView; stage: StageView }>, today: IsoDate): DueRow[] {
  const limit = addDays(today, 7);
  return stages
    .filter(({ project, stage }) => project.status === 'RUNNING' && stage.status !== 'HELD' && stage.estimate !== null && stage.estimate.end >= today && stage.estimate.end <= limit)
    .map(({ project, stage }) => ({
      projectCode: project.code,
      projectName: project.name,
      stage: stage.kind,
      pics: stage.assignees.map((a) => a.name),
      end: (stage.estimate as { end: IsoDate }).end,
      daysLeft: calendarDaysBetween(today, (stage.estimate as { end: IsoDate }).end),
      lagging: stage.progress.lagging,
      progress: stage.progress.effective,
    }))
    .sort((a, b) => a.end.localeCompare(b.end) || a.projectCode.localeCompare(b.projectCode));
}

/**
 * Menyusun Dashboard Head. Kartu 4 (PIC kelebihan beban) selalu minggu berjalan; tabel kapasitas mengikuti pilihan
 * periode. Kartu 6 memakai definisi yang sama dengan filter Kanban "memperpanjang estimasi tahapan".
 * Masukan: dependensi, pelaku (Manager), mode dan pergeseran kapasitas. Keluaran: `HeadDashboard`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-04-01 sampai FR-04-06, BL-43, NFR-14.
 */
export async function getHeadDashboard(deps: DashboardDeps, actor: Actor, input: { mode: CapacityMode; offset: number }): Promise<HeadDashboard> {
  const today = deps.clock.today();
  const thisWeek = weekRange(today);
  const range = capacityRange(input.mode, input.offset, today);
  const [projects, pics, extending, weekCards, weekLogs, rangeCards, rangeLogs, openCards, compliance] = await Promise.all([
    listActiveProjectViews(deps.project, actor),
    deps.reads.listLoginPics(),
    deps.kanban.queries.countExtending(),
    deps.reads.listCardsOverlapping(thisWeek),
    deps.reads.logMinutesByPic(thisWeek),
    deps.reads.listCardsOverlapping(range),
    deps.reads.logMinutesByPic(range),
    deps.reads.listOpenCards(null, ['IN_PROGRESS']),
    getCompliance(deps.kanban, { period: 'THIS_WEEK', from: null, to: null }),
  ]);
  const stages = openStages(projects);
  const risks = buildRisks(stages);
  const due = buildDue(stages, today);

  const capacityFor = (cards: typeof weekCards, logs: typeof weekLogs, picId: number, period: { start: IsoDate; end: IsoDate }, mode: CapacityMode) =>
    picCapacity(cards.filter((card) => card.picId === picId), period, mode, () => logs.get(picId) ?? 0);
  const overloaded = pics.filter((pic) => capacityFor(weekCards, weekLogs, pic.id, thisWeek, 'WEEK').summary.status === 'OVER').length;

  const inProgressIds = openCards.filter((card) => card.column === 'IN_PROGRESS').map((card) => card.id);
  const lastLogs = await deps.reads.lastLogDates(inProgressIds);
  const staleByPic = new Map<number, number>();
  for (const card of openCards) {
    if (card.column === 'IN_PROGRESS' && isStaleInProgress(lastLogs.get(card.id) ?? null, today)) staleByPic.set(card.picId, (staleByPic.get(card.picId) ?? 0) + 1);
  }

  const roles: RoleSummary[] = (['BA', 'QA'] as const).map((role) => {
    const ids = new Set(pics.filter((pic) => pic.stage === role).map((pic) => pic.id));
    const activeCount = pics.filter((pic) => pic.stage === role && pic.isActive).length;
    const cards = weekCards.filter((card) => ids.has(card.picId));
    const roleStages = stages.filter(({ stage }) => stage.kind === role);
    return {
      role,
      picCount: activeCount,
      running: roleStages.filter(({ project, stage }) => project.status === 'RUNNING' && stage.status === 'RUNNING').length,
      notStarted: roleStages.filter(({ stage }) => stage.status === 'NOT_STARTED').length,
      planned: cards.filter((card) => card.column === 'PLANNED').length,
      inProgress: cards.filter((card) => card.column === 'IN_PROGRESS').length,
      done: cards.filter((card) => card.column === 'DONE').length,
      adhoc: cards.filter((card) => card.isAdhoc).length,
    };
  });

  return {
    cards: {
      late: stages.filter(({ stage }) => stage.lateness.isLate).length,
      lagging: stages.filter(({ stage }) => stage.progress.lagging).length,
      due7: due.length,
      overloaded,
      held: stages.filter(({ stage }) => stage.status === 'HELD').length,
      extending,
      incomplete: projects.filter((project) => !project.planning.isComplete).length,
    },
    risks: { rows: risks.slice(0, RISK_LIMIT), total: risks.length },
    due,
    capacity: { mode: input.mode, offset: input.offset, range, rows: pics.map((pic) => ({ pic, capacity: capacityFor(rangeCards, rangeLogs, pic.id, range, input.mode).summary })).filter((row) => row.pic.isActive || row.capacity.plannedMinutes > 0 || row.capacity.actualMinutes > 0) },
    roles,
    quality: pics.filter((pic) => pic.isActive || (weekLogs.get(pic.id) ?? 0) > 0).map((pic) => {
      const minutes = weekLogs.get(pic.id) ?? 0;
      const rating = weeklyLogQuality(minutes, today);
      return { picId: pic.id, name: pic.name, weekMinutes: minutes, percent: rating.percent, quality: rating.quality, staleCards: staleByPic.get(pic.id) ?? 0, compliance: compliance.rows.find((row) => row.picId === pic.id)?.percent ?? null };
    }),
  };
}
