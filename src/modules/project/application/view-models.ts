/**
 * Model tampilan project dan tahapan untuk layar (Daftar, Gantt, Detail).
 *
 * Seluruh angka dan penanda (progres, Tertinggal, Terlambat, bar Gantt, hak tombol) dihitung SEKALI di sini
 * dengan aturan domain, lalu dipakai bersama semua layar supaya angkanya konsisten (NFR-12, NFR-14). Layar hanya
 * menampilkan, tidak menghitung ulang.
 */
import type { IsoDate } from '@/shared/iso-date';
import { ganttBarModel, type GanttBar } from '../domain/gantt-bar';
import { planningCompleteness, type PlanningCompleteness, type ProjectType } from '../domain/project-rules';
import { estimateShiftWorkdays, revisionWarning } from '../domain/revision';
import {
  completionVerdict,
  displayStatus,
  stageLateness,
  type CompletionVerdict,
  type DisplayStatus,
  type Lateness,
} from '../domain/stage-lateness';
import { effectiveStageProgress, expectedProgress, isLagging, stageSystemProgress } from '../domain/stage-progress';
import { canEditAssignees, canFillTimeline, canUpdateStage } from '../domain/stage-rules';
import type { Estimate, HoldPeriod, ProjectStatus, StageActor, StageKind, StageStatus } from '../domain/stage-types';
import type { ApplicationRef, PicCardSummary, ProjectSnapshot, StageCardFacts, StageSnapshot } from './ports';
import { STAGE_LABEL, stageAccess } from './support';

/** Bahan yang sama untuk membangun seluruh tampilan pada satu permintaan. */
export interface ViewContext {
  readonly today: IsoDate;
  /** Batas peringatan revisi berulang (master). */
  readonly revisionThreshold: number;
  /** Pelaku yang sedang melihat (menentukan tombol dan penanda "milik saya"). */
  readonly actor: StageActor;
}

/** Rincian progres sebuah tahapan. */
export interface StageProgressView {
  /** Angka yang berlaku (100 bila Selesai, manual bila ada, selain itu hitungan sistem). */
  readonly effective: number;
  /** Hitungan sistem dari kartu; null bila tidak ada kartu. */
  readonly system: number | null;
  /** Angka manual yang berlaku; null bila mengikuti hitungan sistem. */
  readonly manual: number | null;
  readonly manualNote: string | null;
  readonly manualBy: string | null;
  /** Progres diharapkan menurut laju (0..100). */
  readonly expected: number;
  /** True bila ditandai "Tertinggal dari laju". */
  readonly lagging: boolean;
  readonly cardCount: number;
  /** Rincian per PIC (jumlah kartu dan progres), terlihat semua pengguna. */
  readonly perPic: ReadonlyArray<PicCardSummary>;
  /** Nama PIC tahapan yang belum punya kartu, ditampilkan sebagai peringatan bila tahapan punya lebih dari satu PIC. */
  readonly picsWithoutCards: ReadonlyArray<string>;
  /** Nama PIC dengan progres terendah, disebut pada penanda Tertinggal. */
  readonly lowestPic: string | null;
}

/** Hak tombol pelaku pada satu tahapan (ditentukan server, bukan UI). */
export interface StageRights {
  readonly update: boolean;
  readonly editAssignees: boolean;
  readonly fillTimeline: boolean;
  /** Membuka kembali tahapan Selesai (hanya Manager). */
  readonly reopen: boolean;
}

/** Satu tahapan siap tampil. */
export interface StageView {
  readonly stageId: number;
  readonly kind: StageKind;
  readonly label: string;
  readonly status: StageStatus;
  /** Versi baris untuk penguncian optimistis pada formulir (NFR-10). */
  readonly version: number;
  readonly display: DisplayStatus;
  readonly assignees: ReadonlyArray<{ picId: number; name: string; isNew: boolean }>;
  readonly estimate: Estimate | null;
  readonly baseline: Estimate | null;
  readonly actualStart: IsoDate | null;
  readonly actualEnd: IsoDate | null;
  readonly holdSince: IsoDate | null;
  readonly holdReason: string | null;
  /** Riwayat penahanan: periode yang sudah berakhir (terlama di atas); hold berjalan ada pada `holdSince`. */
  readonly holdHistory: ReadonlyArray<{ readonly since: IsoDate; readonly resumedOn: IsoDate; readonly reason: string }>;
  readonly progress: StageProgressView;
  readonly lateness: Lateness;
  readonly completion: CompletionVerdict | null;
  readonly revisionCount: number;
  /** Revisi mencapai batas peringatan (penanda pada kartu tahapan dan Gantt). */
  readonly revisionAtLimit: boolean;
  /** Pergeseran estimasi selesai terhadap estimasi awal dalam hari kerja; null bila belum ada keduanya. */
  readonly shiftWorkdays: number | null;
  readonly bar: GanttBar | null;
  /** True bila tahapan ini milik PIC yang sedang melihat. */
  readonly isMine: boolean;
  readonly rights: StageRights;
}

/** Satu project siap tampil. */
export interface ProjectView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly referenceNo: string | null;
  readonly projectType: ProjectType | null;
  readonly businessOwner: string | null;
  readonly department: string | null;
  readonly requestDate: IsoDate | null;
  readonly uatSignOffDate: IsoDate | null;
  readonly goLiveDate: IsoDate | null;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly statusReason: string | null;
  readonly version: number;
  readonly applications: ReadonlyArray<ApplicationRef>;
  readonly stages: ReadonlyArray<StageView>;
  /** Estimasi keseluruhan: mulai paling awal sampai selesai paling akhir; null bila tidak ada timeline. */
  readonly overall: Estimate | null;
  /** True bila kurang dari tiga tahapan punya estimasi ("sebagian tahapan"). */
  readonly overallPartial: boolean;
  readonly planning: PlanningCompleteness;
  /** True bila sedikitnya satu tahapan terlambat (penanda pada status project di Daftar). */
  readonly hasLateStage: boolean;
}

/**
 * Menyusun daftar periode hold (selesai dan berjalan) sebuah tahapan untuk perhitungan laju.
 * Masukan: snapshot tahapan. Keluaran: daftar `HoldPeriod`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-05-02 butir 6.
 */
function holdPeriodsOf(stage: StageSnapshot): HoldPeriod[] {
  const periods: HoldPeriod[] = stage.holdHistory.map((hold) => ({ since: hold.since, resumedOn: hold.resumedOn }));
  if (stage.status === 'HELD' && stage.holdSince) periods.push({ since: stage.holdSince, resumedOn: null });
  return periods;
}

/**
 * Membangun rincian progres sebuah tahapan dari kartu dan data tahapan.
 * Masukan: snapshot tahapan, fakta kartu (boleh kosong), status project, konteks. Keluaran: `StageProgressView`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-05-02 butir 1 sampai 6, BL-40.
 */
function buildProgress(stage: StageSnapshot, facts: StageCardFacts | undefined, projectStatus: ProjectStatus, ctx: ViewContext): StageProgressView {
  const cards = facts?.cards ?? [];
  const system = stageSystemProgress(cards, stage.status === 'DONE');
  const effective = effectiveStageProgress({ status: stage.status, systemProgress: system, manualProgress: stage.manualProgress });
  const expected = stage.estimate ? expectedProgress(stage.estimate, holdPeriodsOf(stage), ctx.today) : 0;
  const perPic = facts?.perPic ?? [];
  const picsWithoutCards =
    stage.assignees.length > 1 && cards.length > 0
      ? stage.assignees.filter((a) => !perPic.some((p) => p.picId === a.picId)).map((a) => a.name)
      : [];
  const lowest = [...perPic].sort((a, b) => a.progress - b.progress)[0];
  return {
    effective,
    system,
    manual: stage.status === 'DONE' ? null : stage.manualProgress,
    manualNote: stage.manualProgressNote,
    manualBy: stage.manualProgressByLabel,
    expected,
    lagging: stage.estimate ? isLagging({ stageStatus: stage.status, projectStatus, progress: effective, expected }) : false,
    cardCount: cards.length,
    perPic,
    picsWithoutCards,
    lowestPic: lowest ? lowest.name : null,
  };
}

/**
 * Membangun tampilan satu tahapan lengkap dengan penanda, bar Gantt, dan hak tombol.
 * Masukan: snapshot project dan tahapan, fakta kartu tahapan, konteks. Keluaran: `StageView`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-05-01, FR-05-02, FR-12-02, FR-13-03, FR-13-04, FR-13-05 butir 9, BL-45.
 */
export function buildStageView(project: ProjectSnapshot, stage: StageSnapshot, facts: StageCardFacts | undefined, ctx: ViewContext): StageView {
  const access = stageAccess(stage);
  const latenessInput = {
    stageStatus: stage.status,
    projectStatus: project.status,
    estimate: stage.estimate,
    baseline: stage.baseline,
    today: ctx.today,
  };
  const picId = ctx.actor.picId;
  const isMine = picId !== null && stage.assignees.some((a) => a.picId === picId);
  return {
    stageId: stage.id,
    kind: stage.kind,
    label: STAGE_LABEL[stage.kind],
    status: stage.status,
    version: stage.version,
    display: displayStatus({ ...latenessInput, holdSince: stage.holdSince }),
    assignees: stage.assignees.map((a) => ({ picId: a.picId, name: a.name, isNew: a.picId === picId && a.seenAt === null })),
    estimate: stage.estimate,
    baseline: stage.baseline,
    actualStart: stage.actualStart,
    actualEnd: stage.actualEnd,
    holdSince: stage.holdSince,
    holdReason: stage.holdReason,
    holdHistory: stage.holdHistory,
    progress: buildProgress(stage, facts, project.status, ctx),
    lateness: stageLateness(latenessInput),
    completion:
      stage.status === 'DONE' && stage.actualEnd && stage.estimate ? completionVerdict(stage.actualEnd, stage.estimate, stage.baseline) : null,
    revisionCount: stage.revisionCount,
    revisionAtLimit: revisionWarning(stage.revisionCount, ctx.revisionThreshold).atLimit,
    shiftWorkdays: stage.estimate && stage.baseline ? estimateShiftWorkdays(stage.baseline, stage.estimate) : null,
    bar: ganttBarModel({
      stageStatus: stage.status,
      projectStatus: project.status,
      estimate: stage.estimate,
      baseline: stage.baseline,
      actualStart: stage.actualStart,
      actualEnd: stage.actualEnd,
      holds: holdPeriodsOf(stage),
      revisionCount: stage.revisionCount,
      revisionWarnThreshold: ctx.revisionThreshold,
      today: ctx.today,
    }),
    isMine,
    rights: {
      update: canUpdateStage(ctx.actor, access),
      editAssignees: canEditAssignees(ctx.actor, access),
      fillTimeline: canFillTimeline(ctx.actor, access),
      reopen: ctx.actor.role === 'MANAGER' && stage.status === 'DONE',
    },
  };
}

/**
 * Membangun tampilan satu project beserta tiga tahapannya.
 * Masukan: snapshot project, fakta kartu per id tahapan, konteks. Keluaran: `ProjectView`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-10-01, FR-11-01, FR-02-02 butir 4.
 */
export function buildProjectView(project: ProjectSnapshot, factsByStage: ReadonlyMap<number, StageCardFacts>, ctx: ViewContext): ProjectView {
  const stages = project.stages.map((stage) => buildStageView(project, stage, factsByStage.get(stage.id), ctx));
  const withTimeline = stages.filter((s) => s.estimate !== null);
  const starts = withTimeline.map((s) => (s.estimate as Estimate).start).sort();
  const ends = withTimeline.map((s) => (s.estimate as Estimate).end).sort();
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    referenceNo: project.referenceNo,
    projectType: project.projectType,
    businessOwner: project.businessOwner,
    department: project.department,
    requestDate: project.requestDate,
    uatSignOffDate: project.uatSignOffDate,
    goLiveDate: project.goLiveDate,
    description: project.description,
    status: project.status,
    statusReason: project.statusReason,
    version: project.version,
    applications: project.applications,
    stages,
    overall: starts.length > 0 ? { start: starts[0] as IsoDate, end: ends[ends.length - 1] as IsoDate } : null,
    overallPartial: withTimeline.length > 0 && withTimeline.length < stages.length,
    planning: planningCompleteness(project.stages.map((s) => ({ kind: s.kind, assignedCount: s.assignees.length, hasTimeline: s.estimate !== null }))),
    hasLateStage: stages.some((s) => s.lateness.isLate),
  };
}
