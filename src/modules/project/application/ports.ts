/**
 * Port modul project: bentuk data (snapshot), akses data project dan tahapan, rujukan master, dan sumber kartu.
 *
 * `CardSourcePort` adalah titik inversi dependensi yang menghindari siklus project <-> kanban
 * (Technical Design §5.2): project hanya mengenal port ini, adapter-nya dirakit di `platform/container`.
 */
import type { AuditWriter } from '@/shared/audit';
import type { Clock } from '@/shared/clock';
import type { IsoDate } from '@/shared/iso-date';
import type { Transactor, TxContext } from '@/shared/transaction';
import type { ProjectInfo, ProjectType } from '../domain/project-rules';
import type { ProgressCard } from '../domain/stage-progress';
import type { Estimate, ProjectStatus, StageKind, StageStatus } from '../domain/stage-types';

/** PIC yang ditugaskan pada sebuah tahapan. */
export interface Assignee {
  readonly picId: number;
  readonly name: string;
  /** Waktu PIC membuka detail project; null = penanda "Assignment baru" masih aktif (BL-45). */
  readonly seenAt: Date | null;
  readonly assignedAt: Date;
  /** Label pelaku yang menugaskan, untuk daftar Assignment baru. */
  readonly assignedByLabel: string;
}

/** Keadaan satu tahapan seperti tersimpan. */
export interface StageSnapshot {
  readonly id: number;
  readonly projectId: number;
  readonly kind: StageKind;
  readonly status: StageStatus;
  readonly estimate: Estimate | null;
  readonly baseline: Estimate | null;
  readonly actualStart: IsoDate | null;
  readonly actualEnd: IsoDate | null;
  readonly holdSince: IsoDate | null;
  readonly holdReason: string | null;
  /** Id akun pelaku yang memulai hold berjalan. */
  readonly holdBy: number | null;
  readonly manualProgress: number | null;
  readonly manualProgressNote: string | null;
  readonly manualProgressByLabel: string | null;
  /** Id akun dan waktu penyesuaian manual terakhir; dipertahankan saat tahapan disimpan karena hal lain. */
  readonly manualProgressBy: number | null;
  readonly manualProgressAt: Date | null;
  readonly version: number;
  readonly assignees: ReadonlyArray<Assignee>;
  readonly revisionCount: number;
  /** Periode hold yang sudah berakhir. */
  readonly holdHistory: ReadonlyArray<{ readonly since: IsoDate; readonly resumedOn: IsoDate; readonly reason: string }>;
}

/** Aplikasi terdampak pada sebuah project (nama disimpan agar tampil walau master dinonaktifkan). */
export interface ApplicationRef {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
}

/** Keadaan satu project beserta tiga tahapannya (urut BA, DEV, QA). */
export interface ProjectSnapshot {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly referenceNo: string | null;
  readonly projectType: ProjectType | null;
  readonly businessOwner: string | null;
  readonly department: string | null;
  readonly requestDate: IsoDate | null;
  readonly uatSignOffDate: IsoDate | null;
  readonly goLiveDate: IsoDate | null;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly statusReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly applications: ReadonlyArray<ApplicationRef>;
  readonly stages: ReadonlyArray<StageSnapshot>;
}

/** Satu baris riwayat revisi estimasi. */
export interface RevisionRow {
  readonly id: number;
  readonly stageId: number;
  readonly seq: number;
  readonly previous: Estimate;
  readonly next: Estimate;
  readonly categoryName: string;
  readonly note: string;
  readonly createdBy: number;
  readonly createdByLabel: string;
  readonly createdAt: Date;
  /** Tanggal bisnis (zona Asia/Jakarta) revisi dibuat. */
  readonly createdOn: IsoDate;
  /** Kode kartu asal bila revisi otomatis dari rencana kartu; kosong untuk revisi manual. */
  readonly sourceCardCodes: ReadonlyArray<string>;
}

/** Nilai yang ditulis ke tahapan saat disimpan. */
export interface StageWrite {
  readonly status: StageStatus;
  readonly estimate: Estimate | null;
  readonly baseline: Estimate | null;
  readonly actualStart: IsoDate | null;
  readonly actualEnd: IsoDate | null;
  readonly holdSince: IsoDate | null;
  readonly holdReason: string | null;
  readonly holdBy: number | null;
  readonly manualProgress: number | null;
  readonly manualProgressNote: string | null;
  readonly manualProgressBy: number | null;
  readonly manualProgressAt: Date | null;
}

/** Atribut dan status project yang ditulis saat disimpan. */
export interface ProjectWrite {
  readonly info: ProjectInfo;
  readonly status: ProjectStatus;
  readonly statusReason: string | null;
}

/** Penyimpanan perubahan project: nilai tulis ditambah waktu perubahan dari `Clock` (TD-05). */
export interface ProjectSave extends ProjectWrite {
  readonly now: Date;
}

/** Penugasan PIC yang diminta pada satu tahapan. */
export interface AssigneeChange {
  readonly added: ReadonlyArray<number>;
  readonly removed: ReadonlyArray<number>;
}

/** Masukan penambahan revisi estimasi. */
export interface RevisionInsert {
  readonly previous: Estimate;
  readonly next: Estimate;
  readonly categoryName: string;
  readonly note: string;
  readonly createdBy: number;
  readonly sourceCardIds: ReadonlyArray<number>;
  /** Waktu pembuatan dari `Clock` (bukan `now()` database) agar penggabungan harian konsisten dengan "hari ini" (TD-05). */
  readonly now: Date;
}

/** Akses data project dan tahapan. Metode ber-`tx` berjalan di dalam transaksi pemanggil. */
export interface ProjectRepository {
  /** Membuat project beserta tiga tahapan kosong dan aplikasi terdampak. Mengembalikan id, kode, dan id tahapan. */
  createProject(
    tx: TxContext,
    input: ProjectWrite & { readonly createdBy: number },
  ): Promise<{ id: number; code: string; stageIds: Readonly<Record<StageKind, number>> }>;
  /** Mengunci project dan tahapannya (SELECT ... FOR UPDATE) lalu membacanya; null bila tidak ada. */
  lockProject(tx: TxContext, projectId: number): Promise<ProjectSnapshot | null>;
  /** Mencari id project pemilik sebuah tahapan; null bila tahapan tidak ada. */
  findProjectIdOfStage(stageId: number): Promise<number | null>;
  /** Menyimpan atribut, aplikasi, dan status project; false bila `expectedVersion` tidak cocok (CONFLICT). */
  saveProject(tx: TxContext, projectId: number, expectedVersion: number, write: ProjectSave): Promise<boolean>;
  /** Menyimpan keadaan tahapan; false bila `expectedVersion` tidak cocok (CONFLICT). */
  saveStage(tx: TxContext, stageId: number, expectedVersion: number, write: StageWrite): Promise<boolean>;
  /**
   * Mengganti penugasan PIC tahapan. PIC baru diberi penanda "Assignment baru" kecuali PIC itu menugaskan dirinya
   * sendiri atau tahapan Development (BL-45). Mengembalikan PIC yang ditambah dan dilepas.
   */
  replaceAssignees(
    tx: TxContext,
    stage: { id: number; kind: StageKind },
    picIds: ReadonlyArray<number>,
    context: { assignedBy: number; selfPicId: number | null; now: Date },
  ): Promise<AssigneeChange>;
  /** Menambah satu periode hold yang sudah berakhir ke riwayat. */
  appendHoldHistory(
    tx: TxContext,
    stageId: number,
    row: { since: IsoDate; resumedOn: IsoDate; reason: string; heldBy: number; resumedBy: number },
  ): Promise<void>;
  /** Revisi terakhir tahapan (untuk keputusan penggabungan), atau null. */
  lastRevision(tx: TxContext, stageId: number): Promise<RevisionRow | null>;
  /** Menambah revisi bernomor berikutnya beserta kartu asal. Mengembalikan nomor revisi. */
  appendRevision(tx: TxContext, stageId: number, revision: RevisionInsert): Promise<number>;
  /**
   * Menggabungkan perpanjangan otomatis baru ke revisi yang ada: estimasi baru, kategori, catatan gabungan, dan
   * kartu asal bertambah; nomor revisi tidak bertambah (FR-13-05 butir 3).
   */
  mergeRevision(
    tx: TxContext,
    revisionId: number,
    update: { readonly next: Estimate; readonly categoryName: string; readonly note: string; readonly sourceCardIds: ReadonlyArray<number>; readonly now: Date },
  ): Promise<void>;
  /** Membaca seluruh revisi tahapan, terlama di atas. */
  listRevisions(stageId: number): Promise<RevisionRow[]>;
}

/** PIC sebagai rujukan validasi penugasan. */
export interface PicRef {
  readonly id: number;
  readonly name: string;
  readonly stage: StageKind;
  readonly isActive: boolean;
}

/** Kategori alasan revisi sebagai rujukan. */
export interface RevisionCategoryRef {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
}

/** Rujukan data master (baca saja) yang dibutuhkan project. */
export interface ReferencePort {
  getPics(ids: ReadonlyArray<number>): Promise<PicRef[]>;
  getApplications(ids: ReadonlyArray<number>): Promise<ApplicationRef[]>;
  getRevisionCategory(id: number): Promise<RevisionCategoryRef | null>;
  /** Batas peringatan revisi berulang (master, awal 3). */
  getRevisionWarnThreshold(): Promise<number>;
  /** Aplikasi aktif untuk pilihan pada formulir project (FR-08-02). */
  listActiveApplications(): Promise<ApplicationRef[]>;
  /** PIC aktif untuk pilihan penugasan tahapan (hanya yang sesuai tahapan dipakai UI). */
  listActivePics(): Promise<PicRef[]>;
  /** Kategori alasan revisi aktif untuk dialog revisi (FR-08-03). */
  listActiveRevisionCategories(): Promise<RevisionCategoryRef[]>;
}

/** Rujukan tahapan untuk mencari kartunya (kartu terhubung lewat project dan jenis tahapan). */
export interface StageRef {
  readonly stageId: number;
  readonly projectId: number;
  readonly kind: StageKind;
}

/** Rincian kartu aktif per PIC pada sebuah tahapan (FR-05-02 butir 2). */
export interface PicCardSummary {
  readonly picId: number;
  readonly name: string;
  readonly cardCount: number;
  /** Progres gabungan kartu PIC itu (berbobot hari kerja), 0..100. */
  readonly progress: number;
}

/** Fakta kartu sebuah tahapan. */
export interface StageCardFacts {
  /** Kartu aktif (tidak dibatalkan) untuk hitungan progres. */
  readonly cards: ReadonlyArray<ProgressCard>;
  readonly perPic: ReadonlyArray<PicCardSummary>;
  /** Jumlah kartu terbuka (belum Done dan tidak dibatalkan). */
  readonly openCount: number;
}

/** Sumber data kartu bagi project (diimplementasikan adapter di luar modul project). */
export interface CardSourcePort {
  /** Nama pemilik kartu terbuka pada tahapan (tanpa duplikat), untuk syarat Selesai. */
  openCardOwners(stage: StageRef): Promise<string[]>;
  /** Fakta kartu untuk banyak tahapan sekaligus (tanpa N+1), kunci = id tahapan. */
  cardFacts(stages: ReadonlyArray<StageRef>): Promise<Map<number, StageCardFacts>>;
}

/** Ketergantungan yang disuntikkan ke use case project. */
export interface ProjectDeps {
  readonly clock: Clock;
  readonly transactor: Transactor;
  readonly projects: ProjectRepository;
  readonly queries: ProjectQueryRepository;
  readonly reference: ReferencePort;
  readonly cards: CardSourcePort;
  readonly writeAudit: AuditWriter;
}

/** Status tahapan yang dapat dipilih pada filter (Screen [010] field 6). */
export type StageStatusFilter = 'ALL' | 'OPEN' | 'RUNNING' | 'LATE' | 'LAGGING' | 'HELD' | 'DONE';

/** Filter bersama Daftar dan Gantt (BL-41, Screen [010]). */
export interface ProjectFilter {
  /** Kata kunci: ID, nama, no. referensi, aplikasi, atau nama PIC. */
  readonly q?: string;
  readonly status?: ProjectStatus;
  /** Menyaring PROJECT yang melibatkan PIC ini; tahapan PIC lain tetap tampil (FR-12-03). */
  readonly picId?: number;
  readonly stage?: StageKind;
  readonly stageStatus?: StageStatusFilter;
  readonly projectType?: ProjectType;
  readonly completeness?: 'COMPLETE' | 'INCOMPLETE' | 'NO_PIC' | 'NO_TIMELINE';
  /** "Hanya milik saya": menyaring tahapan milik PIC ini. */
  readonly mineOnlyPicId?: number;
  /** Pembatasan id project (dipakai filter turunan seperti Tertinggal). */
  readonly projectIds?: ReadonlyArray<number>;
}

/** Permintaan pencarian project berhalaman di server. */
export interface ProjectSearch {
  readonly filter: ProjectFilter;
  /** START = estimasi mulai paling awal (Gantt, project tanpa timeline terakhir); NEWEST = terbaru di atas (Daftar). */
  readonly order: 'START' | 'NEWEST';
  readonly page: number;
  readonly pageSize: number;
  readonly today: IsoDate;
}

/** Baris daftar Assignment baru bagi seorang PIC (FR-07-02). */
export interface NewAssignmentRow {
  readonly projectId: number;
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageKind;
  readonly estimate: Estimate | null;
  readonly assignedByLabel: string;
  readonly assignedAt: Date;
}

/** Akses baca project untuk Daftar, Gantt, Detail, dan Assignment baru. */
export interface ProjectQueryRepository {
  /** Mencari id project menurut filter, urutan, dan halaman; total mengikuti filter. */
  searchProjectIds(search: ProjectSearch): Promise<{ ids: number[]; total: number }>;
  /** Jumlah SELURUH project per status, tidak dipengaruhi filter lain (FR-14-02). */
  countByStatus(): Promise<Record<ProjectStatus, number>>;
  /** Snapshot banyak project sekaligus, urutan sesuai `ids`. */
  loadSnapshots(ids: ReadonlyArray<number>): Promise<ProjectSnapshot[]>;
  /** Snapshot satu project; null bila tidak ada. */
  loadSnapshot(id: number): Promise<ProjectSnapshot | null>;
  /** Id project menurut kode `PRJ-nnn`; null bila tidak ada. */
  findProjectIdByCode(code: string): Promise<number | null>;
  /** Tahapan Berjalan pada project Berjalan, calon penanda Tertinggal (dihitung di domain). */
  listRunningStageCandidates(): Promise<Array<{ projectId: number; stage: StageRef }>>;
  /** Id seluruh project dengan status tertentu (dasar Dashboard: project selain Batal dan Selesai). */
  listProjectIdsByStatus(statuses: ReadonlyArray<ProjectStatus>): Promise<number[]>;
  /** Seluruh revisi estimasi semua tahapan sebuah project, terlama di atas. */
  listRevisionsOfProject(projectId: number): Promise<RevisionRow[]>;
  /** Daftar Assignment baru (belum dilihat) milik PIC. */
  listNewAssignments(picId: number): Promise<NewAssignmentRow[]>;
  /** Pilihan "Nama project" untuk filter: id, kode, dan nama, terbaru di atas (dibatasi jumlahnya). */
  listProjectOptions(limit: number): Promise<Array<{ id: number; code: string; name: string }>>;
  /** Menandai seluruh penugasan PIC pada project itu sebagai sudah dilihat; mengembalikan jumlah yang berubah. */
  markAssignmentsSeen(projectId: number, picId: number, now: Date): Promise<number>;
}
