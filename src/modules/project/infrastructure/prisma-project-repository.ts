/**
 * Implementasi Prisma untuk repository project dan tahapan.
 *
 * Seluruh penulisan memakai transaksi pemanggil; penyimpanan berversi memakai `updateMany` dengan syarat versi
 * agar penyimpanan berdasarkan data lama ditolak (NFR-10).
 */
import type { PrismaClient } from '@/generated/prisma/client';
import { fromDbDate, toDbDate } from '@/shared/db-date';
import { toIsoDate, type IsoDate } from '@/shared/iso-date';
import type { TxContext } from '@/shared/transaction';
import type {
  Assignee,
  ProjectRepository,
  ProjectSnapshot,
  RevisionRow,
  StageSnapshot,
} from '../application/ports';
import type { ProjectType } from '../domain/project-rules';
import type { Estimate, ProjectStatus, StageKind, StageStatus } from '../domain/stage-types';

/** Klien Prisma atau transaksi Prisma. */
type Db = PrismaClient;

/** Urutan tahapan tetap: BA, Development, QA (BL-02). */
const STAGE_ORDER: ReadonlyArray<StageKind> = ['BA', 'DEV', 'QA'];

/** Pembuat tanggal bisnis dari objek `Date` kolom `DATE` (selalu tengah malam UTC). */
const BUSINESS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Menyusun estimasi dari dua kolom tanggal (keduanya terisi atau keduanya null, dijaga constraint database).
 * Masukan: tanggal mulai dan selesai. Keluaran: `Estimate` atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-02-02 butir 2, BL-03.
 */
function toEstimate(start: Date | null, end: Date | null): Estimate | null {
  const from = fromDbDate(start);
  const to = fromDbDate(end);
  return from && to ? { start: from, end: to } : null;
}

/**
 * Menurunkan tanggal bisnis (zona Asia/Jakarta) dari sebuah instan waktu.
 * Masukan: `Date`. Keluaran: `IsoDate`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: BL-09, FR-13-05 butir 3 ("satu hari" memakai tanggal server zona Asia/Jakarta).
 */
function businessDayOf(instant: Date): IsoDate {
  return toIsoDate(BUSINESS_DAY.format(instant));
}

/** Pemilihan relasi untuk membaca project lengkap. */
const PROJECT_INCLUDE = {
  project_application: { include: { affected_application: true } },
  project_stage: {
    include: {
      stage_assignment: { include: { pic: true, app_user: { include: { pic: true } } } },
      stage_hold_history: true,
      app_user: { include: { pic: true } },
      _count: { select: { stage_revision: true } },
    },
  },
} as const;

/**
 * Menentukan label pelaku untuk tampilan: nama PIC bila ada, selain itu username akun.
 * Masukan: akun beserta PIC-nya (boleh null). Keluaran: label atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: BL-07 (pelaku dari sesi login).
 */
function userLabel(user: { username: string; pic: { name: string } | null } | null): string | null {
  return user ? (user.pic?.name ?? user.username) : null;
}

/** Baris project beserta relasi seperti dikembalikan `PROJECT_INCLUDE`. */
type ProjectRow = NonNullable<Awaited<ReturnType<typeof readProjectRow>>>;

/**
 * Membaca satu project beserta tahapan, penugasan, riwayat hold, dan aplikasi.
 * Masukan: klien atau transaksi dan id project. Keluaran: baris atau null.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-11-01.
 */
async function readProjectRow(db: Db, projectId: number) {
  return db.project.findUnique({ where: { id: BigInt(projectId) }, include: PROJECT_INCLUDE });
}

/**
 * Mengubah baris project menjadi snapshot aplikasi.
 * Masukan: baris project dengan relasi. Keluaran: `ProjectSnapshot` dengan tahapan terurut BA, DEV, QA.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-11-01, BL-01.
 */
export function toProjectSnapshot(row: ProjectRow): ProjectSnapshot {
  const stages: StageSnapshot[] = [...row.project_stage]
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage as StageKind) - STAGE_ORDER.indexOf(b.stage as StageKind))
    .map((stage) => ({
      id: Number(stage.id),
      projectId: Number(stage.project_id),
      kind: stage.stage as StageKind,
      status: stage.status as StageStatus,
      estimate: toEstimate(stage.est_start, stage.est_end),
      baseline: toEstimate(stage.baseline_start, stage.baseline_end),
      actualStart: fromDbDate(stage.actual_start),
      actualEnd: fromDbDate(stage.actual_end),
      holdSince: fromDbDate(stage.hold_since),
      holdReason: stage.hold_reason,
      holdBy: stage.hold_by === null ? null : Number(stage.hold_by),
      manualProgress: stage.manual_progress,
      manualProgressNote: stage.manual_progress_note,
      manualProgressByLabel: userLabel(stage.app_user),
      manualProgressBy: stage.manual_progress_by === null ? null : Number(stage.manual_progress_by),
      manualProgressAt: stage.manual_progress_at,
      version: stage.version,
      assignees: [...stage.stage_assignment]
        .sort((a, b) => Number(a.pic_id) - Number(b.pic_id))
        .map(
          (assignment): Assignee => ({
            picId: Number(assignment.pic_id),
            name: assignment.pic.name,
            seenAt: assignment.seen_at,
            assignedAt: assignment.assigned_at,
            assignedByLabel: userLabel(assignment.app_user) ?? '',
          }),
        ),
      revisionCount: stage._count.stage_revision,
      holdHistory: [...stage.stage_hold_history]
        .sort((a, b) => a.hold_since.getTime() - b.hold_since.getTime())
        .map((hold) => ({
          since: toIsoDate(hold.hold_since.toISOString().slice(0, 10)),
          resumedOn: toIsoDate(hold.resumed_on.toISOString().slice(0, 10)),
          reason: hold.reason,
        })),
    }));

  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    referenceNo: row.reference_no,
    projectType: row.project_type as ProjectType | null,
    businessOwner: row.business_owner,
    department: row.department,
    requestDate: fromDbDate(row.request_date),
    uatSignOffDate: fromDbDate(row.uat_sign_off_date),
    goLiveDate: fromDbDate(row.go_live_date),
    description: row.description,
    status: row.status as ProjectStatus,
    statusReason: row.status_reason,
    version: row.version,
    createdAt: row.created_at,
    applications: row.project_application
      .map((link) => ({ id: Number(link.affected_application.id), name: link.affected_application.name, isActive: link.affected_application.is_active }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stages,
  };
}

/**
 * Mengubah baris revisi menjadi `RevisionRow`.
 * Masukan: baris revisi dengan pelaku dan kartu asal. Keluaran: `RevisionRow`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-13-01, FR-13-05 butir 2 (kartu asal dicatat).
 */
export function toRevisionRow(row: {
  id: bigint;
  stage_id: bigint;
  seq: number;
  prev_start: Date;
  prev_end: Date;
  new_start: Date;
  new_end: Date;
  category_name: string;
  note: string;
  created_by: bigint;
  created_at: Date;
  app_user: { username: string; pic: { name: string } | null };
  stage_revision_source: Array<{ card: { code: string } }>;
}): RevisionRow {
  return {
    id: Number(row.id),
    stageId: Number(row.stage_id),
    seq: row.seq,
    previous: { start: fromDbDate(row.prev_start) as IsoDate, end: fromDbDate(row.prev_end) as IsoDate },
    next: { start: fromDbDate(row.new_start) as IsoDate, end: fromDbDate(row.new_end) as IsoDate },
    categoryName: row.category_name,
    note: row.note,
    createdBy: Number(row.created_by),
    createdByLabel: userLabel(row.app_user) ?? '',
    createdAt: row.created_at,
    createdOn: businessDayOf(row.created_at),
    sourceCardCodes: row.stage_revision_source.map((source) => source.card.code),
  };
}

/** Pemilihan relasi untuk membaca revisi. */
export const REVISION_INCLUDE = {
  app_user: { include: { pic: true } },
  stage_revision_source: { include: { card: { select: { code: true } } } },
} as const;

/**
 * Membuat repository project di atas klien Prisma.
 * Masukan: klien Prisma. Keluaran: `ProjectRepository`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan membaca dan menulis tabel project dan tahapan.
 * Rujukan: Technical Design §6.1, database-design §5.
 */
export function createPrismaProjectRepository(prisma: PrismaClient): ProjectRepository {
  const inTx = (tx: TxContext): Db => tx as unknown as Db;

  return {
    /** Membuat project, aplikasi, dan tiga tahapan. Efek samping: INSERT `project`, `project_application`, `project_stage`. */
    async createProject(tx, input) {
      const db = inTx(tx);
      const { info } = input;
      const project = await db.project.create({
        data: {
          name: info.name,
          reference_no: info.referenceNo,
          project_type: info.projectType,
          business_owner: info.businessOwner,
          department: info.department,
          request_date: toDbDate(info.requestDate),
          uat_sign_off_date: toDbDate(info.uatSignOffDate),
          go_live_date: toDbDate(info.goLiveDate),
          description: info.description,
          status: input.status,
          status_reason: input.statusReason,
          created_by: BigInt(input.createdBy),
        },
        select: { id: true, code: true },
      });
      if (info.applicationIds.length > 0) {
        await db.project_application.createMany({
          data: info.applicationIds.map((id) => ({ project_id: project.id, application_id: BigInt(id) })),
        });
      }
      const stageIds = {} as Record<StageKind, number>;
      for (const kind of STAGE_ORDER) {
        const stage = await db.project_stage.create({ data: { project_id: project.id, stage: kind }, select: { id: true } });
        stageIds[kind] = Number(stage.id);
      }
      return { id: Number(project.id), code: project.code, stageIds };
    },

    /** Mengunci dan membaca project. Efek samping: mengunci baris project dan tahapan sampai transaksi selesai. */
    async lockProject(tx, projectId) {
      const db = inTx(tx);
      await db.$queryRawUnsafe('SELECT id FROM project WHERE id = $1 FOR UPDATE', projectId);
      await db.$queryRawUnsafe('SELECT id FROM project_stage WHERE project_id = $1 ORDER BY id FOR UPDATE', projectId);
      const row = await readProjectRow(db, projectId);
      return row ? toProjectSnapshot(row) : null;
    },

    /** Mencari project pemilik tahapan. Efek samping: tidak ada (hanya baca). */
    async findProjectIdOfStage(stageId) {
      const row = await prisma.project_stage.findUnique({ where: { id: BigInt(stageId) }, select: { project_id: true } });
      return row ? Number(row.project_id) : null;
    },

    /** Menyimpan atribut, status, dan aplikasi project dengan syarat versi. Efek samping: UPDATE project, ganti `project_application`. */
    async saveProject(tx, projectId, expectedVersion, write) {
      const db = inTx(tx);
      const { info } = write;
      const updated = await db.project.updateMany({
        where: { id: BigInt(projectId), version: expectedVersion },
        data: {
          name: info.name,
          reference_no: info.referenceNo,
          project_type: info.projectType,
          business_owner: info.businessOwner,
          department: info.department,
          request_date: toDbDate(info.requestDate),
          uat_sign_off_date: toDbDate(info.uatSignOffDate),
          go_live_date: toDbDate(info.goLiveDate),
          description: info.description,
          status: write.status,
          status_reason: write.statusReason,
          version: { increment: 1 },
          updated_at: write.now,
        },
      });
      if (updated.count === 0) return false;
      await db.project_application.deleteMany({ where: { project_id: BigInt(projectId) } });
      if (info.applicationIds.length > 0) {
        await db.project_application.createMany({
          data: info.applicationIds.map((id) => ({ project_id: BigInt(projectId), application_id: BigInt(id) })),
        });
      }
      return true;
    },

    /** Menyimpan keadaan tahapan dengan syarat versi. Efek samping: UPDATE `project_stage`. */
    async saveStage(tx, stageId, expectedVersion, write) {
      const updated = await inTx(tx).project_stage.updateMany({
        where: { id: BigInt(stageId), version: expectedVersion },
        data: {
          status: write.status,
          est_start: toDbDate(write.estimate?.start ?? null),
          est_end: toDbDate(write.estimate?.end ?? null),
          baseline_start: toDbDate(write.baseline?.start ?? null),
          baseline_end: toDbDate(write.baseline?.end ?? null),
          actual_start: toDbDate(write.actualStart),
          actual_end: toDbDate(write.actualEnd),
          hold_since: toDbDate(write.holdSince),
          hold_reason: write.holdReason,
          hold_by: write.holdBy === null ? null : BigInt(write.holdBy),
          manual_progress: write.manualProgress,
          manual_progress_note: write.manualProgressNote,
          manual_progress_by: write.manualProgressBy === null ? null : BigInt(write.manualProgressBy),
          manual_progress_at: write.manualProgressAt,
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    /** Mengganti penugasan PIC. Efek samping: DELETE dan INSERT `stage_assignment`. */
    async replaceAssignees(tx, stage, picIds, context) {
      const db = inTx(tx);
      const existing = await db.stage_assignment.findMany({ where: { stage_id: BigInt(stage.id) }, select: { pic_id: true } });
      const existingIds = existing.map((row) => Number(row.pic_id));
      const added = picIds.filter((id) => !existingIds.includes(id));
      const removed = existingIds.filter((id) => !picIds.includes(id));
      if (removed.length > 0) {
        await db.stage_assignment.deleteMany({ where: { stage_id: BigInt(stage.id), pic_id: { in: removed.map(BigInt) } } });
      }
      if (added.length > 0) {
        await db.stage_assignment.createMany({
          data: added.map((picId) => ({
            stage_id: BigInt(stage.id),
            pic_id: BigInt(picId),
            assigned_by: BigInt(context.assignedBy),
            assigned_at: context.now,
            // BL-45: PIC Development tidak login dan PIC yang menugaskan dirinya sendiri tidak mendapat penanda baru
            seen_at: stage.kind === 'DEV' || picId === context.selfPicId ? context.now : null,
          })),
        });
      }
      return { added, removed };
    },

    /** Menambah riwayat hold. Efek samping: INSERT `stage_hold_history`. */
    async appendHoldHistory(tx, stageId, row) {
      await inTx(tx).stage_hold_history.create({
        data: {
          stage_id: BigInt(stageId),
          hold_since: toDbDate(row.since) as Date,
          resumed_on: toDbDate(row.resumedOn) as Date,
          reason: row.reason,
          held_by: BigInt(row.heldBy),
          resumed_by: BigInt(row.resumedBy),
        },
      });
    },

    /** Membaca revisi terakhir tahapan. Efek samping: tidak ada (hanya baca). */
    async lastRevision(tx, stageId) {
      const row = await inTx(tx).stage_revision.findFirst({
        where: { stage_id: BigInt(stageId) },
        orderBy: { seq: 'desc' },
        include: REVISION_INCLUDE,
      });
      return row ? toRevisionRow(row) : null;
    },

    /** Menambah revisi bernomor berikutnya. Efek samping: INSERT `stage_revision` dan `stage_revision_source`. */
    async appendRevision(tx, stageId, revision) {
      const db = inTx(tx);
      const last = await db.stage_revision.aggregate({ where: { stage_id: BigInt(stageId) }, _max: { seq: true } });
      const seq = (last._max.seq ?? 0) + 1;
      const created = await db.stage_revision.create({
        data: {
          stage_id: BigInt(stageId),
          seq,
          prev_start: toDbDate(revision.previous.start) as Date,
          prev_end: toDbDate(revision.previous.end) as Date,
          new_start: toDbDate(revision.next.start) as Date,
          new_end: toDbDate(revision.next.end) as Date,
          category_name: revision.categoryName,
          note: revision.note,
          created_by: BigInt(revision.createdBy),
          created_at: revision.now,
          updated_at: revision.now,
        },
        select: { id: true },
      });
      if (revision.sourceCardIds.length > 0) {
        await db.stage_revision_source.createMany({
          data: revision.sourceCardIds.map((cardId) => ({ revision_id: created.id, card_id: BigInt(cardId) })),
        });
      }
      return seq;
    },

    /** Menggabungkan perpanjangan ke revisi yang ada. Efek samping: UPDATE `stage_revision`, INSERT sumber kartu. */
    async mergeRevision(tx, revisionId, update) {
      const db = inTx(tx);
      await db.stage_revision.update({
        where: { id: BigInt(revisionId) },
        data: { new_start: toDbDate(update.next.start) as Date, new_end: toDbDate(update.next.end) as Date, category_name: update.categoryName, note: update.note, updated_at: update.now },
      });
      if (update.sourceCardIds.length > 0) {
        await db.stage_revision_source.createMany({
          data: update.sourceCardIds.map((cardId) => ({ revision_id: BigInt(revisionId), card_id: BigInt(cardId) })),
          skipDuplicates: true,
        });
      }
    },

    /** Membaca seluruh revisi tahapan. Efek samping: tidak ada (hanya baca). */
    async listRevisions(stageId) {
      const rows = await prisma.stage_revision.findMany({
        where: { stage_id: BigInt(stageId) },
        orderBy: { seq: 'asc' },
        include: REVISION_INCLUDE,
      });
      return rows.map(toRevisionRow);
    },
  };
}

/**
 * Membaca snapshot project tanpa mengunci (untuk halaman baca).
 * Masukan: klien Prisma dan id project. Keluaran: `ProjectSnapshot` atau null.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-11-01, Technical Design §7.1.
 */
export async function readProjectSnapshot(prisma: PrismaClient, projectId: number): Promise<ProjectSnapshot | null> {
  const row = await readProjectRow(prisma, projectId);
  return row ? toProjectSnapshot(row) : null;
}

/**
 * Membaca snapshot banyak project sekaligus (tanpa N+1), mempertahankan urutan id yang diberikan.
 * Masukan: klien Prisma dan daftar id project. Keluaran: daftar `ProjectSnapshot` sesuai urutan id.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-15-01, Technical Design §13 (tanpa N+1).
 */
export async function readProjectSnapshots(prisma: PrismaClient, projectIds: ReadonlyArray<number>): Promise<ProjectSnapshot[]> {
  if (projectIds.length === 0) return [];
  const rows = await prisma.project.findMany({ where: { id: { in: projectIds.map(BigInt) } }, include: PROJECT_INCLUDE });
  const byId = new Map(rows.map((row) => [Number(row.id), toProjectSnapshot(row)]));
  return projectIds.flatMap((id) => {
    const snapshot = byId.get(id);
    return snapshot ? [snapshot] : [];
  });
}
