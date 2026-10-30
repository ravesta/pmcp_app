'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createProject,
  STAGE_ORDER,
  updateProjectInfo,
  updateStage,
  type ProjectInfoInput,
  type StageKind,
  type StageStatus,
  type UpdateStageInput,
} from '@/modules/project';
import { getContainer } from '@/platform/container';
import { MESSAGES } from '@/platform/messages';
import { nextStamp, type ActionState } from '../../_lib/action-state';
import { formInteger, formIntegers, formText, toActionState } from '../../_lib/form-data';
import { requirePageSession } from '../../_lib/session';

/** Status tahapan yang diterima dari formulir (divalidasi, bukan dipercaya). */
const STAGE_STATUSES: ReadonlyArray<StageStatus> = ['NOT_STARTED', 'RUNNING', 'HELD', 'DONE'];

/**
 * Membaca atribut project dari formulir (Buat project dan Ubah informasi memakai isian yang sama).
 * Masukan: FormData. Keluaran: `ProjectInfoInput` mentah (belum divalidasi).
 * Efek samping: tidak ada.
 * Rujukan: Screen [013], Screen [015], Security Design §7.
 */
function readProjectInfo(formData: FormData): ProjectInfoInput {
  return {
    name: formText(formData, 'name'),
    referenceNo: formText(formData, 'referenceNo'),
    projectType: formText(formData, 'projectType'),
    businessOwner: formText(formData, 'businessOwner'),
    department: formText(formData, 'department'),
    requestDate: formText(formData, 'requestDate'),
    uatSignOffDate: formText(formData, 'uatSignOffDate'),
    goLiveDate: formText(formData, 'goLiveDate'),
    description: formText(formData, 'description'),
    applicationIds: formIntegers(formData, 'applicationIds'),
  };
}

/**
 * Membaca perencanaan satu tahapan (PIC dan estimasi) dari formulir Buat project.
 * Masukan: FormData dan jenis tahapan. Keluaran: PIC terpilih dan tanggal estimasi mentah.
 * Efek samping: tidak ada.
 * Rujukan: FR-02-02, Screen [013] field 12 dan 13.
 */
function readStagePlan(formData: FormData, kind: StageKind) {
  return { picIds: formIntegers(formData, `pics.${kind}`), estStart: formText(formData, `estStart.${kind}`), estEnd: formText(formData, `estEnd.${kind}`) };
}

/**
 * Aksi Buat project (Manager). Berhasil: kembali ke Daftar Project dengan pesan berhasil.
 * Masukan: state sebelumnya dan FormData (atribut, status, alasan, PIC dan estimasi tiap tahapan). Keluaran: state
 * galat bila gagal; bila berhasil mengarahkan ke Daftar dan tidak kembali.
 * Efek samping: menjalankan `createProject` (menulis project, tahapan, penugasan, dan audit) lalu me-refresh halaman.
 * Hak akses dicek di server oleh use case (hanya Manager).
 * Rujukan: FR-02-01 butir 7, FR-02-02, Screen [013].
 */
export async function createProjectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await createProject(getContainer().project, actor, {
    info: readProjectInfo(formData),
    status: formText(formData, 'status'),
    statusReason: formText(formData, 'statusReason'),
    stages: Object.fromEntries(STAGE_ORDER.map((kind) => [kind, readStagePlan(formData, kind)])),
  });
  if (!result.ok) return toActionState(result, '');
  revalidatePath('/project', 'layout');
  redirect(`/project?v=daftar&dibuat=${encodeURIComponent(result.data.code)}&lengkap=${result.data.planningComplete ? '1' : '0'}`);
}

/**
 * Aksi Ubah informasi dan status project (Manager dan PIC BA/QA).
 * Masukan: state sebelumnya dan FormData (id project, versi, atribut, status, alasan). Keluaran: state hasil.
 * Efek samping: menjalankan `updateProjectInfo` (menulis project dan audit) lalu me-refresh halaman Project.
 * Rujukan: FR-11-02, FR-14-01, Screen [015].
 */
export async function updateProjectInfoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const projectId = formInteger(formData, 'projectId');
  const expectedVersion = formInteger(formData, 'expectedVersion');
  if (projectId === null || expectedVersion === null) return { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  const result = await updateProjectInfo(getContainer().project, actor, {
    projectId,
    expectedVersion,
    info: readProjectInfo(formData),
    status: formText(formData, 'status'),
    statusReason: formText(formData, 'statusReason'),
  });
  revalidatePath('/project', 'layout');
  return toActionState(result, 'Perubahan disimpan.');
}

/**
 * Membandingkan dua daftar id tanpa memperhatikan urutan.
 * Masukan: dua daftar bilangan bulat. Keluaran: true bila isinya sama.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-03-01 (hanya perubahan PIC yang sebenarnya yang disimpan).
 */
function sameIds(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Menyusun bagian perubahan tahapan dari isian dialog dengan membandingkan nilai awal (isian tersembunyi) terhadap
 * nilai yang dikirim, sehingga hanya bagian yang benar-benar berubah yang disimpan.
 * Masukan: FormData dialog Perbarui Tahapan. Keluaran: bagian untuk `updateStage`, atau galat isian (nilai progres
 * bukan bilangan bulat).
 * Efek samping: tidak ada (fungsi murni terhadap FormData). Semua nilai tetap divalidasi ulang oleh use case.
 * Rujukan: Screen [016], FR-03-01, FR-05-01, FR-05-02, FR-13-01, Security Design §7.
 */
function readStageParts(formData: FormData): { parts: Omit<UpdateStageInput, 'stageId' | 'expectedVersion'> } | { error: ActionState } {
  const parts: { -readonly [K in keyof Omit<UpdateStageInput, 'stageId' | 'expectedVersion'>]: Omit<UpdateStageInput, 'stageId' | 'expectedVersion'>[K] } = {};

  const target = formText(formData, 'target') as StageStatus;
  const statusInitial = formText(formData, 'statusInitial');
  const reason = formText(formData, 'reason');
  if (STAGE_STATUSES.includes(target) && (target !== statusInitial || (target === 'HELD' && reason.trim() !== formText(formData, 'holdReasonInitial').trim()))) {
    parts.status = { target, reason, note: formText(formData, 'statusNote') };
  }

  const progressRaw = formText(formData, 'progressValue').trim();
  const progressNote = formText(formData, 'progressNote');
  if (formText(formData, 'reset') === '1' || (progressRaw === '' && formText(formData, 'hasManual') === '1')) {
    parts.progress = { value: null, note: progressNote };
  } else if (progressRaw !== '') {
    const value = formInteger(formData, 'progressValue');
    if (value === null) {
      return { error: { ok: false, message: MESSAGES.MANUAL_PROGRESS_RANGE, fields: { 'progress.value': MESSAGES.MANUAL_PROGRESS_RANGE }, stamp: nextStamp() } };
    }
    if (String(value) !== formText(formData, 'progressInitial')) parts.progress = { value, note: progressNote };
  }

  const picIds = formIntegers(formData, 'picIds');
  const initialPics = formText(formData, 'picIdsInitial').split(',').filter(Boolean).map(Number);
  const picsChanged = formText(formData, 'picsTouched') === '1' && !sameIds(picIds, initialPics);
  const estStart = formText(formData, 'estStart');
  const estEnd = formText(formData, 'estEnd');
  const filled = estStart.trim() !== '' || estEnd.trim() !== '';
  if (picsChanged || filled) parts.planning = { ...(picsChanged ? { picIds } : {}), ...(filled ? { estStart, estEnd } : {}) };

  const newStart = formText(formData, 'newStart');
  const newEnd = formText(formData, 'newEnd');
  if (newStart.trim() !== '' || newEnd.trim() !== '') {
    parts.revision = { newStart, newEnd, categoryId: formInteger(formData, 'categoryId'), note: formText(formData, 'revisionNote') };
  }
  return { parts };
}

/**
 * Aksi dialog Perbarui Tahapan (Screen [016]): satu tombol Simpan yang menyimpan semua bagian yang diubah (PIC dan
 * timeline, revisi estimasi, progres, status) dalam satu transaksi.
 * Masukan: state sebelumnya dan FormData dialog. Keluaran: state hasil dengan pesan ringkas dan saran (revisi setelah
 * hold, batas revisi tercapai).
 * Efek samping: menjalankan `updateStage` (menulis tahapan dan audit; batal seluruhnya bila ada bagian ditolak) lalu
 * me-refresh halaman Project. Hak akses dicek di server oleh tiap bagian.
 * Rujukan: Screen [016], FR-03-01, FR-05-01, FR-05-02, FR-13-01, FR-13-04, NFR-10.
 */
export async function updateStageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const stageId = formInteger(formData, 'stageId');
  const expectedVersion = formInteger(formData, 'expectedVersion');
  if (stageId === null || expectedVersion === null) return { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  const read = readStageParts(formData);
  if ('error' in read) return read.error;

  const result = await updateStage(getContainer().project, actor, { stageId, expectedVersion, ...read.parts });
  revalidatePath('/project', 'layout');
  if (!result.ok) return toActionState(result, '');
  const notes: string[] = [];
  if (result.data.suggestRevision) notes.push('Pertimbangkan merevisi estimasi tahapan karena sempat ditahan.');
  if (result.data.revisionWarning?.justReached) notes.push(`Revisi ${result.data.revisionSeq} disimpan. Tahapan ini sudah mencapai batas peringatan revisi.`);
  return toActionState(result, ['Perubahan disimpan.', ...notes].join(' '));
}
