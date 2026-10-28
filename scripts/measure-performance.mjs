/**
 * Mengukur waktu respons server tiap layar utama pada data acuan (anggaran pemrosesan server maksimal 1,0 detik,
 * Technical Design §13; total muat per layar maksimal 3 detik, NFR-08).
 *
 * Skrip membuat sesi uji langsung di database (token acak, hanya hash yang disimpan), memanggil tiap alamat beberapa
 * kali, lalu mencetak median dan terburuk. Keluar dengan kode 1 bila ada layar yang melewati anggaran.
 *
 * Pemakaian: node scripts/measure-performance.mjs [--base http://localhost:3100] [--runs 7] [--budget-ms 1000]
 * Masukan: `DATABASE_URL` (database data acuan); server aplikasi yang sedang berjalan pada alamat `--base`.
 *   Bila server berjalan dengan `APP_ENV=production` atau `staging`, nama cookie diawali `__Host-` dan hanya terkirim
 *   lewat HTTPS; ukur pada server `APP_ENV=development` atau lewat HTTPS.
 * Efek samping: INSERT `session` untuk Manager dan satu PIC acuan; menghapus sesi itu setelah selesai.
 * Rujukan: Technical Design §13 (Verifikasi), NFR-08.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Anggaran total muat layar pada cache dingin (NFR-08). */
const COLD_BUDGET_MS = 3000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Membaca argumen `--nama nilai` dari baris perintah.
 * Masukan: nama dan nilai bawaan. Keluaran: nilai teks.
 * Efek samping: tidak ada.
 * Rujukan: kebiasaan skrip di folder ini.
 */
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

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
 * Menghitung median dari daftar angka.
 * Masukan: daftar angka tidak kosong. Keluaran: median.
 * Efek samping: tidak ada.
 * Rujukan: pelaporan hasil ukur.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Memanggil satu alamat dan mengukur waktu hingga byte pertama dan hingga seluruh isi diterima.
 * Masukan: alamat lengkap dan cookie. Keluaran: milidetik byte pertama, total, dan status HTTP.
 * Efek samping: satu permintaan GET ke server aplikasi.
 * Rujukan: NFR-08.
 */
async function timeRequest(url, cookie) {
  const start = performance.now();
  const response = await fetch(url, { headers: { cookie }, redirect: 'manual' });
  const first = performance.now() - start;
  await response.arrayBuffer();
  return { first, total: performance.now() - start, status: response.status };
}

/**
 * Menjalankan pengukuran seluruh layar.
 * Masukan: tidak ada. Keluaran: tidak ada (mencetak tabel; kode keluar 1 bila melewati anggaran).
 * Efek samping: membuat dan menghapus sesi uji di database.
 * Rujukan: Technical Design §13.
 */
async function main() {
  const base = arg('base', 'http://localhost:3100');
  const runs = Number(arg('runs', '7'));
  const budget = Number(arg('budget-ms', '1000'));
  const db = new pg.Client({ connectionString: readDatabaseUrl() });
  await db.connect();
  const tokens = [];
  const makeSession = async (where) => {
    const user = (await db.query(`SELECT id FROM app_user WHERE ${where} ORDER BY id LIMIT 1`)).rows[0];
    const token = randomBytes(32).toString('base64url');
    const hashed = createHash('sha256').update(token).digest();
    await db.query("INSERT INTO session (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [hashed, user.id]);
    tokens.push(hashed);
    return `pmcp_session=${token}`;
  };
  const manager = await makeSession("role = 'MANAGER'");
  const pic = await makeSession("username LIKE 'acuan.ba%'");
  const code = (await db.query('SELECT code FROM project ORDER BY id OFFSET 10 LIMIT 1')).rows[0].code;
  const screens = [
    ['Dashboard Head', '/dashboard', manager], ['Dashboard PIC', '/dashboard', pic],
    ['Project: Gantt', '/project', manager], ['Project: Daftar', '/project?v=daftar', manager],
    ['Project: Gantt, filter tahapan terlambat', '/project?sts=LATE', manager], ['Detail Project', `/project/${code}`, manager],
    ['Kanban (Manager, semua PIC)', '/kanban', manager], ['Kanban (PIC)', '/kanban', pic],
    ['Riwayat: tahapan selesai', '/riwayat', manager], ['Riwayat: aktivitas harian', '/riwayat?tab=harian&mode=minggu', manager],
    ['Master', '/master/aplikasi', manager],
  ];
  await fetch(`${base}/api/health`); // membangunkan proses server (cold start proses tidak diukur)
  let failed = false;
  console.log(`Anggaran server: ${budget} ms; ${runs} kali per layar (kali pertama = cache dingin, anggaran 3000 ms; sisanya anggaran server)\n`);
  console.log('Layar'.padEnd(44), 'dingin'.padStart(8), 'median'.padStart(8), 'terburuk*'.padStart(9), 'status');
  for (const [name, path, cookie] of screens) {
    const results = [];
    for (let i = 0; i < runs; i += 1) results.push(await timeRequest(`${base}${path}`, cookie));
    const totals = results.map((r) => r.total);
    const worst = Math.max(...totals.slice(1));
    // panggilan pertama (cache dingin) dinilai terhadap anggaran total layar 3 detik; sisanya terhadap anggaran server
    const ok = results.every((r) => r.status === 200) && worst <= budget && totals[0] <= COLD_BUDGET_MS;
    if (!ok) failed = true;
    console.log(name.padEnd(44), `${Math.round(totals[0])}`.padStart(8), `${Math.round(median(totals))}`.padStart(8), `${Math.round(worst)}`.padStart(9), ok ? 'lulus' : `GAGAL (status ${results[0].status})`);
  }
  console.log('\n* terburuk dihitung tanpa panggilan pertama (dingin).');
  await db.query('DELETE FROM session WHERE token_hash = ANY($1)', [tokens]);
  await db.end();
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exit(1);
});
