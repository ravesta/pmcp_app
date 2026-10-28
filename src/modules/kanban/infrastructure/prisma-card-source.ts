/**
 * Adapter Prisma untuk `CardSourcePort` milik modul project: menyediakan fakta kartu bagi progres tahapan dan syarat
 * Selesai. Dimiliki modul kanban karena kartu adalah datanya; project hanya mengenal port (Technical Design §5.2).
 */
import type { PrismaClient } from '@/generated/prisma/client';
import { cardWeight, type CardSourcePort, type PicCardSummary, type ProgressCard, type StageCardFacts, type StageKind } from '@/modules/project';
import { fromDbDate } from '@/shared/db-date';
import type { IsoDate } from '@/shared/iso-date';
import { roundHalfUp } from '@/shared/rounding';

/**
 * Menghitung progres gabungan sekumpulan kartu (berbobot hari kerja rencana) tanpa batas 99%.
 * Masukan: kartu. Keluaran: persen bulat 0..100.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-05-02 butir 2 (rincian per PIC), BL-40(b).
 */
function combinedProgress(cards: ReadonlyArray<ProgressCard>): number {
  let weighted = 0;
  let total = 0;
  for (const card of cards) {
    const weight = cardWeight(card);
    weighted += card.progress * weight;
    total += weight;
  }
  return total === 0 ? 0 : roundHalfUp(weighted / total);
}

/**
 * Membuat sumber kartu di atas klien Prisma (kartu project yang tidak dibatalkan; menggantikan adapter sementara
 * pada irisan 2).
 * Masukan: klien Prisma. Keluaran: `CardSourcePort`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan hanya membaca tabel `card`.
 * Rujukan: FR-05-01 butir 4, FR-05-02 butir 1 dan 2, BL-40.
 */
export function createPrismaCardSource(prisma: PrismaClient): CardSourcePort {
  return {
    /** Nama pemilik kartu terbuka (belum Done, tidak dibatalkan). Efek samping: tidak ada (hanya baca). */
    async openCardOwners(stage) {
      const rows = await prisma.card.findMany({
        where: {
          kind: 'PROJECT',
          project_id: BigInt(stage.projectId),
          stage: stage.kind,
          cancelled_at: null,
          board_column: { not: 'DONE' },
        },
        select: { pic: { select: { name: true } } },
      });
      return [...new Set(rows.map((row) => row.pic.name))].sort((a, b) => a.localeCompare(b));
    },

    /** Fakta kartu banyak tahapan dalam satu kueri. Efek samping: tidak ada (hanya baca). */
    async cardFacts(stages) {
      const result = new Map<number, StageCardFacts>();
      if (stages.length === 0) return result;
      const rows = await prisma.card.findMany({
        where: {
          kind: 'PROJECT',
          cancelled_at: null,
          // IN pada project (bukan ratusan klausa OR pasangan project-tahapan); pencocokan tahapan dilakukan di bawah
          project_id: { in: [...new Set(stages.map((stage) => BigInt(stage.projectId)))] },
        },
        select: {
          project_id: true,
          stage: true,
          owner_pic_id: true,
          board_column: true,
          progress: true,
          plan_start: true,
          plan_end: true,
          pic: { select: { name: true } },
        },
      });

      for (const stage of stages) {
        const own = rows.filter((row) => Number(row.project_id) === stage.projectId && row.stage === stage.kind);
        const cards: ProgressCard[] = own.map((row) => ({
          progress: row.board_column === 'DONE' ? 100 : row.progress,
          plannedStart: fromDbDate(row.plan_start) as IsoDate,
          plannedEnd: fromDbDate(row.plan_end) as IsoDate,
        }));
        const byPic = new Map<number, { name: string; cards: ProgressCard[] }>();
        own.forEach((row, index) => {
          const picId = Number(row.owner_pic_id);
          const entry = byPic.get(picId) ?? { name: row.pic.name, cards: [] };
          entry.cards.push(cards[index] as ProgressCard);
          byPic.set(picId, entry);
        });
        const perPic: PicCardSummary[] = [...byPic.entries()].map(([picId, entry]) => ({
          picId,
          name: entry.name,
          cardCount: entry.cards.length,
          progress: combinedProgress(entry.cards),
        }));
        result.set(stage.stageId, { cards, perPic, openCount: own.filter((row) => row.board_column !== 'DONE').length });
      }
      return result;
    },
  };
}
