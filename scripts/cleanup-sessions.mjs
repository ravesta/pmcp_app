/**
 * Membersihkan sesi yang sudah lama tidak berlaku (kedaluwarsa atau dicabut lebih dari N hari) dan penghitung login
 * yang tidak lagi relevan, agar tabel `session` dan `login_throttle` tidak membengkak.
 *
 * Pemakaian: node scripts/cleanup-sessions.mjs [--days 7]   (jadwalkan harian lewat cron atau penjadwal infra)
 * Masukan: `DATABASE_URL` dari lingkungan atau `.env`.
 * Efek samping: DELETE pada `session` (kedaluwarsa atau dicabut lebih dari N hari) dan `login_throttle` (tidak ditunda
 * dan tidak diperbarui lebih dari N hari); mencetak jumlah baris yang dihapus. Sesi aktif tidak tersentuh.
 * Rujukan: Technical Design §3 (scripts/ pembersihan sesi kedaluwarsa), Security Design §5.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Membaca `DATABASE_URL` dari lingkungan atau `.env`.
 * Masukan: tidak ada. Keluaran: URL atau undefined.
 * Efek samping: membaca `.env` bila ada.
 * Rujukan: Technical Design §15.
 */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = join(root, '.env');
  return existsSync(file) ? /^DATABASE_URL=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim() : undefined;
}

/**
 * Menjalankan pembersihan.
 * Masukan: tidak ada. Keluaran: tidak ada (mencetak ringkasan).
 * Efek samping: DELETE seperti dijelaskan di atas.
 * Rujukan: Security Design §5.
 */
async function main() {
  const index = process.argv.indexOf('--days');
  const days = index >= 0 ? Number(process.argv[index + 1]) : 7;
  if (!Number.isInteger(days) || days < 1) throw new Error('--days harus bilangan bulat 1 atau lebih.');
  const url = readDatabaseUrl();
  if (!url) throw new Error('DATABASE_URL tidak diatur.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const sessions = await client.query(
      "DELETE FROM session WHERE (expires_at < now() - make_interval(days => $1) OR revoked_at < now() - make_interval(days => $1))",
      [days],
    );
    const throttles = await client.query(
      'DELETE FROM login_throttle WHERE (locked_until IS NULL OR locked_until < now()) AND updated_at < now() - make_interval(days => $1)',
      [days],
    );
    console.log(`Sesi dihapus: ${sessions.rowCount}; penghitung login dihapus: ${throttles.rowCount}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exit(1);
});
