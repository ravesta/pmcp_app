import 'server-only';
import { recordAccessDenied } from '@/modules/audit';
import type { Actor } from '@/modules/auth';
import { getContainer } from '@/platform/container';

/** Bentuk hasil use case yang dikenali penjaga akses ditolak. */
type MaybeDenied = { readonly ok: boolean; readonly error?: { readonly code: string } };

/**
 * Mencatat percobaan akses ditolak di server (halaman atau aksi) sebagai peristiwa Keamanan.
 * Masukan: pelaku dan uraian singkat yang dicoba. Keluaran: janji selesai.
 * Efek samping: INSERT `audit_event` kategori SECURITY (lihat `recordAccessDenied`).
 * Rujukan: FR-01-04 butir 4, EC-01-04.01.
 */
export async function recordDenied(actor: Actor, attempted: string): Promise<void> {
  await recordAccessDenied(getContainer().auditRepository, actor, attempted);
}

/**
 * Meneruskan hasil use case apa adanya, dan mencatat penolakan hak bila hasilnya FORBIDDEN. Dipakai di setiap Server
 * Action bertindak-ubah supaya penolakan (mis. PIC memindahkan kartu PIC lain lewat permintaan langsung) terekam.
 * Masukan: pelaku, nama aksi (kode pendek), dan janji hasil use case. Keluaran: hasil use case.
 * Efek samping: INSERT `audit_event` SECURITY hanya bila FORBIDDEN; tidak memuat isian formulir.
 * Rujukan: FR-01-04 butir 4, FR-09-01 butir 3 (Keamanan = login dan akses ditolak), EC-16-01.01, NFR-04.
 */
export async function audited<T extends MaybeDenied>(actor: Actor, action: string, pending: Promise<T>): Promise<T> {
  const result = await pending;
  if (!result.ok && result.error?.code === 'FORBIDDEN') await recordDenied(actor, action);
  return result;
}
