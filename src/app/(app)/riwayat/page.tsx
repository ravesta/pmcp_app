import { getDailyActivity, getDoneStages } from '@/modules/dashboard';
import { getContainer } from '@/platform/container';
import { Card, CardHeader } from '@/ui/components/card';
import { AutoSubmitForm } from '@/ui/components/auto-submit-form';
import { PlainSelect } from '@/ui/components/plain-field';
import { SegmentedLinks } from '@/ui/components/segmented-links';
import { requirePageSession } from '../../_lib/session';
import { DailyActivity } from './_components/daily-activity';
import { DoneStages } from './_components/done-stages';
import { parseRiwayatParams, riwayatHref, shiftDate, type RawSearchParams } from './_lib/search-params';

/**
 * Menu Riwayat dengan dua tab: Tahapan selesai dan Aktivitas harian. PIC hanya melihat miliknya; Manager memilih PIC
 * lewat dropdown di samping tab (berlaku langsung, seperti mockup v0.2).
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
  const tahapan = params.tab === 'tahapan' ? await getDoneStages(deps, actor, { q: params.q, stage: params.stage, period: params.period, picId: params.picId, page: params.page, pageSize: params.pageSize }) : null;
  const harian = params.tab === 'harian' ? await getDailyActivity(deps, actor, { mode: params.mode, date: params.date, picId: params.picId }) : null;

  return (
    <Card>
      <CardHeader
        level={1}
        title={isManager ? 'Riwayat' : 'Riwayat saya'}
        subtitle={params.tab === 'tahapan' ? 'Tahapan project yang sudah selesai' : 'Apa saja yang dikerjakan per hari, dari log kartu Kanban'}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
        <SegmentedLinks label="Bagian riwayat" active={params.tab} options={[{ key: 'tahapan', label: 'Tahapan selesai', href: '/riwayat?tab=tahapan' }, { key: 'harian', label: 'Aktivitas harian', href: '/riwayat?tab=harian' }]} />
        {isManager ? (
          <AutoSubmitForm action="/riwayat" label="Pilih PIC" style={{ minWidth: 200 }}>
            {Object.entries(raw).flatMap(([name, value]) => {
              const text = Array.isArray(value) ? value[0] : value;
              return name === 'pic' || name === 'hal' || text === undefined ? [] : [<input key={name} type="hidden" name={name} value={text} />];
            })}
            <PlainSelect id="riwayat-pic" name="pic" label="PIC" emptyLabel={params.tab === 'tahapan' ? 'Semua PIC' : null} defaultValue={String(params.tab === 'tahapan' ? (tahapan?.picId ?? '') : (harian?.pic?.id ?? ''))} options={(tahapan?.pics ?? harian?.pics ?? []).map((pic) => ({ value: String(pic.id), label: `${pic.name} (${pic.stage})` }))} />
          </AutoSubmitForm>
        ) : null}
      </div>
      {tahapan ? (
        <DoneStages
          result={tahapan}
          params={params}
          isManager={isManager}
          hrefFor={(page) => riwayatHref(raw, { hal: page > 1 ? String(page) : null })}
        />
      ) : harian ? (
        <DailyActivity
          result={harian}
          params={params}
          isManager={isManager}
          today={today}
          hrefWith={(changes) => riwayatHref(raw, changes)}
          previousDate={shiftDate(params.date ?? today, params.mode, -1)}
          nextDate={shiftDate(params.date ?? today, params.mode, 1)}
        />
      ) : null}
    </Card>
  );
}
