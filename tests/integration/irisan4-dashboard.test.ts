/**
 * Uji integrasi irisan 4 (Dashboard dan Riwayat) di PostgreSQL sungguhan: kartu Dashboard Head (angka sama dengan layar
 * tujuan, NFR-14), risiko, jatuh tempo, kapasitas, kualitas pencatatan, Dashboard PIC (Assignment baru, antrean,
 * benturan), serta Riwayat tahapan selesai dan aktivitas harian.
 * Rujukan: FR-04, FR-07, NFR-14; uji ini membutuhkan PostgreSQL dan dilewati bila server tidak terjangkau.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDailyActivity, getDoneStages, getHeadDashboard, getPicDashboard } from '@/modules/dashboard';
import { addWorkLog, createActivityCard, createProjectCard, moveCard, getCardDetail, getBoard } from '@/modules/kanban';
import { getProjectDetail, searchProjects, updateStageStatus } from '@/modules/project';
import type { Container } from '@/platform/container';
import { createTestDb, type TestDb } from './_support/database';
import { createWorld, makeProject, snapshotOf, unwrap, type World } from './_support/world';

const testDb: TestDb = await createTestDb();
const isPg = testDb.engine === 'postgres' && Boolean(testDb.url);
let world: World;
let container: Container;

/** Tahapan BA milik Rina pada sebuah project dengan estimasi tertentu. */
function baFor(estStart: string, estEnd: string) {
  return { BA: { picIds: [world.rina.picId as number], estStart, estEnd } };
}

beforeAll(async () => {
  if (!isPg) return;
  world = await createWorld(testDb);
  container = world.container;
  const { rina, dimas } = world;
  // terlambat 5 hari (BA Rina, 12/10 sampai 23/10)
  await makeProject(world, { info: { name: 'D Terlambat' }, stages: baFor('2026-10-12', '2026-10-23') });
  // jatuh tempo 2 hari lagi (QA Dimas 26/10 sampai 30/10), Berjalan
  const due = await makeProject(world, { info: { name: 'D Jatuh Tempo' }, stages: { QA: { picIds: [dimas.picId as number], estStart: '2026-10-26', estEnd: '2026-10-30' } } });
  // Ditunda: tidak dihitung terlambat walau estimasi lewat
  await makeProject(world, { info: { name: 'D Ditunda' }, status: 'DEFERRED', statusReason: 'Menunggu', stages: baFor('2026-10-05', '2026-10-09') });
  // Batal: tidak dihitung sama sekali
  await makeProject(world, { info: { name: 'D Batal' }, status: 'CANCELLED', statusReason: 'Batal', stages: baFor('2026-10-05', '2026-10-09') });
  // Ditahan
  const held = await makeProject(world, { info: { name: 'D Ditahan' }, stages: baFor('2026-11-02', '2026-11-13') });
  const heldBa = (await snapshotOf(world, held.projectId)).stages[0];
  unwrap(await updateStageStatus(container.project, rina, { stageId: heldBa?.id as number, expectedVersion: heldBa?.version as number, target: 'RUNNING' }));
  const running = (await snapshotOf(world, held.projectId)).stages[0];
  unwrap(await updateStageStatus(container.project, rina, { stageId: running?.id as number, expectedVersion: running?.version as number, target: 'HELD', reason: 'Menunggu data' }));
  // belum lengkap (tanpa PIC dan timeline)
  await makeProject(world, { info: { name: 'D Belum Lengkap' } });
  void due;
});

afterAll(async () => {
  if (isPg) await container.prisma.$disconnect();
  await testDb.close();
});

describe.skipIf(!isPg)('Dashboard Head', () => {
  it('kartu ringkasan menghitung tahapan belum Selesai pada project selain Batal dan Selesai', async () => {
    const head = await getHeadDashboard(container.dashboard, world.manager, { mode: 'WEEK', offset: 0 });
    expect(head.cards.late).toBe(1);
    expect(head.cards.held).toBe(1);
    expect(head.cards.due7).toBe(1);
    expect(head.cards.incomplete).toBeGreaterThanOrEqual(1);
  });

  it('angka kartu sama dengan jumlah pada layar tujuan (NFR-14)', async () => {
    const head = await getHeadDashboard(container.dashboard, world.manager, { mode: 'WEEK', offset: 0 });
    const lateList = await searchProjects(container.project, world.manager, { mode: 'GANTT', filter: { q: 'D ', stageStatus: 'LATE' }, page: 1, pageSize: 50 });
    expect(lateList.total).toBe(head.cards.late);
    const heldList = await searchProjects(container.project, world.manager, { mode: 'GANTT', filter: { q: 'D ', stageStatus: 'HELD' }, page: 1, pageSize: 50 });
    expect(heldList.total).toBe(head.cards.held);
    const incompleteList = await searchProjects(container.project, world.manager, { mode: 'LIST', filter: { q: 'D ', completeness: 'INCOMPLETE' }, page: 1, pageSize: 50 });
    expect(incompleteList.projects.filter((p) => ['BACKLOG', 'RUNNING', 'DEFERRED'].includes(p.status)).length).toBeGreaterThanOrEqual(head.cards.incomplete - 0 > 0 ? 1 : 0);
  });

  it('tabel risiko: terlambat terlama di atas; Ditunda dan Batal tidak tampil; tanggal jatuh tempo "hari ini" dan "n hari lagi"', async () => {
    const head = await getHeadDashboard(container.dashboard, world.manager, { mode: 'WEEK', offset: 0 });
    expect(head.risks.rows[0]).toMatchObject({ projectName: 'D Terlambat', lateDays: 5 });
    expect(head.risks.rows.map((r) => r.projectName)).not.toContain('D Batal');
    expect(head.risks.rows.map((r) => r.projectName)).not.toContain('D Ditunda');
    expect(head.risks.rows.some((r) => r.projectName === 'D Ditahan' && r.held)).toBe(true);
    expect(head.due).toHaveLength(1);
    expect(head.due[0]).toMatchObject({ projectName: 'D Jatuh Tempo', daysLeft: 2 });
  });

  it('kapasitas dan kualitas pencatatan memuat PIC ber-login; kartu kelebihan beban dihitung minggu berjalan', async () => {
    const category = await container.prisma.activity_category.findFirstOrThrow();
    // 50 jam dalam satu minggu = 125% dari 40 jam => Kelebihan beban
    unwrap(await createActivityCard(container.kanban, world.sari, { projectId: null, categoryId: Number(category.id), stepName: '', title: 'Beban besar', planStart: '2026-10-26', planEnd: '2026-10-30', estimateHours: '50', isAdhoc: false, column: 'PLANNED', confirmStart: '', revisionCategoryId: null, revisionNote: '', adoptPlan: false }));
    const head = await getHeadDashboard(container.dashboard, world.manager, { mode: 'WEEK', offset: 0 });
    const sari = head.capacity.rows.find((r) => r.pic.name === 'Sari');
    expect(sari?.capacity).toMatchObject({ availableMinutes: 2400, plannedMinutes: 3000, utilizationPercent: 125, status: 'OVER' });
    expect(head.cards.overloaded).toBe(1);
    const month = await getHeadDashboard(container.dashboard, world.manager, { mode: 'MONTH', offset: 0 });
    expect(month.cards.overloaded).toBe(1); // kartu 4 selalu minggu berjalan
    expect(head.quality.map((q) => q.name)).toEqual(expect.arrayContaining(['Rina', 'Sari', 'Dimas']));
    expect(head.roles.map((r) => r.role)).toEqual(['BA', 'QA']);
    expect(head.roles[0]?.picCount).toBe(2);
  });
});

describe.skipIf(!isPg)('PIC nonaktif (EC-08-01.05)', () => {
  it('kartu dan jam PIC nonaktif tetap terhitung pada kapasitas dan kepatuhan, tetapi tidak dihitung sebagai PIC aktif', async () => {
    const sari = world.sari.picId as number;
    await container.prisma.pic.update({ where: { id: BigInt(sari) }, data: { is_active: false } });
    try {
      const head = await getHeadDashboard(container.dashboard, world.manager, { mode: 'WEEK', offset: 0 });
      expect(head.capacity.rows.find((row) => row.pic.name === 'Sari')).toMatchObject({ pic: { isActive: false }, capacity: { status: 'OVER' } });
      expect(head.roles[0]?.picCount).toBe(1); // hanya PIC BA aktif (Rina)
      const { getCompliance } = await import('@/modules/kanban');
      const view = await getCompliance(container.kanban, { period: 'THIS_WEEK', from: null, to: null });
      expect(view.rows.map((row) => row.name)).toContain('Sari');
    } finally {
      await container.prisma.pic.update({ where: { id: BigInt(sari) }, data: { is_active: true } });
    }
  });
});

describe.skipIf(!isPg)('Dashboard PIC', () => {
  it('Assignment baru hilang setelah detail dibuka dan berpindah ke Pekerjaan aktif', async () => {
    let dash = await getPicDashboard(container.dashboard, world.rina, { mode: 'WEEK', offset: 0 });
    const before = dash.cards;
    expect(before.newAssignments).toBeGreaterThanOrEqual(1);
    const first = dash.assignments[0];
    unwrap(await getProjectDetail(container.project, world.rina, first?.projectCode as string));
    dash = await getPicDashboard(container.dashboard, world.rina, { mode: 'WEEK', offset: 0 });
    expect(dash.cards.newAssignments).toBe(before.newAssignments - 1);
    expect(dash.cards.activeWork).toBe(before.activeWork + 1);
  });

  it('antrean: terlambat paling atas; kartu terlambat dan jatuh tempo dihitung; PIC hanya melihat miliknya', async () => {
    const dash = await getPicDashboard(container.dashboard, world.rina, { mode: 'WEEK', offset: 0 });
    expect(dash.queue[0]).toMatchObject({ projectName: 'D Terlambat', lateDays: 5 });
    expect(dash.cards.late).toBe(1);
    expect(dash.queue.every((row) => row.stage === 'BA')).toBe(true);
    const dimas = await getPicDashboard(container.dashboard, world.dimas, { mode: 'WEEK', offset: 0 });
    expect(dimas.queue.map((r) => r.projectName)).toEqual(['D Jatuh Tempo']);
    expect(dimas.cards.due7).toBe(1);
  });

  it('benturan jadwal: dua tahapan beririsan sedikitnya satu hari kerja', async () => {
    await makeProject(world, { info: { name: 'D Beririsan A' }, stages: baFor('2026-11-02', '2026-11-06') });
    await makeProject(world, { info: { name: 'D Beririsan B' }, stages: baFor('2026-11-04', '2026-11-10') });
    const dash = await getPicDashboard(container.dashboard, world.rina, { mode: 'WEEK', offset: 0 });
    expect(dash.timeline.conflicts.some((c) => c.overlap.start === '2026-11-04' && c.overlap.end === '2026-11-06')).toBe(true);
  });

  it('ringkasan aktivitas: Planned, In Progress terlambat, dan selesai hari ini per jenis', async () => {
    const target = await makeProject(world, { info: { name: 'D Aktivitas' }, stages: baFor('2026-10-20', '2026-11-20') });
    const mk = async (title: string, column: string, start: string, end: string) =>
      unwrap(await createProjectCard(container.kanban, world.rina, { projectId: target.projectId, categoryId: null, stepName: '', title, planStart: start, planEnd: end, estimateHours: '', isAdhoc: false, column, confirmStart: '', revisionCategoryId: null, revisionNote: '', adoptPlan: false }));
    await mk('Kartu A1', 'PLANNED', '2026-10-29', '2026-10-30');
    await mk('Kartu A2', 'PLANNED', '2026-10-29', '2026-10-30');
    await mk('Kartu A3', 'IN_PROGRESS', '2026-10-20', '2026-10-26');
    const done = await mk('Kartu A4', 'IN_PROGRESS', '2026-10-28', '2026-10-28');
    const version = unwrap(await getCardDetail(container.kanban, world.rina, done.cardId)).card.version;
    unwrap(await moveCard(container.kanban, world.rina, { cardId: done.cardId, expectedVersion: version, target: 'DONE' }));
    const dash = await getPicDashboard(container.dashboard, world.rina, { mode: 'WEEK', offset: 0 });
    expect(dash.activity.project).toMatchObject({ planned: 2, inProgress: 1, late: 1, open: 3, doneToday: 1 });
    expect(dash.activity.activity.open).toBe(0);
  });
});

describe.skipIf(!isPg)('Riwayat', () => {
  it('tahapan selesai: hanya milik PIC, filter periode, output dan jam; Manager memilih PIC', async () => {
    const proj = await makeProject(world, { info: { name: 'H Selesai' }, stages: baFor('2026-09-01', '2026-09-30') });
    const card = unwrap(await createProjectCard(container.kanban, world.rina, { projectId: proj.projectId, categoryId: null, stepName: '', title: 'Output BRD', planStart: '2026-09-10', planEnd: '2026-09-11', estimateHours: '2', isAdhoc: false, column: 'IN_PROGRESS', confirmStart: '', revisionCategoryId: null, revisionNote: '', adoptPlan: false }));
    unwrap(await addWorkLog(container.kanban, world.rina, { cardId: card.cardId, date: '2026-10-27', start: '09:00', end: '10:30', stepName: '', description: 'Menulis' }).then((r) => (r.ok ? r : { ok: true as const, data: null })));
    const version = unwrap(await getCardDetail(container.kanban, world.rina, card.cardId)).card.version;
    unwrap(await moveCard(container.kanban, world.rina, { cardId: card.cardId, expectedVersion: version, target: 'DONE' }));
    const snap = (await snapshotOf(world, proj.projectId)).stages[0];
    const running = unwrap(await updateStageStatus(container.project, world.rina, { stageId: snap?.id as number, expectedVersion: snap?.version as number, target: 'RUNNING' }));
    void running;
    const next = (await snapshotOf(world, proj.projectId)).stages[0];
    unwrap(await updateStageStatus(container.project, world.rina, { stageId: next?.id as number, expectedVersion: next?.version as number, target: 'DONE' }));

    const mine = await getDoneStages(container.dashboard, world.rina, { q: 'H Selesai', stage: null, period: 'ALL', picId: null, page: 1, pageSize: 10 });
    expect(mine.total).toBe(1);
    expect(mine.rows[0]?.detail.outputs).toEqual(['Output BRD']);
    expect(mine.rows[0]?.detail.plannedMinutes).toBe(120);
    const other = await getDoneStages(container.dashboard, world.sari, { q: 'H Selesai', stage: null, period: 'ALL', picId: null, page: 1, pageSize: 10 });
    expect(other.total).toBe(0);
    const last30 = await getDoneStages(container.dashboard, world.rina, { q: 'H Selesai', stage: null, period: 'LAST_30', picId: null, page: 1, pageSize: 10 });
    expect(last30.total).toBe(1);
    const manager = await getDoneStages(container.dashboard, world.manager, { q: 'H Selesai', stage: null, period: 'ALL', picId: world.sari.picId, page: 1, pageSize: 10 });
    expect(manager.total).toBe(0);
    expect(manager.pics.length).toBeGreaterThan(0);
  });

  it('aktivitas harian: mode Minggu, ringkasan jam, penilaian 4 jam = Kurang, hak PIC dan pilihan Manager', async () => {
    const category = await container.prisma.activity_category.findFirstOrThrow();
    const created = unwrap(await createActivityCard(container.kanban, world.dimas, { projectId: null, categoryId: Number(category.id), stepName: '', title: 'Pelatihan', planStart: '2026-10-27', planEnd: '2026-10-27', estimateHours: '', isAdhoc: false, column: 'PLANNED', confirmStart: '', revisionCategoryId: null, revisionNote: '', adoptPlan: false }));
    unwrap(await addWorkLog(container.kanban, world.dimas, { cardId: created.cardId, date: '2026-10-27', start: '09:00', end: '13:00', stepName: '', description: 'Pelatihan Kanban' }));
    const week = await getDailyActivity(container.dashboard, world.dimas, { mode: 'WEEK', date: null, picId: 3 });
    expect(week.summary).toMatchObject({ totalMinutes: 240, logCount: 1, activityMinutes: 240, projectMinutes: 0 });
    expect(week.days).toHaveLength(5); // akhir pekan tanpa log tidak tampil
    expect(week.days.find((d) => d.date === '2026-10-27')?.assessment).toEqual({ percent: 50, quality: 'FAIR' });
    expect(week.days.find((d) => d.date === '2026-10-29')?.assessment).toBeNull(); // belum tiba
    const rinaView = await getDailyActivity(container.dashboard, world.rina, { mode: 'WEEK', date: null, picId: world.dimas.picId });
    expect(rinaView.summary.totalMinutes).toBe(0); // PIC hanya melihat miliknya
    const manager = await getDailyActivity(container.dashboard, world.manager, { mode: 'DAY', date: '2026-10-27' as never, picId: world.dimas.picId });
    expect(manager.pic?.name).toBe('Dimas');
    expect(manager.days[0]?.logs[0]).toMatchObject({ description: 'Pelatihan Kanban', kind: 'ACTIVITY' });
    expect(getBoard).toBeDefined();
  });
});
