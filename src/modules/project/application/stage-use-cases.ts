/**
 * Use case tahapan: melengkapi PIC dan timeline, memperbarui status (hold, selesai, buka kembali), progres manual,
 * dan revisi estimasi (FR-03-01, FR-05-01, FR-05-02, FR-06-01, FR-13-01, FR-13-02, FR-13-04).
 *
 * Setiap use case: periksa hak (server), validasi, lalu satu transaksi yang mengunci project, memeriksa versi
 * (NFR-10), menulis, dan mencatat audit.
 */
import type { Actor } from '@/modules/auth';
import {
  MESSAGES,
  maxLengthMessage,
  openCardsMessage,
} from '@/platform/messages';
import type { AuditChange } from '@/shared/audit';
import { formatDisplayDate } from '@/shared/iso-date';
import { fail, ok, type Result } from '@/shared/result';
import {
  checkManualRevision,
  REVISION_NOTE_MAX,
  revisionWarning,
  type RevisionWarning,
} from '../domain/revision';
import { checkEstimateInput } from '../domain/project-rules';
import { effectiveStageProgress, stageSystemProgress } from '../domain/stage-progress';
import {
  applyStatusChange,
  canEditAssignees,
  canFillTimeline,
  canUpdateStage,
  checkManualProgress,
  HOLD_REASON_MAX,
  type StatusChangeIssue,
} from '../domain/stage-rules';
import type { Estimate, StageStatus } from '../domain/stage-types';
import { estimateIssueMessage } from './create-project';
import type { ProjectDeps } from './ports';
import {
  STAGE_LABEL,
  STAGE_STATUS_LABEL,
  formatEstimate,
  lockStage,
  stageAccess,
  toStageActor,
  toStageState,
  toStageWrite,
} from './support';

/**
 * Memuat project pemilik tahapan (tanpa kunci) agar transaksi dapat mengunci project yang tepat.
 * Masukan: dependensi dan id tahapan. Keluaran: id project, atau null bila tahapan tidak ada.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: Technical Design §6.1.
 */
async function projectIdOf(deps: ProjectDeps, stageId: number): Promise<number | null> {
  return deps.projects.findProjectIdOfStage(stageId);
}

/** Masukan melengkapi PIC dan/atau timeline tahapan. */
export interface UpdateStagePlanningInput {
  readonly stageId: number;
  readonly expectedVersion: number;
  /** Daftar PIC baru; undefined = PIC tidak diubah. Boleh kosong (PIC mengosongkan PIC tahapannya, EC-03-01.03). */
  readonly picIds?: ReadonlyArray<number>;
  /** Estimasi baru `YYYY-MM-DD`; keduanya undefined = timeline tidak diubah. Hanya untuk tahapan tanpa timeline. */
  readonly estStart?: string;
  readonly estEnd?: string;
}

/**
 * Melengkapi PIC dan/atau timeline tahapan. Manager dapat mengubah PIC tahapan mana pun; PIC BA/QA mana pun dapat
 * mengisi PIC atau timeline yang masih kosong; PIC tahapan itu dapat mengubah PIC tahapannya. Timeline yang sudah
 * terisi tidak ditimpa di sini (lewat revisi beralasan). Estimasi pertama menjadi estimasi awal.
 * Masukan: dependensi, pelaku, dan `UpdateStagePlanningInput`. Keluaran: berhasil, atau FORBIDDEN, NOT_FOUND,
 * CONFLICT (versi lama), VALIDATION (`pics`, `estimate`), atau BUSINESS_RULE `STAGE_FILL_ONLY`.
 * Efek samping: satu transaksi: UPDATE penugasan (penanda Assignment baru bagi PIC login yang ditambahkan oleh
 * orang lain) dan/atau estimasi tahapan; satu peristiwa audit dengan nilai lama dan baru.
 * Rujukan: FR-03-01 butir 1 sampai 7, FR-02-02, BL-06, BL-11, BL-45, EC-03-01.01 sampai EC-03-01.03.
 */
export async function updateStagePlanning(deps: ProjectDeps, actor: Actor, input: UpdateStagePlanningInput): Promise<Result<null>> {
  const projectId = await projectIdOf(deps, input.stageId);
  if (projectId === null) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
  const stageActor = toStageActor(actor);
  const wantsEstimate = input.estStart !== undefined || input.estEnd !== undefined;

  let estimate: Estimate | null = null;
  if (wantsEstimate) {
    const check = checkEstimateInput(input.estStart ?? '', input.estEnd ?? '');
    if (!check.ok) {
      const message = estimateIssueMessage(check.issue);
      return fail({ code: 'VALIDATION', message, fields: { estimate: message } });
    }
    estimate = check.estimate;
  }
  const picIds = input.picIds ? [...new Set(input.picIds)] : undefined;
  const pics = picIds ? await deps.reference.getPics(picIds) : [];

  const now = deps.clock.now();
  return deps.transactor.run(async (tx) => {
    const locked = await lockStage(deps, tx, projectId, input.stageId);
    if (!locked) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
    const { project, stage } = locked;
    if (stage.version !== input.expectedVersion) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    const access = stageAccess(stage);
    const changes: AuditChange[] = [];

    if (picIds) {
      if (!canEditAssignees(stageActor, access)) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
      for (const picId of picIds) {
        const pic = pics.find((p) => p.id === picId);
        const alreadyAssigned = stage.assignees.some((a) => a.picId === picId);
        if (!pic || pic.stage !== stage.kind) {
          return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_PIC_MISMATCH, fields: { pics: MESSAGES.STAGE_PIC_MISMATCH } });
        }
        if (!pic.isActive && !alreadyAssigned) {
          return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_PIC_INACTIVE, fields: { pics: MESSAGES.STAGE_PIC_INACTIVE } });
        }
      }
    }

    if (wantsEstimate && estimate) {
      if (stage.estimate) return fail({ code: 'BUSINESS_RULE', rule: 'STAGE_FILL_ONLY', message: MESSAGES.STAGE_FILL_ONLY });
      if (!canFillTimeline(stageActor, access)) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
    }

    if (picIds) {
      const currentIds = stage.assignees.map((a) => a.picId);
      const same = currentIds.length === picIds.length && currentIds.every((id) => picIds.includes(id));
      if (!same) {
        await deps.projects.replaceAssignees(tx, { id: stage.id, kind: stage.kind }, picIds, {
          assignedBy: actor.userId,
          selfPicId: actor.picId,
          now,
        });
        const oldNames = stage.assignees.map((a) => a.name).join(', ');
        const newNames = picIds.map((id) => pics.find((p) => p.id === id)?.name ?? String(id)).join(', ');
        changes.push({ field: `PIC ${STAGE_LABEL[stage.kind]}`, old: oldNames, new: newNames });
      }
    }

    if (wantsEstimate && estimate) {
      await deps.projects.saveStage(tx, stage.id, stage.version, toStageWrite(stage, { estimate, baseline: estimate }));
      changes.push({ field: `Estimasi ${STAGE_LABEL[stage.kind]}`, old: '-', new: formatEstimate(estimate) });
    }

    if (changes.length === 0) return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_NO_CHANGES });
    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'stage.planning_updated',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: perencanaan tahapan ${STAGE_LABEL[stage.kind]} dilengkapi oleh ${actor.label}`,
      changes,
    });
    return ok(null);
  });
}

/** Masukan perubahan status tahapan. */
export interface UpdateStageStatusInput {
  readonly stageId: number;
  readonly expectedVersion: number;
  readonly target: StageStatus;
  /** Alasan hold. */
  readonly reason?: string;
  /** Catatan Manager (melewati syarat Selesai atau membuka kembali tahapan). */
  readonly note?: string;
}

/** Hasil perubahan status tahapan. */
export interface UpdateStageStatusResult {
  readonly status: StageStatus;
  /** True bila UI sebaiknya menyarankan (tidak mewajibkan) revisi estimasi, yaitu saat hold dilanjutkan. */
  readonly suggestRevision: boolean;
}

/**
 * Menerjemahkan penyebab penolakan perubahan status menjadi galat.
 * Masukan: penyebab dan pemilik kartu terbuka. Keluaran: hasil gagal dengan kode dan pesan yang sesuai.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-05-01 butir 3 sampai 5 dan 9, EC-05-01.01 sampai EC-05-01.06.
 */
function statusIssueToFailure(issue: StatusChangeIssue, owners: ReadonlyArray<string>): Result<never> {
  switch (issue) {
    case 'HOLD_REASON_REQUIRED':
      return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_HOLD_REASON_REQUIRED, fields: { reason: MESSAGES.STAGE_HOLD_REASON_REQUIRED } });
    case 'HOLD_REASON_TOO_LONG': {
      const message = maxLengthMessage('Alasan', HOLD_REASON_MAX);
      return fail({ code: 'VALIDATION', message, fields: { reason: message } });
    }
    case 'NOTE_REQUIRED':
      return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_NOTE_REQUIRED, fields: { note: MESSAGES.STAGE_NOTE_REQUIRED } });
    case 'OPEN_CARDS':
      return fail({ code: 'BUSINESS_RULE', rule: 'STAGE_HAS_OPEN_CARDS', message: openCardsMessage(owners), details: owners });
    case 'NOT_STARTED_HAS_MANUAL_PROGRESS':
      return fail({ code: 'BUSINESS_RULE', rule: issue, message: MESSAGES.STAGE_NOT_STARTED_HAS_MANUAL_PROGRESS });
    case 'REOPEN_MANAGER_ONLY':
      return fail({ code: 'FORBIDDEN', message: MESSAGES.STAGE_REOPEN_MANAGER_ONLY });
    case 'REOPEN_TARGET_INVALID':
      return fail({ code: 'BUSINESS_RULE', rule: issue, message: MESSAGES.STAGE_REOPEN_TARGET_INVALID });
    case 'PROJECT_COMPLETED':
      return fail({ code: 'BUSINESS_RULE', rule: issue, message: MESSAGES.STAGE_PROJECT_COMPLETED });
    case 'NO_CHANGE':
      return fail({ code: 'VALIDATION', message: MESSAGES.STAGE_STATUS_UNCHANGED });
  }
}

/**
 * Memperbarui status tahapan: Belum Mulai, Berjalan, Ditahan (wajib alasan), Selesai (tanpa kartu terbuka, atau
 * Manager dengan catatan), dan membuka kembali tahapan Selesai (Manager dengan catatan).
 * Masukan: dependensi, pelaku, dan `UpdateStageStatusInput`. Keluaran: status baru dan saran revisi, atau
 * FORBIDDEN, NOT_FOUND, CONFLICT, VALIDATION (`reason`, `note`), atau BUSINESS_RULE (`STAGE_HAS_OPEN_CARDS` dengan
 * `details` pemilik kartu terbuka, dan lainnya).
 * Efek samping: satu transaksi: UPDATE tahapan (status, tanggal aktual, hold), INSERT riwayat hold bila hold
 * ditutup, dan satu peristiwa audit dengan nilai lama dan baru (termasuk catatan Manager).
 * Rujukan: FR-05-01, FR-06-01, FR-13-02, BL-13, BL-15, BL-16, BL-40(d), EC-05-01.01 sampai EC-05-01.07.
 */
export async function updateStageStatus(deps: ProjectDeps, actor: Actor, input: UpdateStageStatusInput): Promise<Result<UpdateStageStatusResult>> {
  const projectId = await projectIdOf(deps, input.stageId);
  if (projectId === null) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
  const stageActor = toStageActor(actor);
  const today = deps.clock.today();

  return deps.transactor.run(async (tx) => {
    const locked = await lockStage(deps, tx, projectId, input.stageId);
    if (!locked) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
    const { project, stage } = locked;
    if (!canUpdateStage(stageActor, stageAccess(stage))) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
    if (stage.version !== input.expectedVersion) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    const owners = input.target === 'DONE' ? await deps.cards.openCardOwners({ stageId: stage.id, projectId, kind: stage.kind }) : [];
    const outcome = applyStatusChange(toStageState(stage), {
      target: input.target,
      reason: input.reason ?? '',
      note: input.note ?? '',
      isManager: actor.role === 'MANAGER',
      openCardOwners: owners,
      projectStatus: project.status,
      today,
    });
    if (!outcome.ok) return statusIssueToFailure(outcome.issue, outcome.owners ?? owners);

    const startsHold = outcome.next.status === 'HELD' && stage.status !== 'HELD';
    const saved = await deps.projects.saveStage(
      tx,
      stage.id,
      stage.version,
      toStageWrite(stage, {
        status: outcome.next.status,
        actualStart: outcome.next.actualStart,
        actualEnd: outcome.next.actualEnd,
        holdSince: outcome.next.holdSince,
        holdReason: outcome.next.holdReason,
        holdBy: outcome.next.status === 'HELD' ? (startsHold ? actor.userId : stage.holdBy) : null,
        manualProgress: outcome.next.manualProgress,
        manualProgressNote: outcome.next.manualProgress === null ? null : stage.manualProgressNote,
        manualProgressBy: outcome.next.manualProgress === null ? null : stage.manualProgressBy,
        manualProgressAt: outcome.next.manualProgress === null ? null : stage.manualProgressAt,
      }),
    );
    if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    if (outcome.closedHold) {
      await deps.projects.appendHoldHistory(tx, stage.id, {
        since: outcome.closedHold.since,
        resumedOn: outcome.closedHold.resumedOn,
        reason: outcome.closedHold.reason,
        heldBy: stage.holdBy ?? actor.userId,
        resumedBy: actor.userId,
      });
    }

    const changes: AuditChange[] = [{ field: `Status ${STAGE_LABEL[stage.kind]}`, old: STAGE_STATUS_LABEL[stage.status], new: STAGE_STATUS_LABEL[outcome.next.status] }];
    if (outcome.next.status === 'HELD' && outcome.next.holdReason) {
      changes.push({ field: 'Alasan ditahan', old: stage.holdReason ?? '', new: outcome.next.holdReason });
    }
    if (outcome.next.actualStart && outcome.next.actualStart !== stage.actualStart) {
      changes.push({ field: 'Mulai aktual', old: stage.actualStart ? formatDisplayDate(stage.actualStart) : '-', new: formatDisplayDate(outcome.next.actualStart) });
    }
    if (outcome.next.actualEnd !== stage.actualEnd) {
      changes.push({
        field: 'Selesai aktual',
        old: stage.actualEnd ? formatDisplayDate(stage.actualEnd) : '-',
        new: outcome.next.actualEnd ? formatDisplayDate(outcome.next.actualEnd) : '-',
      });
    }
    if (outcome.auditNote) changes.push({ field: outcome.reopened ? 'Catatan buka kembali' : 'Catatan melewati syarat Selesai', old: '', new: outcome.auditNote });

    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: outcome.reopened ? 'stage.reopened' : 'stage.status_changed',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: status tahapan ${STAGE_LABEL[stage.kind]} ${STAGE_STATUS_LABEL[stage.status]} menjadi ${STAGE_STATUS_LABEL[outcome.next.status]} oleh ${actor.label}`,
      changes,
    });
    return ok({ status: outcome.next.status, suggestRevision: outcome.suggestRevision });
  });
}

/** Masukan penyesuaian progres manual. */
export interface SetManualProgressInput {
  readonly stageId: number;
  readonly expectedVersion: number;
  /** Angka manual 0..99; null = kembalikan ke hitungan sistem. */
  readonly value: number | null;
  readonly note?: string;
}

/**
 * Menyesuaikan progres tahapan secara manual (0..99) dengan catatan wajib bila tahapan punya kartu dan angka
 * berbeda dari nilai yang berlaku; atau mengembalikannya ke hitungan sistem. Tahapan Development diisi Manager.
 * Masukan: dependensi, pelaku, dan `SetManualProgressInput`. Keluaran: berhasil, atau FORBIDDEN, NOT_FOUND,
 * CONFLICT, atau VALIDATION (`value`, `note`).
 * Efek samping: satu transaksi: UPDATE progres manual beserta catatan, pelaku, dan waktu; satu peristiwa audit
 * dengan nilai lama dan baru.
 * Rujukan: FR-05-02 butir 3 sampai 5, FR-06-01 butir 3, BL-40(c), EC-05-02.01 sampai EC-05-02.03.
 */
export async function setManualProgress(deps: ProjectDeps, actor: Actor, input: SetManualProgressInput): Promise<Result<null>> {
  const projectId = await projectIdOf(deps, input.stageId);
  if (projectId === null) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
  const stageActor = toStageActor(actor);
  const now = deps.clock.now();

  return deps.transactor.run(async (tx) => {
    const locked = await lockStage(deps, tx, projectId, input.stageId);
    if (!locked) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
    const { project, stage } = locked;
    if (!canUpdateStage(stageActor, stageAccess(stage))) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
    if (stage.version !== input.expectedVersion) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    const facts = (await deps.cards.cardFacts([{ stageId: stage.id, projectId, kind: stage.kind }])).get(stage.id);
    const system = stageSystemProgress(facts?.cards ?? []);
    const current = effectiveStageProgress({ status: stage.status, systemProgress: system, manualProgress: stage.manualProgress });
    const issue = checkManualProgress({
      value: input.value,
      note: input.note ?? '',
      hasCards: (facts?.cards.length ?? 0) > 0,
      currentEffective: current,
      stageStatus: stage.status,
    });
    if (issue === 'OUT_OF_RANGE') return fail({ code: 'VALIDATION', message: MESSAGES.MANUAL_PROGRESS_RANGE, fields: { value: MESSAGES.MANUAL_PROGRESS_RANGE } });
    if (issue === 'NOTE_REQUIRED') return fail({ code: 'VALIDATION', message: MESSAGES.MANUAL_PROGRESS_NOTE_REQUIRED, fields: { note: MESSAGES.MANUAL_PROGRESS_NOTE_REQUIRED } });
    if (issue === 'STAGE_DONE') return fail({ code: 'BUSINESS_RULE', rule: issue, message: MESSAGES.MANUAL_PROGRESS_STAGE_DONE });

    const note = (input.note ?? '').trim();
    const saved = await deps.projects.saveStage(
      tx,
      stage.id,
      stage.version,
      toStageWrite(stage, {
        manualProgress: input.value,
        manualProgressNote: input.value === null || note === '' ? null : note,
        manualProgressBy: input.value === null ? null : actor.userId,
        manualProgressAt: input.value === null ? null : now,
      }),
    );
    if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'stage.progress_adjusted',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: progres tahapan ${STAGE_LABEL[stage.kind]} ${
        input.value === null ? 'dikembalikan ke hitungan sistem' : `disesuaikan manual menjadi ${input.value}%`
      } oleh ${actor.label}`,
      changes: [
        { field: `Progres ${STAGE_LABEL[stage.kind]}`, old: `${current}%`, new: input.value === null ? `${system ?? 0}% (hitungan sistem)` : `${input.value}%` },
        ...(note ? [{ field: 'Catatan penyesuaian', old: '', new: note }] : []),
      ],
    });
    return ok(null);
  });
}

/** Masukan revisi estimasi manual. */
export interface ReviseStageEstimateInput {
  readonly stageId: number;
  readonly expectedVersion: number;
  readonly newStart: string;
  readonly newEnd: string;
  readonly categoryId: number | null;
  readonly note: string;
}

/** Hasil revisi estimasi. */
export interface ReviseStageEstimateResult {
  /** Nomor revisi yang tersimpan (Revisi 1, 2, ...). */
  readonly seq: number;
  readonly warning: RevisionWarning;
}

/**
 * Merevisi estimasi tahapan secara manual: revisi bernomor dengan kategori (master aktif) dan catatan, tanpa
 * persetujuan, tanpa menggeser tahapan lain. Tahapan yang belum punya estimasi diisi sebagai estimasi awal.
 * Masukan: dependensi, pelaku, dan `ReviseStageEstimateInput`. Keluaran: nomor revisi dan peringatan revisi
 * berulang; atau FORBIDDEN, NOT_FOUND, CONFLICT, atau VALIDATION (`dates`, `category`, `note`).
 * Efek samping: satu transaksi: INSERT revisi bernomor (nama kategori disimpan pada revisi), UPDATE estimasi
 * terkini (estimasi awal tidak berubah), dan audit; bila revisi mencapai batas peringatan dicatat audit tambahan.
 * Rujukan: FR-13-01, FR-13-04, FR-13-05 butir 8, BL-11, BL-12, BL-16, BL-18, BL-19, EC-13-01.01 sampai EC-13-01.06.
 */
export async function reviseStageEstimate(deps: ProjectDeps, actor: Actor, input: ReviseStageEstimateInput): Promise<Result<ReviseStageEstimateResult>> {
  const projectId = await projectIdOf(deps, input.stageId);
  if (projectId === null) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
  const stageActor = toStageActor(actor);

  const datesCheck = checkEstimateInput(input.newStart, input.newEnd);
  if (!datesCheck.ok) {
    const message = estimateIssueMessage(datesCheck.issue);
    return fail({ code: 'VALIDATION', message, fields: { dates: message } });
  }
  if (datesCheck.estimate === null) {
    return fail({ code: 'VALIDATION', message: MESSAGES.REVISION_DATES_REQUIRED, fields: { dates: MESSAGES.REVISION_DATES_REQUIRED } });
  }
  const newEstimate = datesCheck.estimate;

  const category = input.categoryId === null ? null : await deps.reference.getRevisionCategory(input.categoryId);
  const threshold = await deps.reference.getRevisionWarnThreshold();

  return deps.transactor.run(async (tx) => {
    const locked = await lockStage(deps, tx, projectId, input.stageId);
    if (!locked) return fail({ code: 'NOT_FOUND', message: MESSAGES.STAGE_NOT_FOUND });
    const { project, stage } = locked;
    if (!canUpdateStage(stageActor, stageAccess(stage))) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
    if (stage.version !== input.expectedVersion) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    if (!stage.estimate) {
      // EC-13-01.04: belum ada estimasi awal, pengisian tanggal adalah estimasi awal (bukan revisi).
      await deps.projects.saveStage(tx, stage.id, stage.version, toStageWrite(stage, { estimate: newEstimate, baseline: newEstimate }));
      await deps.writeAudit(tx, {
        actorUserId: actor.userId,
        actorLabel: actor.label,
        category: 'PROJECT',
        action: 'stage.planning_updated',
        projectCode: project.code,
        entityType: 'project_stage',
        entityId: String(stage.id),
        summary: `${project.code}: estimasi awal tahapan ${STAGE_LABEL[stage.kind]} diisi oleh ${actor.label}`,
        changes: [{ field: `Estimasi ${STAGE_LABEL[stage.kind]}`, old: '-', new: formatEstimate(newEstimate) }],
      });
      return ok({ seq: 0, warning: { atLimit: false, justReached: false } });
    }

    const check = checkManualRevision({
      current: stage.estimate,
      newStart: newEstimate.start,
      newEnd: newEstimate.end,
      categoryId: input.categoryId,
      note: input.note,
    });
    const fields: Record<string, string> = {};
    if (check.issues.includes('SAME_AS_CURRENT')) fields.dates = MESSAGES.REVISION_SAME_AS_CURRENT;
    if (check.issues.includes('CATEGORY_REQUIRED') || !category) fields.category = MESSAGES.REVISION_CATEGORY_REQUIRED;
    else if (!category.isActive) fields.category = MESSAGES.REVISION_CATEGORY_INACTIVE;
    if (check.issues.includes('NOTE_TOO_SHORT')) fields.note = MESSAGES.REVISION_NOTE_REQUIRED;
    if (check.issues.includes('NOTE_TOO_LONG')) fields.note = maxLengthMessage('Catatan', REVISION_NOTE_MAX);
    if (Object.keys(fields).length > 0 || !category) {
      return fail({ code: 'VALIDATION', message: Object.values(fields)[0] ?? MESSAGES.UNEXPECTED, fields });
    }

    const seq = await deps.projects.appendRevision(tx, stage.id, {
      previous: stage.estimate,
      next: newEstimate,
      categoryName: category.name,
      note: check.note,
      createdBy: actor.userId,
      sourceCardIds: [],
      now: deps.clock.now(),
    });
    const saved = await deps.projects.saveStage(tx, stage.id, stage.version, toStageWrite(stage, { estimate: newEstimate }));
    if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    const warning = revisionWarning(stage.revisionCount + 1, threshold, true);
    const changes: AuditChange[] = [
      { field: `Estimasi ${STAGE_LABEL[stage.kind]}`, old: formatEstimate(stage.estimate), new: formatEstimate(newEstimate) },
      { field: 'Kategori alasan', old: '', new: category.name },
      { field: 'Catatan', old: '', new: check.note },
    ];
    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'stage.estimate_revised',
      projectCode: project.code,
      entityType: 'project_stage',
      entityId: String(stage.id),
      summary: `${project.code}: estimasi tahapan ${STAGE_LABEL[stage.kind]} direvisi (Revisi ${seq}) oleh ${actor.label}`,
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
        summary: `${project.code}: tahapan ${STAGE_LABEL[stage.kind]} telah direvisi ${stage.revisionCount + 1} kali (batas peringatan ${threshold})`,
      });
    }
    return ok({ seq, warning });
  });
}
