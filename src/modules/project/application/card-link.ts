/**
 * Penghubung modul project untuk modul kanban: fakta tahapan sasaran kartu, revisi estimasi otomatis dari rencana
 * kartu, dan perubahan status project dari konfirmasi pembuatan kartu (FR-13-05, FR-17-01, FR-17-02).
 *
 * Fungsi bertanda `tx` berjalan di dalam transaksi kanban sehingga kartu, revisi, dan status tersimpan semua atau
 * tidak sama sekali (Technical Design §7.3). Arah impor tetap satu arah: kanban memakai fungsi ini lewat index modul.
 */
import type { Actor } from '@/modules/auth';
import { MESSAGES, maxLengthMessage } from '@/platform/messages';
import type { AuditChange } from '@/shared/audit';
import type { IsoDate } from '@/shared/iso-date';
import type { TxContext } from '@/shared/transaction';
import { fail, ok, type Result } from '@/shared/result';
import {
  mergeRevisionNotes,
  planAutoRevision,
  REVISION_NOTE_MAX,
  REVISION_NOTE_MIN,
  revisionWarning,
  shouldMergeRevision,
  type RevisionWarning,
} from '../domain/revision';
import type { Estimate, ProjectStatus, StageKind, StageStatus } from '../domain/stage-types';
import type { ProjectDeps, ProjectSnapshot } from './ports';
import { PROJECT_STATUS_LABEL, STAGE_LABEL, formatEstimate, lockStage, toStageWrite } from './support';

/** Fakta project dan tahapan sasaran sebuah kartu project. */
export interface CardStageTarget {
  readonly projectId: number;
  readonly projectCode: string;
  readonly projectName: string;
  readonly projectStatus: ProjectStatus;
  readonly projectStatusReason: string | null;
  readonly stageId: number;
  readonly stageKind: StageKind;
  readonly stageStatus: StageStatus;
  /** Estimasi terkini tahapan; null bila belum ada timeline. */
  readonly stageEstimate: Estimate | null;
  /** Jumlah revisi tahapan sampai sekarang. */
  readonly revisionCount: number;
  /** True bila PIC yang bertanya ditugaskan pada tahapan itu. */
  readonly isAssigned: boolean;
}

/**
 * Mengubah snapshot project menjadi fakta sasaran kartu bagi PIC dan tahapan tertentu.
 * Masukan: snapshot project, jenis tahapan, id PIC penanya. Keluaran: `CardStageTarget`, atau null bila tahapan tidak ada.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-17-01 butir 1 dan 2.
 */
function toCardStageTarget(project: ProjectSnapshot, kind: StageKind, picId: number): CardStageTarget | null {
  const stage = project.stages.find((s) => s.kind === kind);
  if (!stage) return null;
  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    projectStatus: project.status,
    projectStatusReason: project.statusReason,
    stageId: stage.id,
    stageKind: stage.kind,
    stageStatus: stage.status,
    stageEstimate: stage.estimate,
    revisionCount: stage.revisionCount,
    isAssigned: stage.assignees.some((a) => a.picId === picId),
  };
}

/**
 * Membaca fakta project dan tahapan sasaran kartu tanpa mengunci (untuk pratinjau dan validasi awal).
 * Masukan: dependensi, id project, jenis tahapan PIC, dan id PIC. Keluaran: `CardStageTarget`, atau null bila tidak ada.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-17-01 butir 1 sampai 4, FR-13-05 butir 2 (pratinjau).
 */
export async function getCardStageTarget(deps: ProjectDeps, projectId: number, kind: StageKind, picId: number): Promise<CardStageTarget | null> {
  const snapshot = await deps.queries.loadSnapshot(projectId);
  return snapshot ? toCardStageTarget(snapshot, kind, picId) : null;
}

/** Masukan revisi otomatis dari rencana sebuah kartu. */
export interface CardRevisionInput {
  readonly stageId: number;
  readonly projectId: number;
  readonly cardId: number;
  readonly cardCode: string;
  readonly plannedStart: IsoDate;
  readonly plannedEnd: IsoDate;
  /** Kategori alasan revisi (master aktif); wajib bila rencana melewati estimasi tahapan. */
  readonly categoryId: number | null;
  readonly note: string;
  /** Tahapan tanpa estimasi: jadikan rentang rencana sebagai estimasi awal (FR-13-05 butir 8). */
  readonly adoptPlanAsBaseline: boolean;
}

/** Hasil penerapan revisi otomatis. */
export type CardRevisionOutcome =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'ADOPTED' }
  | {
      readonly kind: 'REVISED';
      readonly seq: number;
      /** True bila digabung ke revisi hari itu oleh PIC yang sama (nomor revisi tidak bertambah). */
      readonly merged: boolean;
      readonly from: IsoDate;
      readonly to: IsoDate;
      readonly warning: RevisionWarning;
    };

/**
 * Menerapkan revisi estimasi tahapan otomatis dari rencana kartu di dalam transaksi pemanggil. Bila rencana melewati
 * estimasi selesai terkini sedikitnya satu hari kerja, estimasi selesai diperpanjang sampai tanggal selesai rencana
 * sebagai revisi bernomor dengan kartu asal; perpanjangan oleh PIC yang sama pada hari yang sama digabung. Estimasi
 * mulai tidak dimajukan dan estimasi tidak mengecil.
 * Masukan: dependensi, transaksi, pelaku, dan `CardRevisionInput`. Keluaran: `CardRevisionOutcome`; atau NOT_FOUND,
 * VALIDATION (`revision.category`, `revision.note`).
 * Efek samping: mengunci tahapan; INSERT atau UPDATE revisi, UPDATE estimasi tahapan, dan audit (termasuk peringatan
 * batas revisi); tidak ada efek bila rencana tidak memicu revisi.
 * Rujukan: FR-13-05 butir 1 sampai 5 dan 8, FR-13-04, BL-16, BL-39; AC: dua perpanjangan oleh PIC yang sama pada
 * hari yang sama = satu revisi; rencana berakhir Sabtu setelah estimasi Jumat tidak memicu revisi.
 */
export async function applyCardRevision(deps: ProjectDeps, tx: TxContext, actor: Actor, input: CardRevisionInput): Promise<Result<CardRevisionOutcome>> {
  const locked = await lockStage(deps, tx, input.projectId, input.stageId);
  if (!locked) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
  const { project, stage } = locked;
  const plan = planAutoRevision(stage.estimate, input.plannedStart, input.plannedEnd);

  if (plan.kind === 'NONE') return ok({ kind: 'NONE' });
  if (plan.kind === 'ADOPT_PLAN_AS_BASELINE') {
    if (!input.adoptPlanAsBaseline) return ok({ kind: 'NONE' });
    const saved = await deps.projects.saveStage(tx, stage.id, stage.version, toStageWrite(stage, { estimate: plan.estimate, baseline: plan.estimate }));
    if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });
    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'stage.planning_updated',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: estimasi awal tahapan ${STAGE_LABEL[stage.kind]} diisi dari rencana kartu ${input.cardCode} oleh ${actor.label}`,
      changes: [{ field: `Estimasi ${STAGE_LABEL[stage.kind]}`, old: '-', new: formatEstimate(plan.estimate) }],
    });
    return ok({ kind: 'ADOPTED' });
  }

  const category = input.categoryId === null ? null : await deps.reference.getRevisionCategory(input.categoryId);
  const note = input.note.trim();
  const fields: Record<string, string> = {};
  if (!category) fields['revision.category'] = MESSAGES.REVISION_CATEGORY_REQUIRED;
  else if (!category.isActive) fields['revision.category'] = MESSAGES.REVISION_CATEGORY_INACTIVE;
  if (note.length < REVISION_NOTE_MIN) fields['revision.note'] = MESSAGES.REVISION_NOTE_REQUIRED;
  else if (note.length > REVISION_NOTE_MAX) fields['revision.note'] = maxLengthMessage('Catatan', REVISION_NOTE_MAX);
  if (Object.keys(fields).length > 0 || !category || !stage.estimate) {
    return fail({ code: 'VALIDATION', message: Object.values(fields)[0] ?? MESSAGES.REVISION_AUTO_REQUIRED, fields });
  }

  const threshold = await deps.reference.getRevisionWarnThreshold();
  const today = deps.clock.today();
  const last = await deps.projects.lastRevision(tx, stage.id);
  const merged = last !== null && shouldMergeRevision(
    { seq: last.seq, createdOn: last.createdOn, createdBy: last.createdBy, isAutomatic: last.sourceCardCodes.length > 0, note: last.note },
    actor.userId,
    today,
  );
  const next: Estimate = { start: stage.estimate.start, end: plan.to };

  let seq: number;
  if (merged && last) {
    seq = last.seq;
    await deps.projects.mergeRevision(tx, last.id, {
      next: { start: last.next.start, end: plan.to },
      categoryName: category.name,
      note: mergeRevisionNotes(last.note, note),
      sourceCardIds: [input.cardId],
      now: deps.clock.now(),
    });
  } else {
    seq = await deps.projects.appendRevision(tx, stage.id, {
      previous: stage.estimate,
      next,
      categoryName: category.name,
      note,
      createdBy: actor.userId,
      sourceCardIds: [input.cardId],
      now: deps.clock.now(),
    });
  }
  const saved = await deps.projects.saveStage(tx, stage.id, stage.version, toStageWrite(stage, { estimate: next }));
  if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

  const revisionCount = merged ? stage.revisionCount : stage.revisionCount + 1;
  const warning = revisionWarning(revisionCount, threshold, !merged);
  const changes: AuditChange[] = [
    { field: `Estimasi ${STAGE_LABEL[stage.kind]}`, old: formatEstimate(stage.estimate), new: formatEstimate(next) },
    { field: 'Kategori alasan', old: '', new: category.name },
    { field: 'Catatan', old: '', new: note },
    { field: 'Kartu asal', old: '', new: input.cardCode },
  ];
  await deps.writeAudit(tx, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    category: 'PROJECT',
    action: 'stage.estimate_revised',
    projectCode: project.code,
    entityType: 'project_stage',
    entityId: String(stage.id),
    summary: `${project.code}: estimasi tahapan ${STAGE_LABEL[stage.kind]} diperpanjang otomatis dari kartu ${input.cardCode} (Revisi ${seq}${merged ? ', digabung' : ''}) oleh ${actor.label}`.slice(0, 300),
    changes,
  });
  if (warning.justReached) {
    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'stage.revision_limit_reached',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: tahapan ${STAGE_LABEL[stage.kind]} telah direvisi ${revisionCount} kali (batas peringatan ${threshold})`,
    });
  }
  return ok({ kind: 'REVISED', seq, merged, from: plan.from, to: plan.to, warning });
}

/**
 * Mengubah status project Backlog atau Ditunda menjadi Berjalan di dalam transaksi pemanggil, atas konfirmasi PIC saat
 * membuat kartu. Alasan status Ditunda dihapus. Bila status project sudah bukan Backlog atau Ditunda, tidak ada yang
 * diubah.
 * Masukan: dependensi, transaksi, pelaku, id project, dan kode kartu penyebab. Keluaran: true bila status diubah.
 * Efek samping: mengunci project; UPDATE status project dan audit (siapa, kapan, status lama dan baru, sebab kartu).
 * Rujukan: FR-17-02 butir 3 dan 4, FR-14-01 butir 7, BL-38; AC: menjawab "Ya" mengubah status dan tercatat dengan sebab kartu.
 */
export async function startProjectFromCard(deps: ProjectDeps, tx: TxContext, actor: Actor, input: { projectId: number; cardCode: string }): Promise<Result<boolean>> {
  const project = await deps.projects.lockProject(tx, input.projectId);
  if (!project) return fail({ code: 'NOT_FOUND', message: MESSAGES.PROJECT_NOT_FOUND });
  if (project.status !== 'BACKLOG' && project.status !== 'DEFERRED') return ok(false);
  const saved = await deps.projects.saveProject(tx, project.id, project.version, {
    info: {
      name: project.name,
      referenceNo: project.referenceNo,
      projectType: project.projectType,
      businessOwner: project.businessOwner,
      department: project.department,
      requestDate: project.requestDate,
      uatSignOffDate: project.uatSignOffDate,
      goLiveDate: project.goLiveDate,
      description: project.description,
      applicationIds: project.applications.map((a) => a.id),
    },
    status: 'RUNNING',
    statusReason: null,
    now: deps.clock.now(),
  });
  if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });
  const changes: AuditChange[] = [{ field: 'Status project', old: PROJECT_STATUS_LABEL[project.status], new: PROJECT_STATUS_LABEL.RUNNING }];
  if (project.statusReason) changes.push({ field: 'Alasan status', old: project.statusReason, new: '' });
  await deps.writeAudit(tx, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    category: 'PROJECT',
    action: 'project.status_changed',
    projectCode: project.code,
    entityType: 'project',
    entityId: String(project.id),
    summary: `${project.code}: status project ${PROJECT_STATUS_LABEL[project.status]} menjadi Berjalan oleh ${actor.label} (kartu ${input.cardCode})`,
    changes,
  });
  return ok(true);
}

