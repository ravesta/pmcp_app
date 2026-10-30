/**
 * Use case mengubah informasi dan status project (FR-11-02, FR-14-01).
 */
import { type Actor } from '@/modules/auth';
import { MESSAGES, maxLengthMessage, stagesNotDoneMessage, statusReasonRequiredMessage } from '@/platform/messages';
import type { AuditChange } from '@/shared/audit';
import { formatDisplayDate } from '@/shared/iso-date';
import { fail, ok, type Result } from '@/shared/result';
import {
  checkProjectInfo,
  checkProjectStatus,
  PROJECT_LIMITS,
  type ProjectInfo,
  type ProjectInfoInput,
} from '../domain/project-rules';
import { canEditProjectInfo } from '../domain/stage-rules';
import { projectInfoMessages } from './create-project';
import type { ProjectDeps, ProjectSnapshot } from './ports';
import { PROJECT_STATUS_LABEL, STAGE_LABEL, toStageActor } from './support';

/** Masukan perubahan informasi dan status project. */
export interface UpdateProjectInfoInput {
  readonly projectId: number;
  readonly expectedVersion: number;
  readonly info: ProjectInfoInput;
  readonly status: string;
  readonly statusReason: string;
}

/**
 * Membandingkan atribut lama dan baru lalu menyusun daftar perubahan untuk jejak audit.
 * Masukan: snapshot project, atribut baru, nama aplikasi lama dan baru. Keluaran: daftar perubahan (kosong bila
 * tidak ada yang berbeda).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-11-02, BL-07 (perubahan tanpa nilai berbeda tidak dicatat).
 */
function diffInfo(before: ProjectSnapshot, after: ProjectInfo, oldApplications: string, newApplications: string): AuditChange[] {
  const changes: AuditChange[] = [];
  const text = (value: string | null): string => value ?? '';
  const push = (field: string, oldValue: string, newValue: string): void => {
    if (oldValue !== newValue) changes.push({ field, old: oldValue, new: newValue });
  };
  push('Nama project', before.name, after.name);
  push('No. referensi', text(before.referenceNo), text(after.referenceNo));
  push('Jenis project', text(before.projectType), text(after.projectType));
  push('Business owner', text(before.businessOwner), text(after.businessOwner));
  push('Department', text(before.department), text(after.department));
  push('Request date', before.requestDate ? formatDisplayDate(before.requestDate) : '', after.requestDate ? formatDisplayDate(after.requestDate) : '');
  push('UAT Sign Off', before.uatSignOffDate ? formatDisplayDate(before.uatSignOffDate) : '', after.uatSignOffDate ? formatDisplayDate(after.uatSignOffDate) : '');
  push('Go Live', before.goLiveDate ? formatDisplayDate(before.goLiveDate) : '', after.goLiveDate ? formatDisplayDate(after.goLiveDate) : '');
  push('Deskripsi', text(before.description), text(after.description));
  push('Aplikasi terdampak', oldApplications, newApplications);
  return changes;
}

/**
 * Mengubah informasi dan/atau status project (Manager dan PIC BA/QA). ID Project dan estimasi keseluruhan tidak
 * dapat diubah langsung. Aplikasi yang sudah dipakai tetap terpilih walau kini nonaktif; aplikasi baru harus aktif.
 * Masukan: dependensi, pelaku, dan `UpdateProjectInfoInput`. Keluaran: berhasil; atau FORBIDDEN, NOT_FOUND,
 * CONFLICT (versi lama), VALIDATION per isian (`name`, `statusReason`, `status`, `applicationIds`, dll.), atau
 * VALIDATION umum bila tidak ada isian yang berbeda.
 * Efek samping: satu transaksi: UPDATE project dan aplikasi terdampak, serta peristiwa audit terpisah untuk
 * perubahan informasi dan perubahan status, masing-masing dengan nilai lama dan baru.
 * Rujukan: FR-11-02, FR-14-01, BL-07, BL-20, BL-21, BL-23, EC-11-02.01 sampai EC-11-02.04, EC-14-01.01 dan EC-14-01.02.
 */
export async function updateProjectInfo(deps: ProjectDeps, actor: Actor, input: UpdateProjectInfoInput): Promise<Result<null>> {
  if (!canEditProjectInfo(toStageActor(actor))) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });

  const infoCheck = checkProjectInfo(input.info);
  const applications = infoCheck.ok ? await deps.reference.getApplications(infoCheck.info.applicationIds) : [];

  return deps.transactor.run(async (tx) => {
    const project = await deps.projects.lockProject(tx, input.projectId);
    if (!project) return fail({ code: 'NOT_FOUND', message: MESSAGES.PROJECT_NOT_FOUND });
    if (project.version !== input.expectedVersion) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    const fields: Record<string, string> = {};
    if (!infoCheck.ok) Object.assign(fields, projectInfoMessages(infoCheck.fields));

    const statusCheck = checkProjectStatus({
      target: input.status,
      reason: input.statusReason,
      stageStatuses: project.stages.map((s) => s.status),
      creating: false,
    });
    if (!statusCheck.ok) {
      if (statusCheck.issue === 'REASON_REQUIRED') {
        fields.statusReason = statusReasonRequiredMessage(PROJECT_STATUS_LABEL[input.status as keyof typeof PROJECT_STATUS_LABEL] ?? input.status);
      } else if (statusCheck.issue === 'REASON_TOO_LONG') {
        fields.statusReason = maxLengthMessage('Alasan', PROJECT_LIMITS.statusReason);
      } else if (statusCheck.issue === 'NOT_ALL_STAGES_DONE') {
        fields.status = stagesNotDoneMessage(project.stages.filter((s) => s.status !== 'DONE').map((s) => STAGE_LABEL[s.kind]));
      } else {
        fields.status = MESSAGES.PROJECT_STATUS_INVALID;
      }
    }

    if (infoCheck.ok) {
      const existingIds = new Set(project.applications.map((a) => a.id));
      const invalid =
        applications.length !== infoCheck.info.applicationIds.length ||
        applications.some((a) => !a.isActive && !existingIds.has(a.id));
      if (invalid) fields.applicationIds = MESSAGES.PROJECT_APPLICATION_INACTIVE;
    }

    if (Object.keys(fields).length > 0 || !infoCheck.ok || !statusCheck.ok) {
      return fail({ code: 'VALIDATION', message: Object.values(fields)[0] ?? MESSAGES.UNEXPECTED, fields });
    }

    const oldApplications = project.applications.map((a) => a.name).sort().join(', ');
    const newApplications = applications.map((a) => a.name).sort().join(', ');
    const infoChanges = diffInfo(project, infoCheck.info, oldApplications, newApplications);
    const statusChanged = statusCheck.status !== project.status;
    const reasonChanged = (statusCheck.reason ?? '') !== (project.statusReason ?? '');
    if (infoChanges.length === 0 && !statusChanged && !reasonChanged) {
      return fail({ code: 'VALIDATION', message: MESSAGES.PROJECT_NO_CHANGES });
    }

    const saved = await deps.projects.saveProject(tx, project.id, project.version, {
      info: infoCheck.info,
      status: statusCheck.status,
      statusReason: statusCheck.reason,
      now: deps.clock.now(),
    });
    if (!saved) return fail({ code: 'CONFLICT', message: MESSAGES.CONFLICT });

    if (infoChanges.length > 0) {
      await deps.writeAudit(tx, {
        actorUserId: actor.userId,
        actorLabel: actor.label,
        category: 'PROJECT',
        action: 'project.info_updated',
        projectCode: project.code,
        entityType: 'project',
        entityId: String(project.id),
        summary: `${project.code}: informasi project diubah oleh ${actor.label} (${infoChanges.map((c) => c.field).join(', ')})`.slice(0, 300),
        changes: infoChanges,
      });
    }
    if (statusChanged || reasonChanged) {
      const changes: AuditChange[] = [];
      if (statusChanged) changes.push({ field: 'Status project', old: PROJECT_STATUS_LABEL[project.status], new: PROJECT_STATUS_LABEL[statusCheck.status] });
      if (reasonChanged) changes.push({ field: 'Alasan status', old: project.statusReason ?? '', new: statusCheck.reason ?? '' });
      await deps.writeAudit(tx, {
        actorUserId: actor.userId,
        actorLabel: actor.label,
        category: 'PROJECT',
        action: 'project.status_changed',
        projectCode: project.code,
        entityType: 'project',
        entityId: String(project.id),
        summary: `${project.code}: status project ${PROJECT_STATUS_LABEL[project.status]} menjadi ${PROJECT_STATUS_LABEL[statusCheck.status]} oleh ${actor.label}`,
        changes,
      });
    }
    return ok(null);
  });
}
