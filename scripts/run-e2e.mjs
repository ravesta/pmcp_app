/**
 * Menjalankan seluruh uji E2E (browser nyata) pada database sementara dan server produksi lokal.
 *
 * Tujuan: satu perintah (`npm run test:e2e`) yang menyiapkan lingkungan, menjalankan skenario `tests/e2e/*.e2e.mjs`
 * berurutan, lalu membersihkan. Skenario pertama (`irisan1`) memakai akun Manager hasil bootstrap; setelah itu
 * pengendali mengisi akun dan PIC uji dengan password yang diketahui untuk skenario berikutnya.
 * Masukan: `DATABASE_URL` (server PostgreSQL; nama database diabaikan), `E2E_PORT` (bawaan 3130),
 * `E2E_CHROMIUM_PATH` (opsional), argumen `--skip-build` (pakai hasil build yang ada; bawaan selalu build ulang agar uji memakai kode terbaru), `--keep` (jangan hapus database), nama berkas sebagai penyaring.
 * Efek samping: membuat dan menghapus database `pmcp_e2e_*`, menjalankan build bila perlu, memulai dan menghentikan `next start`,
 * menulis tangkapan layar kegagalan ke `test-results/e2e`.
 * Rujukan: Technical Design §14 (E2E), §15.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.E2E_PORT ?? '3130';
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'rahasia-uji-panjang-123';
const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));

/**
 * Membaca `DATABASE_URL` dari lingkungan atau berkas `.env`.
 * Masukan: tidak ada. Keluaran: URL koneksi atau undefined.
 * Efek samping: membaca berkas `.env` bila ada (hanya baca).
 * Rujukan: Technical Design §15.
 */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = join(root, '.env');
  return existsSync(file) ? /^DATABASE_URL=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim() : undefined;
}

/**
 * Menjalankan perintah sinkron dengan lingkungan tambahan dan mengembalikan keluarannya.
 * Masukan: berkas, argumen, lingkungan. Keluaran: stdout; melempar galat bila perintah gagal.
 * Efek samping: menjalankan proses anak.
 * Rujukan: laporan uji.
 */
function run(file, argv, env) {
  const result = spawnSync(file, argv, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file} ${argv.join(' ')} gagal:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

/**
 * Menunggu server menjawab `/api/health` dengan sukses.
 * Masukan: batas waktu detik. Keluaran: janji selesai; melempar galat bila tidak siap.
 * Efek samping: permintaan HTTP ke server lokal.
 * Rujukan: Technical Design §15.
 */
async function waitReady(seconds) {
  for (let i = 0; i < seconds * 2; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* belum siap */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server E2E tidak siap tepat waktu.');
}

/**
 * Mengisi akun Manager dengan password yang diketahui serta PIC dan akun PIC uji.
 * Masukan: URL database sementara. Keluaran: janji selesai.
 * Efek samping: UPDATE app_user, INSERT pic dan app_user.
 * Rujukan: FR-01, FR-08-03.
 */
async function seedPeople(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await client.query("UPDATE app_user SET password_hash = $1, must_change_password = false WHERE username = 'manager'", [passwordHash]);
    await client.query("INSERT INTO pic (name, stage) VALUES ('Rina','BA'),('Sari','BA'),('Dimas','QA'),('Budi','DEV')");
    for (const [username, pic] of [['rina.ba', 'Rina'], ['dimas.qa', 'Dimas']]) {
      await client.query(
        "INSERT INTO app_user (username, role, pic_id, password_hash, must_change_password) SELECT $1, 'PIC', id, $2, false FROM pic WHERE name = $3",
        [username, passwordHash, pic],
      );
    }
  } finally {
    await client.end();
  }
}

const baseUrl = readDatabaseUrl();
if (!baseUrl) {
  console.error('DATABASE_URL tidak ditemukan (lingkungan atau .env).');
  process.exit(2);
}
const admin = new URL(baseUrl);
admin.pathname = '/postgres';
const dbName = `pmcp_e2e_${randomBytes(4).toString('hex')}`;
const target = new URL(baseUrl);
target.pathname = `/${dbName}`;
const databaseUrl = target.toString();
const shots = join(root, 'test-results', 'e2e');
mkdirSync(shots, { recursive: true });

let server;
let exitCode = 1;
const adminClient = new pg.Client({ connectionString: admin.toString() });
try {
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${dbName}`);
  console.log(`Database sementara: ${dbName}`);
  const busy = await fetch(`${BASE}/api/health`).then(() => true, () => false);
  if (busy) throw new Error(`Port ${PORT} sudah dipakai; hentikan server itu atau ubah E2E_PORT.`);
  const env = { DATABASE_URL: databaseUrl, NODE_ENV: 'production', APP_ENV: 'production' };

  run('node', ['scripts/migrate.mjs'], env);
  const bootstrap = run('node', ['scripts/bootstrap-manager.mjs'], env);
  const managerTemp = /wajib diganti saat login pertama\): (\S+)/.exec(bootstrap)?.[1];
  if (!managerTemp) throw new Error('Password sementara Manager tidak terbaca dari bootstrap.');

  if (!args.includes('--skip-build') || !existsSync(join(root, '.next', 'BUILD_ID'))) {
    console.log('Membangun aplikasi (npm run build)...');
    run('npm', ['run', 'build'], env);
  }
  server = spawn('npx', ['next', 'start', '-p', PORT, '-H', '127.0.0.1'], { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore', detached: true });
  await waitReady(60);

  const specs = readdirSync(join(root, 'tests', 'e2e'))
    .filter((f) => f.endsWith('.e2e.mjs') && (filters.length === 0 || filters.some((x) => f.includes(x))))
    .sort();
  const specEnv = { ...process.env, ...env, E2E_BASE_URL: BASE, E2E_MANAGER_TEMP: managerTemp, E2E_SHOTS: shots, E2E_PASSWORD: PASSWORD };
  let failed = 0;
  let seeded = false;
  for (const spec of specs) {
    if (!seeded && !spec.startsWith('01-')) {
      await seedPeople(databaseUrl);
      seeded = true;
    }
    const outcome = spawnSync('node', [join('tests', 'e2e', spec)], { cwd: root, env: specEnv, stdio: 'inherit' });
    if (outcome.status !== 0) failed += 1;
  }
  console.log(`\nE2E selesai: ${specs.length - failed}/${specs.length} skenario lulus.`);
  exitCode = failed === 0 && specs.length > 0 ? 0 : 1;
} catch (error) {
  console.error(error.message);
} finally {
  if (server) process.kill(-server.pid, 'SIGTERM'); // seluruh grup proses, supaya `next` ikut berhenti
  if (!args.includes('--keep')) await adminClient.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
  await adminClient.end().catch(() => {});
}
process.exit(exitCode);
