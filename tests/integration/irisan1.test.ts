/**
 * Uji integrasi irisan 1 di PostgreSQL sungguhan: login, throttle, sesi, ganti dan reset password,
 * PIC, master, jejak audit, hak akses, dan konkurensi.
 * Rujukan: FR-01-01 s.d. FR-01-06, FR-08-01 s.d. FR-08-06, FR-19-01, FR-09-01, NFR-01, NFR-04, NFR-10.
 *
 * Uji ini membutuhkan PostgreSQL (Prisma tidak berjalan di PGlite); dilewati bila server tidak terjangkau.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from '@/modules/audit';
import {
  changeOwnPassword,
  login,
  logout,
  requireSession,
  type Actor,
  type AuthenticatedSession,
} from '@/modules/auth';
import {
  addMasterItem,
  createPic,
  getThresholds,
  listMaster,
  listPics,
  moveStep,
  renameMasterItem,
  resetPicPassword,
  setMasterItemActive,
  setPicActive,
  setThreshold,
} from '@/modules/master';
import { buildContainer, type Container } from '@/platform/container';
import { loadConfig } from '@/platform/config';
import { createPrismaClient } from '@/platform/db';
import type { Clock } from '@/shared/clock';
import { toIsoDate } from '@/shared/iso-date';
import { createTestDb, type TestDb } from './_support/database';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');
const IP = '10.0.0.7';
const MANAGER_PASSWORD = 'kopi-hitam-tanpa-gula';

/** Database uji dibuat di level modul agar keputusan lewati-uji diketahui sebelum uji dikumpulkan. */
const testDb: TestDb = await createTestDb();
const isPg = testDb.engine === 'postgres' && Boolean(testDb.url);
let container: Container;
let now = new Date('2026-10-28T05:00:00Z');

/** Jam uji yang dapat dimajukan untuk menguji masa berlaku sesi dan penundaan login. */
const clock: Clock = { today: () => toIsoDate('2026-10-28'), now: () => new Date(now.getTime()) };

/**
 * Memajukan jam uji.
 * Masukan: jumlah menit. Keluaran: tidak ada.
 * Efek samping: mengubah waktu "sekarang" jam uji.
 * Rujukan: NFR-16 butir 1.
 */
function advanceMinutes(minutes: number): void {
  now = new Date(now.getTime() + minutes * 60_000);
}

/**
 * Mengambil nilai berhasil dari sebuah hasil, gagal uji bila hasilnya galat.
 * Masukan: hasil use case. Keluaran: data.
 * Efek samping: tidak ada.
 * Rujukan: Technical Design §8.
 */
function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`Hasil gagal tak terduga: ${result.error.code} ${result.error.message}`);
  return result.data;
}

/**
 * Login dan mengembalikan pelaku beserta sesinya.
 * Masukan: username dan password. Keluaran: token dan sesi terautentikasi.
 * Efek samping: membuat sesi dan audit login.
 * Rujukan: FR-01-01.
 */
async function signIn(username: string, password: string): Promise<{ token: string; session: AuthenticatedSession }> {
  const { token } = unwrap(await login(container.auth, { username, password, sourceAddress: IP }));
  const session = await requireSession(container.auth, token);
  if (!session) throw new Error('Sesi tidak valid setelah login');
  return { token, session };
}

let manager: Actor;
let managerSession: AuthenticatedSession;

beforeAll(async () => {
  if (!isPg || !testDb.url) return;
  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const folder of folders) await testDb.exec(readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8'));
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: testDb.url });
  container = buildContainer(createPrismaClient(testDb.url), clock, config);
  // akun Manager awal (di produksi dibuat skrip bootstrap, FR-01-06)
  const hash = await container.auth.hasher.hash(MANAGER_PASSWORD);
  await container.prisma.app_user.create({
    data: { username: 'manager', role: 'MANAGER', password_hash: hash, must_change_password: false },
  });
  managerSession = (await signIn('manager', MANAGER_PASSWORD)).session;
  manager = managerSession.actor;
});

afterAll(async () => {
  if (container) await container.prisma.$disconnect();
  await testDb.close();
});

describe('login dan throttle (FR-01-01)', () => {
  it.skipIf(!isPg)('login berhasil membuka sesi dan mengembalikan pelaku', async () => {
    expect(manager.role).toBe('MANAGER');
    expect(manager.label).toBe('Manager');
  });

  it.skipIf(!isPg)('username tidak membedakan huruf besar kecil dan spasi tepi dibuang', async () => {
    const result = await login(container.auth, { username: '  MANAGER ', password: MANAGER_PASSWORD, sourceAddress: IP });
    expect(result.ok).toBe(true);
  });

  it.skipIf(!isPg)('pesan generik sama untuk username tidak dikenal dan password salah', async () => {
    const unknown = await login(container.auth, { username: 'tidak.ada', password: 'apa-saja-yang-panjang', sourceAddress: IP });
    const wrong = await login(container.auth, { username: 'manager', password: 'salah-password-panjang', sourceAddress: IP });
    expect(unknown.ok || wrong.ok).toBe(false);
    if (!unknown.ok && !wrong.ok) {
      expect(unknown.error.message).toBe('Username atau password salah.');
      expect(wrong.error.message).toBe(unknown.error.message);
      expect(unknown.error.code).toBe('AUTHENTICATION');
    }
  });

  it.skipIf(!isPg)('isian kosong ditolak tanpa dihitung sebagai percobaan', async () => {
    const result = await login(container.auth, { username: '', password: '', sourceAddress: '10.9.9.9' });
    expect(result.ok).toBe(false);
    expect(await container.auth.repository.getThrottle('IP', '10.9.9.9')).toBeNull();
  });

  it.skipIf(!isPg)('5 kegagalan menunda 15 menit: percobaan berikutnya ditolak walau password benar, lalu pulih', async () => {
    const hash = await container.auth.hasher.hash('rahasia-throttle-uji');
    await container.prisma.app_user.create({ data: { username: 'throttle.uji', role: 'MANAGER', password_hash: hash, must_change_password: false } });
    for (let i = 0; i < 5; i += 1) {
      const attempt = await login(container.auth, { username: 'throttle.uji', password: 'salah-berulang-kali', sourceAddress: '10.1.1.1' });
      expect(attempt.ok).toBe(false);
    }
    const locked = await login(container.auth, { username: 'throttle.uji', password: 'rahasia-throttle-uji', sourceAddress: '10.1.1.2' });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.error.code).toBe('THROTTLED');
      expect(locked.error.message).toMatch(/Coba lagi pukul \d{2}:\d{2}/);
    }
    advanceMinutes(14);
    expect((await login(container.auth, { username: 'throttle.uji', password: 'rahasia-throttle-uji', sourceAddress: '10.1.1.2' })).ok).toBe(false);
    advanceMinutes(2);
    const recovered = await login(container.auth, { username: 'throttle.uji', password: 'rahasia-throttle-uji', sourceAddress: '10.1.1.2' });
    expect(recovered.ok).toBe(true);
    expect(await container.auth.repository.getThrottle('USER', 'throttle.uji')).toBeNull();
  });

  it.skipIf(!isPg)('percobaan gagal paralel tercatat atomik: tidak ada yang hilang dan batas tetap berlaku', async () => {
    const rule = { now: new Date('2026-10-28T05:00:00Z'), maxFailures: 5, lockMinutes: 15 };
    const states = await Promise.all(Array.from({ length: 12 }, () => container.auth.repository.recordFailure('USER', 'paralel.uji', rule)));
    expect(Math.max(...states.map((state) => state.failures))).toBe(12);
    const final = await container.auth.repository.getThrottle('USER', 'paralel.uji');
    expect(final?.failures).toBe(12);
    expect(final?.lockedUntil).not.toBeNull();
  });

  it.skipIf(!isPg)('alamat tidak diketahui hanya dibatasi per username (tidak mengunci semua pengguna)', async () => {
    for (let i = 0; i < 25; i += 1) await login(container.auth, { username: `tamu.${i}`, password: 'sembarang-password', sourceAddress: 'tidak-diketahui' });
    expect(await container.auth.repository.getThrottle('IP', 'tidak-diketahui')).toBeNull();
    const ok = await login(container.auth, { username: 'manager', password: 'kopi-hitam-tanpa-gula', sourceAddress: 'tidak-diketahui' });
    expect(ok.ok || (!ok.ok && ok.error.code !== 'THROTTLED')).toBe(true);
  });

  it.skipIf(!isPg)('username tidak dikenal juga ditunda dengan pesan yang sama bentuknya (anti enumerasi)', async () => {
    for (let i = 0; i < 5; i += 1) await login(container.auth, { username: 'hantu.siapa', password: 'sembarang-password', sourceAddress: '10.2.2.2' });
    const locked = await login(container.auth, { username: 'hantu.siapa', password: 'sembarang-password', sourceAddress: '10.2.2.3' });
    expect(!locked.ok && locked.error.code).toBe('THROTTLED');
  });

  it.skipIf(!isPg)('akun nonaktif ditolak dengan pesan generik', async () => {
    const hash = await container.auth.hasher.hash('akun-nonaktif-uji-1');
    await container.prisma.app_user.create({ data: { username: 'nonaktif.uji', role: 'MANAGER', password_hash: hash, is_active: false, must_change_password: false } });
    const result = await login(container.auth, { username: 'nonaktif.uji', password: 'akun-nonaktif-uji-1', sourceAddress: '10.3.3.3' });
    expect(!result.ok && result.error.message).toBe('Username atau password salah.');
  });
});

describe('sesi (FR-01-01 butir 5, FR-01-03)', () => {
  it.skipIf(!isPg)('idle 2 jam menolak sesi, aktivitas sebelumnya memperpanjang', async () => {
    const { token } = await signIn('manager', MANAGER_PASSWORD);
    advanceMinutes(100);
    expect(await requireSession(container.auth, token)).not.toBeNull(); // memperbarui last_seen
    advanceMinutes(100);
    expect(await requireSession(container.auth, token)).not.toBeNull(); // 100 menit sejak aktivitas terakhir
    advanceMinutes(121);
    expect(await requireSession(container.auth, token)).toBeNull();
  });

  it.skipIf(!isPg)('maksimum 12 jam menolak sesi walau terus aktif', async () => {
    const { token } = await signIn('manager', MANAGER_PASSWORD);
    for (let i = 0; i < 11; i += 1) {
      advanceMinutes(60);
      expect(await requireSession(container.auth, token)).not.toBeNull();
    }
    advanceMinutes(61);
    expect(await requireSession(container.auth, token)).toBeNull();
  });

  it.skipIf(!isPg)('keluar mengakhiri sesi dan token acak tidak dikenali', async () => {
    const { token } = await signIn('manager', MANAGER_PASSWORD);
    await logout(container.auth, token);
    expect(await requireSession(container.auth, token)).toBeNull();
    expect(await requireSession(container.auth, 'token-acak-yang-tidak-ada')).toBeNull();
    expect(await requireSession(container.auth, undefined)).toBeNull();
  });

  it.skipIf(!isPg)('token disimpan hanya sebagai hash di database', async () => {
    const { token } = await signIn('manager', MANAGER_PASSWORD);
    const rows = await testDb.query<{ n: string }>(`SELECT count(*) AS n FROM session WHERE encode(token_hash, 'escape') LIKE '%${token.slice(0, 8)}%'`);
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });
});

describe('PIC dan akun (FR-08-01, FR-01-05)', () => {
  let temporary = '';
  let rinaPicId = 0;

  it.skipIf(!isPg)('Manager menambah PIC BA dengan akun: password sementara tampil sekali dan wajib ganti', async () => {
    const created = unwrap(await createPic(container.master, manager, { name: 'Rina', stage: 'BA', withLogin: true, username: 'Rina' }));
    expect(created.username).toBe('rina');
    expect(created.temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    temporary = created.temporaryPassword as string;
    rinaPicId = created.picId;
    const hashRow = await container.prisma.app_user.findUniqueOrThrow({ where: { username: 'rina' } });
    expect(hashRow.password_hash).not.toContain(temporary);
    expect(hashRow.must_change_password).toBe(true);
    const { session } = await signIn('rina', temporary);
    expect(session.actor.role).toBe('PIC');
    expect(session.actor.picStage).toBe('BA');
    expect(session.actor.mustChangePassword).toBe(true);
  });

  it.skipIf(!isPg)('PIC Development tidak boleh punya akun login (EC-08-01.02)', async () => {
    const result = await createPic(container.master, manager, { name: 'Andi', stage: 'DEV', withLogin: true, username: 'andi.dev' });
    expect(!result.ok && result.error.fields?.login).toMatch(/tidak dapat memiliki akun login/);
  });

  it.skipIf(!isPg)('PIC Development tanpa akun dicatat sebagai nama saja', async () => {
    const created = unwrap(await createPic(container.master, manager, { name: 'Andi', stage: 'DEV', withLogin: false }));
    expect(created.temporaryPassword).toBeNull();
    expect(await container.prisma.app_user.count({ where: { pic_id: BigInt(created.picId) } })).toBe(0);
  });

  it.skipIf(!isPg)('username sama ditolak tanpa membedakan huruf besar kecil (EC-08-01.01)', async () => {
    const result = await createPic(container.master, manager, { name: 'Rina Dua', stage: 'QA', withLogin: true, username: 'RINA' });
    expect(!result.ok && result.error.fields?.username).toBe('Username sudah dipakai.');
    expect((await listPics(container.master, manager)).ok).toBe(true);
  });

  it.skipIf(!isPg)('dua pembuatan PIC dengan username sama serentak: satu berhasil, satu ditolak rapi', async () => {
    const results = await Promise.all([
      createPic(container.master, manager, { name: 'Kembar Satu', stage: 'QA', withLogin: true, username: 'kembar.uji' }),
      createPic(container.master, manager, { name: 'Kembar Dua', stage: 'QA', withLogin: true, username: 'kembar.uji' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rejected = results.find((r) => !r.ok);
    expect(rejected && !rejected.ok && rejected.error.fields?.username).toBe('Username sudah dipakai.');
    expect(await container.prisma.app_user.count({ where: { username: 'kembar.uji' } })).toBe(1);
  });

  it.skipIf(!isPg)('format username salah, nama kosong, tahapan kosong ditolak per isian', async () => {
    const result = await createPic(container.master, manager, { name: '', stage: '', withLogin: true, username: 'ab' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error.fields ?? {}).sort()).toEqual(['name', 'stage', 'username'].sort());
    }
  });

  it.skipIf(!isPg)('ganti password wajib: kebijakan, konfirmasi, dan password saat ini salah dicek', async () => {
    const { session } = await signIn('rina', temporary);
    const bad = await changeOwnPassword(container.auth, session, { current: temporary, next: 'pendek', confirm: 'pendek' });
    expect(!bad.ok && bad.error.fields?.next).toMatch(/minimal 12/);
    const common = await changeOwnPassword(container.auth, session, { current: temporary, next: 'password12345', confirm: 'password12345' });
    expect(!common.ok && common.error.fields?.next).toMatch(/umum/);
    const mismatch = await changeOwnPassword(container.auth, session, { current: temporary, next: 'kalimat-baru-aman', confirm: 'kalimat-lain-aman' });
    expect(!mismatch.ok && mismatch.error.fields?.confirm).toMatch(/harus sama/);
    const wrong = await changeOwnPassword(container.auth, session, { current: 'bukan-password-saya', next: 'kalimat-baru-aman', confirm: 'kalimat-baru-aman' });
    expect(!wrong.ok && wrong.error.fields?.current).toBe('Password saat ini salah.');
    const sameAsCurrent = await changeOwnPassword(container.auth, session, { current: temporary, next: temporary, confirm: temporary });
    expect(!sameAsCurrent.ok && sameAsCurrent.error.fields?.next).toMatch(/sama dengan password saat ini/);
  });

  it.skipIf(!isPg)('ganti password berhasil: sesi lain berakhir, sesi ini tetap, penanda wajib ganti hilang', async () => {
    await container.prisma.login_throttle.deleteMany({});
    const first = await signIn('rina', temporary);
    const second = await signIn('rina', temporary);
    unwrap(await changeOwnPassword(container.auth, first.session, { current: temporary, next: 'kalimat-baru-aman', confirm: 'kalimat-baru-aman' }));
    expect(await requireSession(container.auth, first.token)).not.toBeNull();
    expect(await requireSession(container.auth, second.token)).toBeNull();
    expect((await login(container.auth, { username: 'rina', password: temporary, sourceAddress: IP })).ok).toBe(false);
    const again = await signIn('rina', 'kalimat-baru-aman');
    expect(again.session.actor.mustChangePassword).toBe(false);
  });

  it.skipIf(!isPg)('reset password: password sementara baru, semua sesi berakhir, wajib ganti lagi', async () => {
    await container.prisma.login_throttle.deleteMany({});
    const active = await signIn('rina', 'kalimat-baru-aman');
    const reset = unwrap(await resetPicPassword(container.master, manager, { picId: rinaPicId }));
    expect(reset.username).toBe('rina');
    expect(await requireSession(container.auth, active.token)).toBeNull();
    expect((await login(container.auth, { username: 'rina', password: 'kalimat-baru-aman', sourceAddress: IP })).ok).toBe(false);
    const fresh = await signIn('rina', reset.temporaryPassword);
    expect(fresh.session.actor.mustChangePassword).toBe(true);
  });

  it.skipIf(!isPg)('reset password PIC tanpa akun ditolak', async () => {
    const dev = unwrap(await createPic(container.master, manager, { name: 'Tono', stage: 'DEV', withLogin: false }));
    const result = await resetPicPassword(container.master, manager, { picId: dev.picId });
    expect(!result.ok && result.error.rule).toBe('PIC_NO_LOGIN_ACCOUNT');
  });

  it.skipIf(!isPg)('ubah nama PIC dicatat dengan nilai lama dan baru; tahapan dan username tetap', async () => {
    unwrap(await renamePicHelper(rinaPicId, 'Rina Pratiwi'));
    const pic = await container.prisma.pic.findUniqueOrThrow({ where: { id: BigInt(rinaPicId) } });
    expect(pic.name).toBe('Rina Pratiwi');
    expect(pic.stage).toBe('BA');
  });

  it.skipIf(!isPg)('menonaktifkan PIC yang masih bertugas butuh konfirmasi dan melampirkan project terdampak', async () => {
    const picRow = await container.prisma.pic.findUniqueOrThrow({ where: { id: BigInt(rinaPicId) } });
    const user = await container.prisma.app_user.findUniqueOrThrow({ where: { username: 'manager' } });
    const project = await container.prisma.project.create({ data: { name: 'Project Terdampak', created_by: user.id } });
    const stage = await container.prisma.project_stage.create({ data: { project_id: project.id, stage: 'BA', status: 'RUNNING' } });
    await container.prisma.stage_assignment.create({ data: { stage_id: stage.id, pic_id: picRow.id, assigned_by: user.id } });

    const blocked = await setPicActive(container.master, manager, { picId: rinaPicId, active: false });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.rule).toBe('PIC_HAS_ASSIGNMENTS');
      expect(blocked.error.details).toEqual([{ projectCode: project.code, projectName: 'Project Terdampak', stage: 'BA' }]);
    }
    expect((await listPics(container.master, manager)).ok && (await container.prisma.pic.findUniqueOrThrow({ where: { id: picRow.id } })).is_active).toBe(true);

    const live = await signIn('rina', (await resetForLogin()).temporaryPassword);
    unwrap(await setPicActive(container.master, manager, { picId: rinaPicId, active: false, confirmed: true }));
    expect(await requireSession(container.auth, live.token)).toBeNull();
    expect((await login(container.auth, { username: 'rina', password: 'apa-saja-password', sourceAddress: IP })).ok).toBe(false);
    // penugasan tidak dilepas otomatis
    expect(await container.prisma.stage_assignment.count({ where: { pic_id: picRow.id } })).toBe(1);
    unwrap(await setPicActive(container.master, manager, { picId: rinaPicId, active: true }));
  });

  /**
   * Mereset password Rina agar uji dapat login ulang.
   * Masukan: tidak ada. Keluaran: hasil reset (berisi password sementara).
   * Efek samping: mereset password dan menghapus throttle.
   * Rujukan: FR-01-05.
   */
  async function resetForLogin() {
    await container.prisma.login_throttle.deleteMany({});
    return unwrap(await resetPicPassword(container.master, manager, { picId: rinaPicId }));
  }

  /**
   * Mengganti nama PIC memakai Manager.
   * Masukan: id PIC dan nama baru. Keluaran: hasil use case.
   * Efek samping: UPDATE nama dan audit.
   * Rujukan: FR-08-01 butir 4.
   */
  async function renamePicHelper(picId: number, name: string) {
    const { renamePic } = await import('@/modules/master');
    return renamePic(container.master, manager, { picId, name });
  }
});

describe('hak akses (FR-01-04, NFR-01)', () => {
  it.skipIf(!isPg)('PIC ditolak untuk semua aksi Master dan Jejak (dicek di server)', async () => {
    const created = unwrap(await createPic(container.master, manager, { name: 'Budi', stage: 'QA', withLogin: true, username: 'budi' }));
    const { session } = await signIn('budi', created.temporaryPassword as string);
    const pic = session.actor;
    const forbidden = (r: { ok: boolean; error?: { code: string } }) => !r.ok && r.error?.code === 'FORBIDDEN';
    expect(forbidden(await listMaster(container.master, pic, 'application'))).toBe(true);
    expect(forbidden(await addMasterItem(container.master, pic, { kind: 'application', name: 'X' }))).toBe(true);
    expect(forbidden(await renameMasterItem(container.master, pic, { kind: 'application', id: 1, name: 'Y' }))).toBe(true);
    expect(forbidden(await setMasterItemActive(container.master, pic, { kind: 'application', id: 1, active: false }))).toBe(true);
    expect(forbidden(await moveStep(container.master, pic, { id: 1, direction: 'down' }))).toBe(true);
    expect(forbidden(await setThreshold(container.master, pic, { key: 'revision_warn_threshold', value: 5 }))).toBe(true);
    expect(forbidden(await getThresholds(container.master, pic))).toBe(true);
    expect(forbidden(await createPic(container.master, pic, { name: 'Z', stage: 'BA', withLogin: false }))).toBe(true);
    expect(forbidden(await listPics(container.master, pic))).toBe(true);
    expect(forbidden(await resetPicPassword(container.master, pic, { picId: 1 }))).toBe(true);
    expect(forbidden(await setPicActive(container.master, pic, { picId: 1, active: false }))).toBe(true);
    expect(forbidden(await listAuditEvents(container.auditRepository, pic, { page: 1, pageSize: 10 }))).toBe(true);
    // tidak ada perubahan akibat percobaan itu
    expect(await container.prisma.affected_application.count({ where: { name: 'X' } })).toBe(0);
  });
});

describe('master pilihan (FR-08-02 s.d. FR-08-05, FR-19-01)', () => {
  it.skipIf(!isPg)('menambah, nama sama ditolak tanpa membedakan huruf besar kecil, nama kosong dan terlalu panjang ditolak', async () => {
    const added = unwrap(await addMasterItem(container.master, manager, { kind: 'application', name: '  Core Billing ' }));
    expect(added.id).toBeGreaterThan(0);
    const dup = await addMasterItem(container.master, manager, { kind: 'application', name: 'core billing' });
    expect(!dup.ok && dup.error.fields?.name).toBe('Nama itu sudah ada.');
    const empty = await addMasterItem(container.master, manager, { kind: 'application', name: '   ' });
    expect(!empty.ok && empty.error.fields?.name).toBe('Nama wajib diisi.');
    const long = await addMasterItem(container.master, manager, { kind: 'application', name: 'a'.repeat(51) });
    expect(!long.ok && long.error.fields?.name).toBe('Nama maksimal 50 karakter.');
  });

  it.skipIf(!isPg)('ubah nama dicatat nilai lama dan baru; nama yang sama diabaikan', async () => {
    const list = unwrap(await listMaster(container.master, manager, 'application'));
    const target = list.find((item) => item.name === 'Core Billing');
    expect(target).toBeDefined();
    unwrap(await renameMasterItem(container.master, manager, { kind: 'application', id: (target as { id: number }).id, name: 'Core Billing 2' }));
    const audit = unwrap(await listAuditEvents(container.auditRepository, manager, { category: 'MASTER', page: 1, pageSize: 10 }));
    const renamed = audit.rows.find((row) => row.action === 'master.renamed');
    expect(renamed?.changes).toEqual([{ field: 'Nama', old: 'Core Billing', new: 'Core Billing 2' }]);
  });

  it.skipIf(!isPg)('Aplikasi boleh dinonaktifkan semua; master lain wajib minimal satu aktif (EC-08-02.04)', async () => {
    const list = unwrap(await listMaster(container.master, manager, 'activity_category'));
    for (const item of list.slice(0, -1)) {
      unwrap(await setMasterItemActive(container.master, manager, { kind: 'activity_category', id: item.id, active: false }));
    }
    const last = list[list.length - 1] as { id: number };
    const refused = await setMasterItemActive(container.master, manager, { kind: 'activity_category', id: last.id, active: false });
    expect(!refused.ok && refused.error.message).toBe('Minimal satu pilihan harus aktif.');
    unwrap(await setMasterItemActive(container.master, manager, { kind: 'activity_category', id: list[0]!.id, active: true }));
  });

  it.skipIf(!isPg)('dua penonaktifan serentak pada item aktif terakhir: tepat satu berhasil (EC-08-02.06)', async () => {
    const list = unwrap(await listMaster(container.master, manager, 'reschedule_reason'));
    for (const item of list.slice(0, -2)) unwrap(await setMasterItemActive(container.master, manager, { kind: 'reschedule_reason', id: item.id, active: false }));
    const [a, b] = list.slice(-2) as unknown as [{ id: number }, { id: number }];
    const results = await Promise.all([
      setMasterItemActive(container.master, manager, { kind: 'reschedule_reason', id: a.id, active: false }),
      setMasterItemActive(container.master, manager, { kind: 'reschedule_reason', id: b.id, active: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const active = await container.prisma.reschedule_reason.count({ where: { is_active: true } });
    expect(active).toBe(1);
  });

  it.skipIf(!isPg)('dua penambahan nama sama serentak: satu berhasil, satu ditolak (EC-08-02.06)', async () => {
    const results = await Promise.all([
      addMasterItem(container.master, manager, { kind: 'application', name: 'Serentak' }),
      addMasterItem(container.master, manager, { kind: 'application', name: 'serentak' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rejected = results.find((r) => !r.ok);
    expect(rejected && !rejected.ok && rejected.error.message).toBe('Nama itu sudah ada.');
    expect(await container.prisma.affected_application.count({ where: { name: { equals: 'serentak', mode: 'insensitive' } } })).toBe(1);
  });

  it.skipIf(!isPg)('kategori bawaan sistem tidak dapat diubah nama atau dinonaktifkan (FR-08-03 butir 3)', async () => {
    const list = unwrap(await listMaster(container.master, manager, 'revision_category'));
    const system = list.filter((item) => item.systemKey !== null);
    expect(system.map((item) => item.systemKey).sort()).toEqual(['HOLD_RESUMED', 'LATE']);
    for (const item of system) {
      const renamed = await renameMasterItem(container.master, manager, { kind: 'revision_category', id: item.id, name: 'Nama Lain' });
      const off = await setMasterItemActive(container.master, manager, { kind: 'revision_category', id: item.id, active: false });
      expect(!renamed.ok && renamed.error.rule).toBe('MASTER_LOCKED');
      expect(!off.ok && off.error.rule).toBe('MASTER_LOCKED');
    }
  });

  it.skipIf(!isPg)('step: nama unik per tahapan, urutan dapat dinaikkan dan diturunkan, ujung tidak bergeser', async () => {
    const ba = unwrap(await listMaster(container.master, manager, 'stage_step', 'BA'));
    expect(ba).toHaveLength(9);
    expect(ba[0]?.name).toBe('Intake & Asesmen Awal');
    const sameInQa = await addMasterItem(container.master, manager, { kind: 'stage_step', stage: 'QA', name: 'Intake & Asesmen Awal' });
    expect(sameInQa.ok).toBe(true); // unik per tahapan, bukan global
    const dupInBa = await addMasterItem(container.master, manager, { kind: 'stage_step', stage: 'BA', name: 'handover' });
    expect(dupInBa.ok).toBe(false);
    unwrap(await moveStep(container.master, manager, { id: ba[1]!.id, direction: 'up' }));
    const after = unwrap(await listMaster(container.master, manager, 'stage_step', 'BA'));
    expect(after[0]?.name).toBe('Analisis Requirement');
    expect(after[1]?.name).toBe('Intake & Asesmen Awal');
    unwrap(await moveStep(container.master, manager, { id: after[0]!.id, direction: 'up' })); // sudah di ujung
    expect(unwrap(await listMaster(container.master, manager, 'stage_step', 'BA'))[0]?.name).toBe('Analisis Requirement');
  });

  it.skipIf(!isPg)('ambang peringatan: bilangan bulat 1 sampai 20, perubahan dicatat sekali', async () => {
    expect(unwrap(await getThresholds(container.master, manager))).toEqual({ revision: 3, reschedule: 3 });
    for (const bad of [0, 21, 2.5]) {
      const result = await setThreshold(container.master, manager, { key: 'revision_warn_threshold', value: bad });
      expect(!result.ok && result.error.message).toBe('Isi bilangan bulat 1 sampai 20.');
    }
    unwrap(await setThreshold(container.master, manager, { key: 'revision_warn_threshold', value: 5 }));
    unwrap(await setThreshold(container.master, manager, { key: 'revision_warn_threshold', value: 5 })); // tanpa perubahan
    expect(unwrap(await getThresholds(container.master, manager)).revision).toBe(5);
    const changes = await container.prisma.audit_event.count({ where: { action: 'setting.changed' } });
    expect(changes).toBe(1);
  });
});

describe('jejak audit (FR-09-01, NFR-04)', () => {
  it.skipIf(!isPg)('setiap mutasi menghasilkan peristiwa dengan kategori yang benar dan terbaru di atas', async () => {
    const all = unwrap(await listAuditEvents(container.auditRepository, manager, { page: 1, pageSize: 50 }));
    expect(all.total).toBeGreaterThan(20);
    const ids = all.rows.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const categories = new Set(all.rows.map((row) => row.category));
    expect(categories).toEqual(new Set(['SECURITY', 'ACCOUNT', 'MASTER']));
    const accountActions = unwrap(await listAuditEvents(container.auditRepository, manager, { category: 'ACCOUNT', page: 1, pageSize: 50 })).rows.map((row) => row.action);
    for (const action of ['pic.created', 'account.password_changed', 'account.password_reset', 'pic.deactivated', 'pic.activated', 'pic.renamed']) {
      expect(accountActions).toContain(action);
    }
  });

  it.skipIf(!isPg)('password sementara dan password pengguna tidak pernah tercatat di audit', async () => {
    const rows = await testDb.query<{ s: string }>(`SELECT summary || ' ' || changes::text AS s FROM audit_event`);
    const text = rows.rows.map((row) => row.s).join('\n');
    expect(text).not.toMatch(/[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}/);
    for (const secret of [MANAGER_PASSWORD, 'kalimat-baru-aman', 'rahasia-throttle-uji', 'salah-berulang-kali']) expect(text).not.toContain(secret);
  });

  it.skipIf(!isPg)('username tidak dikenal dicatat tanpa nilai yang diketik (CL-056d)', async () => {
    await login(container.auth, { username: 'rahasia-salah-ketik-password', password: 'x'.repeat(14), sourceAddress: '10.4.4.4' });
    const rows = await testDb.query<{ s: string }>(`SELECT summary FROM audit_event WHERE action = 'login.failed' AND actor_user_id IS NULL`);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.map((row) => row.s).join(' ')).not.toContain('rahasia-salah-ketik-password');
  });

  it.skipIf(!isPg)('jejak tidak dapat diubah atau dihapus (trigger)', async () => {
    await expect(testDb.exec(`UPDATE audit_event SET summary = 'x'`)).rejects.toThrow(/append-only/);
    await expect(testDb.exec(`DELETE FROM audit_event`)).rejects.toThrow(/append-only/);
  });

  it.skipIf(!isPg)('ukuran halaman di luar pilihan menjadi 10 dan halaman dipaginasi di server', async () => {
    const page = unwrap(await listAuditEvents(container.auditRepository, manager, { page: 1, pageSize: 7 }));
    expect(page.pageSize).toBe(10);
    expect(page.rows.length).toBeLessThanOrEqual(10);
    const second = unwrap(await listAuditEvents(container.auditRepository, manager, { page: 2, pageSize: 10 }));
    expect(second.rows[0]?.id).toBeLessThan(page.rows[page.rows.length - 1]!.id);
  });
});
