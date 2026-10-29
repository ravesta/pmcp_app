import { getHeadDashboard, getPicDashboard, type CapacityMode } from '@/modules/dashboard';
import { getProjectFormOptions } from '@/modules/project';
import { getContainer } from '@/platform/container';
import { weekRange } from '@/shared/calendar';
import { formatDisplayDate } from '@/shared/iso-date';
import { requirePageSession } from '../../_lib/session';
import { HeadView } from './_components/head-view';
import { PicView } from './_components/pic-view';

/**
 * Membaca pilihan periode kapasitas dari parameter alamat (daftar putih).
 * Masukan: parameter `kap` (`minggu` atau `bulan`) dan `geser` (bilangan bulat). Keluaran: mode dan pergeseran.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-07-05, Security Design §7 (input tidak tepercaya).
 */
function readCapacityParams(raw: Record<string, string | string[] | undefined>): { mode: CapacityMode; offset: number } {
  const kap = Array.isArray(raw.kap) ? raw.kap[0] : raw.kap;
  const geser = Array.isArray(raw.geser) ? raw.geser[0] : raw.geser;
  const offset = geser && /^-?\d{1,3}$/.test(geser) ? Number(geser) : 0;
  return { mode: kap === 'bulan' ? 'MONTH' : 'WEEK', offset };
}

/**
 * Dashboard (tab pertama): Dashboard Head BA & QA bagi Manager, Dashboard PIC bagi PIC. Pilihan periode kapasitas
 * berada di alamat sehingga tahan tombol kembali.
 * Masukan: parameter alamat `kap` dan `geser`. Keluaran: halaman dashboard sesuai peran.
 * Efek samping: memvalidasi sesi; hanya membaca data.
 * Rujukan: FR-01-01 butir 6, FR-04, FR-07, BL-43, BL-44.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor } = await requirePageSession();
  const input = readCapacityParams(await searchParams);
  const container = getContainer();
  const today = container.clock.today();
  const hrefFor = (mode: CapacityMode, offset: number) => {
    const query = new URLSearchParams();
    if (mode === 'MONTH') query.set('kap', 'bulan');
    if (offset !== 0) query.set('geser', String(offset));
    const text = query.toString();
    return text ? `/dashboard?${text}` : '/dashboard';
  };
  if (actor.role === 'MANAGER') {
    const data = await getHeadDashboard(container.dashboard, actor, input);
    const week = weekRange(today);
    return <HeadView data={data} today={today} weekLabel={`${formatDisplayDate(week.start).slice(0, 5)} - ${formatDisplayDate(week.end).slice(0, 5)}`} hrefFor={hrefFor} />;
  }
  const raw = await searchParams;
  const showLayers = raw.lapisan !== '0';
  const layersQuery = new URLSearchParams();
  if (input.mode === 'MONTH') layersQuery.set('kap', 'bulan');
  if (input.offset !== 0) layersQuery.set('geser', String(input.offset));
  if (showLayers) layersQuery.set('lapisan', '0');
  const layersHref = layersQuery.toString() ? `/dashboard?${layersQuery.toString()}` : '/dashboard';
  const [data, options] = await Promise.all([getPicDashboard(container.dashboard, actor, input), getProjectFormOptions(container.project)]);
  return <PicView data={data} name={actor.label} today={today} hrefFor={hrefFor} showLayers={showLayers} layersHref={layersHref} editContext={{ options, revisionThreshold: data.revisionThreshold, isManager: false }} />;
}
