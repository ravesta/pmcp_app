/**
 * Query baca project: Daftar, Gantt, Detail, opsi formulir, dan Assignment baru
 * (FR-10-01, FR-10-02, FR-11-01, FR-12-01, FR-12-03, FR-14-02, FR-15-01, FR-07-02).
 *
 * Semua penyaringan dan paging terjadi di server (di SQL), kartu dimuat sekali untuk seluruh tahapan yang tampil
 * (tanpa N+1), dan angka dihitung oleh domain lewat `view-models.ts`.
 */
import type { Actor } from '@/modules/auth';
import { MESSAGES } from '@/platform/messages';
import { fail, ok, type Result } from '@/shared/result';
import type { ProjectStatus, StageActor } from '../domain/stage-types';
import type {
  ApplicationRef,
  NewAssignmentRow,
  PicRef,
  ProjectDeps,
  ProjectFilter,
  RevisionCategoryRef,
  RevisionRow,
  StageRef,
} from './ports';
import { toStageActor } from './support';
import { buildProjectView, type ProjectView, type ViewContext } from './view-models';

/** Ukuran halaman yang diizinkan: Daftar 5, 10, 20 (bawaan 5); Gantt 5, 10, 20, 50 (bawaan 10). */
export const PAGE_SIZES = {
  LIST: { options: [5, 10, 20], default: 5 },
  GANTT: { options: [5, 10, 20, 50], default: 10 },
} as const;

/** Tampilan tab Project. */
export type ProjectViewMode = keyof typeof PAGE_SIZES;

/** Masukan pencarian Daftar atau Gantt. */
export interface SearchProjectsInput {
  readonly mode: ProjectViewMode;
  readonly filter: ProjectFilter;
  readonly page: number;
  readonly pageSize: number;
}

/** Hasil pencarian: project halaman ini, total menurut filter, dan jumlah seluruh project per status. */
export interface SearchProjectsResult {
  readonly projects: ReadonlyArray<ProjectView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Jumlah SELURUH project per status, tidak dipengaruhi filter (FR-14-02 butir 2). */
  readonly statusCounts: Readonly<Record<ProjectStatus, number>>;
  /** Batas peringatan revisi berulang (dipakai dialog Perbarui Tahapan yang dibuka dari bar Gantt). */
  readonly revisionThreshold: number;
}

/**
 * Membangun konteks tampilan (hari ini, batas revisi, pelaku) untuk satu permintaan.
 * Masukan: dependensi dan pelaku. Keluaran: `ViewContext`.
 * Efek samping: membaca satu pengaturan master (batas peringatan revisi).
 * Rujukan: NFR-16 butir 1 ("hari ini" hanya dari `Clock`), FR-13-04.
 */
async function viewContext(deps: ProjectDeps, actor: StageActor): Promise<ViewContext> {
  return { today: deps.clock.today(), revisionThreshold: await deps.reference.getRevisionWarnThreshold(), actor };
}

/**
 * Menghitung id project yang memiliki tahapan "Tertinggal dari laju" (butuh progres dari kartu sehingga tidak
 * dapat disaring langsung di SQL). Hanya tahapan Berjalan pada project Berjalan yang diperiksa.
 * Masukan: dependensi, konteks, dan filter (tahapan dan "hanya milik saya" ikut membatasi). Keluaran: id project.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-05-02 butir 6, BL-40(e), NFR-14 (angka sama dengan layar tujuan).
 */
async function laggingProjectIds(deps: ProjectDeps, ctx: ViewContext, filter: ProjectFilter): Promise<number[]> {
  const candidates = await deps.queries.listRunningStageCandidates();
  const projectIds = [...new Set(candidates.map((c) => c.projectId))];
  const snapshots = await deps.queries.loadSnapshots(projectIds);
  const facts = await deps.cards.cardFacts(candidates.map((c) => c.stage));
  const result: number[] = [];
  for (const snapshot of snapshots) {
    const view = buildProjectView(snapshot, facts, ctx);
    const hit = view.stages.some(
      (stage) =>
        stage.progress.lagging &&
        (filter.stage === undefined || stage.kind === filter.stage) &&
        (filter.mineOnlyPicId === undefined || stage.assignees.some((a) => a.picId === filter.mineOnlyPicId)),
    );
    if (hit) result.push(view.id);
  }
  return result;
}

/**
 * Menormalkan ukuran dan nomor halaman ke nilai yang diizinkan.
 * Masukan: mode tampilan, ukuran dan halaman yang diminta. Keluaran: ukuran dan halaman yang aman.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-12-01 butir 6, FR-10-01, FR-15-01 (ukuran di luar pilihan menjadi bawaan).
 */
export function normalizePaging(mode: ProjectViewMode, pageSize: number, page: number): { pageSize: number; page: number } {
  const config = PAGE_SIZES[mode];
  const allowed = (config.options as ReadonlyArray<number>).includes(pageSize) ? pageSize : config.default;
  return { pageSize: allowed, page: Math.max(1, Math.floor(page) || 1) };
}

/**
 * Mencari project untuk tampilan Daftar atau Gantt dengan satu filter bersama, berhalaman di server.
 * Masukan: dependensi, pelaku, dan `SearchProjectsInput`. Keluaran: project halaman ini lengkap dengan tahapan dan
 * bar, total menurut filter, dan jumlah per status.
 * Aturan: Daftar diurutkan terbaru di atas; Gantt menurut estimasi mulai paling awal (tanpa timeline terakhir);
 * filter "Hanya milik saya" hanya berlaku bagi PIC; filter Tertinggal dihitung dari progres kartu.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: BL-41, FR-10-01, FR-12-01 butir 5 dan 6, FR-12-03, FR-14-02, FR-15-01, NFR-08.
 */
export async function searchProjects(deps: ProjectDeps, actor: Actor, input: SearchProjectsInput): Promise<SearchProjectsResult> {
  const stageActor = toStageActor(actor);
  const ctx = await viewContext(deps, stageActor);
  const paging = normalizePaging(input.mode, input.pageSize, input.page);

  let filter: ProjectFilter = input.filter;
  if (filter.mineOnlyPicId !== undefined && actor.picId !== filter.mineOnlyPicId) filter = { ...filter, mineOnlyPicId: actor.picId ?? undefined };
  if (filter.stageStatus === 'LAGGING') {
    const laggingIds = await laggingProjectIds(deps, ctx, filter);
    const restricted = filter.projectIds ? laggingIds.filter((id) => filter.projectIds?.includes(id)) : laggingIds;
    filter = { ...filter, projectIds: restricted };
  }

  const [found, statusCounts] = await Promise.all([
    deps.queries.searchProjectIds({ filter, order: input.mode === 'GANTT' ? 'START' : 'NEWEST', page: paging.page, pageSize: paging.pageSize, today: ctx.today }),
    deps.queries.countByStatus(),
  ]);
  const snapshots = await deps.queries.loadSnapshots(found.ids);
  const stageRefs: StageRef[] = snapshots.flatMap((p) => p.stages.map((s) => ({ stageId: s.id, projectId: p.id, kind: s.kind })));
  const facts = await deps.cards.cardFacts(stageRefs);
  return {
    projects: snapshots.map((snapshot) => buildProjectView(snapshot, facts, ctx)),
    total: found.total,
    page: paging.page,
    pageSize: paging.pageSize,
    statusCounts,
    revisionThreshold: ctx.revisionThreshold,
  };
}

/** Pilihan untuk formulir project dan dialog tahapan. */
export interface ProjectFormOptions {
  readonly applications: ReadonlyArray<ApplicationRef>;
  readonly pics: ReadonlyArray<PicRef>;
  readonly revisionCategories: ReadonlyArray<RevisionCategoryRef>;
}

/**
 * Membaca pilihan master aktif untuk formulir (aplikasi, PIC, kategori alasan revisi).
 * Masukan: dependensi. Keluaran: `ProjectFormOptions`.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-02-01, FR-02-02, FR-11-02, FR-13-01.
 */
export async function getProjectFormOptions(deps: ProjectDeps): Promise<ProjectFormOptions> {
  const [applications, pics, revisionCategories] = await Promise.all([
    deps.reference.listActiveApplications(),
    deps.reference.listActivePics(),
    deps.reference.listActiveRevisionCategories(),
  ]);
  return { applications, pics, revisionCategories };
}

/** Batas jumlah pilihan "Nama project" pada filter (menjaga ukuran halaman). */
const PROJECT_OPTION_LIMIT = 500;

/**
 * Membaca pilihan "Nama project" untuk bar filter (kode dan nama, terbaru di atas).
 * Masukan: dependensi. Keluaran: daftar pilihan, dibatasi jumlahnya.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: Screen [010] field 2 (Nama project, pilihan ganda dapat dicari), BL-41.
 */
export async function listProjectOptions(deps: ProjectDeps): Promise<Array<{ id: number; code: string; name: string }>> {
  return deps.queries.listProjectOptions(PROJECT_OPTION_LIMIT);
}

/** Detail project: tampilan, riwayat revisi, dan pilihan formulir. */
export interface ProjectDetail {
  readonly project: ProjectView;
  /** Riwayat revisi estimasi per id tahapan, terlama di atas. */
  readonly revisions: ReadonlyMap<number, ReadonlyArray<RevisionRow>>;
  readonly options: ProjectFormOptions;
  readonly revisionThreshold: number;
  /** Manager dan PIC BA/QA dapat mengubah informasi project (FR-11-02). */
  readonly canEditInfo: boolean;
}

/**
 * Membuka Detail Project menurut kode (`PRJ-nnn`). Semua peran dapat membuka semua project. Membuka detail
 * menandai penugasan PIC pada project itu sebagai sudah dilihat (Assignment baru hilang).
 * Masukan: dependensi, pelaku, dan kode project. Keluaran: `ProjectDetail`, atau NOT_FOUND.
 * Efek samping: UPDATE `stage_assignment.seen_at` bagi PIC yang membuka (BL-45); selebihnya hanya baca.
 * Rujukan: FR-11-01, FR-07-02, BL-45, EC-11-01.01.
 */
export async function getProjectDetail(deps: ProjectDeps, actor: Actor, code: string): Promise<Result<ProjectDetail>> {
  const projectId = await deps.queries.findProjectIdByCode(code);
  if (projectId === null) return fail({ code: 'NOT_FOUND', message: MESSAGES.PROJECT_NOT_FOUND });
  if (actor.picId !== null) await deps.queries.markAssignmentsSeen(projectId, actor.picId, deps.clock.now());

  const snapshot = await deps.queries.loadSnapshot(projectId);
  if (!snapshot) return fail({ code: 'NOT_FOUND', message: MESSAGES.PROJECT_NOT_FOUND });
  const stageActor = toStageActor(actor);
  const ctx = await viewContext(deps, stageActor);
  const [facts, revisionRows, options] = await Promise.all([
    deps.cards.cardFacts(snapshot.stages.map((s) => ({ stageId: s.id, projectId, kind: s.kind }))),
    deps.queries.listRevisionsOfProject(projectId),
    getProjectFormOptions(deps),
  ]);
  const revisions = new Map<number, RevisionRow[]>();
  for (const row of revisionRows) revisions.set(row.stageId, [...(revisions.get(row.stageId) ?? []), row]);
  return ok({
    project: buildProjectView(snapshot, facts, ctx),
    revisions,
    options,
    revisionThreshold: ctx.revisionThreshold,
    canEditInfo: stageActor.role === 'MANAGER' || stageActor.picStage !== null,
  });
}

/**
 * Membaca daftar Assignment baru milik PIC yang login (kosong untuk Manager).
 * Masukan: dependensi dan pelaku. Keluaran: daftar Assignment baru, terbaru di atas.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-07-02 butir 2, BL-45.
 */
export async function listNewAssignments(deps: ProjectDeps, actor: Actor): Promise<NewAssignmentRow[]> {
  return actor.picId === null ? [] : deps.queries.listNewAssignments(actor.picId);
}

/**
 * Membaca seluruh project aktif (Backlog, Berjalan, Ditunda; bukan Batal dan Selesai) lengkap dengan tahapan, progres,
 * dan penanda, sebagai dasar hitung Dashboard. Kartu dimuat sekali untuk semua tahapan (tanpa N+1).
 * Masukan: dependensi dan pelaku. Keluaran: daftar `ProjectView` terurut menurut id.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-04-01 (dasar hitung: project selain Batal dan Selesai), FR-07-01, NFR-14 (angka sama dengan layar tujuan).
 */
export async function listActiveProjectViews(deps: ProjectDeps, actor: Actor): Promise<ProjectView[]> {
  const ctx = await viewContext(deps, toStageActor(actor));
  const ids = await deps.queries.listProjectIdsByStatus(['BACKLOG', 'RUNNING', 'DEFERRED']);
  const snapshots = await deps.queries.loadSnapshots(ids);
  const stageRefs: StageRef[] = snapshots.flatMap((p) => p.stages.map((s) => ({ stageId: s.id, projectId: p.id, kind: s.kind })));
  const facts = await deps.cards.cardFacts(stageRefs);
  return snapshots.map((snapshot) => buildProjectView(snapshot, facts, ctx));
}
