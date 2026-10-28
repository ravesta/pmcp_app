/**
 * Uji integrasi irisan 3 (Kanban) di PostgreSQL sungguhan: pembuatan kartu project dan activity, konfirmasi status
 * project, revisi estimasi otomatis (termasuk penggabungan dan konkurensi), perpindahan, progres, jadwal ulang,
 * pembatalan, log activity (bentrok, 8 jam, hak), kepatuhan, rencana kerja dan log pada detail project.
 * Rujukan: FR-13-05, FR-16 sampai FR-18, FR-20, FR-21; BL-24 sampai BL-39.
 *
 * Uji ini membutuhkan PostgreSQL (Prisma tidak berjalan di PGlite); dilewati bila server tidak terjangkau.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addWorkLog,
  cancelCard,
  createActivityCard,
  createProjectCard,
  deleteWorkLog,
  getBoard,
  getCardDetail,
  getCardFormOptions,
  getCompliance,
  listProjectPlans,
  listProjectWorkLogs,
  moveCard,
  previewCardPlan,
  rescheduleCard,
  setCardProgress,
  type CreateCardInput,
} from '@/modules/kanban';
import { getProjectDetail } from '@/modules/project';
import type { Container } from '@/platform/container';
import { createTestDb, type TestDb } from './_support/database';
import { createWorld, makeProject, snapshotOf, unwrap, type World } from './_support/world';

const testDb: TestDb = await createTestDb();
const isPg = testDb.engine === 'postgres' && Boolean(testDb.url);
let world: World;
let container: Container;
let kanban: Container['kanban'];

/** Isian kartu bawaan; uji menimpa bagian yang relevan. */
function cardInput(over: Partial<CreateCardInput> = {}): CreateCardInput {
  return {
    projectId: null,
    categoryId: null,
    stepName: '',
    title: 'Analisis requirement klaim',
    planStart: '2026-10-27',
    planEnd: '2026-10-29',
    estimateHours: '',
    isAdhoc: false,
    column: 'PLANNED',
    confirmStart: '',
    revisionCategoryId: null,
    revisionNote: '',
    adoptPlan: false,
    ...over,
  };
}

/** Membuat project berjalan dengan BA milik Rina, estimasi 26/10 sampai 30/10 (Jumat). */
async function runningProject(name: string): Promise<{ projectId: number; code: string }> {
  return makeProject(world, { info: { name }, stages: { BA: { picIds: [world.rina.picId as number], estStart: '2026-10-26', estEnd: '2026-10-30' } } });
}

/** Membuat kartu project oleh Rina dan mengembalikan hasilnya (gagal uji bila ditolak). */
async function projectCard(projectId: number, over: Partial<CreateCardInput> = {}) {
  return unwrap(await createProjectCard(kanban, world.rina, cardInput({ projectId, ...over })));
}

beforeAll(async () => {
  if (!isPg) return;
  world = await createWorld(testDb);
  container = world.container;
  kanban = container.kanban;
});

afterAll(async () => {
  if (isPg) await container.prisma.$disconnect();
  await testDb.close();
});

describe.skipIf(!isPg)('membuat kartu', () => {
  it('kartu project tersimpan dengan kode KB-nnnnn, rencana awal, dan tampil di Rencana kerja', async () => {
    const { projectId, code } = await runningProject('KB Dasar');
    const created = await projectCard(projectId, { estimateHours: '1,5', stepName: 'Analisis Requirement' });
    expect(created.code).toMatch(/^KB-\d{5}$/);
    expect(created.revision.kind).toBe('NONE');

    const plans = await listProjectPlans(kanban, world.manager, projectId);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ code: created.code, estimateMinutes: 90, column: 'PLANNED', baseline: null, owner: { name: 'Rina' } });
    const history = await container.prisma.audit_event.findFirst({ where: { action: 'card.created', project_code: code } });
    expect(history).not.toBeNull();
  });

  it('menolak: bukan PIC, project tak diikuti, project Batal, step tidak aktif, estimasi 0, judul pendek', async () => {
    const { projectId } = await runningProject('KB Tolak');
    expect((await createProjectCard(kanban, world.manager, cardInput({ projectId }))).ok).toBe(false);
    // Sari bukan PIC tahapan BA project ini
    const notFollowing = await createProjectCard(kanban, world.sari, cardInput({ projectId }));
    expect(notFollowing).toMatchObject({ ok: false, error: { fields: { project: expect.stringContaining('bukan PIC') } } });

    const cancelled = await makeProject(world, { info: { name: 'KB Batal' }, status: 'CANCELLED', statusReason: 'Dibatalkan', stages: { BA: { picIds: [world.rina.picId as number], estStart: '2026-10-26', estEnd: '2026-10-30' } } });
    expect(await createProjectCard(kanban, world.rina, cardInput({ projectId: cancelled.projectId }))).toMatchObject({ ok: false, error: { fields: { project: expect.stringContaining('Batal') } } });

    const bad = await createProjectCard(kanban, world.rina, cardInput({ projectId, stepName: 'Tidak ada', title: 'ab', estimateHours: '0' }));
    expect(bad).toMatchObject({ ok: false, error: { fields: { step: expect.any(String), title: expect.any(String), estimate: expect.any(String) } } });
  });

  it('tahapan Selesai menolak kartu baru', async () => {
    const { projectId } = await runningProject('KB Tahap Selesai');
    const snap = await snapshotOf(world, projectId);
    await container.prisma.project_stage.update({ where: { id: BigInt(snap.stages[0]?.id as number) }, data: { status: 'DONE', actual_start: new Date('2026-10-26T00:00:00Z'), actual_end: new Date('2026-10-27T00:00:00Z') } });
    expect(await createProjectCard(kanban, world.rina, cardInput({ projectId }))).toMatchObject({ ok: false, error: { fields: { project: 'Tahapan ini sudah selesai.' } } });
  });

  it('project Backlog: jawaban wajib; "Ya" mengubah status menjadi Berjalan dan tercatat; "Biarkan" tidak', async () => {
    const backlog = await makeProject(world, { info: { name: 'KB Backlog' }, status: 'BACKLOG', stages: { BA: { picIds: [world.rina.picId as number], estStart: '2026-10-26', estEnd: '2026-10-30' } } });
    expect(await createProjectCard(kanban, world.rina, cardInput({ projectId: backlog.projectId }))).toMatchObject({ ok: false, error: { fields: { statusConfirm: expect.any(String) } } });
    expect((await snapshotOf(world, backlog.projectId)).status).toBe('BACKLOG');

    unwrap(await createProjectCard(kanban, world.rina, cardInput({ projectId: backlog.projectId, confirmStart: 'NO' })));
    expect((await snapshotOf(world, backlog.projectId)).status).toBe('BACKLOG');

    const yes = unwrap(await createProjectCard(kanban, world.rina, cardInput({ projectId: backlog.projectId, confirmStart: 'YES' })));
    expect(yes.projectStarted).toBe(true);
    expect((await snapshotOf(world, backlog.projectId)).status).toBe('RUNNING');
    const audit = await container.prisma.audit_event.findFirst({ where: { action: 'project.status_changed', project_code: backlog.code }, orderBy: { id: 'desc' } });
    expect(audit?.summary).toContain(yes.code);
  });

  it('kartu activity memakai kategori master; tanpa kategori ditolak; log tanpa step', async () => {
    expect(await createActivityCard(kanban, world.rina, cardInput())).toMatchObject({ ok: false, error: { fields: { category: expect.any(String) } } });
    const category = await container.prisma.activity_category.findFirstOrThrow({ where: { name: 'Rapat departemen' } });
    const created = unwrap(await createActivityCard(kanban, world.rina, cardInput({ title: 'Rapat mingguan', categoryId: Number(category.id), isAdhoc: true })));
    const detail = unwrap(await getCardDetail(kanban, world.manager, created.cardId));
    expect(detail.card).toMatchObject({ kind: 'ACTIVITY', categoryName: 'Rapat departemen', isAdhoc: true });
    expect(detail.card.markers.map((m) => m.kind)).toContain('ADHOC');
    const log = await addWorkLog(kanban, world.rina, { cardId: created.cardId, date: '2026-10-28', start: '09:00', end: '10:00', stepName: '', description: 'Rapat' });
    expect(log.ok).toBe(true);
  });

  it('pilihan formulir: hanya project yang diikuti dan belum Batal/Selesai', async () => {
    const options = await getCardFormOptions(kanban, world.rina);
    expect(options.stage).toBe('BA');
    expect(options.projects.every((p) => ['BACKLOG', 'RUNNING', 'DEFERRED'].includes(p.status))).toBe(true);
    expect(options.projects.map((p) => p.name)).not.toContain('KB Batal');
    expect((await getCardFormOptions(kanban, world.manager)).projects).toEqual([]);
  });
});

describe.skipIf(!isPg)('revisi estimasi otomatis (FR-13-05)', () => {
  it('rencana melewati estimasi wajib kategori dan catatan; menyimpan merevisi estimasi dengan kartu asal', async () => {
    const { projectId } = await runningProject('Rev Otomatis');
    const preview = unwrap(await previewCardPlan(kanban, world.rina, { projectId, planStart: '2026-10-27' as never, planEnd: '2026-11-06' as never }));
    expect(preview.revision).toMatchObject({ kind: 'EXTEND', workdaysOver: 5 });
    expect(preview.nextSeq).toBe(1);

    const refused = await createProjectCard(kanban, world.rina, cardInput({ projectId, planEnd: '2026-11-06' }));
    expect(refused).toMatchObject({ ok: false, error: { fields: { 'revision.category': expect.any(String), 'revision.note': expect.any(String) } } });
    expect(await container.prisma.card.count({ where: { project_id: BigInt(projectId) } })).toBe(0); // transaksi batal utuh

    const created = await projectCard(projectId, { planEnd: '2026-11-06', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Scope bertambah' });
    expect(created.revision).toMatchObject({ kind: 'REVISED', seq: 1, merged: false, to: '2026-11-06' });
    const snap = await snapshotOf(world, projectId);
    expect(snap.stages[0]?.estimate).toEqual({ start: '2026-10-26', end: '2026-11-06' });
    expect(snap.stages[0]?.baseline).toEqual({ start: '2026-10-26', end: '2026-10-30' }); // estimasi awal tetap
    const detail = unwrap(await getProjectDetail(container.project, world.manager, snap.code));
    expect(detail.revisions.get(snap.stages[0]?.id as number)?.[0]?.sourceCardCodes).toEqual([created.code]);

    const plans = await listProjectPlans(kanban, world.manager, projectId);
    expect(plans[0]?.markers.map((m) => m.kind)).toContain('EXTENDS_STAGE');
  });

  it('rencana berakhir akhir pekan setelah estimasi Jumat tidak memicu revisi', async () => {
    const { projectId } = await runningProject('Rev Akhir Pekan');
    const created = await projectCard(projectId, { planEnd: '2026-10-31' });
    expect(created.revision.kind).toBe('NONE');
    expect((await snapshotOf(world, projectId)).stages[0]?.estimate?.end).toBe('2026-10-30');
  });

  it('dua perpanjangan PIC yang sama pada hari yang sama digabung menjadi satu revisi', async () => {
    const { projectId } = await runningProject('Rev Gabung');
    const first = await projectCard(projectId, { planEnd: '2026-11-04', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Tambahan pertama' });
    const second = await projectCard(projectId, { title: 'Kartu kedua', planEnd: '2026-11-10', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Tambahan kedua' });
    expect(first.revision).toMatchObject({ seq: 1, merged: false });
    expect(second.revision).toMatchObject({ seq: 1, merged: true, to: '2026-11-10' });
    const snap = await snapshotOf(world, projectId);
    expect(snap.stages[0]?.revisionCount).toBe(1);
    const revisions = await container.project.projects.listRevisions(snap.stages[0]?.id as number);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ next: { end: '2026-11-10' }, previous: { end: '2026-10-30' }, sourceCardCodes: expect.arrayContaining([first.code, second.code]) });
    expect(revisions[0]?.note).toContain('Tambahan pertama');
    expect(revisions[0]?.note).toContain('Tambahan kedua');
  });

  it('konkurensi: dua kartu serentak yang memperpanjang tahapan sama menghasilkan satu revisi tanpa kehilangan data', async () => {
    const { projectId } = await runningProject('Rev Serentak');
    const results = await Promise.all([
      createProjectCard(kanban, world.rina, cardInput({ projectId, title: 'Serentak A', planEnd: '2026-11-05', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Catatan A' })),
      createProjectCard(kanban, world.rina, cardInput({ projectId, title: 'Serentak B', planEnd: '2026-11-12', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Catatan B' })),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const snap = await snapshotOf(world, projectId);
    expect(snap.stages[0]?.revisionCount).toBe(1);
    expect(['2026-11-12']).toContain(snap.stages[0]?.estimate?.end); // yang terpanjang menang (estimasi tidak mengecil)
    // urutan commit bebas: kartu yang berakhir lebih awal hanya ditandai bila tahapan sudah diperpanjang lebih dulu
    const flagged = await container.prisma.card.count({ where: { project_id: BigInt(projectId), extends_stage: true } });
    expect([1, 2]).toContain(flagged);
  });

  it('tahapan tanpa estimasi: rencana dapat dijadikan estimasi awal bila dipilih', async () => {
    const { projectId } = await makeProject(world, { info: { name: 'Rev Tanpa Estimasi' }, stages: { BA: { picIds: [world.rina.picId as number], estStart: '', estEnd: '' } } });
    const kept = await projectCard(projectId, { title: 'Tanpa adopsi' });
    expect(kept.revision.kind).toBe('NONE');
    expect((await snapshotOf(world, projectId)).stages[0]?.estimate).toBeNull();
    const adopted = await projectCard(projectId, { title: 'Dengan adopsi', adoptPlan: true });
    expect(adopted.revision.kind).toBe('ADOPTED');
    expect((await snapshotOf(world, projectId)).stages[0]?.baseline).toEqual({ start: '2026-10-27', end: '2026-10-29' });
  });
});

describe.skipIf(!isPg)('memindahkan, progres, jadwal ulang, pembatalan', () => {
  it('pindah ke Done mengisi tanggal selesai hari ini dan progres 100; kembali meminta progres diisi', async () => {
    const { projectId } = await runningProject('Pindah');
    const { cardId } = await projectCard(projectId, { column: 'IN_PROGRESS' });
    let detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    unwrap(await setCardProgress(kanban, world.rina, { cardId, expectedVersion: detail.card.version, value: 50 }));
    detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(detail.card.progress).toBe(50);
    expect(detail.progressEvents.at(-1)).toMatchObject({ oldValue: 0, newValue: 50 });

    unwrap(await moveCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, target: 'DONE' }));
    detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(detail.card).toMatchObject({ column: 'DONE', progress: 100, doneOn: '2026-10-28' });

    unwrap(await moveCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, target: 'IN_PROGRESS' }));
    detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(detail.card).toMatchObject({ column: 'IN_PROGRESS', progress: 0, doneOn: null });
    expect(detail.card.markers.map((m) => m.kind)).toContain('PROGRESS_NEEDED');
    // progres kartu masuk progres tahapan lewat kartu aktif
    const stage = (await snapshotOf(world, projectId)).stages[0];
    expect(stage?.status).toBe('NOT_STARTED'); // kartu tidak mengubah status tahapan (BL-27)
  });

  it('progres hanya saat In Progress dan hanya 0/25/50/75; kartu Planned menolak', async () => {
    const { projectId } = await runningProject('Progres');
    const { cardId } = await projectCard(projectId);
    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(await setCardProgress(kanban, world.rina, { cardId, expectedVersion: detail.card.version, value: 25 })).toMatchObject({ ok: false });
    unwrap(await moveCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, target: 'IN_PROGRESS' }));
    const next = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(await setCardProgress(kanban, world.rina, { cardId, expectedVersion: next.card.version, value: 60 })).toMatchObject({ ok: false });
    expect((await setCardProgress(kanban, world.rina, { cardId, expectedVersion: next.card.version, value: 75 })).ok).toBe(true);
  });

  it('hak: PIC lain dan Manager hanya baca; versi lama ditolak CONFLICT', async () => {
    const { projectId } = await runningProject('Hak');
    const { cardId } = await projectCard(projectId);
    const detail = unwrap(await getCardDetail(kanban, world.sari, cardId));
    expect(detail.card.canManage).toBe(false);
    expect(await moveCard(kanban, world.sari, { cardId, expectedVersion: detail.card.version, target: 'DONE' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await moveCard(kanban, world.manager, { cardId, expectedVersion: detail.card.version, target: 'DONE' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await cancelCard(kanban, world.manager, { cardId, expectedVersion: detail.card.version, reason: 'x' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await moveCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version + 5, target: 'DONE' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('jadwal ulang: alasan wajib, rencana awal tetap, peringatan pada batas 3, kepatuhan mengikuti rencana terkini', async () => {
    const { projectId } = await runningProject('Jadwal Ulang');
    const { cardId } = await projectCard(projectId);
    const reason = await container.prisma.reschedule_reason.findFirstOrThrow({ where: { name: 'Prioritas berubah' } });
    const reschedule = async (start: string, end: string, reasonId: number | null) => {
      const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
      return rescheduleCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, planStart: start, planEnd: end, reasonId, note: '', revisionCategoryId: null, revisionNote: '' });
    };
    expect(await reschedule('2026-10-28', '2026-10-30', null)).toMatchObject({ ok: false, error: { fields: { reason: expect.any(String) } } });
    expect(await reschedule('2026-10-27', '2026-10-29', Number(reason.id))).toMatchObject({ ok: false, error: { fields: { plan: expect.any(String) } } });

    expect(unwrap(await reschedule('2026-10-28', '2026-10-30', Number(reason.id))).warning.reached).toBe(false);
    expect(unwrap(await reschedule('2026-10-29', '2026-10-30', Number(reason.id))).warning.reached).toBe(false);
    const third = unwrap(await reschedule('2026-10-30', '2026-10-30', Number(reason.id)));
    expect(third.warning).toMatchObject({ reached: true, count: 3, threshold: 3 });

    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(detail.reschedules).toHaveLength(3);
    expect(detail.card).toMatchObject({ planStart: '2026-10-30', baseline: { start: '2026-10-27', end: '2026-10-29' } });
    expect(detail.card.markers).toContainEqual({ kind: 'RESCHEDULED', count: 3, warn: true });
  });

  it('jadwal ulang yang melewati estimasi tahapan memicu revisi otomatis', async () => {
    const { projectId } = await runningProject('Jadwal Ulang Revisi');
    const { cardId } = await projectCard(projectId);
    const reason = await container.prisma.reschedule_reason.findFirstOrThrow();
    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    const refused = await rescheduleCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, planStart: '2026-11-02', planEnd: '2026-11-13', reasonId: Number(reason.id), note: '', revisionCategoryId: null, revisionNote: '' });
    expect(refused).toMatchObject({ ok: false, error: { fields: { 'revision.category': expect.any(String) } } });
    expect(await container.prisma.card_reschedule.count({ where: { card_id: BigInt(cardId) } })).toBe(0); // dibatalkan utuh
    const done = unwrap(await rescheduleCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, planStart: '2026-11-02', planEnd: '2026-11-13', reasonId: Number(reason.id), note: '', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Mundur' }));
    expect(done.revision).toMatchObject({ kind: 'REVISED', to: '2026-11-13' });
    expect((await snapshotOf(world, projectId)).stages[0]?.estimate?.end).toBe('2026-11-13');
  });

  it('pembatalan: alasan wajib, keluar dari papan dan rencana kerja, tampil di daftar Dibatalkan, log tetap', async () => {
    const { projectId } = await runningProject('Batal Kartu');
    const { cardId } = await projectCard(projectId, { title: 'Kartu akan batal' });
    unwrap(await addWorkLog(kanban, world.rina, { cardId, date: '2026-10-27', start: '09:00', end: '10:00', stepName: 'Analisis Requirement', description: 'Awal' }));
    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(await cancelCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, reason: '  ' })).toMatchObject({ ok: false, error: { fields: { reason: expect.any(String) } } });
    unwrap(await cancelCard(kanban, world.rina, { cardId, expectedVersion: detail.card.version, reason: 'Tidak jadi' }));

    const board = await getBoard(kanban, world.manager, { period: 'THIS_WEEK', from: null, to: null, picId: null, kind: null, q: 'Kartu akan batal', extendsOnly: false });
    expect(Object.values(board.columns).flat()).toHaveLength(0);
    expect(board.cancelled.map((c) => c.title)).toContain('Kartu akan batal');
    expect((await listProjectPlans(kanban, world.manager, projectId)).map((c) => c.title)).not.toContain('Kartu akan batal');
    const after = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(after.logs).toHaveLength(1); // log tetap tersimpan
    expect(await addWorkLog(kanban, world.rina, { cardId, date: '2026-10-27', start: '12:00', end: '13:00', stepName: 'Analisis Requirement', description: 'Lagi' })).toMatchObject({ ok: false });
    expect(await moveCard(kanban, world.rina, { cardId, expectedVersion: after.card.version, target: 'DONE' })).toMatchObject({ ok: false });
  });
});

describe.skipIf(!isPg)('papan Kanban (FR-16-01)', () => {
  it('menyaring menurut periode, PIC, jenis, kata kunci, dan hanya kartu pemanjang estimasi', async () => {
    const { projectId } = await runningProject('Papan Filter');
    const planned = await projectCard(projectId, { title: 'Papan planned' });
    const doneCard = await projectCard(projectId, { title: 'Papan done lama', planStart: '2026-09-01', planEnd: '2026-09-04' });
    const version = unwrap(await getCardDetail(kanban, world.rina, doneCard.cardId)).card.version;
    unwrap(await moveCard(kanban, world.rina, { cardId: doneCard.cardId, expectedVersion: version, target: 'DONE' }));
    // kartu Done yang selesai hari ini tetap beririsan periode; kartu rencana September yang Done diselesaikan hari ini tampil
    const extending = await projectCard(projectId, { title: 'Papan pemanjang', planEnd: '2026-11-04', revisionCategoryId: world.revisionCategoryId, revisionNote: 'Perpanjang' });

    const all = await getBoard(kanban, world.rina, { period: 'THIS_WEEK', from: null, to: null, picId: null, kind: null, q: 'Papan', extendsOnly: false });
    expect(all.columns.PLANNED.map((c) => c.code)).toEqual(expect.arrayContaining([planned.code, extending.code]));
    expect(all.columns.DONE.map((c) => c.code)).toContain(doneCard.code);
    expect(all.canCreate).toBe(true);

    const onlyExtending = await getBoard(kanban, world.rina, { period: 'THIS_WEEK', from: null, to: null, picId: null, kind: null, q: 'Papan', extendsOnly: true });
    expect(Object.values(onlyExtending.columns).flat().map((c) => c.code)).toEqual([extending.code]);

    const bySari = await getBoard(kanban, world.rina, { period: 'THIS_WEEK', from: null, to: null, picId: world.sari.picId, kind: null, q: 'Papan', extendsOnly: false });
    expect(Object.values(bySari.columns).flat()).toHaveLength(0);
    const activity = await getBoard(kanban, world.rina, { period: 'THIS_WEEK', from: null, to: null, picId: null, kind: 'ACTIVITY', q: 'Papan', extendsOnly: false });
    expect(Object.values(activity.columns).flat()).toHaveLength(0);

    const manager = await getBoard(kanban, world.manager, { period: 'THIS_WEEK', from: null, to: null, picId: null, kind: null, q: 'Papan planned', extendsOnly: false });
    expect(manager.canCreate).toBe(false);
    expect(manager.columns.PLANNED[0]?.canManage).toBe(false);
  });
});

describe.skipIf(!isPg)('log activity (FR-18-01)', () => {
  let cardId: number;
  beforeAll(async () => {
    if (!isPg) return;
    const { projectId } = await runningProject('Log Project');
    cardId = (await projectCard(projectId, { title: 'Kartu untuk log', column: 'IN_PROGRESS' })).cardId;
  });

  const log = (over: Partial<Parameters<typeof addWorkLog>[2]> = {}, actor = world?.rina) =>
    addWorkLog(kanban, actor, { cardId, date: '2026-10-14', start: '09:00', end: '11:00', stepName: 'Analisis Requirement', description: 'Analisis', ...over });

  it('mencatat log dan menghitung total per step', async () => {
    const saved = unwrap(await log());
    expect(saved).toMatchObject({ dayMinutes: 120, overDay: false });
    unwrap(await log({ start: '11:00', end: '12:00', stepName: 'Dokumentasi Requirement', description: 'Dokumen' })); // berimpit tepat: tidak bentrok
    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    expect(detail.totals).toEqual({ totalMinutes: 180, count: 2, perStep: [{ stepName: 'Dokumentasi Requirement', minutes: 60 }, { stepName: 'Analisis Requirement', minutes: 120 }].sort((a, b) => detail.totals.perStep.findIndex((s) => s.stepName === a.stepName) - detail.totals.perStep.findIndex((s) => s.stepName === b.stepName)) });
    expect(detail.card.loggedMinutes).toBe(180);
  });

  it('menolak bentrok (juga lintas kartu), tanggal esok, jam terbalik, uraian kosong, step tak dikenal', async () => {
    expect(await log({ start: '10:00', end: '12:00' })).toMatchObject({ ok: false, error: { fields: { time: expect.any(String) } } });
    const other = (await projectCard((await runningProject('Log Lain')).projectId, { title: 'Kartu lain' })).cardId;
    expect(await addWorkLog(kanban, world.rina, { cardId: other, date: '2026-10-14', start: '10:30', end: '11:30', stepName: 'Analisis Requirement', description: 'Bentrok lintas kartu' })).toMatchObject({ ok: false, error: { fields: { time: expect.any(String) } } });
    expect(await log({ date: '2026-10-29', start: '13:00', end: '14:00' })).toMatchObject({ ok: false, error: { fields: { date: expect.any(String) } } });
    expect(await log({ start: '15:00', end: '14:00' })).toMatchObject({ ok: false, error: { fields: { time: expect.any(String) } } });
    expect(await log({ start: '13:00', end: '14:00', description: '  ' })).toMatchObject({ ok: false, error: { fields: { description: expect.any(String) } } });
    expect(await log({ start: '13:00', end: '14:00', stepName: 'Tidak ada' })).toMatchObject({ ok: false, error: { fields: { step: expect.any(String) } } });
    expect(await log({ start: '13:00', end: '14:00', stepName: '' })).toMatchObject({ ok: false, error: { fields: { step: expect.any(String) } } });
  });

  it('peringatan (bukan penolakan) bila total hari melebihi 8 jam', async () => {
    const result = unwrap(await log({ date: '2026-10-15', start: '08:00', end: '17:00', description: 'Sehari penuh' }));
    expect(result).toMatchObject({ dayMinutes: 540, overDay: true });
  });

  it('serentak: dua log yang berimpit hanya satu yang tersimpan (trigger database)', async () => {
    const results = await Promise.all([
      log({ date: '2026-10-16', start: '09:00', end: '10:00', description: 'Serentak 1' }),
      log({ date: '2026-10-16', start: '09:30', end: '10:30', description: 'Serentak 2' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await container.prisma.work_log.count({ where: { card_id: BigInt(cardId), work_date: new Date('2026-10-16T00:00:00Z') } })).toBe(1);
  });

  it('hak: hanya pemilik mencatat dan menghapus; log tidak dapat diubah, hanya dihapus', async () => {
    expect(await log({ date: '2026-10-17', start: '09:00', end: '10:00' }, world.sari)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const detail = unwrap(await getCardDetail(kanban, world.rina, cardId));
    const target = detail.logs[0];
    expect(await deleteWorkLog(kanban, world.sari, { logId: target?.id as number })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await deleteWorkLog(kanban, world.manager, { logId: target?.id as number })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect((await deleteWorkLog(kanban, world.rina, { logId: target?.id as number })).ok).toBe(true);
    const audit = await container.prisma.audit_event.findFirst({ where: { action: 'worklog.deleted' } });
    expect(audit).not.toBeNull();
  });

  it('Log activity di detail project: ringkasan per tahapan dan PIC, filter, dan paging', async () => {
    const { projectId } = await runningProject('Log Detail');
    const a = (await projectCard(projectId, { title: 'Log detail A' })).cardId;
    const dimasProject = await makeProject(world, { info: { name: 'Log Detail QA' }, stages: { QA: { picIds: [world.dimas.picId as number], estStart: '2026-10-26', estEnd: '2026-10-30' } } });
    const q = unwrap(await createProjectCard(kanban, world.dimas, cardInput({ projectId: dimasProject.projectId, title: 'Log detail QA' }))).cardId;
    unwrap(await addWorkLog(kanban, world.rina, { cardId: a, date: '2026-10-20', start: '09:00', end: '10:00', stepName: 'Analisis Requirement', description: 'A1' }));
    unwrap(await addWorkLog(kanban, world.dimas, { cardId: q, date: '2026-10-20', start: '09:00', end: '11:00', stepName: 'Test Planning', description: 'Q1' }));

    const page = await listProjectWorkLogs(kanban, projectId, { stage: null, picId: null }, 1, 10);
    expect(page.rows.map((r) => r.description)).toEqual(['A1']);
    const qa = await listProjectWorkLogs(kanban, dimasProject.projectId, { stage: null, picId: world.rina.picId }, 1, 10);
    expect(qa.rows).toHaveLength(0);
    expect(qa.totalMinutes).toBe(120); // ringkasan seluruh project tidak berubah oleh filter
    expect(qa.perPic).toEqual([{ picId: world.dimas.picId, name: 'Dimas', minutes: 120 }]);
    expect(qa.perStage).toEqual([{ stage: 'QA', minutes: 120 }]);
  });
});

describe.skipIf(!isPg)('kepatuhan rencana (FR-21-05)', () => {
  it('menghitung per PIC: tepat waktu, terlambat, lewat belum selesai, belum jatuh tempo, dadakan; terlihat semua pengguna', async () => {
    world.clockState.today = '2026-12-04'; // Jumat; periode uji 01/12 sampai 07/12 tidak tercampur kartu uji lain
    const { projectId } = await makeProject(world, { info: { name: 'Kepatuhan' }, stages: { QA: { picIds: [world.dimas.picId as number], estStart: '2026-11-30', estEnd: '2026-12-18' } } });
    const make = async (title: string, planStart: string, planEnd: string, over: Partial<CreateCardInput> = {}) => unwrap(await createProjectCard(kanban, world.dimas, cardInput({ projectId, title, planStart, planEnd, ...over })));
    const done = async (cardId: number) => {
      const detail = unwrap(await getCardDetail(kanban, world.dimas, cardId));
      unwrap(await moveCard(kanban, world.dimas, { cardId, expectedVersion: detail.card.version, target: 'DONE' }));
    };
    const early = await make('Selesai lebih awal', '2026-12-01', '2026-12-07'); // Done hari ini, rencana selesai belum tiba: belum jatuh tempo
    await done(early.cardId);
    const dueOnTime = await make('Jatuh tempo tepat', '2026-12-01', '2026-12-04');
    await done(dueOnTime.cardId); // Done 04/12 pada rencana selesai 04/12: tepat waktu
    await make('Lewat belum selesai', '2026-12-01', '2026-12-03');
    await make('Dadakan', '2026-12-04', '2026-12-04', { isAdhoc: true });
    const range = { period: 'RANGE' as const, from: '2026-12-01' as never, to: '2026-12-07' as never };
    const view = await getCompliance(kanban, range);
    const row = view.rows.find((r) => r.name === 'Dimas');
    expect(row).toMatchObject({ planned: 3, due: 2, onTime: 1, overdueOpen: 1, notDue: 1, adhoc: 1, percent: 50, stage: 'QA' });
    expect((row?.onTime ?? 0) + (row?.late ?? 0) + (row?.overdueOpen ?? 0) + (row?.notDue ?? 0)).toBe(row?.planned);
    world.clockState.today = '2026-10-28';
  });
});
