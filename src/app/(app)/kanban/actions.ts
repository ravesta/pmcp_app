'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addWorkLog,
  cancelCard,
  createActivityCard,
  createProjectCard,
  deleteWorkLog,
  moveCard,
  previewCardPlan,
  rescheduleCard,
  setCardProgress,
  type CreateCardInput,
} from '@/modules/kanban';
import { getContainer } from '@/platform/container';
import { dayOverloadMessage, rescheduleLimitMessage } from '@/platform/messages';
import { isIsoDate } from '@/shared/iso-date';
import { nextStamp, type ActionState } from '../../_lib/action-state';
import { formInteger, formText, toActionState } from '../../_lib/form-data';
import { requirePageSession } from '../../_lib/session';
import { audited } from '../../_lib/denied-access';

/**
 * Menyegarkan halaman yang menampilkan kartu atau estimasi tahapan setelah perubahan.
 * Masukan: tidak ada. Keluaran: tidak ada.
 * Efek samping: menandai halaman Kanban dan Project agar dirender ulang.
 * Rujukan: Technical Design §7 (revalidate halaman terkait).
 */
function refreshPages(): void {
  revalidatePath('/kanban');
  revalidatePath('/project', 'layout');
}

/**
 * Membatasi alamat kembali pada halaman Kanban sendiri (mencegah pengalihan ke alamat luar).
 * Masukan: nilai dari formulir. Keluaran: alamat `/kanban...` tanpa parameter dialog, atau `/kanban`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Security Design §7 (input tidak tepercaya, tanpa open redirect).
 */
function safeReturnTo(value: string): string {
  if (!/^\/kanban(\?[^#\s]*)?$/.test(value)) return '/kanban';
  const query = new URLSearchParams(value.split('?')[1] ?? '');
  query.delete('buat');
  const text = query.toString();
  return text ? `/kanban?${text}` : '/kanban';
}

/**
 * Membaca isian pembuatan kartu dari formulir (kartu project dan activity memakai isian yang sama).
 * Masukan: FormData. Keluaran: `CreateCardInput` mentah (belum divalidasi).
 * Efek samping: tidak ada.
 * Rujukan: FR-17-01, FR-21-01, Security Design §7.
 */
function readCardInput(formData: FormData): CreateCardInput {
  return {
    projectId: formInteger(formData, 'projectId'),
    categoryId: formInteger(formData, 'categoryId'),
    stepName: formText(formData, 'stepName'),
    title: formText(formData, 'title'),
    planStart: formText(formData, 'planStart'),
    planEnd: formText(formData, 'planEnd'),
    estimateHours: formText(formData, 'estimateHours'),
    isAdhoc: formText(formData, 'isAdhoc') === '1',
    column: formText(formData, 'column'),
    confirmStart: formText(formData, 'confirmStart'),
    revisionCategoryId: formInteger(formData, 'revisionCategoryId'),
    revisionNote: formText(formData, 'revisionNote'),
    adoptPlan: formText(formData, 'adoptPlan') === '1',
  };
}

/**
 * Aksi Buat kartu (project atau activity, hanya PIC). Berhasil: kembali ke papan dengan banner berisi kode kartu.
 * Masukan: state sebelumnya dan FormData (jenis, isian kartu, jawaban konfirmasi, kategori dan catatan revisi, alamat
 * kembali). Keluaran: state galat bila gagal; bila berhasil mengarahkan ke papan dan tidak kembali.
 * Efek samping: menjalankan use case pembuatan kartu (kartu, revisi estimasi, status project, audit) lalu me-refresh.
 * Hak akses dicek di server oleh use case.
 * Rujukan: FR-17-01, FR-17-02, FR-21-01, FR-13-05.
 */
export async function createCardAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const input = readCardInput(formData);
  const deps = getContainer().kanban;
  const result = formText(formData, 'kind') === 'ACTIVITY' ? await audited(actor, 'createActivityCard', createActivityCard(deps, actor, input)) : await audited(actor, 'createProjectCard', createProjectCard(deps, actor, input));
  if (!result.ok) return toActionState(result, '');
  refreshPages();
  const base = new URLSearchParams(safeReturnTo(formText(formData, 'returnTo')).split('?')[1] ?? '');
  base.set('dibuat', result.data.code);
  redirect(`/kanban?${base.toString()}`);
}

/**
 * Aksi pratinjau rencana kartu project (dipanggil klien saat project atau tanggal berubah): apakah rencana melewati
 * estimasi tahapan dan apakah status project perlu dikonfirmasi. Tidak menyimpan apa pun.
 * Masukan: id project dan rencana (`YYYY-MM-DD`). Keluaran: ringkasan pratinjau, atau null bila belum dapat dihitung.
 * Efek samping: tidak ada (hanya baca).
 * Rujukan: FR-13-05 butir 2, FR-17-02.
 */
export async function previewCardPlanAction(projectId: number, planStart: string, planEnd: string): Promise<{
  kind: 'NONE' | 'EXTEND' | 'ADOPT';
  from?: string;
  to?: string;
  workdaysOver?: number;
  nextSeq: number;
  needsStatusConfirm: boolean;
} | null> {
  const { actor } = await requirePageSession();
  if (!Number.isInteger(projectId) || !isIsoDate(planStart) || !isIsoDate(planEnd) || planEnd < planStart) return null;
  const result = await previewCardPlan(getContainer().kanban, actor, { projectId, planStart, planEnd });
  if (!result.ok) return null;
  const { revision } = result.data;
  return {
    kind: revision.kind === 'EXTEND' ? 'EXTEND' : revision.kind === 'ADOPT_PLAN_AS_BASELINE' ? 'ADOPT' : 'NONE',
    from: revision.kind === 'EXTEND' ? revision.from : undefined,
    to: revision.kind === 'EXTEND' ? revision.to : undefined,
    workdaysOver: revision.kind === 'EXTEND' ? revision.workdaysOver : undefined,
    nextSeq: result.data.nextSeq,
    needsStatusConfirm: result.data.needsStatusConfirm,
  };
}

/**
 * Aksi pindah kolom kartu (tombol panah atau seret-lepas).
 * Masukan: state sebelumnya dan FormData (cardId, expectedVersion, target). Keluaran: state hasil.
 * Efek samping: menjalankan `moveCard` (kartu, riwayat progres, audit) lalu me-refresh halaman.
 * Rujukan: FR-16-02.
 */
export async function moveCardAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'moveCard', moveCard(getContainer().kanban, actor, {
    cardId: formInteger(formData, 'cardId') ?? 0,
    expectedVersion: formInteger(formData, 'expectedVersion') ?? 0,
    target: formText(formData, 'target'),
  }));
  refreshPages();
  return toActionState(result, 'Kartu dipindahkan.');
}

/**
 * Aksi pilih progres kartu In Progress.
 * Masukan: state sebelumnya dan FormData (cardId, expectedVersion, value). Keluaran: state hasil.
 * Efek samping: menjalankan `setCardProgress` lalu me-refresh halaman.
 * Rujukan: FR-16-03.
 */
export async function setProgressAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'setCardProgress', setCardProgress(getContainer().kanban, actor, {
    cardId: formInteger(formData, 'cardId') ?? 0,
    expectedVersion: formInteger(formData, 'expectedVersion') ?? 0,
    value: formInteger(formData, 'value') ?? -1,
  }));
  refreshPages();
  return toActionState(result, 'Progres disimpan.');
}

/**
 * Aksi jadwal ulang rencana kartu. Pesan berhasil memuat peringatan batas jadwal ulang dan revisi estimasi tahapan.
 * Masukan: state sebelumnya dan FormData (cardId, expectedVersion, rencana baru, alasan, catatan, kategori dan catatan
 * revisi). Keluaran: state hasil.
 * Efek samping: menjalankan `rescheduleCard` (riwayat, rencana, revisi, audit) lalu me-refresh halaman.
 * Rujukan: FR-21-03, FR-13-05.
 */
export async function rescheduleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'rescheduleCard', rescheduleCard(getContainer().kanban, actor, {
    cardId: formInteger(formData, 'cardId') ?? 0,
    expectedVersion: formInteger(formData, 'expectedVersion') ?? 0,
    planStart: formText(formData, 'planStart'),
    planEnd: formText(formData, 'planEnd'),
    reasonId: formInteger(formData, 'reasonId'),
    note: formText(formData, 'note'),
    revisionCategoryId: formInteger(formData, 'revisionCategoryId'),
    revisionNote: formText(formData, 'revisionNote'),
  }));
  if (!result.ok) return toActionState(result, '');
  refreshPages();
  const parts = ['Rencana dijadwal ulang dan dicatat.'];
  if (result.data.warning.reached) parts.push(rescheduleLimitMessage(result.data.warning.count, result.data.warning.threshold));
  if (result.data.revision.kind === 'REVISED') parts.push(`Estimasi tahapan direvisi otomatis (Revisi ${result.data.revision.seq}).`);
  return { ok: true, message: parts.join(' '), stamp: nextStamp() };
}

/**
 * Aksi batalkan kartu.
 * Masukan: state sebelumnya dan FormData (cardId, expectedVersion, reason). Keluaran: state hasil.
 * Efek samping: menjalankan `cancelCard` lalu me-refresh halaman.
 * Rujukan: FR-21-04.
 */
export async function cancelCardAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'cancelCard', cancelCard(getContainer().kanban, actor, {
    cardId: formInteger(formData, 'cardId') ?? 0,
    expectedVersion: formInteger(formData, 'expectedVersion') ?? 0,
    reason: formText(formData, 'reason'),
  }));
  refreshPages();
  return toActionState(result, 'Kartu dibatalkan.');
}

/**
 * Aksi catat log activity. Pesan berhasil memuat peringatan bila total hari melebihi 8 jam.
 * Masukan: state sebelumnya dan FormData (cardId, date, start, end, stepName, description). Keluaran: state hasil.
 * Efek samping: menjalankan `addWorkLog` lalu me-refresh halaman.
 * Rujukan: FR-18-01.
 */
export async function addLogAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'addWorkLog', addWorkLog(getContainer().kanban, actor, {
    cardId: formInteger(formData, 'cardId') ?? 0,
    date: formText(formData, 'date'),
    start: formText(formData, 'start'),
    end: formText(formData, 'end'),
    stepName: formText(formData, 'stepName'),
    description: formText(formData, 'description'),
  }));
  if (!result.ok) return toActionState(result, '');
  refreshPages();
  return { ok: true, message: result.data.overDay ? dayOverloadMessage(result.data.dayMinutes) : 'Log tersimpan.', stamp: nextStamp() };
}

/**
 * Aksi hapus log (log tidak dapat diubah, hanya dihapus pemilik).
 * Masukan: state sebelumnya dan FormData (logId). Keluaran: state hasil.
 * Efek samping: menjalankan `deleteWorkLog` lalu me-refresh halaman.
 * Rujukan: FR-18-01 butir 4.
 */
export async function deleteLogAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const result = await audited(actor, 'deleteWorkLog', deleteWorkLog(getContainer().kanban, actor, { logId: formInteger(formData, 'logId') ?? 0 }));
  refreshPages();
  return toActionState(result, 'Log dihapus.');
}
