/**
 * Membuat data acuan uji performa (Technical Design §13, CL-057): 300 project (900 tahapan), 15 PIC (11 ber-login),
 * 6.000 kartu, 60.000 log, dan 100.000 peristiwa audit.
 *
 * Tujuan: mengukur anggaran muat 3 detik pada volume yang disetujui pemilik. Skrip ini HANYA untuk database uji atau
 * pengembangan: menolak berjalan bila `APP_ENV=production` atau bila sudah ada project di database.
 *
 * Pemakaian: node scripts/seed-reference-data.mjs
 * Masukan: `DATABASE_URL` dari lingkungan atau `.env`; akun Manager (`manager`) sudah ada (skrip bootstrap).
 * Efek samping: INSERT massal pic, app_user, project, project_stage, stage_assignment, card, work_log, audit_event.
 * Rujukan: Technical Design §13 (Verifikasi), implementation-log (irisan 5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Membaca `DATABASE_URL` dari lingkungan atau berkas `.env`.
 * Masukan: tidak ada. Keluaran: URL koneksi atau undefined.
 * Efek samping: membaca `.env` bila ada.
 * Rujukan: Technical Design §15.
 */
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = join(root, '.env');
  if (!existsSync(file)) return undefined;
  return /^DATABASE_URL=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim();
}

/**
 * Menjalankan pembuatan data acuan.
 * Masukan: tidak ada. Keluaran: tidak ada (mencetak ringkasan jumlah baris).
 * Efek samping: INSERT massal dalam satu transaksi; keluar dengan kode 1 bila ditolak.
 * Rujukan: Technical Design §13.
 */
async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('Data acuan tidak boleh dibuat di produksi.');
  const url = readDatabaseUrl();
  if (!url) throw new Error('DATABASE_URL tidak diatur.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (Number((await client.query('SELECT COUNT(*) AS n FROM project')).rows[0].n) > 0) throw new Error('Database sudah berisi project; gunakan database kosong.');
    const manager = (await client.query("SELECT id FROM app_user WHERE role = 'MANAGER' LIMIT 1")).rows[0];
    if (!manager) throw new Error('Akun Manager belum ada (jalankan bootstrap-manager.mjs).');
    const passwordHash = await hash('rahasia-uji-panjang-123');
    await client.query('BEGIN');

    // 15 PIC: 6 BA + 5 QA ber-login, 4 Development tanpa login
    await client.query(`INSERT INTO pic (name, stage) SELECT 'Acuan BA ' || n, 'BA'::stage_t FROM generate_series(1, 6) n
                        UNION ALL SELECT 'Acuan QA ' || n, 'QA'::stage_t FROM generate_series(1, 5) n
                        UNION ALL SELECT 'Acuan DEV ' || n, 'DEV'::stage_t FROM generate_series(1, 4) n`);
    await client.query(`INSERT INTO app_user (username, role, pic_id, password_hash, must_change_password)
                        SELECT 'acuan.' || lower(stage::text) || row_number() OVER (PARTITION BY stage ORDER BY id), 'PIC', id, $1, false
                        FROM pic WHERE name LIKE 'Acuan %' AND stage <> 'DEV'`, [passwordHash]);

    // 300 project, status campuran
    await client.query(`INSERT INTO project (name, status, status_reason, created_by, project_type)
                        SELECT 'Acuan Project ' || n,
                          (ARRAY['RUNNING','RUNNING','RUNNING','RUNNING','RUNNING','RUNNING','BACKLOG','DEFERRED','COMPLETED','CANCELLED'])[1 + n % 10]::project_status_t,
                          CASE WHEN n % 10 IN (7, 9) THEN 'Alasan uji acuan' END, $1, (ARRAY['NEW','CHANGE_REQUEST'])[1 + n % 2]::project_type_t
                        FROM generate_series(1, 300) n`, [manager.id]);

    // 900 tahapan berurutan BA -> DEV -> QA dengan jadwal tersebar Juli sampai Desember 2026
    await client.query(`INSERT INTO project_stage (project_id, stage, status, est_start, est_end, baseline_start, baseline_end, actual_start, actual_end)
      SELECT p.id, s.stage,
        CASE WHEN p.status = 'COMPLETED' THEN 'DONE' WHEN p.status = 'RUNNING' AND s.ord = 1 AND p.id % 3 = 0 THEN 'DONE'
             WHEN p.status = 'RUNNING' AND s.ord = 1 THEN 'RUNNING' ELSE 'NOT_STARTED' END::stage_status_t,
        d.start_on, d.end_on, d.start_on, d.end_on,
        CASE WHEN p.status = 'COMPLETED' OR (p.status = 'RUNNING' AND s.ord = 1) THEN d.start_on END,
        CASE WHEN p.status = 'COMPLETED' OR (p.status = 'RUNNING' AND s.ord = 1 AND p.id % 3 = 0) THEN d.end_on END
      FROM project p
      CROSS JOIN (VALUES (1, 'BA'::stage_t, 0, 9), (2, 'DEV'::stage_t, 10, 29), (3, 'QA'::stage_t, 30, 39)) AS s(ord, stage, off_start, off_end)
      CROSS JOIN LATERAL (SELECT (DATE '2026-07-01' + (((p.id * 7) % 120)::int + s.off_start))::date AS start_on, (DATE '2026-07-01' + (((p.id * 7) % 120)::int + s.off_end))::date AS end_on) d`);
    await client.query(`INSERT INTO stage_assignment (stage_id, pic_id, assigned_by, seen_at)
      SELECT s.id, (SELECT c.id FROM (SELECT id, row_number() OVER (ORDER BY id) rn, count(*) OVER () cnt FROM pic WHERE stage = s.stage AND name LIKE 'Acuan %') c WHERE c.rn = 1 + (s.project_id % c.cnt)),
             $1, now()
      FROM project_stage s`, [manager.id]);

    // 6.000 kartu pada 11 PIC ber-login (80% kartu project, 20% activity)
    await client.query(`INSERT INTO card (kind, owner_pic_id, project_id, stage, step_name, category_name, title, board_column, progress, plan_start, plan_end, plan_baseline_start, plan_baseline_end, est_minutes, is_adhoc, done_on)
      SELECT k.kind, o.id, CASE WHEN k.kind = 'PROJECT' THEN pr.id END, CASE WHEN k.kind = 'PROJECT' THEN o.stage END,
             CASE WHEN k.kind = 'PROJECT' THEN CASE o.stage WHEN 'BA' THEN 'Analisis Requirement' ELSE 'Test Planning' END END,
             CASE WHEN k.kind = 'ACTIVITY' THEN 'Rapat departemen' END,
             'Kartu acuan ' || n, k.col, CASE WHEN k.col = 'IN_PROGRESS' THEN (n % 4) * 25 ELSE 0 END,
             d.start_on, d.end_on, d.start_on, d.end_on, 60 + (n % 20) * 30, n % 17 = 0, CASE WHEN k.col = 'DONE' THEN d.end_on END
      FROM generate_series(1, 6000) n
      JOIN LATERAL (SELECT CASE WHEN n % 5 = 0 THEN 'ACTIVITY' ELSE 'PROJECT' END::card_kind_t AS kind,
                           (ARRAY['PLANNED','IN_PROGRESS','DONE','DONE','PLANNED'])[1 + n % 5]::card_column_t AS col) k ON true
      JOIN LATERAL (SELECT id, stage FROM (SELECT id, stage, row_number() OVER (ORDER BY id) rn FROM pic WHERE name LIKE 'Acuan %' AND stage <> 'DEV') x WHERE rn = 1 + (n % 11)) o ON true
      JOIN LATERAL (SELECT id FROM project WHERE status IN ('RUNNING', 'BACKLOG', 'DEFERRED') ORDER BY id OFFSET (n * 13) % 200 LIMIT 1) pr ON true
      JOIN LATERAL (SELECT (DATE '2026-09-01' + (n % 90))::date AS start_on, (DATE '2026-09-01' + (n % 90) + (n % 6))::date AS end_on) d ON true`);

    // 60.000 log tanpa bentrok: tiap PIC memakai slot 30 menit berurutan (16 slot per hari mulai 06:00)
    await client.query(`INSERT INTO work_log (card_id, owner_pic_id, work_date, start_time, end_time, step_name, description)
      SELECT c.id, c.owner_pic_id, (DATE '2025-11-20' + (j / 16))::date,
             (TIME '06:00' + ((j % 16) * INTERVAL '30 minutes'))::time, (TIME '06:30' + ((j % 16) * INTERVAL '30 minutes'))::time,
             c.step_name, 'Log acuan ' || i
      FROM generate_series(0, 59999) i
      CROSS JOIN LATERAL (SELECT i % 11 AS k, i / 11 AS j) idx
      JOIN LATERAL (SELECT id, owner_pic_id, step_name FROM (SELECT id, owner_pic_id, step_name, row_number() OVER (PARTITION BY owner_pic_id ORDER BY id) rn, count(*) OVER (PARTITION BY owner_pic_id) cnt
                                                             FROM card WHERE owner_pic_id IN (SELECT id FROM pic WHERE name LIKE 'Acuan %' AND stage <> 'DEV')) x
                    WHERE x.owner_pic_id = (SELECT id FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM pic WHERE name LIKE 'Acuan %' AND stage <> 'DEV') p WHERE rn = 1 + idx.k)
                      AND x.rn = 1 + (idx.j % x.cnt)) c ON true`);

    // 100.000 peristiwa audit
    await client.query(`INSERT INTO audit_event (occurred_at, actor_user_id, actor_label, category, action, project_code, entity_type, entity_id, summary, changes)
      SELECT TIMESTAMPTZ '2026-01-01 08:00+07' + (n * INTERVAL '2 minutes'), $1, 'Manager',
             (ARRAY['PROJECT','CARD','MASTER','ACCOUNT','SECURITY'])[1 + n % 5]::audit_category_t, 'acuan.peristiwa',
             'PRJ-' || lpad((1 + n % 300)::text, 3, '0'), 'project', (1 + n % 300)::text, 'Peristiwa acuan ' || n,
             jsonb_build_array(jsonb_build_object('field', 'Nama', 'old', 'a', 'new', 'b'))
      FROM generate_series(1, 100000) n`, [manager.id]);
    await client.query('COMMIT');
    await client.query('ANALYZE');
    for (const table of ['pic', 'project', 'project_stage', 'card', 'work_log', 'audit_event']) {
      console.log(`${table}: ${(await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n}`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exit(1);
});
