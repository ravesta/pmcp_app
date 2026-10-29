import Link from 'next/link';
import type { CardView } from '@/modules/kanban';
import { ToneChip } from '@/ui/components/tone-chip';
import { formatDateOrDash, formatRange, PROJECT_STATUS_TEXT, projectStatusTone, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import { formatDuration, formatPlanRange, markerChip } from '@/ui/format/kanban-labels';
import { DraggableCard } from './board-dnd';
import styles from './kanban.module.css';
import { MoveButtons } from './move-buttons';

/** Properti kartu pada papan. */
interface KanbanCardProps {
  readonly card: CardView;
  /** Alamat yang membuka rincian kartu (mempertahankan filter). */
  readonly openHref: string;
  /** Menampilkan nama pemilik (Manager atau melihat kartu PIC lain). */
  readonly showOwner: boolean;
}

/**
 * Kartu pada papan Kanban: jenis, project dan tahapan (atau kategori activity), estimasi tahapan, rencana beserta
 * rencana awal bila dijadwal ulang, penanda rencana, progres, waktu tercatat, dan tombol panah bagi pemilik. Judul
 * adalah tautan ke rincian; seluruh kartu dapat diklik lewat tautan itu.
 * Masukan: kartu, alamat rincian, dan penanda tampil pemilik. Keluaran: kartu (dapat diseret bagi pemilik).
 * Efek samping: tidak ada selain render (seret dan tombol ditangani komponen klien).
 * Rujukan: FR-17-03, FR-21-02, FR-16-01 butir 5, mockup v0.2 (kCard).
 */
export function KanbanCard({ card, openHref, showOwner }: KanbanCardProps) {
  const isProject = card.kind === 'PROJECT' && card.project !== null && card.stage !== null;
  return (
    <DraggableCard cardId={card.id} version={card.version} canDrag={card.canManage} tone={isProject && card.stage ? card.stage : 'ACT'}>
      <div className={styles.head}>
        <span className={`${styles.kind} ${isProject ? '' : styles.activity}`}>{isProject ? 'Project' : 'Activity'}</span>
        {card.project ? <ToneChip text={PROJECT_STATUS_TEXT[card.project.status]} tone={projectStatusTone(card.project.status)} /> : <ToneChip text={card.categoryName ?? ''} tone="neutral" />}
      </div>
      <div className={styles.title}><Link href={openHref}>{card.title}</Link></div>
      {isProject && card.project && card.stage ? (
        <>
          <div className={`${styles.small} ${styles.muted}`}>{card.project.code} · {card.project.name}</div>
          <div className={styles.stageLine}>
            <span className={`${styles.stageTag} ${styles[card.stage] ?? ''}`}>{card.stage}</span>
            <span className={styles.small}>{STAGE_FULL_TEXT[card.stage]}{card.stepName ? ` · ${card.stepName}` : ''}</span>
          </div>
          <div className={`${styles.small} ${styles.muted}`}>Estimasi tahapan <span className={styles.mono}>{formatRange(card.stageEstimate, 'belum ada')}</span>{card.stageProgress && card.stageProgress.revisionCount > 0 ? <> <ToneChip text={`R${card.stageProgress.revisionCount}`} tone="rev" /></> : null}</div>
          {card.stageProgress ? (
            <div className={styles.progress} title={`Progres tahapan ${STAGE_FULL_TEXT[card.stage]} (gabungan semua kartu dan PIC)`}>
              <span className={`${styles.small} ${styles.muted}`}>Tahapan</span>
              <div className={styles.bar} role="img" aria-label={`Progres tahapan ${card.stageProgress.percent}%`}><i style={{ width: `${card.stageProgress.percent}%` }} /></div>
              <b className={`${styles.mono} ${styles.small}`}>{card.stageProgress.percent}%{card.stageProgress.manual ? '*' : ''}</b>
              {card.stageProgress.lagging ? <ToneChip text="Tertinggal" tone="warn" /> : null}
            </div>
          ) : null}
        </>
      ) : null}
      <div className={`${styles.mono} ${styles.small}`}>
        Rencana {formatPlanRange(card.planStart, card.planEnd)}
        {card.baseline ? <span className={styles.muted}> (awal {formatPlanRange(card.baseline.start, card.baseline.end)})</span> : null}
        {card.doneOn ? <span className={styles.muted}> · selesai {formatDateOrDash(card.doneOn).slice(0, 5)}</span> : null}
      </div>
      <div className={styles.flags}>
        {card.markers.map((marker, index) => {
          const chip = markerChip(marker);
          return <ToneChip key={`${marker.kind}-${index}`} text={chip.text} tone={chip.tone} />;
        })}
      </div>
      <div className={styles.progress}>
        <span className={`${styles.small} ${styles.muted}`}>Kartu</span>
        <div className={styles.bar} role="img" aria-label={`Progres kartu ${card.progress}%`}><i style={{ width: `${card.progress}%` }} /></div>
        <b className={`${styles.mono} ${styles.small}`}>{card.progress}%</b>
      </div>
      <div className={`${styles.small} ${styles.muted}`}>
        ⏱ {formatDuration(card.loggedMinutes)}{card.estimateMinutes ? ` / ${formatDuration(card.estimateMinutes)}` : ''} · {card.logCount} log{showOwner ? ` · ${card.owner.name}` : ''}
      </div>
      {card.canManage ? <MoveButtons cardId={card.id} version={card.version} column={card.column} /> : null}
    </DraggableCard>
  );
}
