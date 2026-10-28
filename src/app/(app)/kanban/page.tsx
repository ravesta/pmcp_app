import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Link from 'next/link';
import { getBoard, getCardDetail, getCardFormOptions, getCompliance, COLUMN_LABEL } from '@/modules/kanban';
import { getContainer } from '@/platform/container';
import { formatDisplayDate } from '@/shared/iso-date';
import { Card, CardHeader } from '@/ui/components/card';
import { LinkButton } from '@/ui/components/link-controls';
import { COLUMN_DESCRIPTION, COLUMN_ORDER } from '@/ui/format/kanban-labels';
import { requirePageSession } from '../../_lib/session';
import { DropColumn } from './_components/board-dnd';
import { CardDialog } from './_components/card-dialog';
import { ComplianceTable } from './_components/compliance-table';
import { CreateCardDialog } from './_components/create-card-dialog';
import { KanbanCard } from './_components/kanban-card';
import { KanbanFilters } from './_components/kanban-filters';
import styles from './_components/kanban.module.css';
import { kanbanHref, parseKanbanParams, type RawSearchParams } from './_lib/search-params';

/**
 * Halaman Kanban (papan tim): tiga kolom (Planned, In Progress, Done) berisi kartu project dan activity, filter periode,
 * PIC, jenis, dan pencarian, kepatuhan rencana per PIC, dan daftar kartu dibatalkan. PIC melihat kartu semua PIC tetapi
 * hanya mengelola kartunya; Manager baca saja. Kartu dan dialog dibuka lewat parameter alamat.
 * Masukan: parameter alamat (periode, pic, jenis, q, perpanjang, kartu, buat, dibuat). Keluaran: papan dan dialog.
 * Efek samping: memvalidasi sesi; hanya membaca data.
 * Rujukan: FR-16-01, FR-16-02, FR-17-03, FR-21-05, BL-29, BL-37, mockup v0.2 (fungsi kanban).
 */
export default async function KanbanPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requirePageSession();
  const raw = await searchParams;
  const params = parseKanbanParams(raw, actor.picId);
  const container = getContainer();
  const deps = container.kanban;
  const today = container.clock.today();

  const [board, compliance, formOptions, detail] = await Promise.all([
    getBoard(deps, actor, params.board),
    getCompliance(deps, { period: params.board.period, from: params.board.from, to: params.board.to }),
    params.create ? getCardFormOptions(deps, actor) : Promise.resolve(null),
    params.openCardId !== null ? getCardDetail(deps, actor, params.openCardId) : Promise.resolve(null),
  ]);

  const total = COLUMN_ORDER.reduce((sum, column) => sum + board.totals[column], 0);
  const closeHref = kanbanHref(raw, { kartu: null, buat: null, dibuat: null });
  const isPic = actor.role === 'PIC';
  const selectedPic = params.board.picId === null ? null : board.pics.find((pic) => pic.id === params.board.picId);

  return (
    <>
      {params.createdCode ? <Alert severity="success" role="status">Kartu {params.createdCode} berhasil dibuat.</Alert> : null}
      <Card>
        <CardHeader
          level={1}
          title="Kanban"
          subtitle={`${formatDisplayDate(board.range.start)} - ${formatDisplayDate(board.range.end)} · ${total} kartu${selectedPic ? ` · ${selectedPic.name}` : ''}${params.board.extendsOnly ? ' · hanya yang memperpanjang estimasi tahapan' : ''}`}
          actions={
            board.canCreate ? (
              <>
                <LinkButton href={kanbanHref(raw, { buat: 'activity' })} variant="outlined">+ Kartu activity</LinkButton>
                <LinkButton href={kanbanHref(raw, { buat: 'project' })} variant="contained">+ Buat kartu</LinkButton>
              </>
            ) : (
              <span className={styles.muted} style={{ fontSize: 12 }}>Hanya PIC yang dapat membuat dan memindahkan kartu</span>
            )
          }
        />
        <KanbanFilters params={params} pics={board.pics} isPic={isPic} />
        <ComplianceTable view={compliance} myPicId={actor.picId} />
        <p className={styles.hint}>Kartu menunjukkan apakah rencana berjalan. Kartu tidak mengubah status tahapan di project. Seret kartu ke kolom lain atau pakai tombol panah.</p>
        <div className={styles.board}>
          {COLUMN_ORDER.map((column) => {
            const cards = board.columns[column];
            return (
              <DropColumn key={column} column={column} label={`Kolom ${COLUMN_LABEL[column]}`}>
                <header className={styles.colHead}>
                  <h3>{COLUMN_LABEL[column]}</h3>
                  <span className={styles.count}>{board.totals[column]}</span>
                  <span className={`${styles.muted} ${styles.small}`}>{COLUMN_DESCRIPTION[column]}</span>
                </header>
                <div className={styles.body}>
                  {cards.length > 0
                    ? cards.map((card) => <KanbanCard key={card.id} card={card} openHref={kanbanHref(raw, { kartu: String(card.id), buat: null })} showOwner={!isPic || card.owner.picId !== actor.picId} />)
                    : <div className={styles.empty}>Belum ada kartu</div>}
                  {board.totals[column] > cards.length ? (
                    <div className={`${styles.small} ${styles.muted}`} role="status">
                      Menampilkan {cards.length} dari {board.totals[column]} kartu.{' '}
                      <Link href={kanbanHref(raw, { batas: String(board.columnLimit + 40) })}>Tampilkan lebih banyak</Link>
                    </div>
                  ) : null}
                </div>
              </DropColumn>
            );
          })}
        </div>
        {board.cancelled.length > 0 ? (
          <details className={styles.details}>
            <summary>Dibatalkan ({board.cancelled.length})</summary>
            <ul className={styles.small}>
              {board.cancelled.map((card) => (
                <li key={card.id}><b>{card.title}</b> · {card.owner.name} · {card.cancelReason} {card.cancelledAt ? <span className={styles.muted}>({formatDisplayDate(card.cancelledAt.toISOString().slice(0, 10) as never)})</span> : null}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      {params.create && formOptions && board.canCreate ? <CreateCardDialog kind={params.create === 'project' ? 'PROJECT' : 'ACTIVITY'} options={formOptions} closeHref={closeHref} today={today} /> : null}
      {detail && detail.ok ? <CardDialog detail={detail.data} closeHref={closeHref} today={today} /> : null}
      {params.openCardId !== null && detail && !detail.ok ? (
        <Box sx={{ position: 'fixed', bottom: 16, left: 16 }}><Alert severity="error" role="alert">{detail.error.message}</Alert></Box>
      ) : null}
    </>
  );
}
