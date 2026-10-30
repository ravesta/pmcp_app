/**
 * Use case membuat project beserta tiga tahapannya (FR-02-01, FR-02-02).
 */
import { can, type Actor } from '@/modules/auth';
import { MESSAGES, maxLengthMessage, statusReasonRequiredMessage } from '@/platform/messages';
import { formatDisplayDate } from '@/shared/iso-date';
import { fail, ok, type Result } from '@/shared/result';
import type { AuditChange } from '@/shared/audit';
import {
  checkEstimateInput,
  checkProjectInfo,
  checkProjectStatus,
  PROJECT_LIMITS,
  planningCompleteness,
  type ProjectInfoInput,
} from '../domain/project-rules';
import type { Estimate, StageKind } from '../domain/stage-types';
import type { ProjectDeps } from './ports';
import { PROJECT_STATUS_LABEL, STAGE_LABEL, formatEstimate } from './support';

/** Urutan tahapan project (BL-02). */
export const STAGE_ORDER: ReadonlyArray<StageKind> = ['BA', 'DEV', 'QA'];

/** Perencanaan satu tahapan yang diisi saat project dibuat (boleh dikosongkan). */
export interface StagePlanInput {
  readonly picIds: ReadonlyArray<number>;
  /** Estimasi mulai `YYYY-MM-DD`; kosong bila belum diisi. */
  readonly estStart: string;
  /** Estimasi selesai `YYYY-MM-DD`; kosong bila belum diisi. */
  readonly estEnd: string;
}

/** Masukan pembuatan project. */
export interface CreateProjectInput {
  readonly info: ProjectInfoInput;
  readonly status: string;
  readonly statusReason: string;
  readonly stages: Readonly<Partial<Record<StageKind, StagePlanInput>>>;
}

/** Hasil pembuatan project. */
export interface CreateProjectResult {
  readonly projectId: number;
  readonly code: string;
  /** False bila masih ada PIC atau timeline yang kosong (pemberitahuan filter Kelengkapan perencanaan). */
  readonly planningComplete: boolean;
}

/**
 * Menerjemahkan masalah isian atribut project menjadi pesan per isian.
 * Masukan: peta masalah dari `checkProjectInfo`. Keluaran: peta isian ke pesan Indonesia.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: EC-02-01.01, EC-02-01.02, EC-02-01.08.
 */
export function projectInfoMessages(issues: Record<string, string | undefined>): Record<string, string> {
  const labels: Record<string, [string, number]> = {
    name: ['Nama project', PROJECT_LIMITS.name],
    referenceNo: ['No. referensi', PROJECT_LIMITS.referenceNo],
    businessOwner: ['Business owner', PROJECT_LIMITS.businessOwner],
    department: ['Department', PROJECT_LIMITS.department],
    description: ['Deskripsi', PROJECT_LIMITS.description],
  };
  const messages: Record<string, string> = {};
  for (const [field, issue] of Object.entries(issues)) {
    if (!issue) continue;
    if (field === 'name' && issue === 'REQUIRED') messages[field] = MESSAGES.PROJECT_NAME_REQUIRED;
    else if (issue === 'TOO_LONG' && labels[field]) messages[field] = maxLengthMessage(labels[field][0], labels[field][1]);
    else if (field === 'projectType') messages[field] = MESSAGES.PROJECT_TYPE_INVALID;
    else if (field === 'requestDate' || field === 'uatSignOffDate' || field === 'goLiveDate') messages[field] = MESSAGES.DATE_INVALID;
    else messages[field] = MESSAGES.UNEXPECTED;
  }
  return messages;
}

/**
 * Menerjemahkan penyebab penolakan estimasi menjadi pesan.
 * Masukan: penyebab. Keluaran: pesan Indonesia.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: EC-02-01.04, EC-13-01.03.
 */
export function estimateIssueMessage(issue: 'PAIR_REQUIRED' | 'INVALID_DATE' | 'END_BEFORE_START'): string {
  if (issue === 'PAIR_REQUIRED') return MESSAGES.ESTIMATE_PAIR_REQUIRED;
  if (issue === 'END_BEFORE_START') return MESSAGES.ESTIMATE_ORDER;
  return MESSAGES.DATE_INVALID;
}

/**
 * Membuat project baru (hanya Manager): atribut, status awal, PIC dan estimasi tiap tahapan yang boleh dikosongkan.
 * Masukan: dependensi, pelaku, dan `CreateProjectInput`. Keluaran: id, kode `PRJ-nnn`, dan penanda kelengkapan
 * perencanaan; atau galat VALIDATION per isian (`name`, `projectType`, `requestDate`, `applicationIds`, `status`,
 * `statusReason`, `estimate.<BA|DEV|QA>`, `pics.<BA|DEV|QA>`), atau FORBIDDEN bagi non-Manager.
 * Aturan: tepat tiga tahapan Belum Mulai; PIC aktif dan sesuai tahapan; estimasi pertama menjadi estimasi awal;
 * tumpang tindih antar tahapan tidak menolak (BL-02); Selesai tidak ditawarkan; aplikasi harus aktif.
 * Efek samping: satu transaksi: INSERT project, tahapan, aplikasi, penugasan (penanda Assignment baru bagi PIC
 * login), dan satu peristiwa audit Project beserta nilai awal.
 * Rujukan: FR-02-01, FR-02-02, BL-01, BL-02, BL-11, BL-45, EC-02-01.01 s.d. EC-02-01.09.
 */
export async function createProject(deps: ProjectDeps, actor: Actor, input: CreateProjectInput): Promise<Result<CreateProjectResult>> {
  if (!can(actor, 'project.create')) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });

  const fields: Record<string, string> = {};
  const infoCheck = checkProjectInfo(input.info);
  if (!infoCheck.ok) Object.assign(fields, projectInfoMessages(infoCheck.fields));

  const statusCheck = checkProjectStatus({ target: input.status, reason: input.statusReason, stageStatuses: [], creating: true });
  if (!statusCheck.ok) {
    if (statusCheck.issue === 'REASON_REQUIRED') {
      fields.statusReason = statusReasonRequiredMessage(PROJECT_STATUS_LABEL[input.status as keyof typeof PROJECT_STATUS_LABEL] ?? input.status);
    } else if (statusCheck.issue === 'REASON_TOO_LONG') {
      fields.statusReason = maxLengthMessage('Alasan', PROJECT_LIMITS.statusReason);
    } else if (statusCheck.issue === 'COMPLETED_ON_CREATE') {
      fields.status = MESSAGES.PROJECT_STATUS_COMPLETED_ON_CREATE;
    } else {
      fields.status = MESSAGES.PROJECT_STATUS_INVALID;
    }
  }

  const estimates: Partial<Record<StageKind, Estimate | null>> = {};
  const requestedPicIds = new Set<number>();
  for (const kind of STAGE_ORDER) {
    const plan = input.stages[kind];
    if (!plan) continue;
    const estimateCheck = checkEstimateInput(plan.estStart, plan.estEnd);
    if (estimateCheck.ok) estimates[kind] = estimateCheck.estimate;
    else fields[`estimate.${kind}`] = estimateIssueMessage(estimateCheck.issue);
    for (const picId of plan.picIds) requestedPicIds.add(picId);
  }

  const applicationIds = infoCheck.ok ? infoCheck.info.applicationIds : [];
  const [pics, applications] = await Promise.all([
    deps.reference.getPics([...requestedPicIds]),
    deps.reference.getApplications(applicationIds),
  ]);
  for (const kind of STAGE_ORDER) {
    for (const picId of input.stages[kind]?.picIds ?? []) {
      const pic = pics.find((p) => p.id === picId);
      if (!pic || pic.stage !== kind) fields[`pics.${kind}`] = MESSAGES.STAGE_PIC_MISMATCH;
      else if (!pic.isActive) fields[`pics.${kind}`] = MESSAGES.STAGE_PIC_INACTIVE;
    }
  }
  if (applicationIds.length !== applications.length || applications.some((a) => !a.isActive)) {
    fields.applicationIds = MESSAGES.PROJECT_APPLICATION_INACTIVE;
  }

  if (Object.keys(fields).length > 0 || !infoCheck.ok || !statusCheck.ok) {
    return fail({ code: 'VALIDATION', message: Object.values(fields)[0] ?? MESSAGES.UNEXPECTED, fields });
  }

  const now = deps.clock.now();
  return deps.transactor.run(async (tx) => {
    const created = await deps.projects.createProject(tx, {
      info: infoCheck.info,
      status: statusCheck.status,
      statusReason: statusCheck.reason,
      createdBy: actor.userId,
    });

    const changes: AuditChange[] = [{ field: 'Status project', old: '', new: PROJECT_STATUS_LABEL[statusCheck.status] }];
    const facts: Array<{ kind: StageKind; assignedCount: number; hasTimeline: boolean }> = [];
    for (const kind of STAGE_ORDER) {
      const plan = input.stages[kind];
      const stageId = created.stageIds[kind];
      const estimate = estimates[kind] ?? null;
      const picIds = [...new Set(plan?.picIds ?? [])];
      if (estimate) {
        await deps.projects.saveStage(tx, stageId, 1, {
          status: 'NOT_STARTED',
          estimate,
          baseline: estimate,
          actualStart: null,
          actualEnd: null,
          holdSince: null,
          holdReason: null,
          holdBy: null,
          manualProgress: null,
          manualProgressNote: null,
          manualProgressBy: null,
          manualProgressAt: null,
        });
        changes.push({ field: `Estimasi ${STAGE_LABEL[kind]}`, old: '', new: formatEstimate(estimate) });
      }
      if (picIds.length > 0) {
        await deps.projects.replaceAssignees(tx, { id: stageId, kind }, picIds, { assignedBy: actor.userId, selfPicId: null, now });
        changes.push({
          field: `PIC ${STAGE_LABEL[kind]}`,
          old: '',
          new: picIds.map((id) => pics.find((p) => p.id === id)?.name ?? String(id)).join(', '),
        });
      }
      facts.push({ kind, assignedCount: picIds.length, hasTimeline: estimate !== null });
    }

    await deps.writeAudit(tx, {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      category: 'PROJECT',
      action: 'project.created',
      projectCode: created.code,
      entityType: 'project',
      entityId: String(created.id),
      summary: `Project ${created.code} "${infoCheck.info.name}" dibuat (${PROJECT_STATUS_LABEL[statusCheck.status]})${
        infoCheck.info.requestDate ? `, request date ${formatDisplayDate(infoCheck.info.requestDate)}` : ''
      }`.slice(0, 300),
      changes,
    });
    return ok({ projectId: created.id, code: created.code, planningComplete: planningCompleteness(facts).isComplete });
  });
}
