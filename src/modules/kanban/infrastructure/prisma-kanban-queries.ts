/**
 * Implementasi Prisma untuk query baca Kanban: papan, rincian kartu, rencana kerja, log project, kepatuhan, dan
 * project yang diikuti PIC (FR-16-01, FR-17-03, FR-18-01, FR-20, FR-21-05).
 *
 * Penyaringan dan paging terjadi di SQL; agregat log dan jadwal ulang dimuat sekali untuk seluruh kartu yang tampil
 * (tanpa N+1), Technical Design §13.
 */
import type { PrismaClient, Prisma } from '@/generated/prisma/client';
import { fromDbDate, fromDbTime, toDbDate } from '@/shared/db-date';
import type { IsoDate } from '@/shared/iso-date';
import type { Estimate, ProjectStatus, StageKind, StageStatus } from '@/modules/project';
import type { BoardCardRow, BoardFilter, KanbanQueryRepository, ProjectLogPage } from '../application/ports';
import { CARD_INCLUDE, toCardRecord, toWorkLogRow } from './prisma-card-repository';

/** Relasi tambahan untuk kartu project: status project dan tahapan pemilik kartu. */
const BOARD_INCLUDE = {
  ...CARD_INCLUDE,
  project: { select: { code: true, name: true, status: true, project_stage: { select: { stage: true, status: true, est_start: true, est_end: true, baseline_start: true, baseline_end: true } } } },
} as const;

/** Jumlah log dan menit log per kartu. */
interface LogAggregate {
  readonly count: number;
  readonly minutes: number;
}

/**
 * Membuat estimasi dari dua kolom tanggal; null bila salah satu kosong.
 * Masukan: tanggal mulai dan selesai. Keluaran: `Estimate` atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-02-02 butir 2.
 */
function estimateOf(start: Date | null, end: Date | null): Estimate | null {
  const from = fromDbDate(start);
  const to = fromDbDate(end);
  return from && to ? { start: from, end: to } : null;
}

/**
 * Membuat repository query baca Kanban di atas klien Prisma.
 * Masukan: klien Prisma. Keluaran: `KanbanQueryRepository`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan hanya membaca.
 * Rujukan: Technical Design §7.1, §13.
 */
export function createPrismaKanbanQueries(prisma: PrismaClient): KanbanQueryRepository {
  /**
   * Mencari id kartu project belum Done (tidak dibatalkan) yang ditandai permanen sebagai asal perpanjangan estimasi
   * tahapan atau yang rencananya melewati estimasi selesai terkini tahapannya, dalam satu kueri.
   * Masukan: tidak ada. Keluaran: daftar id kartu.
   * Efek samping: tidak ada (hanya baca).
   * Rujukan: FR-04-01 kartu 6, FR-16-01 butir 4, FR-13-05 butir 5, NFR-14 (angka sama dengan layar tujuan).
   */
  async function extendingCardIds(): Promise<bigint[]> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
      `SELECT c.id FROM card c JOIN project_stage s ON s.project_id = c.project_id AND s.stage = c.stage
       WHERE c.kind = 'PROJECT' AND c.cancelled_at IS NULL AND c.board_column <> 'DONE' AND (c.extends_stage OR (s.est_end IS NOT NULL AND c.plan_end > s.est_end))`,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Menghitung jumlah log dan menit log untuk sekumpulan kartu dalam satu kueri.
   * Masukan: id kartu. Keluaran: peta id kartu ke agregat.
   * Efek samping: tidak ada (hanya baca).
   * Rujukan: FR-18-01 butir 5.
   */
  async function logAggregates(cardIds: ReadonlyArray<bigint>): Promise<Map<number, LogAggregate>> {
    const result = new Map<number, LogAggregate>();
    if (cardIds.length === 0) return result;
    const rows = await prisma.$queryRawUnsafe<Array<{ card_id: bigint; c: bigint; m: number }>>(
      'SELECT card_id, COUNT(*) AS c, COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS m FROM work_log WHERE card_id = ANY($1::bigint[]) GROUP BY card_id',
      cardIds,
    );
    for (const row of rows) result.set(Number(row.card_id), { count: Number(row.c), minutes: row.m });
    return result;
  }

  /**
   * Menghitung jumlah jadwal ulang per kartu dalam satu kueri.
   * Masukan: id kartu. Keluaran: peta id kartu ke jumlah.
   * Efek samping: tidak ada (hanya baca).
   * Rujukan: FR-21-02 butir 2, FR-21-05 butir 2.
   */
  async function rescheduleCounts(cardIds: ReadonlyArray<bigint>): Promise<Map<number, number>> {
    if (cardIds.length === 0) return new Map();
    const groups = await prisma.card_reschedule.groupBy({ by: ['card_id'], where: { card_id: { in: [...cardIds] } }, _count: { _all: true } });
    return new Map(groups.map((group) => [Number(group.card_id), group._count._all]));
  }

  /**
   * Mengubah baris kartu menjadi baris papan dengan agregat dan data tahapan.
   * Masukan: baris kartu dengan relasi `BOARD_INCLUDE`. Keluaran: baris papan.
   * Efek samping: membaca agregat log dan jadwal ulang (dua kueri untuk seluruh baris).
   * Rujukan: FR-17-03, FR-21-02.
   */
  async function toBoardRows(rows: Array<Prisma.cardGetPayload<{ include: typeof BOARD_INCLUDE }>>): Promise<BoardCardRow[]> {
    const ids = rows.map((row) => row.id);
    const [logs, reschedules] = await Promise.all([logAggregates(ids), rescheduleCounts(ids)]);
    return rows.map((row) => {
      const stage = row.project?.project_stage.find((s) => s.stage === row.stage) ?? null;
      const log = logs.get(Number(row.id));
      return {
        card: toCardRecord(row),
        loggedMinutes: log?.minutes ?? 0,
        logCount: log?.count ?? 0,
        rescheduleCount: reschedules.get(Number(row.id)) ?? 0,
        projectStatus: (row.project?.status as ProjectStatus | undefined) ?? null,
        stageEstimate: stage ? estimateOf(stage.est_start, stage.est_end) : null,
        stageBaseline: stage ? estimateOf(stage.baseline_start, stage.baseline_end) : null,
        stageStatus: (stage?.status as StageStatus | undefined) ?? null,
      };
    });
  }

  /**
   * Menyusun kondisi papan dari filter: PIC, jenis, kata kunci, dan periode.
   * Masukan: filter, penanda daftar dibatalkan, dan id kartu pemanjang estimasi (untuk filter itu). Keluaran: kondisi Prisma.
   * Efek samping: tidak ada (fungsi murni).
   * Rujukan: FR-16-01 butir 3 dan 4, BL-37.
   */
  function boardWhere(filter: BoardFilter, cancelled: boolean, extendingIds: ReadonlyArray<bigint> = []): Prisma.cardWhereInput {
    const and: Prisma.cardWhereInput[] = [cancelled ? { cancelled_at: { not: null } } : { cancelled_at: null }];
    if (filter.picId !== null) and.push({ owner_pic_id: BigInt(filter.picId) });
    if (filter.kind !== null) and.push({ kind: filter.kind });
    if (filter.q !== '') {
      const contains = { contains: filter.q, mode: 'insensitive' as const };
      and.push({ OR: [{ title: contains }, { code: contains }, { category_name: contains }, { project: { name: contains } }, { project: { code: contains } }] });
    }
    if (filter.extendsOnly) and.push({ id: { in: [...extendingIds] } });
    else if (filter.range && !cancelled) {
      const from = toDbDate(filter.range.start) as Date;
      const to = toDbDate(filter.range.end) as Date;
      and.push({ OR: [{ board_column: { not: 'DONE' } }, { plan_start: { lte: to }, plan_end: { gte: from } }, { done_on: { gte: from, lte: to } }] });
    }
    return { AND: and };
  }

  return {
    /** Membaca satu kartu. Efek samping: tidak ada (hanya baca). */
    async findCard(cardId) {
      const row = await prisma.card.findUnique({ where: { id: BigInt(cardId) }, include: CARD_INCLUDE });
      return row ? toCardRecord(row) : null;
    },

    /** Papan: kartu tidak dibatalkan menurut filter. Efek samping: tidak ada (hanya baca). */
    async listBoard(filter) {
      const ids = filter.extendsOnly ? await extendingCardIds() : [];
      const rows = await prisma.card.findMany({ where: boardWhere(filter, false, ids), include: BOARD_INCLUDE, orderBy: [{ plan_end: 'asc' }, { id: 'asc' }] });
      return toBoardRows(rows);
    },

    /** Papan per kolom dengan batas kartu per kolom. Efek samping: tidak ada (hanya baca). */
    async listBoardColumns(filter, limit) {
      const ids = filter.extendsOnly ? await extendingCardIds() : [];
      const columns = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
      const parts = await Promise.all(
        columns.map(async (column) => {
          const where = { AND: [boardWhere(filter, false, ids), { board_column: column }] };
          const [total, rows] = await Promise.all([
            prisma.card.count({ where }),
            prisma.card.findMany({ where, include: BOARD_INCLUDE, take: limit, orderBy: column === 'DONE' ? [{ done_on: 'desc' }, { id: 'desc' }] : [{ plan_end: 'asc' }, { id: 'asc' }] }),
          ]);
          return { column, total, rows };
        }),
      );
      const board = await toBoardRows(parts.flatMap((part) => part.rows));
      const result = { PLANNED: { rows: [] as BoardCardRow[], total: 0 }, IN_PROGRESS: { rows: [] as BoardCardRow[], total: 0 }, DONE: { rows: [] as BoardCardRow[], total: 0 } };
      for (const part of parts) result[part.column] = { rows: board.filter((row) => row.card.column === part.column), total: part.total };
      return result;
    },

    /** Jumlah kartu pemanjang estimasi tahapan. Efek samping: tidak ada (hanya baca). */
    async countExtending() {
      return (await extendingCardIds()).length;
    },

    /** Daftar kartu dibatalkan menurut filter (tanpa batas periode). Efek samping: tidak ada (hanya baca). */
    async listCancelled(filter) {
      const rows = await prisma.card.findMany({ where: boardWhere({ ...filter, range: null, extendsOnly: false }, true), include: BOARD_INCLUDE, orderBy: { cancelled_at: 'desc' }, take: 200 });
      return toBoardRows(rows);
    },

    /** Satu kartu dengan agregat, termasuk yang dibatalkan. Efek samping: tidak ada (hanya baca). */
    async getBoardCard(cardId) {
      const row = await prisma.card.findUnique({ where: { id: BigInt(cardId) }, include: BOARD_INCLUDE });
      return row ? (await toBoardRows([row]))[0] ?? null : null;
    },

    /** Log sebuah kartu, terbaru di atas. Efek samping: tidak ada (hanya baca). */
    async listCardLogs(cardId) {
      const rows = await prisma.work_log.findMany({ where: { card_id: BigInt(cardId) }, orderBy: [{ work_date: 'desc' }, { start_time: 'desc' }] });
      return rows.map(toWorkLogRow);
    },

    /** Riwayat jadwal ulang kartu, terlama di atas. Efek samping: tidak ada (hanya baca). */
    async listReschedules(cardId) {
      const rows = await prisma.card_reschedule.findMany({ where: { card_id: BigInt(cardId) }, orderBy: { id: 'asc' }, include: { app_user: { include: { pic: true } } } });
      return rows.map((row) => ({
        oldStart: fromDbDate(row.old_start) as IsoDate,
        oldEnd: fromDbDate(row.old_end) as IsoDate,
        newStart: fromDbDate(row.new_start) as IsoDate,
        newEnd: fromDbDate(row.new_end) as IsoDate,
        reasonName: row.reason_name,
        note: row.note,
        createdByLabel: row.app_user.pic?.name ?? row.app_user.username,
        createdAt: row.created_at,
      }));
    },

    /** Riwayat progres kartu, terlama di atas. Efek samping: tidak ada (hanya baca). */
    async listProgressEvents(cardId) {
      const rows = await prisma.card_progress_event.findMany({ where: { card_id: BigInt(cardId) }, orderBy: { id: 'asc' }, include: { app_user: { include: { pic: true } } } });
      return rows.map((row) => ({
        oldValue: row.old_value,
        newValue: row.new_value,
        source: row.source,
        createdByLabel: row.app_user.pic?.name ?? row.app_user.username,
        createdAt: row.created_at,
      }));
    },

    /** Kartu tidak dibatalkan sebuah project. Efek samping: tidak ada (hanya baca). */
    async listProjectCards(projectId) {
      const rows = await prisma.card.findMany({ where: { project_id: BigInt(projectId), cancelled_at: null }, include: BOARD_INCLUDE, orderBy: [{ plan_start: 'asc' }, { id: 'asc' }] });
      return toBoardRows(rows);
    },

    /** Log project berhalaman dengan ringkasan seluruh project. Efek samping: tidak ada (hanya baca). */
    async listProjectLogs(projectId, filter, page, pageSize): Promise<ProjectLogPage> {
      const params: unknown[] = [projectId];
      let where = 'c.project_id = $1';
      if (filter.stage) {
        params.push(filter.stage);
        where += ` AND c.stage = $${params.length}::stage_t`;
      }
      if (filter.picId !== null) {
        params.push(filter.picId);
        where += ` AND w.owner_pic_id = $${params.length}`;
      }
      const base = 'FROM work_log w JOIN card c ON c.id = w.card_id JOIN pic p ON p.id = w.owner_pic_id';
      const minutes = 'EXTRACT(EPOCH FROM (w.end_time - w.start_time)) / 60';
      const [rows, count, perStage, perPic] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ id: bigint; work_date: Date; start_time: Date; end_time: Date; pic_name: string; stage: StageKind; step_name: string | null; description: string; code: string; title: string }>>(
          `SELECT w.id, w.work_date, w.start_time, w.end_time, p.name AS pic_name, c.stage, w.step_name, w.description, c.code, c.title ${base} WHERE ${where} ORDER BY w.work_date DESC, w.start_time DESC, w.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          ...params,
          pageSize,
          (page - 1) * pageSize,
        ),
        prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total ${base} WHERE ${where}`, ...params),
        prisma.$queryRawUnsafe<Array<{ stage: StageKind; m: number }>>(`SELECT c.stage, SUM(${minutes})::int AS m ${base} WHERE c.project_id = $1 GROUP BY c.stage ORDER BY c.stage`, projectId),
        prisma.$queryRawUnsafe<Array<{ pic_id: bigint; name: string; m: number }>>(`SELECT p.id AS pic_id, p.name, SUM(${minutes})::int AS m ${base} WHERE c.project_id = $1 GROUP BY p.id, p.name ORDER BY p.name`, projectId),
      ]);
      return {
        rows: rows.map((row) => ({
          id: Number(row.id),
          workDate: fromDbDate(row.work_date) as IsoDate,
          span: { start: fromDbTime(row.start_time), end: fromDbTime(row.end_time) },
          picName: row.pic_name,
          stage: row.stage,
          stepName: row.step_name,
          description: row.description,
          cardCode: row.code,
          cardTitle: row.title,
        })),
        total: Number(count[0]?.total ?? 0),
        totalMinutes: perStage.reduce((sum, row) => sum + row.m, 0),
        perStage: perStage.map((row) => ({ stage: row.stage, minutes: row.m })),
        perPic: perPic.map((row) => ({ picId: Number(row.pic_id), name: row.name, minutes: row.m })),
      };
    },

    /** Kartu untuk kepatuhan: tidak dibatalkan, tanggal selesai rencana atau (dadakan) mulai pada periode. */
    async listComplianceCards(range) {
      const from = toDbDate(range.start) as Date;
      const to = toDbDate(range.end) as Date;
      const rows = await prisma.card.findMany({
        where: { cancelled_at: null, OR: [{ is_adhoc: false, plan_end: { gte: from, lte: to } }, { is_adhoc: true, plan_start: { gte: from, lte: to } }] },
        select: { id: true, owner_pic_id: true, plan_start: true, plan_end: true, done_on: true, is_adhoc: true },
      });
      const counts = await rescheduleCounts(rows.map((row) => row.id));
      return rows.map((row) => ({
        id: Number(row.id),
        ownerPicId: Number(row.owner_pic_id),
        planStart: fromDbDate(row.plan_start) as IsoDate,
        planEnd: fromDbDate(row.plan_end) as IsoDate,
        doneOn: fromDbDate(row.done_on),
        isAdhoc: row.is_adhoc,
        cancelled: false,
        rescheduleCount: counts.get(Number(row.id)) ?? 0,
      }));
    },

    /** Project yang diikuti PIC pada tahapannya, terbaru di atas. Efek samping: tidak ada (hanya baca). */
    async listFollowedProjects(picId, stage) {
      const rows = await prisma.project.findMany({
        where: {
          status: { in: ['BACKLOG', 'RUNNING', 'DEFERRED'] },
          project_stage: { some: { stage, status: { not: 'DONE' }, stage_assignment: { some: { pic_id: BigInt(picId) } } } },
        },
        select: { id: true, code: true, name: true, status: true, status_reason: true, project_stage: { where: { stage }, select: { status: true } } },
        orderBy: { id: 'desc' },
        take: 500,
      });
      return rows.map((row) => ({
        projectId: Number(row.id),
        code: row.code,
        name: row.name,
        status: row.status as ProjectStatus,
        statusReason: row.status_reason,
        stageStatus: (row.project_stage[0]?.status ?? 'NOT_STARTED') as StageStatus,
      }));
    },
  };
}
