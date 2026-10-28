/**
 * Implementasi Prisma untuk rujukan master kanban (baca saja): kategori activity, alasan jadwal ulang, step, batas
 * peringatan jadwal ulang, dan daftar PIC.
 */
import type { PrismaClient } from '@/generated/prisma/client';
import type { StageKind } from '@/modules/project';
import type { KanbanReference } from '../application/ports';

/** Kunci pengaturan batas peringatan jadwal ulang berulang (master, FR-08-05). */
const RESCHEDULE_THRESHOLD_KEY = 'reschedule_warn_threshold';

/**
 * Membuat rujukan master kanban di atas klien Prisma.
 * Masukan: klien Prisma. Keluaran: `KanbanReference`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan hanya membaca tabel master.
 * Rujukan: FR-08-04, FR-08-05, FR-17-01, FR-18-01, FR-21-01, FR-21-03.
 */
export function createPrismaKanbanReference(prisma: PrismaClient): KanbanReference {
  return {
    /** Kategori activity aktif terurut nama. Efek samping: tidak ada (hanya baca). */
    async listActivityCategories() {
      const rows = await prisma.activity_category.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } });
      return rows.map((row) => ({ id: Number(row.id), name: row.name }));
    },

    /** Alasan jadwal ulang aktif terurut nama. Efek samping: tidak ada (hanya baca). */
    async listRescheduleReasons() {
      const rows = await prisma.reschedule_reason.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } });
      return rows.map((row) => ({ id: Number(row.id), name: row.name }));
    },

    /** Step aktif sebuah tahapan menurut urutan. Efek samping: tidak ada (hanya baca). */
    async listActiveSteps(stage) {
      const rows = await prisma.stage_step.findMany({ where: { stage, is_active: true }, orderBy: { sort_order: 'asc' } });
      return rows.map((row) => ({ id: Number(row.id), name: row.name }));
    },

    /** Batas peringatan jadwal ulang; 3 bila baris pengaturan tidak ada. Efek samping: tidak ada (hanya baca). */
    async getRescheduleWarnThreshold() {
      const row = await prisma.app_setting.findUnique({ where: { key: RESCHEDULE_THRESHOLD_KEY } });
      return row?.int_value ?? 3;
    },

    /** Seluruh PIC terurut nama. Efek samping: tidak ada (hanya baca). */
    async listPics() {
      const rows = await prisma.pic.findMany({ orderBy: { name: 'asc' } });
      return rows.map((row) => ({ id: Number(row.id), name: row.name, stage: row.stage as StageKind, isActive: row.is_active }));
    },
  };
}
