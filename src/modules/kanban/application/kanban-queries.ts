/**
 * Query baca Kanban: papan, rincian kartu, pilihan formulir, pratinjau revisi, kepatuhan, serta rencana kerja dan log
 * pada detail project (FR-16-01, FR-17-03, FR-18-01, FR-20-01, FR-20-02, FR-21-05).
 *
 * Semua penyaringan terjadi di server; penanda dihitung ulang setiap tampil (FR-21-02 butir 3).
 */
import type { Actor } from '@/modules/auth';
import { getCardStageTarget, planAutoRevision, type AutoRevisionPlan, type StageKind } from '@/modules/project';
import { MESSAGES } from '@/platform/messages';
import { monthRange, weekRange, type DateRange } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import { fail, ok, type Result } from '@/shared/result';
import { needsStatusConfirmation } from '../domain/card-rules';
import type { CardColumn, CardKind } from '../domain/card-types';
import { computeCompliance, type ComplianceRow } from '../domain/compliance';
import { totalLogs, type LogTotals } from '../domain/work-log-rules';
import type {
  BoardFilter,
  FollowedProject,
  KanbanDeps,
  MasterChoice,
  ProgressEventRow,
  ProjectLogFilter,
  ProjectLogPage,
  RescheduleRow,
  WorkLogRow,
} from './ports';
import { toCardView, type CardView, type CardViewContext } from './view-models';

/** Jumlah kartu per kolom yang dimuat pertama kali; selebihnya lewat "Tampilkan lebih banyak" (anggaran muat 3 detik). */
const DEFAULT_COLUMN_LIMIT = 40;

/** Periode papan dan kepatuhan (FR-16-01 butir 4, FR-21-05 butir 4). */
export type PeriodKey = 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'RANGE';

/** Masukan papan dari parameter alamat (sudah dibersihkan UI). */
export interface BoardInput {
  readonly period: PeriodKey;
  /** Rentang bebas bila `period` = RANGE. */
  readonly from: IsoDate | null;
  readonly to: IsoDate | null;
  /** Id PIC; null = semua PIC. */
  readonly picId: number | null;
  readonly kind: CardKind | null;
  readonly q: string;
  readonly extendsOnly: boolean;
  /** Batas kartu per kolom yang ditampilkan (bawaan 40); jumlah sebenarnya tetap tampil. */
  readonly columnLimit?: number;
}

/** Papan Kanban siap tampil. */
export interface BoardView {
  readonly range: DateRange;
  readonly columns: Readonly<Record<CardColumn, ReadonlyArray<CardView>>>;
  /** Jumlah kartu sebenarnya per kolom menurut filter (dapat lebih besar dari yang tampil). */
  readonly totals: Readonly<Record<CardColumn, number>>;
  readonly columnLimit: number;
  readonly cancelled: ReadonlyArray<CardView>;
  readonly pics: ReadonlyArray<{ id: number; name: string; stage: StageKind; isActive: boolean }>;
  /** True bila pelaku PIC (dapat membuat kartu). */
  readonly canCreate: boolean;
}

/**
 * Menentukan rentang tanggal periode.
 * Masukan: periode, rentang bebas, dan hari ini. Keluaran: rentang inklusif (rentang bebas tidak valid memakai minggu ini).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-16-01 butir 4, FR-21-05 butir 4, NFR-16 butir 3 (minggu Senin sampai Minggu).
 */
export function resolvePeriod(period: PeriodKey, from: IsoDate | null, to: IsoDate | null, today: IsoDate): DateRange {
  if (period === 'LAST_WEEK') return weekRange(today, -1);
  if (period === 'THIS_MONTH') return monthRange(today);
  if (period === 'RANGE' && from && to && to >= from) return { start: from, end: to };
  return weekRange(today);
}

/**
 * Membangun konteks tampilan kartu untuk satu permintaan.
 * Masukan: dependensi dan pelaku. Keluaran: `CardViewContext`.
 * Efek samping: membaca satu pengaturan master (batas jadwal ulang).
 * Rujukan: NFR-16 butir 1, FR-08-05.
 */
async function viewContext(deps: KanbanDeps, actor: Actor): Promise<CardViewContext> {
  return { today: deps.clock.today(), rescheduleThreshold: await deps.reference.getRescheduleWarnThreshold(), actor };
}

/**
 * Menyusun papan Kanban untuk semua pengguna (PIC dapat melihat kartu semua PIC; Manager baca saja). Papan memuat
 * kartu belum Done dan kartu Done yang beririsan dengan periode; kartu dibatalkan hanya pada daftar "Dibatalkan".
 * Masukan: dependensi, pelaku, dan `BoardInput`. Keluaran: `BoardView`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-16-01 butir 1 sampai 7, BL-29, BL-37; AC: kartu Done bulan lalu tidak tampil pada periode Minggu ini.
 */
export async function getBoard(deps: KanbanDeps, actor: Actor, input: BoardInput): Promise<BoardView> {
  const ctx = await viewContext(deps, actor);
  const range = resolvePeriod(input.period, input.from, input.to, ctx.today);
  const filter: BoardFilter = { range: input.extendsOnly ? null : range, picId: input.picId, kind: input.kind, q: input.q.trim(), extendsOnly: input.extendsOnly };
  const columnLimit = Math.min(500, Math.max(10, input.columnLimit ?? DEFAULT_COLUMN_LIMIT));
  const [board, cancelled, pics] = await Promise.all([deps.queries.listBoardColumns(filter, columnLimit), deps.queries.listCancelled(filter), deps.reference.listPics()]);
  const columns: Record<CardColumn, CardView[]> = { PLANNED: [], IN_PROGRESS: [], DONE: [] };
  for (const column of ['PLANNED', 'IN_PROGRESS', 'DONE'] as const) columns[column] = board[column].rows.map((row) => toCardView(row, ctx));
  const totals = { PLANNED: board.PLANNED.total, IN_PROGRESS: board.IN_PROGRESS.total, DONE: board.DONE.total };
  return { range, columns, totals, columnLimit, cancelled: cancelled.map((row) => toCardView(row, ctx)), pics, canCreate: actor.role === 'PIC' };
}

/** Rincian satu kartu: tampilan, log, riwayat jadwal ulang dan progres, serta pilihan formulir. */
export interface CardDetail {
  readonly card: CardView;
  readonly logs: ReadonlyArray<WorkLogRow>;
  readonly totals: LogTotals;
  readonly reschedules: ReadonlyArray<RescheduleRow>;
  readonly progressEvents: ReadonlyArray<ProgressEventRow>;
  /** Step aktif tahapan kartu (kartu project) sebagai pilihan log. */
  readonly steps: ReadonlyArray<MasterChoice>;
  readonly rescheduleReasons: ReadonlyArray<MasterChoice>;
  /** Kategori alasan revisi estimasi tahapan (bila jadwal ulang melewati estimasi tahapan). */
  readonly revisionCategories: ReadonlyArray<MasterChoice>;
  readonly rescheduleThreshold: number;
}

/**
 * Membuka rincian kartu (semua pengguna dapat membuka; hanya pemilik dapat mengelola).
 * Masukan: dependensi, pelaku, dan id kartu. Keluaran: `CardDetail`, atau NOT_FOUND.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-17-03, FR-18-01 butir 5, FR-21-03 butir 3, FR-16-03 butir 3.
 */
export async function getCardDetail(deps: KanbanDeps, actor: Actor, cardId: number): Promise<Result<CardDetail>> {
  const row = await deps.queries.getBoardCard(cardId);
  if (!row) return fail({ code: 'NOT_FOUND', message: MESSAGES.CARD_NOT_FOUND });
  const ctx = await viewContext(deps, actor);
  const [logs, reschedules, progressEvents, reasons, steps, revisionCategories] = await Promise.all([
    deps.queries.listCardLogs(cardId),
    deps.queries.listReschedules(cardId),
    deps.queries.listProgressEvents(cardId),
    deps.reference.listRescheduleReasons(),
    row.card.stage ? deps.reference.listActiveSteps(row.card.stage) : Promise.resolve([]),
    deps.project.reference.listActiveRevisionCategories(),
  ]);
  return ok({
    card: toCardView(row, ctx),
    logs,
    totals: totalLogs(logs.map((log) => ({ minutes: log.span.end - log.span.start, stepName: log.stepName }))),
    reschedules,
    progressEvents,
    steps,
    rescheduleReasons: reasons,
    revisionCategories: revisionCategories.map((c) => ({ id: c.id, name: c.name })),
    rescheduleThreshold: ctx.rescheduleThreshold,
  });
}

/** Pilihan formulir Buat kartu bagi PIC. */
export interface CardFormOptions {
  readonly projects: ReadonlyArray<FollowedProject>;
  readonly categories: ReadonlyArray<MasterChoice>;
  readonly steps: ReadonlyArray<MasterChoice>;
  readonly stage: StageKind | null;
  /** Kategori alasan revisi estimasi tahapan (bila rencana kartu melewati estimasi tahapan). */
  readonly revisionCategories: ReadonlyArray<MasterChoice>;
}

/**
 * Membaca pilihan formulir kartu: project yang diikuti PIC (Backlog, Berjalan, Ditunda dengan tahapan belum Selesai),
 * kategori activity, dan step aktif tahapan PIC. Kosong bagi non-PIC.
 * Masukan: dependensi dan pelaku. Keluaran: `CardFormOptions`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-17-01 butir 1 dan 2, FR-21-01, BL-24, BL-25.
 */
export async function getCardFormOptions(deps: KanbanDeps, actor: Actor): Promise<CardFormOptions> {
  if (actor.role !== 'PIC' || actor.picId === null || actor.picStage === null || actor.picStage === 'DEV') {
    return { projects: [], categories: [], steps: [], stage: null, revisionCategories: [] };
  }
  const [projects, categories, steps, revisionCategories] = await Promise.all([
    deps.queries.listFollowedProjects(actor.picId, actor.picStage),
    deps.reference.listActivityCategories(),
    deps.reference.listActiveSteps(actor.picStage),
    deps.project.reference.listActiveRevisionCategories(),
  ]);
  return { projects, categories, steps, stage: actor.picStage, revisionCategories: revisionCategories.map((c) => ({ id: c.id, name: c.name })) };
}

/** Pratinjau rencana kartu project terhadap estimasi tahapan dan status project. */
export interface CardPlanPreview {
  readonly revision: AutoRevisionPlan;
  /** Nomor revisi bila estimasi diperpanjang (jumlah revisi sekarang + 1). */
  readonly nextSeq: number;
  /** True bila status project Backlog atau Ditunda sehingga jawaban konfirmasi wajib. */
  readonly needsStatusConfirm: boolean;
  readonly projectStatus: string;
}

/**
 * Menghitung pratinjau sebelum kartu project disimpan: apakah rencana melewati estimasi tahapan (revisi otomatis) dan
 * apakah status project perlu dikonfirmasi. Tidak menyimpan apa pun.
 * Masukan: dependensi, pelaku PIC, id project, dan rencana. Keluaran: `CardPlanPreview`; atau NOT_FOUND.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-13-05 butir 2 (pratinjau "Estimasi tahapan akan otomatis direvisi dari X menjadi Y, Revisi ke-n"),
 * FR-17-02.
 */
export async function previewCardPlan(deps: KanbanDeps, actor: Actor, input: { projectId: number; planStart: IsoDate; planEnd: IsoDate }): Promise<Result<CardPlanPreview>> {
  if (actor.picId === null || actor.picStage === null || actor.picStage === 'DEV') return fail({ code: 'FORBIDDEN', message: MESSAGES.CARD_PIC_ONLY });
  const target = await getCardStageTarget(deps.project, input.projectId, actor.picStage, actor.picId);
  if (!target) return fail({ code: 'NOT_FOUND', message: MESSAGES.PROJECT_NOT_FOUND });
  return ok({
    revision: planAutoRevision(target.stageEstimate, input.planStart, input.planEnd),
    nextSeq: target.revisionCount + 1,
    needsStatusConfirm: needsStatusConfirmation(target.projectStatus),
    projectStatus: target.projectStatus,
  });
}

/** Tabel kepatuhan per PIC dengan nama. */
export interface ComplianceView {
  readonly range: DateRange;
  readonly rows: ReadonlyArray<ComplianceRow & { readonly name: string; readonly stage: StageKind }>;
}

/**
 * Menghitung kepatuhan rencana per PIC pada periode; terlihat semua pengguna.
 * Masukan: dependensi, `{period, from, to}`. Keluaran: `ComplianceView`; PIC tanpa rencana maupun dadakan tidak tampil.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-21-05 butir 1 sampai 5, BL-34.
 */
export async function getCompliance(deps: KanbanDeps, input: { period: PeriodKey; from: IsoDate | null; to: IsoDate | null }): Promise<ComplianceView> {
  const today = deps.clock.today();
  const range = resolvePeriod(input.period, input.from, input.to, today);
  const [cards, pics] = await Promise.all([deps.queries.listComplianceCards(range), deps.reference.listPics()]);
  const rows = computeCompliance(cards, range, today).flatMap((row) => {
    const pic = pics.find((p) => p.id === row.picId);
    return pic ? [{ ...row, name: pic.name, stage: pic.stage }] : [];
  });
  return { range, rows };
}

/**
 * Membaca Rencana kerja sebuah project: kartu tidak dibatalkan semua PIC, hanya baca.
 * Masukan: dependensi, pelaku, dan id project. Keluaran: kartu project, urut menurut rencana mulai.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-20-02, CR-001; AC: kartu baru langsung tampil di Rencana kerja project terkait.
 */
export async function listProjectPlans(deps: KanbanDeps, actor: Actor, projectId: number): Promise<CardView[]> {
  const ctx = await viewContext(deps, actor);
  const rows = await deps.queries.listProjectCards(projectId);
  return rows.map((row) => toCardView(row, ctx));
}

/**
 * Membaca log activity seluruh kartu sebuah project dengan filter tahapan dan PIC, berhalaman, beserta ringkasan
 * total per tahapan dan per PIC (seluruh project, tidak terpengaruh filter).
 * Masukan: dependensi, id project, filter, halaman, dan ukuran halaman (5, 10, atau 20; bawaan 10).
 * Keluaran: `ProjectLogPage`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-20-01; AC: filter PIC Rina hanya menampilkan log Rina dan ringkasan project tidak berubah.
 */
export async function listProjectWorkLogs(deps: KanbanDeps, projectId: number, filter: ProjectLogFilter, page: number, pageSize: number): Promise<ProjectLogPage> {
  const size = [5, 10, 20].includes(pageSize) ? pageSize : 10;
  return deps.queries.listProjectLogs(projectId, filter, Math.max(1, Math.floor(page) || 1), size);
}
