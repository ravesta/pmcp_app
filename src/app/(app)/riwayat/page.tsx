import { getDailyActivity, getDoneStages } from '@/modules/dashboard';
import { getContainer } from '@/platform/container';
import { Card, CardHeader } from '@/ui/components/card';
import { SegmentedLinks } from '@/ui/components/segmented-links';
import { requirePageSession } from '../../_lib/session';
import { DailyActivity } from './_components/daily-activity';
import { DoneStages } from './_components/done-stages';
import { parseRiwayatParams, riwayatHref, shiftDate, type RawSearchParams } from './_lib/search-params';

/**
 * Menu Riwayat dengan dua tab: Tahapan selesai dan Aktivitas harian. PIC hanya melihat miliknya; Manager memilih PIC.
 * Hanya baca; log diubah lewat kartu oleh pemiliknya.
 * Masukan: parameter alamat (tab, filter, mode, tanggal, PIC, halaman). Keluaran: halaman Riwayat.
 * Efek samping: memvalidasi sesi; hanya membaca data.
 * Rujukan: FR-07-08, FR-07-09, BL-46, CL-046, CL-047.
 */
export default async function RiwayatPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requirePageSession();
  const raw = await searchParams;
  const params = parseRiwayatParams(raw);
  const container = getContainer();
  const deps = container.dashboard;
  const today = container.clock.today();
  const isManager = actor.role === 'MANAGER';

  return (
    <Card>
      <CardHeader
        level={1}
        title={isManager ? 'Riwayat' : 'Riwayat saya'}
        subtitle={params.tab === 'tahapan' ? 'Tahapan project yang sudah selesai' : 'Apa saja yang dikerjakan per hari, dari log kartu Kanban'}
        actions={<SegmentedLinks label="Tab Riwayat" active={params.tab} options={[{ key: 'tahapan', label: 'Tahapan selesai', href: '/riwayat?tab=tahapan' }, { key: 'harian', label: 'Aktivitas harian', href: '/riwayat?tab=harian' }]} />}
      />
      {params.tab === 'tahapan' ? (
        <DoneStages
          result={await getDoneStages(deps, actor, { q: params.q, stage: params.stage, period: params.period, picId: params.picId, page: params.page, pageSize: params.pageSize })}
          params={params}
          isManager={isManager}
          hrefFor={(page) => riwayatHref(raw, { hal: page > 1 ? String(page) : null })}
        />
      ) : (
        <DailyActivity
          result={await getDailyActivity(deps, actor, { mode: params.mode, date: params.date, picId: params.picId })}
          params={params}
          isManager={isManager}
          today={today}
          hrefWith={(changes) => riwayatHref(raw, changes)}
          previousDate={shiftDate(params.date ?? today, params.mode, -1)}
          nextDate={shiftDate(params.date ?? today, params.mode, 1)}
        />
      )}
    </Card>
  );
}
