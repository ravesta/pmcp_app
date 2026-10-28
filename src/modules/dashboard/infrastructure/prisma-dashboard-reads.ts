/**
 * Implementasi Prisma untuk model baca dashboard dan riwayat: kartu, log, dan tahapan selesai.
 *
 * Seluruh penyaringan, pengurutan, dan paging dilakukan di SQL; agregat dimuat dalam satu kueri per kebutuhan
 * (tanpa N+1), Technical Design §13.
 */
import type { PrismaClient } from '@/generated/prisma/client';
import type { StageKind } from '@/modules/project';
import { fromDbDate, fromDbTime, toDbDate } from '@/shared/db-date';
import type { IsoDate } from '@/shared/iso-date';
import type { DashCard, DashboardReadRepository, DoneStageDetail } from '../application/ports';

/** Kolom kartu yang dibaca untuk hitungan dashboard. */
const CARD_SELECT = { id: true, owner_pic_id: true, kind: true, board_column: true, plan_start: true, plan_end: true, done_on: true, est_minutes: true, is_adhoc: true } as const;

/**
 * Mengubah baris kartu menjadi `DashCard`.
 * Masukan: baris kartu terpilih. Keluaran: `DashCard`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-04-04, FR-04-05, FR-07-06.
 */
function toDashCard(row: { id: bigint; owner_pic_id: bigint; kind: 'PROJECT' | 'ACTIVITY'; board_column: 'PLANNED' | 'IN_PROGRESS' | 'DONE'; plan_start: Date; plan_end: Date; done_on: Date | null; est_minutes: number | null; is_adhoc: boolean }): DashCard {
  return {
    id: Number(row.id),
    picId: Number(row.owner_pic_id),
    kind: row.kind,
    column: row.board_column,
    planStart: fromDbDate(row.plan_start) as IsoDate,
    planEnd: fromDbDate(row.plan_end) as IsoDate,
    doneOn: fromDbDate(row.done_on),
    estimateMinutes: row.est_minutes,
    isAdhoc: row.is_adhoc,
  };
}

/**
 * Membuat model baca dashboard di atas klien Prisma.
 * Masukan: klien Prisma. Keluaran: `DashboardReadRepository`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan hanya membaca.
 * Rujukan: Technical Design §5.2 (dashboard dan history modul baca).
 */
export function createPrismaDashboardReads(prisma: PrismaClient): DashboardReadRepository {
  return {
    /** PIC aktif ber-login. Efek samping: tidak ada (hanya baca). */
    async listLoginPics() {
      const rows = await prisma.pic.findMany({ where: { is_active: true, app_user: { isNot: null }, stage: { in: ['BA', 'QA'] } }, orderBy: { name: 'asc' } });
      return rows.map((row) => ({ id: Number(row.id), name: row.name, stage: row.stage as StageKind }));
    },

    /** Kartu beririsan periode. Efek samping: tidak ada (hanya baca). */
    async listCardsOverlapping(range) {
      const rows = await prisma.card.findMany({
        where: { cancelled_at: null, plan_start: { lte: toDbDate(range.end) as Date }, plan_end: { gte: toDbDate(range.start) as Date } },
        select: CARD_SELECT,
      });
      return rows.map(toDashCard);
    },

    /** Kartu terbuka. Efek samping: tidak ada (hanya baca). */
    async listOpenCards(picId, columns) {
      const rows = await prisma.card.findMany({
        where: { cancelled_at: null, board_column: columns ? { in: [...columns] } : { not: 'DONE' }, ...(picId === null ? {} : { owner_pic_id: BigInt(picId) }) },
        select: CARD_SELECT,
      });
      return rows.map(toDashCard);
    },

    /** Menit log per PIC. Efek samping: tidak ada (hanya baca). */
    async logMinutesByPic(range) {
      const rows = await prisma.$queryRawUnsafe<Array<{ owner_pic_id: bigint; m: number }>>(
        'SELECT owner_pic_id, COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS m FROM work_log WHERE work_date BETWEEN $1::date AND $2::date GROUP BY owner_pic_id',
        range.start,
        range.end,
      );
      return new Map(rows.map((row) => [Number(row.owner_pic_id), row.m]));
    },

    /** Tanggal log terakhir per kartu. Efek samping: tidak ada (hanya baca). */
    async lastLogDates(cardIds) {
      if (cardIds.length === 0) return new Map();
      const rows = await prisma.work_log.groupBy({ by: ['card_id'], where: { card_id: { in: cardIds.map(BigInt) } }, _max: { work_date: true } });
      return new Map(rows.flatMap((row) => (row._max.work_date ? [[Number(row.card_id), fromDbDate(row._max.work_date) as IsoDate] as const] : [])));
    },

    /** Kartu selesai pada tanggal per jenis. Efek samping: tidak ada (hanya baca). */
    async doneOnByKind(picId, date) {
      const groups = await prisma.card.groupBy({ by: ['kind'], where: { owner_pic_id: BigInt(picId), cancelled_at: null, board_column: 'DONE', done_on: toDbDate(date) as Date }, _count: { _all: true } });
      const count = (kind: 'PROJECT' | 'ACTIVITY') => groups.find((group) => group.kind === kind)?._count._all ?? 0;
      return { PROJECT: count('PROJECT'), ACTIVITY: count('ACTIVITY') };
    },

    /** Log PIC pada periode. Efek samping: tidak ada (hanya baca). */
    async listLogs(picId, range) {
      const rows = await prisma.work_log.findMany({
        where: { owner_pic_id: BigInt(picId), work_date: { gte: toDbDate(range.start) as Date, lte: toDbDate(range.end) as Date } },
        orderBy: [{ work_date: 'asc' }, { start_time: 'asc' }],
        include: { card: { select: { id: true, code: true, kind: true, title: true, stage: true, step_name: true, category_name: true, project: { select: { code: true, name: true } } } } },
      });
      return rows.map((row) => ({
        id: Number(row.id),
        date: fromDbDate(row.work_date) as IsoDate,
        startMinute: fromDbTime(row.start_time),
        endMinute: fromDbTime(row.end_time),
        cardId: Number(row.card.id),
        cardCode: row.card.code,
        kind: row.card.kind,
        cardTitle: row.card.title,
        projectCode: row.card.project?.code ?? null,
        projectName: row.card.project?.name ?? null,
        stage: row.card.stage as StageKind | null,
        stepName: row.step_name,
        categoryName: row.card.category_name,
        description: row.description,
      }));
    },

    /** Total log satu hari. Efek samping: tidak ada (hanya baca). */
    async dayLogTotals(picId, date) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint; m: number }>>(
        'SELECT COUNT(*) AS c, COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS m FROM work_log WHERE owner_pic_id = $1 AND work_date = $2::date',
        picId,
        date,
      );
      return { minutes: rows[0]?.m ?? 0, count: Number(rows[0]?.c ?? 0) };
    },

    /** Tahapan selesai menurut filter. Efek samping: tidak ada (hanya baca). */
    async listDoneStages(filter) {
      const params: unknown[] = [];
      const bind = (value: unknown, cast = ''): string => {
        params.push(value);
        return `$${params.length}${cast}`;
      };
      let where = "s.status = 'DONE' AND p.status <> 'CANCELLED'";
      if (filter.q.trim() !== '') {
        const pattern = bind(`%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where += ` AND (p.code ILIKE ${pattern} ESCAPE '\\' OR p.name ILIKE ${pattern} ESCAPE '\\')`;
      }
      if (filter.stage) where += ` AND s.stage = ${bind(filter.stage, '::stage_t')}`;
      if (filter.doneRange) where += ` AND s.actual_end BETWEEN ${bind(filter.doneRange.start, '::date')} AND ${bind(filter.doneRange.end, '::date')}`;
      if (filter.picId !== null) where += ` AND EXISTS (SELECT 1 FROM stage_assignment a WHERE a.stage_id = s.id AND a.pic_id = ${bind(filter.picId)})`;
      const limit = bind(filter.pageSize);
      const offset = bind((filter.page - 1) * filter.pageSize);
      const base = 'FROM project_stage s JOIN project p ON p.id = s.project_id';
      const filterParams = params.slice(0, params.length - 2);
      const [rows, count] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{ id: bigint; project_id: bigint; code: string; name: string; stage: StageKind; est_start: Date | null; est_end: Date | null; actual_end: Date | null; pics: string[] | null }>>(
          `SELECT s.id, s.project_id, p.code, p.name, s.stage, s.est_start, s.est_end, s.actual_end,
             ARRAY(SELECT c.name FROM stage_assignment a JOIN pic c ON c.id = a.pic_id WHERE a.stage_id = s.id ORDER BY c.name) AS pics
           ${base} WHERE ${where} ORDER BY s.actual_end DESC NULLS LAST, s.id DESC LIMIT ${limit} OFFSET ${offset}`,
          ...params,
        ),
        prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total ${base} WHERE ${where}`, ...filterParams),
      ]);
      return {
        rows: rows.map((row) => ({
          projectId: Number(row.project_id),
          projectCode: row.code,
          projectName: row.name,
          stage: row.stage,
          estimateStart: fromDbDate(row.est_start),
          estimateEnd: fromDbDate(row.est_end),
          doneOn: fromDbDate(row.actual_end),
          pics: row.pics ?? [],
        })),
        total: Number(count[0]?.total ?? 0),
      };
    },

    /** Output (judul kartu Done) dan jam per tahapan selesai. Efek samping: tidak ada (hanya baca). */
    async doneStageDetails(rows, picId) {
      const result = new Map<string, DoneStageDetail>();
      if (rows.length === 0) return result;
      const cards = await prisma.card.findMany({
        where: { kind: 'PROJECT', cancelled_at: null, ...(picId === null ? {} : { owner_pic_id: BigInt(picId) }), OR: rows.map((row) => ({ project_id: BigInt(row.projectId), stage: row.stage })) },
        select: { id: true, project_id: true, stage: true, title: true, board_column: true, est_minutes: true },
      });
      const logRows = cards.length === 0 ? [] : await prisma.$queryRawUnsafe<Array<{ card_id: bigint; m: number }>>(
        'SELECT card_id, SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int AS m FROM work_log WHERE card_id = ANY($1::bigint[]) GROUP BY card_id',
        cards.map((card) => card.id),
      );
      const minutes = new Map(logRows.map((row) => [Number(row.card_id), row.m]));
      for (const row of rows) {
        const own = cards.filter((card) => Number(card.project_id) === row.projectId && card.stage === row.stage);
        result.set(`${row.projectId}:${row.stage}`, {
          outputs: own.filter((card) => card.board_column === 'DONE').map((card) => card.title),
          plannedMinutes: own.reduce((sum, card) => sum + (card.est_minutes ?? 0), 0),
          actualMinutes: own.reduce((sum, card) => sum + (minutes.get(Number(card.id)) ?? 0), 0),
        });
      }
      return result;
    },
  };
}
