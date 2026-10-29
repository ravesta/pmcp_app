/**
 * View model kartu untuk UI: kartu ditambah penanda rencana, progres yang berlaku, dan hak pelaku. Entitas database
 * tidak pernah keluar dari lapisan application (NFR-01).
 */
import type { Actor } from '@/modules/auth';
import type { Estimate, ProjectStatus, StageKind } from '@/modules/project';
import { workdaysAfter } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import { computeMarkers, effectiveCardProgress, type PlanMarker } from '../domain/card-rules';
import type { CardColumn, CardKind } from '../domain/card-types';
import type { BoardCardRow } from './ports';

/** Kartu siap tampil. */
export interface CardView {
  readonly id: number;
  readonly code: string;
  readonly kind: CardKind;
  readonly title: string;
  readonly owner: { readonly picId: number; readonly name: string };
  readonly project: { readonly id: number; readonly code: string; readonly name: string; readonly status: ProjectStatus } | null;
  readonly stage: StageKind | null;
  readonly stepName: string | null;
  readonly categoryName: string | null;
  readonly column: CardColumn;
  /** Progres yang berlaku (Planned 0, Done 100, In Progress sesuai pilihan). */
  readonly progress: number;
  readonly planStart: IsoDate;
  readonly planEnd: IsoDate;
  /** Rencana awal bila berbeda dari rencana terkini (sesudah jadwal ulang); selain itu null. */
  readonly baseline: Estimate | null;
  readonly doneOn: IsoDate | null;
  readonly estimateMinutes: number | null;
  readonly loggedMinutes: number;
  readonly logCount: number;
  readonly isAdhoc: boolean;
  /** Estimasi terkini tahapan kartu project (dengan penanda revisi di UI); null untuk activity. */
  readonly stageEstimate: Estimate | null;
  readonly markers: ReadonlyArray<PlanMarker>;
  /** Progres tahapan gabungan semua kartu dan PIC (kartu project); null untuk activity atau bila tidak tersedia. */
  readonly stageProgress: StageProgressSummary | null;
  readonly version: number;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  /** True bila pelaku adalah PIC pemilik dan kartu tidak dibatalkan (BL-29). */
  readonly canManage: boolean;
}

/** Ringkasan progres dan revisi tahapan yang ditampilkan pada kartu project. */
export interface StageProgressSummary {
  readonly percent: number;
  /** True bila angka adalah penyesuaian manual (ditandai `*`). */
  readonly manual: boolean;
  /** True bila tahapan Tertinggal dari laju. */
  readonly lagging: boolean;
  readonly revisionCount: number;
}

/** Konteks tampilan satu permintaan. */
export interface CardViewContext {
  /** Progres tahapan menurut kunci `idProject:tahapan`; tidak ada pada konteks yang tidak membutuhkannya. */
  readonly stageProgress?: ReadonlyMap<string, StageProgressSummary>;
  readonly today: IsoDate;
  readonly rescheduleThreshold: number;
  readonly actor: Actor;
}

/**
 * Menghitung hari kerja kartu project memperpanjang estimasi tahapan terhadap estimasi awal tahapan.
 * Masukan: baris papan. Keluaran: hari kerja (0 bila tidak memperpanjang).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-21-02 butir 2 ("Di luar estimasi tahapan +n hk"), FR-13-05 butir 5 dan 9, CL-056b.
 */
function extensionWorkdays(row: BoardCardRow): number {
  const { card, stageEstimate, stageBaseline } = row;
  if (card.kind !== 'PROJECT' || !stageEstimate) return 0;
  if (!card.extendsStage && card.planEnd <= stageEstimate.end) return 0;
  const base = stageBaseline?.end ?? stageEstimate.end;
  return Math.max(workdaysAfter(base, card.planEnd), card.extendsStage ? 1 : 0);
}

/**
 * Mengubah baris papan menjadi `CardView` lengkap dengan penanda yang dihitung server.
 * Masukan: baris papan dan konteks. Keluaran: `CardView`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-17-03, FR-21-02 butir 3, FR-16-01 butir 5.
 */
export function toCardView(row: BoardCardRow, ctx: CardViewContext): CardView {
  const { card } = row;
  const cancelled = card.cancelledAt !== null;
  return {
    id: card.id,
    code: card.code,
    kind: card.kind,
    title: card.title,
    owner: { picId: card.ownerPicId, name: card.ownerName },
    project:
      card.projectId !== null && card.projectCode && card.projectName && row.projectStatus
        ? { id: card.projectId, code: card.projectCode, name: card.projectName, status: row.projectStatus }
        : null,
    stage: card.stage,
    stepName: card.stepName,
    categoryName: card.categoryName,
    column: card.column,
    progress: effectiveCardProgress(card),
    planStart: card.planStart,
    planEnd: card.planEnd,
    baseline: card.baselineStart === card.planStart && card.baselineEnd === card.planEnd ? null : { start: card.baselineStart, end: card.baselineEnd },
    doneOn: card.doneOn,
    estimateMinutes: card.estimateMinutes,
    loggedMinutes: row.loggedMinutes,
    logCount: row.logCount,
    isAdhoc: card.isAdhoc,
    stageEstimate: row.stageEstimate,
    stageProgress: card.projectId !== null && card.stage !== null ? (ctx.stageProgress?.get(`${card.projectId}:${card.stage}`) ?? null) : null,
    markers: cancelled
      ? []
      : computeMarkers({
          column: card.column,
          progress: card.progress,
          progressNeedsInput: card.progressNeedsInput,
          planStart: card.planStart,
          planEnd: card.planEnd,
          doneOn: card.doneOn,
          cancelled,
          isAdhoc: card.isAdhoc,
          loggedMinutes: row.loggedMinutes,
          estimateMinutes: card.estimateMinutes,
          rescheduleCount: row.rescheduleCount,
          rescheduleThreshold: ctx.rescheduleThreshold,
          extendsStageWorkdays: extensionWorkdays(row),
          today: ctx.today,
        }),
    version: card.version,
    cancelledAt: card.cancelledAt,
    cancelReason: card.cancelReason,
    canManage: ctx.actor.role === 'PIC' && ctx.actor.picId === card.ownerPicId && !cancelled,
  };
}
