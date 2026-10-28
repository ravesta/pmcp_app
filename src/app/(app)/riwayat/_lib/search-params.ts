/**
 * Parameter URL menu Riwayat: membaca (dengan daftar putih) dan menyusun alamat tab Tahapan selesai dan Aktivitas harian.
 * Nilai dari URL tidak tepercaya; hanya nilai yang dikenal yang diterima (Security Design §7).
 */
import type { DonePeriod } from '@/modules/dashboard';
import type { StageKind } from '@/modules/project';
import { addDays, startOfWeek } from '@/shared/calendar';
import { isIsoDate, type IsoDate } from '@/shared/iso-date';

/** Parameter mentah dari Next.js (`searchParams`). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Keadaan halaman Riwayat. */
export interface RiwayatParams {
  readonly tab: 'tahapan' | 'harian';
  readonly q: string;
  readonly stage: StageKind | null;
  readonly period: DonePeriod;
  readonly picId: number | null;
  readonly page: number;
  readonly pageSize: number;
  readonly mode: 'DAY' | 'WEEK';
  readonly date: IsoDate | null;
}

const PERIODS: Readonly<Record<string, DonePeriod>> = { '30': 'LAST_30', bulan: 'THIS_MONTH', '90': 'LAST_90' };

/**
 * Mengambil nilai tunggal sebuah parameter.
 * Masukan: parameter mentah dan nama. Keluaran: teks atau undefined.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Security Design §7.
 */
function single(raw: RawSearchParams, name: string): string | undefined {
  const value = raw[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Membaca keadaan halaman Riwayat dari parameter URL.
 * Masukan: parameter mentah. Keluaran: `RiwayatParams` dengan nilai bawaan (tab Tahapan selesai, semua waktu, mode Hari).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-08 butir 2, FR-07-09 butir 1.
 */
export function parseRiwayatParams(raw: RawSearchParams): RiwayatParams {
  const stage = single(raw, 'tahap');
  const date = single(raw, 'tanggal');
  const pic = single(raw, 'pic');
  const page = single(raw, 'hal');
  const size = single(raw, 'per');
  return {
    tab: single(raw, 'tab') === 'harian' ? 'harian' : 'tahapan',
    q: (single(raw, 'q') ?? '').trim().slice(0, 100),
    stage: stage === 'BA' || stage === 'DEV' || stage === 'QA' ? stage : null,
    period: PERIODS[single(raw, 'selesai') ?? ''] ?? 'ALL',
    picId: pic && /^\d{1,9}$/.test(pic) ? Number(pic) : null,
    page: page && /^\d{1,6}$/.test(page) ? Math.max(1, Number(page)) : 1,
    pageSize: size && /^\d{1,3}$/.test(size) ? Number(size) : 10,
    mode: single(raw, 'mode') === 'minggu' ? 'WEEK' : 'DAY',
    date: date && isIsoDate(date) ? date : null,
  };
}

/**
 * Menyusun alamat Riwayat dari parameter sekarang dengan sebagian diganti (null menghapus).
 * Masukan: parameter mentah dan perubahan. Keluaran: alamat relatif `/riwayat?...`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-08, FR-07-09 (filter dipertahankan saat berpindah halaman).
 */
export function riwayatHref(raw: RawSearchParams, changes: Readonly<Record<string, string | null>> = {}): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text !== undefined && !(name in changes)) query.set(name, text);
  }
  for (const [name, value] of Object.entries(changes)) if (value !== null) query.set(name, value);
  const text = query.toString();
  return text ? `/riwayat?${text}` : '/riwayat';
}

/**
 * Menghitung tanggal tujuan tombol sebelumnya atau berikutnya pada tab Aktivitas harian.
 * Masukan: tanggal acuan, mode, dan arah (-1 atau 1). Keluaran: tanggal baru (geser satu hari atau satu minggu).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-09 butir 1.
 */
export function shiftDate(date: IsoDate, mode: 'DAY' | 'WEEK', direction: -1 | 1): IsoDate {
  return addDays(mode === 'WEEK' ? startOfWeek(date) : date, direction * (mode === 'WEEK' ? 7 : 1));
}
