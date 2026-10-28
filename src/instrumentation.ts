/**
 * Kait Next.js untuk mencatat galat tak tertangani di server sebagai log teknis (tanpa isian formulir, tanpa header
 * ber-sesi, tanpa isi permintaan). Galat bisnis yang diharapkan (validasi, hak, konflik) tidak melewati sini; ia
 * dikembalikan sebagai hasil ke layar.
 */
import { log } from '@/platform/logger';

/**
 * Mencatat galat permintaan yang tidak tertangani.
 * Masukan: galat (dengan `digest` bila ada), permintaan (jalur dan metode), dan konteks rute. Keluaran: tidak ada.
 * Efek samping: menulis satu baris log tingkat error ke stderr.
 * Rujukan: Technical Design §12 (penanganan galat), §15 (logging), NFR-01 (data sensitif tidak dicatat).
 */
export function onRequestError(error: { digest?: string; message?: string }, request: { path: string; method: string }, context: { routePath: string; routeType: string }): void {
  log('error', 'Galat tak tertangani pada permintaan', {
    digest: error.digest,
    reason: (error.message ?? '').slice(0, 200),
    path: request.path.split('?')[0],
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
  });
}
