/**
 * Mengimpor data actual (Project List 2026) ke database PMCP: PIC, akun login PIC BA/QA, project, tiga tahapan per
 * project, dan penugasan PIC.
 *
 * Tujuan: mengisi database "actual" yang terpisah dari database pengembangan, dengan cara yang dapat diulang persis sama
 * saat lingkungan production tersedia. Skrip membaca JSON hasil `convert-project-list.py` (bukan Excel langsung).
 * Aman secara bawaan: tanpa `--apply` seluruh impor dijalankan di dalam transaksi lalu DIBATALKAN (simulasi), sehingga
 * kesalahan data atau batasan database ketahuan tanpa mengubah apa pun. Skrip menolak berjalan bila sudah ada project.
 *
 * Aturan pemetaan (keputusan pemilik):
 *   - Parent (EPIC) -> No. referensi; Request Date, UAT Sign Off, Go Live -> kolom project yang sama.
 *   - Tahapan BA dan Development memakai Est/Actual Start-End masing-masing.
 *   - Tahapan QA: tanggal mulai dari QA SIT, tanggal selesai dari QA UAT bila ada (selain itu dari QA SIT).
 *   - Status: Selesai -> Selesai, Berjalan -> Berjalan, New dan kosong -> Backlog, Ditunda -> Ditunda (alasan dari Remarks).
 *   - Status tahapan diturunkan dari tanggal actual: ada Actual End -> Selesai, hanya Actual Start -> Berjalan, selain itu Belum mulai.
 *   - Estimasi awal (baseline) diisi sama dengan estimasi, seperti saat project dibuat lewat aplikasi.
 *   - PIC Development tidak ada di data project, jadi tahapan Development tanpa PIC. Akun login hanya untuk PIC BA dan QA.
 *   - Remarks dan catatan tahapan digabung ke Deskripsi project. Penugasan ditandai sudah dilihat (bukan "Assignment baru").
 *
 * Pemakaian:
 *   node scripts/import-actual-data.mjs <data.json>             simulasi (dibatalkan)
 *   node scripts/import-actual-data.mjs <data.json> --apply     impor sungguhan
 * Masukan: `DATABASE_URL` dari lingkungan atau `.env`; akun Manager sudah ada (skrip bootstrap-manager).
 * Efek samping (hanya dengan --apply): INSERT pic, app_user, project, project_stage, stage_assignment, audit_event;
 * password sementara akun PIC ditampilkan sekali di terminal.
 * Rujukan: FR-02, FR-05, FR-08-01, BL-01, BL-03, BL-20; permintaan pemilik (impor data actual 2026-10-30).
 */
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dataFile = args.find((arg) => !arg.startsWith('--'));
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const STAGE_BY_LABEL = { 'business analyst': 'BA', development: 'DEV', qa: 'QA' };
const STAGE_ORDER = ['BA', 'DEV', 'QA'];
const STATUS_BY_LABEL = { selesai: 'COMPLETED', berjalan: 'RUNNING', new: 'BACKLOG', ditunda: 'DEFERRED' };
const NOISE_REMARKS = new Set(['selesai', 'berjalan', 'new', 'ditunda']);

/**
 * Membaca `DATABASE_URL` dari lingkungan atau berkas `.env`.
 * Masukan: tidak ada. Keluaran: URL koneksi atau undefined.
 * Efek samping: membaca `.env` bila ada (hanya baca).
 * Rujukan: Technical Design §15.
 */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = join(root, '.env');
  return existsSync(file) ? /^DATABASE_URL=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim() : undefined;
}

/**
 * Membuat password sementara 16 karakter dalam empat kelompok dari sumber acak kriptografis.
 * Masukan: tidak ada. Keluaran: password sementara.
 * Efek samping: membaca CSPRNG.
 * Rujukan: FR-01-05 butir 1.
 */
function temporaryPassword() {
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let chunk = '';
    for (let i = 0; i < 4; i += 1) chunk += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(chunk);
  }
  return groups.join('-');
}

/**
 * Memotong teks ke panjang maksimum kolom dan mencatat peringatan bila terpotong.
 * Masukan: teks, batas, label untuk peringatan, dan daftar peringatan. Keluaran: teks (mungkin terpotong) atau null.
 * Efek samping: menambah peringatan bila terpotong.
 * Rujukan: batas panjang kolom (database-design §5).
 */
function fit(text, limit, label, warnings) {
  if (text === null || text === undefined) return null;
  const chars = [...String(text)];
  if (chars.length <= limit) return String(text);
  warnings.push(`${label}: dipotong dari ${chars.length} menjadi ${limit} karakter`);
  return chars.slice(0, limit).join('');
}

/**
 * Menyusun satu pasangan tanggal (mulai, selesai) yang berpasangan dan berurutan (BL-03).
 * Masukan: tanggal mulai, tanggal selesai, label, dan daftar peringatan. Keluaran: {start, end} atau null.
 * Efek samping: menambah peringatan bila hanya satu sisi terisi atau urutannya terbalik (pasangan dibuang).
 * Rujukan: BL-03, constraint project_stage_est_pair.
 */
function toPair(start, end, label, warnings) {
  if (!start && !end) return null;
  if (!start || !end) {
    warnings.push(`${label}: hanya salah satu tanggal terisi (${start ?? end}); tidak diimpor`);
    return null;
  }
  if (end < start) {
    warnings.push(`${label}: tanggal selesai ${end} lebih awal dari mulai ${start}; tidak diimpor`);
    return null;
  }
  return { start, end };
}

/**
 * Menyusun tiga tahapan (BA, DEV, QA) sebuah project dari baris data. QA: mulai dari QA SIT, selesai dari QA UAT bila ada.
 * Masukan: baris data, label project untuk peringatan, dan daftar peringatan.
 * Keluaran: peta kind -> {estimate, actual, status, actualStart, actualEnd}.
 * Efek samping: menambah peringatan untuk tanggal yang tidak lengkap.
 * Rujukan: keputusan pemilik pemetaan QA SIT/UAT; stage-rules (aturan status dari tanggal actual).
 */
function buildStages(row, label, warnings) {
  const source = {
    BA: { estStart: row.baEstStart, estEnd: row.baEstEnd, actStart: row.baActualStart, actEnd: row.baActualEnd },
    DEV: { estStart: row.devEstStart, estEnd: row.devEstEnd, actStart: row.devActualStart, actEnd: row.devActualEnd },
    QA: {
      estStart: row.sitEstStart ?? row.uatEstStart,
      estEnd: row.uatEstEnd ?? row.sitEstEnd,
      actStart: row.sitActualStart ?? row.uatActualStart,
      actEnd: row.uatActualEnd ?? row.sitActualEnd,
    },
  };
  const stages = {};
  for (const kind of STAGE_ORDER) {
    const s = source[kind];
    const estimate = toPair(s.estStart, s.estEnd, `${label} ${kind} estimasi`, warnings);
    let actualStart = s.actStart ?? null;
    let actualEnd = s.actEnd ?? null;
    if (actualStart && actualEnd && actualEnd < actualStart) {
      warnings.push(`${label} ${kind} actual: selesai ${actualEnd} lebih awal dari mulai ${actualStart}; Actual End dibuang`);
      actualEnd = null;
    }
    if (actualEnd && !actualStart) {
      actualStart = estimate?.start ?? actualEnd;
      warnings.push(`${label} ${kind} actual: ada Actual End tanpa Actual Start; mulai diisi ${actualStart}`);
    }
    const status = actualEnd ? 'DONE' : actualStart ? 'RUNNING' : 'NOT_STARTED';
    stages[kind] = { estimate, actualStart, actualEnd, status };
  }
  return stages;
}

/**
 * Mencocokkan nama PIC pada data project dengan daftar PIC: nama persis, atau satu-satunya PIC se-tahapan yang kata
 * pertamanya sama (mis. "Barnas" -> "Barnas Danu").
 * Masukan: nama pada data, tahapan, dan daftar PIC. Keluaran: PIC cocok atau null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: keputusan pemilik (penyamaan nama).
 */
function matchPic(name, kind, pics) {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  const sameStage = pics.filter((pic) => pic.stage === kind);
  const exact = sameStage.find((pic) => pic.name.toLowerCase() === wanted);
  if (exact) return exact;
  const byFirstName = sameStage.filter((pic) => pic.name.toLowerCase().split(/\s+/)[0] === wanted.split(/\s+/)[0]);
  return byFirstName.length === 1 ? byFirstName[0] : null;
}

/**
 * Menyusun atribut project (tanpa tahapan) dari satu baris data.
 * Masukan: baris data, label, dan daftar peringatan. Keluaran: atribut siap simpan.
 * Efek samping: menambah peringatan untuk data yang dipotong atau status yang tidak dikenal.
 * Rujukan: BL-20 (alasan wajib untuk Ditunda), batas kolom project.
 */
function buildProject(row, label, warnings) {
  const statusKey = (row.status ?? '').toLowerCase();
  let status = STATUS_BY_LABEL[statusKey];
  if (!status) {
    status = 'BACKLOG';
    warnings.push(`${label}: status "${row.status ?? ''}" kosong atau tidak dikenal; dijadikan Backlog`);
  }
  const notes = [row.remarks1, row.remarks2, row.remarks3].filter((note) => note && !NOISE_REMARKS.has(note.toLowerCase()));
  const description = notes.length > 0 ? fit(notes.join(' · '), 1000, `${label} deskripsi`, warnings) : null;
  const reason = status === 'DEFERRED' ? fit(row.remarks1 ?? 'Ditunda (dari Project List 2026)', 200, `${label} alasan`, warnings) : null;
  return {
    name: fit(row.name, 100, `${label} nama`, warnings),
    referenceNo: fit(row.epic, 50, `${label} no. referensi`, warnings),
    requestDate: row.requestDate ?? null,
    uatSignOffDate: row.uatSignOff ?? null,
    goLiveDate: row.goLive ?? null,
    status,
    statusReason: reason,
    description,
  };
}

/**
 * Membentuk username dari nama PIC (huruf kecil, spasi menjadi titik) yang memenuhi format FR-08-01 dan belum dipakai.
 * Masukan: nama dan himpunan username terpakai. Keluaran: username unik.
 * Efek samping: menambahkan username ke himpunan.
 * Rujukan: FR-08-01 butir 2 (4 sampai 30 karakter a-z 0-9 . _ -).
 */
function makeUsername(name, taken) {
  let base = name.toLowerCase().trim().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
  while (base.length < 4) base += '0';
  base = base.slice(0, 27);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}${n}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Menjalankan seluruh impor dalam satu transaksi dan melaporkan hasilnya.
 * Masukan: tidak ada (membaca argumen baris perintah). Keluaran: janji selesai; mengakhiri proses dengan kode 1 bila gagal.
 * Efek samping: lihat deskripsi berkas; transaksi dibatalkan bila tanpa --apply.
 * Rujukan: lihat deskripsi berkas.
 */
async function main() {
  if (!dataFile) throw new Error('Pemakaian: node scripts/import-actual-data.mjs <data.json> [--apply]');
  const url = readDatabaseUrl();
  if (!url) throw new Error('DATABASE_URL tidak ditemukan (lingkungan atau .env).');
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const warnings = [];

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  console.log(`Sasaran : ${new URL(url).host}${new URL(url).pathname}`);
  console.log(`Mode    : ${apply ? 'IMPOR SUNGGUHAN (--apply)' : 'SIMULASI (dibatalkan di akhir)'}`);
  try {
    await client.query('BEGIN');
    const manager = (await client.query("SELECT id FROM app_user WHERE role = 'MANAGER' AND is_active ORDER BY id LIMIT 1")).rows[0];
    if (!manager) throw new Error('Akun Manager belum ada. Jalankan scripts/bootstrap-manager.mjs lebih dulu.');
    const existing = (await client.query('SELECT count(*)::int AS n FROM project')).rows[0].n;
    if (existing > 0) throw new Error(`Database sudah berisi ${existing} project; impor ditolak agar data tidak dobel.`);

    // PIC: pakai yang sudah ada (nama + tahapan sama) atau buat baru.
    const pics = [];
    for (const item of data.pics) {
      const stage = STAGE_BY_LABEL[(item.stage ?? '').toLowerCase()];
      if (!stage) { warnings.push(`PIC ${item.name}: tahapan "${item.stage}" tidak dikenal; dilewati`); continue; }
      const found = (await client.query('SELECT id FROM pic WHERE lower(name) = lower($1) AND stage = $2', [item.name, stage])).rows[0];
      const id = found?.id ?? (await client.query('INSERT INTO pic (name, stage) VALUES ($1, $2) RETURNING id', [item.name, stage])).rows[0].id;
      pics.push({ id, name: item.name, stage, isNew: !found });
    }

    // Akun login hanya untuk PIC BA dan QA yang belum punya akun.
    const taken = new Set((await client.query('SELECT username FROM app_user')).rows.map((r) => r.username));
    const accounts = [];
    for (const pic of pics.filter((p) => p.stage !== 'DEV')) {
      const has = (await client.query('SELECT 1 FROM app_user WHERE pic_id = $1', [pic.id])).rowCount > 0;
      if (has) continue;
      const username = makeUsername(pic.name, taken);
      const password = temporaryPassword();
      const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const userId = (await client.query(
        "INSERT INTO app_user (username, role, pic_id, password_hash, must_change_password) VALUES ($1, 'PIC', $2, $3, true) RETURNING id",
        [username, pic.id, passwordHash],
      )).rows[0].id;
      await client.query(
        "INSERT INTO audit_event (actor_user_id, actor_label, category, action, entity_type, entity_id, summary) VALUES ($1, 'Impor data actual', 'ACCOUNT', 'account.created', 'app_user', $2, $3)",
        [manager.id, String(userId), `Akun ${username} dibuat untuk PIC "${pic.name}" lewat impor data actual`],
      );
      accounts.push({ name: pic.name, stage: pic.stage, username, password });
    }

    // Project dan tahapan, berurutan menurut nomor agar kode PRJ mengikuti urutan Excel.
    const stats = { project: 0, stage: 0, assignment: 0, byStatus: {}, noBaPic: 0, noQaPic: 0 };
    const rows = [...data.projects].sort((a, b) => (a.no ?? Infinity) - (b.no ?? Infinity));
    for (const row of rows) {
      const label = `No ${row.no ?? 'kosong'} (${row.name})`;
      const project = buildProject(row, label, warnings);
      const stages = buildStages(row, label, warnings);
      const created = (await client.query(
        `INSERT INTO project (name, reference_no, request_date, uat_sign_off_date, go_live_date, status, status_reason, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, code`,
        [project.name, project.referenceNo, project.requestDate, project.uatSignOffDate, project.goLiveDate, project.status, project.statusReason, project.description, manager.id],
      )).rows[0];
      stats.project += 1;
      stats.byStatus[project.status] = (stats.byStatus[project.status] ?? 0) + 1;

      const stageIds = {};
      for (const kind of STAGE_ORDER) {
        const s = stages[kind];
        stageIds[kind] = (await client.query(
          `INSERT INTO project_stage (project_id, stage, status, est_start, est_end, baseline_start, baseline_end, actual_start, actual_end)
           VALUES ($1, $2, $3, $4, $5, $4, $5, $6, $7) RETURNING id`,
          [created.id, kind, s.status, s.estimate?.start ?? null, s.estimate?.end ?? null, s.actualStart, s.actualEnd],
        )).rows[0].id;
        stats.stage += 1;
        if (project.status === 'COMPLETED' && s.estimate && s.status !== 'DONE') warnings.push(`${label}: project Selesai tetapi tahapan ${kind} belum Selesai (tidak ada Actual End)`);
      }

      for (const [kind, personName] of [['BA', row.ba], ['QA', row.qa]]) {
        const pic = matchPic(personName, kind, pics);
        if (!pic) {
          if (personName) warnings.push(`${label}: PIC ${kind} "${personName}" tidak cocok dengan daftar PIC`);
          else stats[kind === 'BA' ? 'noBaPic' : 'noQaPic'] += 1;
          continue;
        }
        await client.query(
          'INSERT INTO stage_assignment (stage_id, pic_id, assigned_by, seen_at) VALUES ($1, $2, $3, now())',
          [stageIds[kind], pic.id, manager.id],
        );
        stats.assignment += 1;
      }
      await client.query(
        "INSERT INTO audit_event (actor_user_id, actor_label, category, action, project_code, entity_type, entity_id, summary) VALUES ($1, 'Impor data actual', 'PROJECT', 'project.imported', $2, 'project', $3, $4)",
        [manager.id, created.code, String(created.id), `Project ${created.code} "${project.name}" diimpor dari ${data.source}`.slice(0, 300)],
      );
    }

    console.log(`\nPIC            : ${pics.length} (${accounts.length} akun login baru)`);
    console.log(`Project        : ${stats.project}  ${JSON.stringify(stats.byStatus)}`);
    console.log(`Tahapan        : ${stats.stage}`);
    console.log(`Penugasan PIC  : ${stats.assignment} (tanpa PIC BA: ${stats.noBaPic}, tanpa PIC QA: ${stats.noQaPic}; Development tanpa PIC)`);
    console.log(`\nPeringatan (${warnings.length}):`);
    for (const warning of warnings) console.log(`  - ${warning}`);

    if (apply) {
      await client.query('COMMIT');
      console.log('\nIMPOR SELESAI dan tersimpan. Password sementara akun PIC (tampil sekali, wajib diganti saat login pertama):');
      for (const account of accounts) console.log(`  ${account.username.padEnd(16)} ${account.password}   (${account.name}, ${account.stage})`);
    } else {
      await client.query('ROLLBACK');
      // Sequence tidak ikut dibatalkan; kembalikan agar kode PRJ pada impor sungguhan mulai dari PRJ-001 (database masih kosong).
      await client.query("SELECT setval('project_code_seq', 1, false)");
      console.log('\nSIMULASI selesai: semua perubahan dibatalkan. Jalankan lagi dengan --apply untuk menyimpan.');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
