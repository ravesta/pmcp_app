/**
 * Pencatat log aplikasi berbaris-JSON ke keluaran standar (dikumpulkan oleh proses supervisor atau infra).
 *
 * Waktu tidak ditulis di sini (jam sistem hanya lewat `Clock`, TD-05); pengumpul log di infra memberi cap waktu per baris.
 * Hanya metadata teknis yang boleh dicatat: tingkat, pesan, kode, rute, dan penanda galat. Password, token sesi, isian
 * formulir, dan isi log aktivitas TIDAK pernah dicatat di sini (NFR-01, NFR-13); pemanggil hanya memberi konteks yang
 * aman. Jejak Perubahan di database adalah catatan bisnis dan terpisah dari log teknis ini.
 */

/** Tingkat log, dari paling rinci. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error'];

/** Konteks aman yang boleh menyertai sebuah log. */
export type LogContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Menentukan apakah sebuah tingkat perlu ditulis pada ambang yang berlaku.
 * Masukan: tingkat pesan dan ambang minimum. Keluaran: true bila ditulis.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Technical Design §15 (LOG_LEVEL).
 */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(threshold);
}

/**
 * Menulis satu baris log JSON bila tingkatnya memenuhi ambang (dari `LOG_LEVEL`, bawaan info).
 * Masukan: tingkat, pesan, dan konteks aman. Keluaran: tidak ada.
 * Efek samping: menulis satu baris ke stdout (debug dan info) atau stderr (warn dan error).
 * Rujukan: Technical Design §15, NFR-01.
 */
export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const threshold = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
  if (!shouldLog(level, ORDER.includes(threshold) ? threshold : 'info')) return;
  const line = JSON.stringify({ level, message, ...context });
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}
