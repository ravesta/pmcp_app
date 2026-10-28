'use server';

import { revalidatePath } from 'next/cache';
import {
  addMasterItem,
  createPic,
  moveStep,
  renameMasterItem,
  renamePic,
  resetPicPassword,
  setMasterItemActive,
  setPicActive,
  setThreshold,
  type MasterKind,
  type ThresholdKey,
} from '@/modules/master';
import { getContainer } from '@/platform/container';
import { MESSAGES } from '@/platform/messages';
import { nextStamp, type ActionState } from '../../_lib/action-state';
import { formText as text, toActionState as toState } from '../../_lib/form-data';
import { requirePageSession } from '../../_lib/session';
import { audited } from '../../_lib/denied-access';

/** Jenis master yang diterima dari formulir (divalidasi, bukan dipercaya). */
const KINDS: ReadonlyArray<MasterKind> = ['application', 'revision_category', 'activity_category', 'reschedule_reason', 'stage_step'];

/**
 * Aksi master pilihan: tambah, ubah nama, aktif/nonaktif, naik/turun urutan.
 * Masukan: state sebelumnya dan FormData (intent, kind, id, name, stage, active, direction). Keluaran: state hasil.
 * Efek samping: menjalankan use case master (menulis master dan audit) lalu me-refresh halaman Master.
 * Hak akses dicek di server oleh use case (hanya Manager).
 * Rujukan: FR-08-02, FR-19-01, Screen [003] sampai [007].
 */
export async function masterAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const deps = getContainer().master;
  const kind = text(formData, 'kind') as MasterKind;
  if (!KINDS.includes(kind)) return { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  const id = Number(text(formData, 'id'));
  const stageRaw = text(formData, 'stage');
  const stage = stageRaw === 'BA' || stageRaw === 'QA' ? stageRaw : undefined;
  let state: ActionState;
  switch (text(formData, 'intent')) {
    case 'add':
      state = toState(await audited(actor, 'addMasterItem', addMasterItem(deps, actor, { kind, name: text(formData, 'name'), stage })), 'Ditambahkan.');
      break;
    case 'rename':
      state = toState(await audited(actor, 'renameMasterItem', renameMasterItem(deps, actor, { kind, id, name: text(formData, 'name') })), 'Nama disimpan.');
      break;
    case 'toggle':
      state = toState(await audited(actor, 'setMasterItemActive', setMasterItemActive(deps, actor, { kind, id, active: text(formData, 'active') === 'true' })), 'Status disimpan.');
      break;
    case 'move':
      state = toState(await audited(actor, 'moveStep', moveStep(deps, actor, { id, direction: text(formData, 'direction') === 'up' ? 'up' : 'down' })), 'Urutan disimpan.');
      break;
    default:
      state = { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  }
  revalidatePath('/master', 'layout');
  return state;
}

/**
 * Aksi pengaturan ambang peringatan (revisi atau jadwal ulang).
 * Masukan: state sebelumnya dan FormData (key, value). Keluaran: state hasil.
 * Efek samping: menulis pengaturan dan audit (hanya bila berubah) lalu me-refresh halaman Master.
 * Rujukan: FR-08-03 butir 4, FR-08-05 butir 3.
 */
export async function thresholdAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const key = text(formData, 'key');
  if (key !== 'revision_warn_threshold' && key !== 'reschedule_warn_threshold') return { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  const state = toState(await audited(actor, 'setThreshold', setThreshold(getContainer().master, actor, { key: key as ThresholdKey, value: Number(text(formData, 'value')) })), 'Batas disimpan.');
  revalidatePath('/master', 'layout');
  return state;
}

/**
 * Aksi Master PIC: tambah, ubah nama, aktif/nonaktif (dengan konfirmasi), dan reset password.
 * Masukan: state sebelumnya dan FormData (intent, picId, name, stage, login, username, active, confirmed).
 * Keluaran: state hasil; `data` memuat password sementara (tampil sekali) atau daftar project terdampak.
 * Efek samping: menjalankan use case PIC (menulis PIC, akun, sesi, audit) lalu me-refresh halaman Master.
 * Password sementara hanya ada pada respons ini dan tidak disimpan di tempat lain.
 * Rujukan: FR-08-01, FR-01-05, Screen [008].
 */
export async function picAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requirePageSession();
  const deps = getContainer().master;
  const picId = Number(text(formData, 'picId'));
  let state: ActionState;
  switch (text(formData, 'intent')) {
    case 'create': {
      const result = await audited(actor, 'createPic', createPic(deps, actor, {
        name: text(formData, 'name'),
        stage: text(formData, 'stage'),
        withLogin: text(formData, 'login') === 'ya',
        username: text(formData, 'username'),
      }));
      state = toState(result, 'PIC ditambahkan.', result.ok ? { kind: 'created', ...result.data, name: text(formData, 'name').trim() } : undefined);
      break;
    }
    case 'rename':
      state = toState(await audited(actor, 'renamePic', renamePic(deps, actor, { picId, name: text(formData, 'name') })), 'Nama disimpan.');
      break;
    case 'toggle':
      state = toState(await audited(actor, 'setPicActive', setPicActive(deps, actor, { picId, active: text(formData, 'active') === 'true', confirmed: text(formData, 'confirmed') === 'true' })), 'Status disimpan.');
      break;
    case 'reset': {
      const result = await audited(actor, 'resetPicPassword', resetPicPassword(deps, actor, { picId }));
      state = toState(result, 'Password direset.', result.ok ? { kind: 'reset', ...result.data } : undefined);
      break;
    }
    default:
      state = { ok: false, message: MESSAGES.UNEXPECTED, stamp: nextStamp() };
  }
  revalidatePath('/master', 'layout');
  return state;
}
