/**
 * Aturan project: validasi atribut, status project, dan kelengkapan perencanaan
 * (FR-02-01, FR-02-02, FR-10-01 butir 2, FR-11-02, FR-14-01; BL-01, BL-20, BL-21).
 */
import { isIsoDate, type IsoDate } from '@/shared/iso-date';
import type { ProjectStatus, StageKind, StageStatus } from './stage-types';

/** Jenis project: baru atau permintaan perubahan (FR-02-01 butir 3). */
export type ProjectType = 'NEW' | 'CHANGE_REQUEST';

/** Batas panjang atribut project (FR-02-01 butir 3 dan 4). */
export const PROJECT_LIMITS = {
  name: 100,
  referenceNo: 50,
  businessOwner: 100,
  department: 100,
  description: 1000,
  statusReason: 200,
} as const;

/** Status yang boleh dipilih saat membuat project; Selesai tidak ditawarkan (BL-21). */
export const CREATE_STATUS_CHOICES: ReadonlyArray<ProjectStatus> = ['BACKLOG', 'RUNNING', 'DEFERRED', 'CANCELLED'];

/** Atribut project yang dikirim pengguna (teks mentah). */
export interface ProjectInfoInput {
  readonly name: string;
  readonly referenceNo?: string;
  readonly projectType?: string;
  readonly businessOwner?: string;
  readonly department?: string;
  readonly requestDate?: string;
  readonly uatSignOffDate?: string;
  readonly goLiveDate?: string;
  readonly description?: string;
  readonly applicationIds?: ReadonlyArray<number>;
}

/** Atribut project yang sudah dibersihkan dan tervalidasi. */
export interface ProjectInfo {
  readonly name: string;
  readonly referenceNo: string | null;
  readonly projectType: ProjectType | null;
  readonly businessOwner: string | null;
  readonly department: string | null;
  readonly requestDate: IsoDate | null;
  readonly uatSignOffDate: IsoDate | null;
  readonly goLiveDate: IsoDate | null;
  readonly description: string | null;
  readonly applicationIds: ReadonlyArray<number>;
}

/** Kode masalah per isian atribut project. */
export type ProjectFieldIssue = 'REQUIRED' | 'TOO_LONG' | 'INVALID';

/**
 * Memangkas teks opsional: spasi di tepi dibuang, kosong menjadi null.
 * Masukan: teks atau undefined. Keluaran: teks bersih atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-02-01 butir 3.
 */
function cleanOptional(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Memeriksa dan membersihkan atribut project.
 * Masukan: atribut mentah. Keluaran: atribut bersih, atau masalah per isian (`name`, `referenceNo`,
 * `projectType`, `businessOwner`, `department`, `requestDate`, `uatSignOffDate`, `goLiveDate`, `description`).
 * Request date, UAT Sign Off, dan Go Live (semua opsional) diterima dalam bentuk `YYYY-MM-DD` (konversi dari dd/mm/yyyy dilakukan di lapisan UI).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-02-01 butir 3, EC-02-01.01, EC-02-01.02, EC-02-01.09.
 */
export function checkProjectInfo(
  input: ProjectInfoInput,
): { ok: true; info: ProjectInfo } | { ok: false; fields: Partial<Record<keyof ProjectInfoInput, ProjectFieldIssue>> } {
  const fields: Partial<Record<keyof ProjectInfoInput, ProjectFieldIssue>> = {};
  const name = input.name.trim();
  if (name.length === 0) fields.name = 'REQUIRED';
  else if ([...name].length > PROJECT_LIMITS.name) fields.name = 'TOO_LONG';

  const optionalLimits = [
    ['referenceNo', PROJECT_LIMITS.referenceNo],
    ['businessOwner', PROJECT_LIMITS.businessOwner],
    ['department', PROJECT_LIMITS.department],
    ['description', PROJECT_LIMITS.description],
  ] as const;
  for (const [field, limit] of optionalLimits) {
    const cleaned = cleanOptional(input[field]);
    if (cleaned !== null && [...cleaned].length > limit) fields[field] = 'TOO_LONG';
  }

  const projectType = cleanOptional(input.projectType);
  if (projectType !== null && projectType !== 'NEW' && projectType !== 'CHANGE_REQUEST') fields.projectType = 'INVALID';

  const requestDate = cleanOptional(input.requestDate);
  if (requestDate !== null && !isIsoDate(requestDate)) fields.requestDate = 'INVALID';
  const uatSignOffDate = cleanOptional(input.uatSignOffDate);
  if (uatSignOffDate !== null && !isIsoDate(uatSignOffDate)) fields.uatSignOffDate = 'INVALID';
  const goLiveDate = cleanOptional(input.goLiveDate);
  if (goLiveDate !== null && !isIsoDate(goLiveDate)) fields.goLiveDate = 'INVALID';

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    info: {
      name,
      referenceNo: cleanOptional(input.referenceNo),
      projectType: projectType as ProjectType | null,
      businessOwner: cleanOptional(input.businessOwner),
      department: cleanOptional(input.department),
      requestDate: requestDate as IsoDate | null,
      uatSignOffDate: uatSignOffDate as IsoDate | null,
      goLiveDate: goLiveDate as IsoDate | null,
      description: cleanOptional(input.description),
      applicationIds: [...new Set(input.applicationIds ?? [])],
    },
  };
}

/** Penyebab penolakan status project. */
export type ProjectStatusIssue = 'REASON_REQUIRED' | 'REASON_TOO_LONG' | 'NOT_ALL_STAGES_DONE' | 'COMPLETED_ON_CREATE' | 'INVALID';

/**
 * Memeriksa pilihan status project beserta alasannya. Ditunda dan Batal wajib alasan (maksimum 200); status
 * lain mengosongkan alasan; Selesai hanya bila semua tahapan Selesai dan tidak ditawarkan saat membuat project.
 * Masukan: status tujuan, alasan, status ketiga tahapan, dan apakah ini pembuatan project baru.
 * Keluaran: status dan alasan yang akan disimpan, atau penyebab penolakan.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-14-01 butir 3 sampai 5 dan 8, BL-20, BL-21; AC: Ditunda tanpa alasan ditolak, Selesai ditolak bila ada tahapan Berjalan.
 */
export function checkProjectStatus(input: {
  target: string;
  reason: string;
  stageStatuses: ReadonlyArray<StageStatus>;
  creating: boolean;
}): { ok: true; status: ProjectStatus; reason: string | null } | { ok: false; issue: ProjectStatusIssue } {
  const known: ReadonlyArray<ProjectStatus> = ['BACKLOG', 'RUNNING', 'DEFERRED', 'CANCELLED', 'COMPLETED'];
  if (!known.includes(input.target as ProjectStatus)) return { ok: false, issue: 'INVALID' };
  const status = input.target as ProjectStatus;
  if (status === 'COMPLETED') {
    if (input.creating) return { ok: false, issue: 'COMPLETED_ON_CREATE' };
    if (input.stageStatuses.length === 0 || input.stageStatuses.some((s) => s !== 'DONE')) {
      return { ok: false, issue: 'NOT_ALL_STAGES_DONE' };
    }
  }
  if (status === 'DEFERRED' || status === 'CANCELLED') {
    const reason = input.reason.trim();
    if (reason.length === 0) return { ok: false, issue: 'REASON_REQUIRED' };
    if ([...reason].length > PROJECT_LIMITS.statusReason) return { ok: false, issue: 'REASON_TOO_LONG' };
    return { ok: true, status, reason };
  }
  return { ok: true, status, reason: null };
}

/** Fakta sebuah tahapan untuk menilai kelengkapan perencanaan. */
export interface PlanningFacts {
  readonly kind: StageKind;
  readonly assignedCount: number;
  readonly hasTimeline: boolean;
}

/** Hasil penilaian kelengkapan perencanaan satu project. */
export interface PlanningCompleteness {
  readonly isComplete: boolean;
  /** Tahapan tanpa PIC ("Belum ada PIC"). */
  readonly missingPic: ReadonlyArray<StageKind>;
  /** Tahapan tanpa estimasi ("Belum ada timeline"). */
  readonly missingTimeline: ReadonlyArray<StageKind>;
}

/**
 * Menilai kelengkapan perencanaan project: setiap tahapan perlu sedikitnya satu PIC dan satu estimasi.
 * Masukan: fakta ketiga tahapan. Keluaran: `PlanningCompleteness`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-10-01 butir 2, FR-02-02 butir 4, BL-41 (filter Kelengkapan perencanaan).
 */
export function planningCompleteness(stages: ReadonlyArray<PlanningFacts>): PlanningCompleteness {
  const missingPic = stages.filter((s) => s.assignedCount === 0).map((s) => s.kind);
  const missingTimeline = stages.filter((s) => !s.hasTimeline).map((s) => s.kind);
  return { isComplete: missingPic.length === 0 && missingTimeline.length === 0, missingPic, missingTimeline };
}

/** Penyebab penolakan isian estimasi (mulai dan selesai). */
export type EstimateInputIssue = 'PAIR_REQUIRED' | 'INVALID_DATE' | 'END_BEFORE_START';

/**
 * Memeriksa pasangan tanggal estimasi tahapan: keduanya diisi atau keduanya kosong, tanggal nyata, selesai tidak
 * sebelum mulai.
 * Masukan: teks tanggal mulai dan selesai dalam bentuk `YYYY-MM-DD` (kosong = belum diisi). Keluaran: estimasi, atau
 * null bila keduanya kosong, atau penyebab penolakan.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-02-02 butir 2, BL-03, EC-02-01.04, EC-13-01.03.
 */
export function checkEstimateInput(
  start: string,
  end: string,
): { ok: true; estimate: { start: IsoDate; end: IsoDate } | null } | { ok: false; issue: EstimateInputIssue } {
  const from = start.trim();
  const to = end.trim();
  if (from === '' && to === '') return { ok: true, estimate: null };
  if (from === '' || to === '') return { ok: false, issue: 'PAIR_REQUIRED' };
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, issue: 'INVALID_DATE' };
  if (to < from) return { ok: false, issue: 'END_BEFORE_START' };
  return { ok: true, estimate: { start: from, end: to } };
}
