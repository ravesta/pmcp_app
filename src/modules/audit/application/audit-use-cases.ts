/**
 * Use case modul audit: mencatat dan membaca jejak perubahan.
 */
import type { Actor } from '@/modules/auth';
import { can } from '@/modules/auth';
import { MESSAGES } from '@/platform/messages';
import { fail, ok, type Result } from '@/shared/result';
import type { TxContext } from '@/shared/transaction';
import type { AuditEventInput, AuditEventRow, AuditQuery, AuditRepository } from './ports';

/** Batas panjang ringkasan pada database (varchar 300). */
const SUMMARY_MAX = 300;

/**
 * Mencatat satu peristiwa jejak audit. Ringkasan dipotong aman bila melebihi batas kolom.
 * Masukan: repository, transaksi (atau null untuk transaksi sendiri), dan peristiwa.
 * Keluaran: janji selesai.
 * Efek samping: INSERT satu baris `audit_event`; bila `tx` diberikan, ikut atomik dengan perubahan
 * bisnis (semua atau tidak sama sekali).
 * Rujukan: BL-07, NFR-04, TD-09.
 */
export async function recordAudit(
  repository: AuditRepository,
  tx: TxContext | null,
  event: AuditEventInput,
): Promise<void> {
  const summary = event.summary.length > SUMMARY_MAX ? `${event.summary.slice(0, SUMMARY_MAX - 1)}…` : event.summary;
  await repository.append(tx, { ...event, summary });
}

/**
 * Membaca daftar pelaku untuk saringan Jejak Perubahan (hanya Manager).
 * Masukan: repository dan pelaku. Keluaran: daftar pelaku, atau FORBIDDEN.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-09-01 butir 3.
 */
export async function listAuditActors(repository: AuditRepository, actor: Actor): Promise<Result<Array<{ userId: number; label: string }>>> {
  if (!can(actor, 'audit.view')) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
  return ok(await repository.listActors());
}

/** Ukuran halaman yang diizinkan untuk Jejak Perubahan (FR-09-01 butir 3). */
const ALLOWED_PAGE_SIZES: ReadonlyArray<number> = [10, 20, 50];

/**
 * Membaca daftar Jejak Perubahan untuk Manager (FR-09-01).
 * Masukan: pelaku, saringan jenis dan pelaku, halaman dan ukuran halaman. Keluaran: baris dan total.
 * Efek samping: tidak ada (hanya baca). Pelaku selain Manager ditolak (FORBIDDEN).
 * Rujukan: FR-09-01, FR-15-01 (paging di server), FR-01-04.
 */
export async function listAuditEvents(
  repository: AuditRepository,
  actor: Actor,
  query: AuditQuery,
): Promise<Result<{ rows: AuditEventRow[]; total: number; page: number; pageSize: number }>> {
  if (!can(actor, 'audit.view')) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
  const pageSize = ALLOWED_PAGE_SIZES.includes(query.pageSize) ? query.pageSize : 10;
  const page = Math.max(1, Math.floor(query.page) || 1);
  const result = await repository.list({ ...query, page, pageSize });
  return ok({ ...result, page, pageSize });
}

/**
 * Membaca riwayat perubahan sebuah project untuk Detail Project. Berbeda dengan Jejak Perubahan (hanya Manager),
 * riwayat per project terbuka bagi semua pengguna yang login karena Detail Project dapat dibuka semua peran.
 * Masukan: repository, kode project, halaman dan ukuran halaman. Keluaran: baris dan total, terbaru di atas.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-11-01 butir 2, BL-07, FR-15-01.
 */
export async function listProjectHistory(
  repository: AuditRepository,
  projectCode: string,
  page: number,
  pageSize: number,
): Promise<{ rows: AuditEventRow[]; total: number; page: number; pageSize: number }> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = ALLOWED_PAGE_SIZES.includes(pageSize) ? pageSize : 10;
  const result = await repository.list({ projectCode, page: safePage, pageSize: safeSize });
  return { ...result, page: safePage, pageSize: safeSize };
}

/**
 * Mencatat percobaan akses ditolak sebagai peristiwa Keamanan (tanpa isian formulir atau data permintaan).
 * Masukan: repository, pelaku, dan uraian singkat yang dicoba (mis. "memindahkan kartu"). Keluaran: janji selesai.
 * Efek samping: INSERT `audit_event` kategori SECURITY, aksi `access.denied`, dalam transaksi kecil sendiri.
 * Rujukan: FR-01-04 butir 4, FR-09-01 butir 3, EC-16-01.01, NFR-04.
 */
export async function recordAccessDenied(repository: AuditRepository, actor: Actor, attempted: string): Promise<void> {
  await recordAudit(repository, null, {
    actorUserId: actor.userId,
    actorLabel: actor.label,
    category: 'SECURITY',
    action: 'access.denied',
    entityType: 'request',
    summary: `Akses ditolak: ${actor.label} (${actor.role}) mencoba ${attempted}`.slice(0, 300),
  });
}
