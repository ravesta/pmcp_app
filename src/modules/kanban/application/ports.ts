/**
 * Port modul kanban: bentuk data kartu dan log, akses data (repository), rujukan master, dan ketergantungan yang
 * disuntikkan ke use case.
 *
 * Modul project dihubungkan lewat fungsi publiknya (`applyCardRevision`, `startProjectFromCard`) dengan `ProjectDeps`
 * yang dirakit di `platform/container` (Technical Design §5.2 dan §7.3).
 */
import type { ProjectDeps, Estimate, StageKind, StageStatus, ProjectStatus } from '@/modules/project';
import type { AuditWriter } from '@/shared/audit';
import type { Clock } from '@/shared/clock';
import type { DateRange } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import type { Transactor, TxContext } from '@/shared/transaction';
import type { CardColumn, CardKind } from '../domain/card-types';
import type { ComplianceCard } from '../domain/compliance';
import type { TimeSpan } from '../domain/work-log-rules';

/** Kartu seperti tersimpan, beserta nama pemilik dan project. */
export interface CardRecord {
  readonly id: number;
  readonly code: string;
  readonly kind: CardKind;
  readonly ownerPicId: number;
  readonly ownerName: string;
  readonly projectId: number | null;
  readonly projectCode: string | null;
  readonly projectName: string | null;
  readonly stage: StageKind | null;
  readonly stepName: string | null;
  readonly categoryName: string | null;
  readonly title: string;
  readonly column: CardColumn;
  /** Progres tersimpan saat In Progress (0/25/50/75). */
  readonly progress: number;
  readonly progressNeedsInput: boolean;
  readonly planStart: IsoDate;
  readonly planEnd: IsoDate;
  readonly baselineStart: IsoDate;
  readonly baselineEnd: IsoDate;
  readonly estimateMinutes: number | null;
  readonly isAdhoc: boolean;
  readonly doneOn: IsoDate | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly extendsStage: boolean;
  readonly extensionNote: string | null;
  readonly version: number;
  readonly createdAt: Date;
}

/** Nilai kartu baru yang disimpan. */
export interface NewCardRecord {
  readonly kind: CardKind;
  readonly ownerPicId: number;
  readonly projectId: number | null;
  readonly stage: StageKind | null;
  readonly stepName: string | null;
  readonly categoryName: string | null;
  readonly title: string;
  readonly column: CardColumn;
  readonly planStart: IsoDate;
  readonly planEnd: IsoDate;
  readonly estimateMinutes: number | null;
  readonly isAdhoc: boolean;
}

/** Perubahan keadaan kolom dan progres kartu. */
export interface CardStatePatch {
  readonly column: CardColumn;
  readonly progress: number;
  readonly progressNeedsInput: boolean;
  readonly doneOn: IsoDate | null;
}

/** Satu baris log aktivitas. */
export interface WorkLogRow {
  readonly id: number;
  readonly cardId: number;
  readonly ownerPicId: number;
  readonly workDate: IsoDate;
  /** Menit sejak 00:00. */
  readonly span: TimeSpan;
  readonly stepName: string | null;
  readonly description: string;
}

/** Satu riwayat jadwal ulang. */
export interface RescheduleRow {
  readonly oldStart: IsoDate;
  readonly oldEnd: IsoDate;
  readonly newStart: IsoDate;
  readonly newEnd: IsoDate;
  readonly reasonName: string;
  readonly note: string | null;
  readonly createdByLabel: string;
  readonly createdAt: Date;
}

/** Satu riwayat progres kartu. */
export interface ProgressEventRow {
  readonly oldValue: number;
  readonly newValue: number;
  readonly source: string;
  readonly createdByLabel: string;
  readonly createdAt: Date;
}

/** Kartu pada papan: kartu ditambah agregat log, jadwal ulang, dan estimasi tahapan. */
export interface BoardCardRow {
  readonly card: CardRecord;
  readonly loggedMinutes: number;
  readonly logCount: number;
  readonly rescheduleCount: number;
  /** Status project dan estimasi tahapan kartu project; null untuk kartu activity. */
  readonly projectStatus: ProjectStatus | null;
  readonly stageEstimate: Estimate | null;
  readonly stageBaseline: Estimate | null;
  /** Progres tahapan yang dihitung project belum tersedia di sini; hanya status tahapan. */
  readonly stageStatus: StageStatus | null;
}

/** Saringan papan Kanban (FR-16-01 butir 4). */
export interface BoardFilter {
  /** Periode inklusif; kartu belum Done selalu ikut, kartu Done hanya bila beririsan. */
  readonly range: DateRange | null;
  readonly picId: number | null;
  readonly kind: CardKind | null;
  readonly q: string;
  /** Hanya kartu yang memperpanjang estimasi tahapan (tanpa batas periode). */
  readonly extendsOnly: boolean;
}

/** Project yang diikuti PIC sebagai pilihan pembuatan kartu. */
export interface FollowedProject {
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly statusReason: string | null;
  readonly stageStatus: StageStatus;
}

/** Filter log pada detail project. */
export interface ProjectLogFilter {
  readonly stage: StageKind | null;
  readonly picId: number | null;
}

/** Baris log pada detail project. */
export interface ProjectLogRow {
  readonly id: number;
  readonly workDate: IsoDate;
  readonly span: TimeSpan;
  readonly picName: string;
  readonly stage: StageKind;
  readonly stepName: string | null;
  readonly description: string;
  readonly cardCode: string;
  /** Judul kartu rencana asal log (kolom Item rencana). */
  readonly cardTitle: string;
}

/** Hasil daftar log project: halaman, total, dan ringkasan waktu per tahapan dan per PIC (seluruh project). */
export interface ProjectLogPage {
  readonly rows: ReadonlyArray<ProjectLogRow>;
  readonly total: number;
  readonly totalMinutes: number;
  readonly perStage: ReadonlyArray<{ readonly stage: StageKind; readonly minutes: number }>;
  readonly perPic: ReadonlyArray<{ readonly picId: number; readonly name: string; readonly minutes: number }>;
}

/** Akses tulis kartu dan log; metode ber-`tx` berjalan di dalam transaksi pemanggil. */
export interface CardRepository {
  insertCard(tx: TxContext, card: NewCardRecord): Promise<{ id: number; code: string }>;
  /** Mengunci kartu (SELECT ... FOR UPDATE) lalu membacanya; null bila tidak ada. */
  lockCard(tx: TxContext, cardId: number): Promise<CardRecord | null>;
  /** Menyimpan kolom dan progres; false bila `expectedVersion` tidak cocok. */
  saveState(tx: TxContext, cardId: number, expectedVersion: number, patch: CardStatePatch): Promise<boolean>;
  /** Menyimpan rencana terkini (rencana awal tetap); false bila versi tidak cocok. */
  savePlan(tx: TxContext, cardId: number, expectedVersion: number, plan: { planStart: IsoDate; planEnd: IsoDate }): Promise<boolean>;
  /** Membatalkan kartu; false bila versi tidak cocok. */
  cancel(tx: TxContext, cardId: number, expectedVersion: number, cancel: { reason: string; at: Date }): Promise<boolean>;
  /** Menandai kartu sebagai asal perpanjangan estimasi tahapan, permanen. */
  markExtendsStage(tx: TxContext, cardId: number, note: string): Promise<void>;
  appendProgressEvent(tx: TxContext, event: { cardId: number; oldValue: number; newValue: number; source: string; createdBy: number }): Promise<void>;
  /** Mencatat jadwal ulang dan mengembalikan jumlah jadwal ulang kartu sesudahnya. */
  appendReschedule(
    tx: TxContext,
    row: { cardId: number; oldStart: IsoDate; oldEnd: IsoDate; newStart: IsoDate; newEnd: IsoDate; reasonName: string; note: string | null; createdBy: number },
  ): Promise<number>;
  insertLog(tx: TxContext, log: { cardId: number; ownerPicId: number; workDate: IsoDate; span: TimeSpan; stepName: string | null; description: string }): Promise<number>;
  /** Mengunci dan membaca satu log; null bila tidak ada. */
  findLog(tx: TxContext, logId: number): Promise<WorkLogRow | null>;
  deleteLog(tx: TxContext, logId: number): Promise<void>;
  /** Interval log PIC pada satu tanggal, lintas kartu. */
  daySpans(tx: TxContext, picId: number, date: IsoDate): Promise<TimeSpan[]>;
}

/** Akses baca kartu, log, dan kepatuhan. */
export interface KanbanQueryRepository {
  findCard(cardId: number): Promise<CardRecord | null>;
  listBoard(filter: BoardFilter): Promise<BoardCardRow[]>;
  /** Papan per kolom dengan batas jumlah kartu per kolom; `total` selalu jumlah sebenarnya menurut filter. */
  listBoardColumns(filter: BoardFilter, limit: number): Promise<Record<CardColumn, { rows: BoardCardRow[]; total: number }>>;
  /** Jumlah kartu project belum Done yang memperpanjang estimasi tahapan (definisi sama dengan filter Kanban). */
  countExtending(): Promise<number>;
  listCancelled(filter: BoardFilter): Promise<BoardCardRow[]>;
  getBoardCard(cardId: number): Promise<BoardCardRow | null>;
  listCardLogs(cardId: number): Promise<WorkLogRow[]>;
  listReschedules(cardId: number): Promise<RescheduleRow[]>;
  listProgressEvents(cardId: number): Promise<ProgressEventRow[]>;
  /** Kartu tidak dibatalkan sebuah project (Rencana kerja). */
  listProjectCards(projectId: number): Promise<BoardCardRow[]>;
  listProjectLogs(projectId: number, filter: ProjectLogFilter, page: number, pageSize: number): Promise<ProjectLogPage>;
  /** Kartu yang dinilai kepatuhannya: tidak dibatalkan, tanggal selesai rencana atau mulai pada periode. */
  listComplianceCards(range: DateRange): Promise<Array<ComplianceCard & { id: number }>>;
  /** Project yang diikuti PIC (tahapan PIC itu ditugaskan padanya), terbaru di atas. */
  listFollowedProjects(picId: number, stage: StageKind): Promise<FollowedProject[]>;
}

/** Item master aktif sebagai pilihan. */
export interface MasterChoice {
  readonly id: number;
  readonly name: string;
}

/** Rujukan master untuk kanban (baca saja). */
export interface KanbanReference {
  listActivityCategories(): Promise<MasterChoice[]>;
  listRescheduleReasons(): Promise<MasterChoice[]>;
  listActiveSteps(stage: StageKind): Promise<MasterChoice[]>;
  /** Batas peringatan jadwal ulang (master, awal 3). */
  getRescheduleWarnThreshold(): Promise<number>;
  /** Seluruh PIC (aktif dan nonaktif) beserta tahapannya untuk filter dan tabel kepatuhan; kartu PIC nonaktif tetap tampil (EC-08-01.05). */
  listPics(): Promise<Array<{ id: number; name: string; stage: StageKind; isActive: boolean }>>;
}

/** Ketergantungan yang disuntikkan ke use case kanban. */
export interface KanbanDeps {
  readonly clock: Clock;
  readonly transactor: Transactor;
  readonly cards: CardRepository;
  readonly queries: KanbanQueryRepository;
  readonly reference: KanbanReference;
  /** Ketergantungan modul project untuk revisi otomatis, status project, dan fakta tahapan. */
  readonly project: ProjectDeps;
  readonly writeAudit: AuditWriter;
}
