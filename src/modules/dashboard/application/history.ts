/**
 * Menu Riwayat: tab Tahapan selesai dan tab Aktivitas harian (FR-07-08, FR-07-09; CL-046, CL-047). Hanya baca.
 *
 * PIC hanya melihat miliknya; Manager memilih PIC atau (pada Tahapan selesai) semua PIC.
 */
import type { Actor } from '@/modules/auth';
import type { StageKind } from '@/modules/project';
import { addDays, dayOfWeek, monthRange, startOfWeek, type DateRange } from '@/shared/calendar';
import type { IsoDate } from '@/shared/iso-date';
import { assessDay, type LogQuality } from '../domain/activity-quality';
import type { DashLog, DashboardDeps, DoneStageDetail, DoneStageRow, LoginPic } from './ports';

/** Pilihan "Selesai pada" (FR-07-08 butir 2). */
export type DonePeriod = 'ALL' | 'LAST_30' | 'THIS_MONTH' | 'LAST_90';

/** Ukuran halaman yang diizinkan (bawaan 10). */
export const DONE_PAGE_SIZES: ReadonlyArray<number> = [10, 20, 50];

/** Satu baris tahapan selesai beserta output dan jam. */
export interface DoneStageView extends DoneStageRow {
  readonly detail: DoneStageDetail;
}

/** Hasil tab Tahapan selesai. */
export interface DoneStagesResult {
  readonly rows: ReadonlyArray<DoneStageView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Daftar PIC untuk pilihan Manager; kosong bagi PIC. */
  readonly pics: ReadonlyArray<LoginPic>;
  /** PIC yang dilihat: id, atau null (semua PIC; hanya Manager). */
  readonly picId: number | null;
}

/**
 * Menentukan rentang "Selesai pada"; 30 dan 90 hari dihitung inklusif hari ini.
 * Masukan: pilihan dan hari ini. Keluaran: rentang, atau null untuk semua waktu.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-08 butir 2, NFR-16; AC: 30 hari terakhir hanya yang selesai dalam 30 hari terakhir.
 */
export function donePeriodRange(period: DonePeriod, today: IsoDate): DateRange | null {
  if (period === 'LAST_30') return { start: addDays(today, -29), end: today };
  if (period === 'LAST_90') return { start: addDays(today, -89), end: today };
  if (period === 'THIS_MONTH') return monthRange(today);
  return null;
}

/**
 * Membaca tab Tahapan selesai: tahapan berstatus Selesai (bukan pada project Batal) dengan output dan jam terencana
 * dibanding aktual, urut terbaru, berhalaman. PIC hanya melihat tahapan miliknya; Manager dapat memilih PIC.
 * Masukan: dependensi, pelaku, dan `{q, stage, period, picId, page, pageSize}`. Keluaran: `DoneStagesResult`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-07-08; AC: PIC tidak melihat tahapan selesai milik PIC lain.
 */
export async function getDoneStages(
  deps: DashboardDeps,
  actor: Actor,
  input: { q: string; stage: StageKind | null; period: DonePeriod; picId: number | null; page: number; pageSize: number },
): Promise<DoneStagesResult> {
  const picId = actor.role === 'PIC' ? actor.picId : input.picId;
  const pageSize = DONE_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : 10;
  const page = Math.max(1, Math.floor(input.page) || 1);
  const [found, pics] = await Promise.all([
    deps.reads.listDoneStages({ q: input.q, stage: input.stage, doneRange: donePeriodRange(input.period, deps.clock.today()), picId, page, pageSize }),
    actor.role === 'MANAGER' ? deps.reads.listLoginPics() : Promise.resolve([]),
  ]);
  const details = await deps.reads.doneStageDetails(found.rows.map((row) => ({ projectId: row.projectId, stage: row.stage })), picId);
  return {
    rows: found.rows.map((row) => ({ ...row, detail: details.get(`${row.projectId}:${row.stage}`) ?? { outputs: [], plannedMinutes: 0, actualMinutes: 0 } })),
    total: found.total,
    page,
    pageSize,
    pics,
    picId,
  };
}

/** Log satu hari beserta total dan penilaian. */
export interface DailyActivityDay {
  readonly date: IsoDate;
  readonly totalMinutes: number;
  readonly assessment: { readonly percent: number; readonly quality: LogQuality } | null;
  readonly logs: ReadonlyArray<DashLog>;
}

/** Hasil tab Aktivitas harian. */
export interface DailyActivityResult {
  readonly range: DateRange;
  readonly mode: 'DAY' | 'WEEK';
  readonly pic: LoginPic | null;
  readonly pics: ReadonlyArray<LoginPic>;
  readonly summary: { readonly totalMinutes: number; readonly logCount: number; readonly projectMinutes: number; readonly activityMinutes: number };
  readonly days: ReadonlyArray<DailyActivityDay>;
}

/**
 * Membaca tab Aktivitas harian: log PIC pada hari atau minggu (Senin sampai Minggu) beserta ringkasan dan penilaian
 * Baik/Kurang/Rendah per hari kerja. Akhir pekan tampil hanya bila ada log. PIC hanya melihat miliknya; Manager memilih
 * satu PIC (bawaan PIC ber-login pertama menurut abjad).
 * Masukan: dependensi, pelaku, `{mode, date, picId}`. Keluaran: `DailyActivityResult`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-07-09; AC: mode Minggu menampilkan Senin sampai Jumat dan akhir pekan hanya bila ada log.
 */
export async function getDailyActivity(deps: DashboardDeps, actor: Actor, input: { mode: 'DAY' | 'WEEK'; date: IsoDate | null; picId: number | null }): Promise<DailyActivityResult> {
  const today = deps.clock.today();
  const date = input.date ?? today;
  const range: DateRange = input.mode === 'DAY' ? { start: date, end: date } : { start: startOfWeek(date), end: addDays(startOfWeek(date), 6) };
  const pics = actor.role === 'MANAGER' ? await deps.reads.listLoginPics() : [];
  const picId = actor.role === 'PIC' ? actor.picId : (input.picId ?? pics.find((pic) => pic.isActive)?.id ?? pics[0]?.id ?? null);
  const logs = picId === null ? [] : await deps.reads.listLogs(picId, range);

  const days: DailyActivityDay[] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const own = logs.filter((log) => log.date === day);
    const weekend = dayOfWeek(day) === 0 || dayOfWeek(day) === 6;
    if (weekend && own.length === 0) continue;
    const totalMinutes = own.reduce((sum, log) => sum + (log.endMinute - log.startMinute), 0);
    days.push({ date: day, totalMinutes, assessment: assessDay(day, totalMinutes, today), logs: own });
  }
  const minutesOf = (list: ReadonlyArray<DashLog>) => list.reduce((sum, log) => sum + (log.endMinute - log.startMinute), 0);
  return {
    range,
    mode: input.mode,
    pic: pics.find((pic) => pic.id === picId) ?? null,
    pics,
    summary: {
      totalMinutes: minutesOf(logs),
      logCount: logs.length,
      projectMinutes: minutesOf(logs.filter((log) => log.kind === 'PROJECT')),
      activityMinutes: minutesOf(logs.filter((log) => log.kind === 'ACTIVITY')),
    },
    days,
  };
}
