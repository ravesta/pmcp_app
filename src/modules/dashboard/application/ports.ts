/**
 * Port modul dashboard: model baca untuk kartu, log, dan tahapan selesai, serta ketergantungan use case.
 *
 * Modul dashboard hanya membaca; ia boleh memakai modul project dan kanban lewat index (Technical Design §5.2).
 */
import type { KanbanDeps } from '@/modules/kanban';
import type { ProjectDeps, StageKind } from '@/modules/project';
import type { DateRange } from '@/shared/calendar';
import type { Clock } from '@/shared/clock';
import type { IsoDate } from '@/shared/iso-date';

/** PIC aktif dengan akun login (BA atau QA). */
export interface LoginPic {
  readonly id: number;
  readonly name: string;
  readonly stage: StageKind;
}

/** Kartu ringkas untuk hitungan dashboard (tidak dibatalkan). */
export interface DashCard {
  readonly id: number;
  readonly picId: number;
  readonly kind: 'PROJECT' | 'ACTIVITY';
  readonly column: 'PLANNED' | 'IN_PROGRESS' | 'DONE';
  readonly planStart: IsoDate;
  readonly planEnd: IsoDate;
  readonly doneOn: IsoDate | null;
  readonly estimateMinutes: number | null;
  readonly isAdhoc: boolean;
}

/** Satu log pada Riwayat aktivitas harian. */
export interface DashLog {
  readonly id: number;
  readonly date: IsoDate;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly cardId: number;
  readonly cardCode: string;
  readonly kind: 'PROJECT' | 'ACTIVITY';
  readonly cardTitle: string;
  readonly projectCode: string | null;
  readonly projectName: string | null;
  readonly stage: StageKind | null;
  readonly stepName: string | null;
  readonly categoryName: string | null;
  readonly description: string;
}

/** Saringan tahapan selesai (FR-07-08). */
export interface DoneStageFilter {
  readonly q: string;
  readonly stage: StageKind | null;
  /** Hanya tahapan yang selesai pada rentang ini; null = semua waktu. */
  readonly doneRange: DateRange | null;
  /** Hanya tahapan yang ditugaskan kepada PIC ini; null = semua PIC. */
  readonly picId: number | null;
  readonly page: number;
  readonly pageSize: number;
}

/** Satu baris tahapan selesai. */
export interface DoneStageRow {
  readonly projectId: number;
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly estimateStart: IsoDate | null;
  readonly estimateEnd: IsoDate | null;
  readonly doneOn: IsoDate | null;
  readonly pics: ReadonlyArray<string>;
}

/** Output dan jam sebuah tahapan selesai. */
export interface DoneStageDetail {
  readonly outputs: ReadonlyArray<string>;
  readonly plannedMinutes: number;
  readonly actualMinutes: number;
}

/** Akses baca khusus dashboard dan riwayat. */
export interface DashboardReadRepository {
  /** PIC aktif dengan akun login, terurut nama. */
  listLoginPics(): Promise<LoginPic[]>;
  /** Kartu tidak dibatalkan yang rencananya beririsan dengan periode. */
  listCardsOverlapping(range: DateRange): Promise<DashCard[]>;
  /** Kartu belum Done dan tidak dibatalkan milik PIC (atau semua PIC bila null), tanpa batas periode; dapat dibatasi kolom. */
  listOpenCards(picId: number | null, columns?: ReadonlyArray<'PLANNED' | 'IN_PROGRESS'>): Promise<DashCard[]>;
  /** Total menit log per PIC pada periode (termasuk log kartu yang dibatalkan). */
  logMinutesByPic(range: DateRange): Promise<Map<number, number>>;
  /** Tanggal log terakhir per kartu (kartu tanpa log tidak ada di peta). */
  lastLogDates(cardIds: ReadonlyArray<number>): Promise<Map<number, IsoDate>>;
  /** Jumlah kartu milik PIC yang selesai pada tanggal tertentu, per jenis. */
  doneOnByKind(picId: number, date: IsoDate): Promise<{ PROJECT: number; ACTIVITY: number }>;
  /** Log sebuah PIC pada periode, berurut tanggal dan jam. */
  listLogs(picId: number, range: DateRange): Promise<DashLog[]>;
  /** Total jam log dan jumlah log PIC pada satu tanggal. */
  dayLogTotals(picId: number, date: IsoDate): Promise<{ minutes: number; count: number }>;
  /** Tahapan selesai (bukan pada project Batal) menurut filter, terbaru di atas. */
  listDoneStages(filter: DoneStageFilter): Promise<{ rows: DoneStageRow[]; total: number }>;
  /** Output dan jam tahapan selesai; jam dibatasi milik PIC bila `picId` diisi. */
  doneStageDetails(rows: ReadonlyArray<{ projectId: number; stage: StageKind }>, picId: number | null): Promise<Map<string, DoneStageDetail>>;
}

/** Ketergantungan use case dashboard. */
export interface DashboardDeps {
  readonly clock: Clock;
  readonly project: ProjectDeps;
  readonly kanban: KanbanDeps;
  readonly reads: DashboardReadRepository;
}
