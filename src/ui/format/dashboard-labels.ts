/**
 * Label dan nada tampilan Dashboard dan Riwayat: status kapasitas, penilaian pencatatan, dan tenggat.
 *
 * Fungsi murni agar mudah diuji; aturan penentuan status ada di domain dashboard.
 */
import type { CapacityStatus, LogQuality } from '@/modules/dashboard';
import type { Tone } from './project-labels';

/** Teks dan nada status kapasitas (CL-005a). */
export const CAPACITY_STATUS: Readonly<Record<CapacityStatus, { text: string; tone: Tone }>> = {
  AVAILABLE: { text: 'Masih tersedia', tone: 'ok' },
  NEAR: { text: 'Mendekati kapasitas', tone: 'warn' },
  OVER: { text: 'Kelebihan beban', tone: 'late' },
};

/** Teks dan nada penilaian pencatatan aktivitas (FR-04-06). */
export const LOG_QUALITY: Readonly<Record<LogQuality, { text: string; tone: Tone }>> = {
  GOOD: { text: 'Baik', tone: 'ok' },
  FAIR: { text: 'Kurang', tone: 'warn' },
  LOW: { text: 'Rendah', tone: 'late' },
};

/**
 * Menulis menit sebagai jam dengan satu desimal bila perlu, mis. 40 j, 12,5 j.
 * Masukan: menit. Keluaran: teks jam.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-05 (tampilan jam tersedia, terencana, aktual).
 */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${String(hours).replace('.', ',')} j`;
}

/**
 * Menulis sisa hari menuju tenggat: "hari ini" atau "n hari lagi".
 * Masukan: sisa hari (0 atau lebih). Keluaran: teks.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-04-03 butir 1; AC: tenggat hari ini tampil "hari ini".
 */
export function formatDaysLeft(daysLeft: number): string {
  return daysLeft === 0 ? 'hari ini' : `${daysLeft} hari lagi`;
}
