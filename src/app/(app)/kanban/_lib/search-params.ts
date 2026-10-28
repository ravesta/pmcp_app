/**
 * Parameter URL halaman Kanban: membaca (dengan daftar putih) keadaan papan dan menyusun alamat turunan.
 *
 * Periode, PIC, jenis, pencarian, dan kartu yang dibuka berada di URL sehingga halaman dirender server dan tahan
 * tombol kembali. Nilai dari URL tidak tepercaya: hanya nilai yang dikenal yang diterima (Security Design §7).
 */
import type { BoardInput, CardKind, PeriodKey } from '@/modules/kanban';
import { isIsoDate } from '@/shared/iso-date';

/** Parameter mentah dari Next.js (`searchParams`). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Keadaan halaman Kanban yang tersimpan di URL. */
export interface KanbanPageParams {
  readonly board: BoardInput;
  /** Pilihan PIC pada filter: `saya`, `semua`, atau id PIC. */
  readonly picChoice: string;
  /** Kartu yang dialognya terbuka (id), atau null. */
  readonly openCardId: number | null;
  /** Dialog Buat kartu yang terbuka, atau null. */
  readonly create: 'project' | 'activity' | null;
  /** Kode kartu yang baru dibuat untuk banner sukses. */
  readonly createdCode: string | null;
}

const PERIODS: Readonly<Record<string, PeriodKey>> = { minggu: 'THIS_WEEK', 'minggu-lalu': 'LAST_WEEK', bulan: 'THIS_MONTH', rentang: 'RANGE' };

/**
 * Mengambil nilai tunggal sebuah parameter (parameter berulang memakai yang pertama).
 * Masukan: parameter mentah dan nama. Keluaran: teks atau undefined.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Security Design §7.
 */
function single(raw: RawSearchParams, name: string): string | undefined {
  const value = raw[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Membaca keadaan halaman Kanban dari parameter URL. PIC melihat kartu miliknya secara bawaan (pilihan `saya`);
 * Manager melihat semua PIC.
 * Masukan: parameter mentah dan id PIC pelaku (null untuk Manager). Keluaran: `KanbanPageParams`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-16-01 butir 4 dan 5 (filter PIC bawaan "Saya"), BL-29.
 */
export function parseKanbanParams(raw: RawSearchParams, actorPicId: number | null): KanbanPageParams {
  const period = PERIODS[single(raw, 'periode') ?? ''] ?? 'THIS_WEEK';
  const from = single(raw, 'dari');
  const to = single(raw, 'sampai');
  const picRaw = single(raw, 'pic') ?? (actorPicId !== null ? 'saya' : 'semua');
  const picChoice = picRaw === 'saya' && actorPicId !== null ? 'saya' : /^\d{1,9}$/.test(picRaw) ? picRaw : 'semua';
  const picId = picChoice === 'saya' ? actorPicId : picChoice === 'semua' ? null : Number(picChoice);
  const kindRaw = single(raw, 'jenis');
  const kind: CardKind | null = kindRaw === 'project' ? 'PROJECT' : kindRaw === 'activity' ? 'ACTIVITY' : null;
  const cardRaw = single(raw, 'kartu');
  const createRaw = single(raw, 'buat');
  const createdRaw = single(raw, 'dibuat');
  return {
    board: {
      period,
      from: from && isIsoDate(from) ? from : null,
      to: to && isIsoDate(to) ? to : null,
      picId,
      kind,
      q: (single(raw, 'q') ?? '').trim().slice(0, 100),
      extendsOnly: single(raw, 'perpanjang') === '1',
      columnLimit: /^\d{2,3}$/.test(single(raw, 'batas') ?? '') ? Number(single(raw, 'batas')) : undefined,
    },
    picChoice,
    openCardId: cardRaw && /^\d{1,9}$/.test(cardRaw) ? Number(cardRaw) : null,
    create: createRaw === 'project' || createRaw === 'activity' ? createRaw : null,
    createdCode: createdRaw && /^KB-\d{5}$/.test(createdRaw) ? createdRaw : null,
  };
}

/**
 * Menyusun alamat Kanban dari parameter sekarang dengan sebagian diganti (nilai null menghapus parameter).
 * Masukan: parameter mentah dan perubahan. Keluaran: alamat relatif `/kanban?...`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-16-01 (filter dipertahankan saat membuka kartu atau dialog).
 */
export function kanbanHref(raw: RawSearchParams, changes: Readonly<Record<string, string | null>> = {}): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text !== undefined && !(name in changes)) query.set(name, text);
  }
  for (const [name, value] of Object.entries(changes)) if (value !== null) query.set(name, value);
  const text = query.toString();
  return text ? `/kanban?${text}` : '/kanban';
}
