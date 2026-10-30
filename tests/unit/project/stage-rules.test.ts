/**
 * Uji hak tahapan, perpindahan status, progres manual, atribut project, dan kelengkapan perencanaan.
 * Rujukan: FR-02-01, FR-03-01, FR-05-01, FR-05-02, FR-06-01, FR-14-01, BL-06, BL-16.
 */
import { describe, expect, it } from 'vitest';
import { toIsoDate as d } from '@/shared/iso-date';
import {
  checkProjectInfo,
  checkProjectStatus,
  planningCompleteness,
} from '@/modules/project/domain/project-rules';
import {
  applyStatusChange,
  canEditAssignees,
  canEditProjectInfo,
  canFillTimeline,
  canUpdateStage,
  checkManualProgress,
  isStagePic,
  type StageState,
} from '@/modules/project/domain/stage-rules';
import type { StageActor } from '@/modules/project/domain/stage-types';

const manager: StageActor = { role: 'MANAGER', picId: null, picStage: null };
const picBa: StageActor = { role: 'PIC', picId: 1, picStage: 'BA' };
const picQa: StageActor = { role: 'PIC', picId: 2, picStage: 'QA' };

describe('hak tahapan', () => {
  const baStage = { kind: 'BA', assignedPicIds: [1], hasTimeline: true } as const;
  const devStage = { kind: 'DEV', assignedPicIds: [9], hasTimeline: true } as const;
  const emptyDev = { kind: 'DEV', assignedPicIds: [], hasTimeline: false } as const;

  it('PIC tahapan dan Manager boleh mengubah tahapan BA/QA; PIC lain tidak', () => {
    expect(canUpdateStage(manager, baStage)).toBe(true);
    expect(canUpdateStage(picBa, baStage)).toBe(true);
    expect(isStagePic(picQa, baStage)).toBe(false);
    expect(canUpdateStage(picQa, baStage)).toBe(false);
  });

  it('tahapan Development hanya diperbarui Manager (AC FR-06-01)', () => {
    expect(canUpdateStage(manager, devStage)).toBe(true);
    expect(canUpdateStage(picBa, devStage)).toBe(false);
    expect(canUpdateStage({ role: 'PIC', picId: 9, picStage: 'BA' }, devStage)).toBe(false);
  });

  it('PIC QA dapat mengisi PIC tahapan Development yang kosong (AC FR-03-01)', () => {
    expect(canEditAssignees(picQa, emptyDev)).toBe(true);
    expect(canFillTimeline(picQa, emptyDev)).toBe(true);
  });

  it('PIC BA yang bukan PIC tahapan QA tidak dapat mengubah PIC tahapan QA yang terisi (AC FR-03-01)', () => {
    const qaStage = { kind: 'QA', assignedPicIds: [2], hasTimeline: true } as const;
    expect(canEditAssignees(picBa, qaStage)).toBe(false);
    expect(canFillTimeline(picBa, qaStage)).toBe(false);
    expect(canEditAssignees(picQa, qaStage)).toBe(true);
    expect(canEditAssignees(manager, qaStage)).toBe(true);
  });

  it('informasi project dapat diubah Manager dan PIC BA/QA', () => {
    expect(canEditProjectInfo(manager)).toBe(true);
    expect(canEditProjectInfo(picBa)).toBe(true);
  });
});

describe('applyStatusChange', () => {
  const today = d('2026-10-28');
  const running: StageState = {
    status: 'RUNNING',
    estimate: { start: d('2026-10-19'), end: d('2026-10-30') },
    actualStart: d('2026-10-19'),
    actualEnd: null,
    holdSince: null,
    holdReason: null,
    manualProgress: null,
  };
  const notStarted: StageState = { ...running, status: 'NOT_STARTED', actualStart: null };
  const req = (over: Partial<Parameters<typeof applyStatusChange>[1]> & { target: StageState['status'] }) => ({
    reason: '',
    note: '',
    isManager: false,
    openCardOwners: [],
    projectStatus: 'RUNNING' as const,
    today,
    ...over,
  });

  it('pertama kali Berjalan mengisi mulai aktual hari itu (AC FR-05-01)', () => {
    const result = applyStatusChange(notStarted, req({ target: 'RUNNING' }));
    expect(result).toMatchObject({ ok: true, next: { status: 'RUNNING', actualStart: today } });
  });

  it('Ditahan wajib alasan dan mencatat tanggal mulai hold', () => {
    expect(applyStatusChange(running, req({ target: 'HELD' }))).toEqual({ ok: false, issue: 'HOLD_REASON_REQUIRED' });
    expect(applyStatusChange(running, req({ target: 'HELD', reason: 'x'.repeat(301) }))).toEqual({ ok: false, issue: 'HOLD_REASON_TOO_LONG' });
    const held = applyStatusChange(running, req({ target: 'HELD', reason: 'Menunggu data' }));
    expect(held).toMatchObject({ ok: true, next: { status: 'HELD', holdSince: today, holdReason: 'Menunggu data' } });
  });

  it('melanjutkan dari hold menutup periode hold dan menyarankan revisi', () => {
    const held: StageState = { ...running, status: 'HELD', holdSince: d('2026-10-21'), holdReason: 'Menunggu data' };
    const result = applyStatusChange(held, req({ target: 'RUNNING' }));
    expect(result).toMatchObject({
      ok: true,
      suggestRevision: true,
      closedHold: { since: d('2026-10-21'), resumedOn: today, reason: 'Menunggu data' },
      next: { status: 'RUNNING', holdSince: null, holdReason: null },
    });
  });

  it('mengubah alasan hold pada tahapan yang sudah Ditahan diizinkan; alasan sama = tanpa perubahan', () => {
    const held: StageState = { ...running, status: 'HELD', holdSince: d('2026-10-21'), holdReason: 'A' };
    expect(applyStatusChange(held, req({ target: 'HELD', reason: 'B' }))).toMatchObject({ ok: true, next: { holdSince: d('2026-10-21'), holdReason: 'B' } });
    expect(applyStatusChange(held, req({ target: 'HELD', reason: 'A' }))).toEqual({ ok: false, issue: 'NO_CHANGE' });
  });

  it('PIC memilih Selesai saat ada kartu terbuka milik rekan ditolak dengan menyebut pemilik (AC FR-05-01)', () => {
    const result = applyStatusChange(running, req({ target: 'DONE', openCardOwners: ['Rina'] }));
    expect(result).toEqual({ ok: false, issue: 'OPEN_CARDS', owners: ['Rina'] });
  });

  it('Manager melewati syarat dengan catatan; tanpa catatan ditolak', () => {
    const open = { target: 'DONE' as const, openCardOwners: ['Rina'], isManager: true };
    expect(applyStatusChange(running, req({ ...open, note: 'ab' }))).toMatchObject({ ok: false, issue: 'NOTE_REQUIRED' });
    const ok = applyStatusChange(running, req({ ...open, note: 'Sisa kartu dibatalkan' }));
    expect(ok).toMatchObject({ ok: true, auditNote: 'Sisa kartu dibatalkan', next: { status: 'DONE', actualEnd: today, manualProgress: null } });
  });

  it('Selesai tanpa kartu terbuka berhasil; Selesai tanpa pernah Berjalan mengisi mulai aktual dari estimasi mulai', () => {
    const result = applyStatusChange(notStarted, req({ target: 'DONE' }));
    expect(result).toMatchObject({ ok: true, auditNote: null, next: { actualStart: d('2026-10-19'), actualEnd: today } });
    const noEstimate = applyStatusChange({ ...notStarted, estimate: null }, req({ target: 'DONE' }));
    expect(noEstimate).toMatchObject({ ok: true, next: { actualStart: today } });
  });

  it('Belum Mulai ditolak bila ada progres manual di atas 0', () => {
    expect(applyStatusChange({ ...running, manualProgress: 30 }, req({ target: 'NOT_STARTED' }))).toEqual({
      ok: false,
      issue: 'NOT_STARTED_HAS_MANUAL_PROGRESS',
    });
    expect(applyStatusChange({ ...running, manualProgress: 0 }, req({ target: 'NOT_STARTED' })).ok).toBe(true);
  });

  it('membuka kembali tahapan Selesai: hanya Manager, dengan catatan, project belum Selesai (AC FR-05-01)', () => {
    const done: StageState = { ...running, status: 'DONE', actualEnd: d('2026-10-27') };
    expect(applyStatusChange(done, req({ target: 'RUNNING' }))).toEqual({ ok: false, issue: 'REOPEN_MANAGER_ONLY' });
    expect(applyStatusChange(done, req({ target: 'RUNNING', isManager: true }))).toMatchObject({ ok: false, issue: 'NOTE_REQUIRED' });
    expect(applyStatusChange(done, req({ target: 'HELD', isManager: true, note: 'Ada bug' }))).toEqual({ ok: false, issue: 'REOPEN_TARGET_INVALID' });
    expect(applyStatusChange(done, req({ target: 'RUNNING', isManager: true, note: 'Ada bug', projectStatus: 'COMPLETED' }))).toEqual({ ok: false, issue: 'PROJECT_COMPLETED' });
    const reopened = applyStatusChange(done, req({ target: 'RUNNING', isManager: true, note: 'Ada bug' }));
    expect(reopened).toMatchObject({ ok: true, reopened: true, auditNote: 'Ada bug', next: { status: 'RUNNING', actualEnd: null, actualStart: d('2026-10-19') } });
  });

  it('status yang sama ditolak sebagai tanpa perubahan', () => {
    expect(applyStatusChange(running, req({ target: 'RUNNING' }))).toEqual({ ok: false, issue: 'NO_CHANGE' });
  });
});

describe('checkManualProgress', () => {
  const base = { note: '', hasCards: true, currentEffective: 40, stageStatus: 'RUNNING' } as const;

  it('angka berbeda tanpa catatan ditolak pada tahapan berkartu (AC FR-05-02)', () => {
    expect(checkManualProgress({ ...base, value: 30 })).toBe('NOTE_REQUIRED');
    expect(checkManualProgress({ ...base, value: 30, note: 'Kartu belum diperbarui' })).toBeNull();
  });

  it('tahapan tanpa kartu diisi langsung tanpa catatan; angka sama tidak butuh catatan', () => {
    expect(checkManualProgress({ ...base, hasCards: false, value: 30 })).toBeNull();
    expect(checkManualProgress({ ...base, value: 40 })).toBeNull();
  });

  it('di luar 0..99 ditolak, 100 hanya lewat Selesai; null mengembalikan ke hitungan sistem', () => {
    expect(checkManualProgress({ ...base, value: 100, note: 'abc' })).toBe('OUT_OF_RANGE');
    expect(checkManualProgress({ ...base, value: -1, note: 'abc' })).toBe('OUT_OF_RANGE');
    expect(checkManualProgress({ ...base, value: null })).toBeNull();
    expect(checkManualProgress({ ...base, value: 10, stageStatus: 'DONE' })).toBe('STAGE_DONE');
  });
});

describe('checkProjectInfo', () => {
  it('nama saja sudah cukup; atribut opsional menjadi null (AC FR-02-01)', () => {
    const result = checkProjectInfo({ name: '  Portal Klaim  ' });
    expect(result).toMatchObject({ ok: true, info: { name: 'Portal Klaim', referenceNo: null, projectType: null, requestDate: null, applicationIds: [] } });
  });

  it('nama kosong, terlalu panjang, jenis atau tanggal tidak valid ditolak per isian', () => {
    expect(checkProjectInfo({ name: ' ' })).toEqual({ ok: false, fields: { name: 'REQUIRED' } });
    expect(checkProjectInfo({ name: 'x'.repeat(101) })).toEqual({ ok: false, fields: { name: 'TOO_LONG' } });
    expect(checkProjectInfo({ name: 'A', projectType: 'LAIN', requestDate: '2026-02-30' })).toEqual({
      ok: false,
      fields: { projectType: 'INVALID', requestDate: 'INVALID' },
    });
    expect(checkProjectInfo({ name: 'A', description: 'x'.repeat(1001) })).toEqual({ ok: false, fields: { description: 'TOO_LONG' } });
  });

  it('UAT Sign Off dan Go Live opsional; tanggal tidak valid ditolak per isian', () => {
    expect(checkProjectInfo({ name: 'A' })).toMatchObject({ ok: true, info: { uatSignOffDate: null, goLiveDate: null } });
    expect(checkProjectInfo({ name: 'A', uatSignOffDate: '2026-11-05', goLiveDate: '2026-11-20' })).toMatchObject({
      ok: true,
      info: { uatSignOffDate: '2026-11-05', goLiveDate: '2026-11-20' },
    });
    expect(checkProjectInfo({ name: 'A', uatSignOffDate: '2026-02-30', goLiveDate: 'besok' })).toEqual({
      ok: false,
      fields: { uatSignOffDate: 'INVALID', goLiveDate: 'INVALID' },
    });
  });

  it('aplikasi terdampak diduplikasi dibersihkan', () => {
    const result = checkProjectInfo({ name: 'A', applicationIds: [1, 2, 2] });
    expect(result.ok && result.info.applicationIds).toEqual([1, 2]);
  });
});

describe('checkProjectStatus', () => {
  it('Ditunda tanpa alasan ditolak; status lain mengosongkan alasan (AC FR-02-01, FR-14-01)', () => {
    expect(checkProjectStatus({ target: 'DEFERRED', reason: ' ', stageStatuses: [], creating: true })).toEqual({ ok: false, issue: 'REASON_REQUIRED' });
    expect(checkProjectStatus({ target: 'CANCELLED', reason: 'Dibatalkan pemilik', stageStatuses: [], creating: false })).toEqual({ ok: true, status: 'CANCELLED', reason: 'Dibatalkan pemilik' });
    expect(checkProjectStatus({ target: 'RUNNING', reason: 'sisa', stageStatuses: [], creating: false })).toEqual({ ok: true, status: 'RUNNING', reason: null });
  });

  it('Selesai tidak ditawarkan saat membuat; hanya bila semua tahapan Selesai (AC FR-14-01)', () => {
    expect(checkProjectStatus({ target: 'COMPLETED', reason: '', stageStatuses: ['DONE', 'DONE', 'DONE'], creating: true })).toEqual({ ok: false, issue: 'COMPLETED_ON_CREATE' });
    expect(checkProjectStatus({ target: 'COMPLETED', reason: '', stageStatuses: ['DONE', 'RUNNING', 'DONE'], creating: false })).toEqual({ ok: false, issue: 'NOT_ALL_STAGES_DONE' });
    expect(checkProjectStatus({ target: 'COMPLETED', reason: '', stageStatuses: ['DONE', 'DONE', 'DONE'], creating: false }).ok).toBe(true);
  });

  it('status tidak dikenal ditolak', () => {
    expect(checkProjectStatus({ target: 'ENTAH', reason: '', stageStatuses: [], creating: false })).toEqual({ ok: false, issue: 'INVALID' });
  });
});

describe('planningCompleteness', () => {
  it('project dengan nama saja: tiga tahapan Belum ada PIC dan Belum ada timeline (AC FR-02-01)', () => {
    const result = planningCompleteness([
      { kind: 'BA', assignedCount: 0, hasTimeline: false },
      { kind: 'DEV', assignedCount: 0, hasTimeline: false },
      { kind: 'QA', assignedCount: 0, hasTimeline: false },
    ]);
    expect(result).toEqual({ isComplete: false, missingPic: ['BA', 'DEV', 'QA'], missingTimeline: ['BA', 'DEV', 'QA'] });
  });

  it('lengkap bila setiap tahapan punya PIC dan timeline', () => {
    const result = planningCompleteness([
      { kind: 'BA', assignedCount: 1, hasTimeline: true },
      { kind: 'DEV', assignedCount: 2, hasTimeline: true },
      { kind: 'QA', assignedCount: 1, hasTimeline: true },
    ]);
    expect(result.isComplete).toBe(true);
  });
});
