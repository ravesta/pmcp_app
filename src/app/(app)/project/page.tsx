import Alert from '@mui/material/Alert';
import { can } from '@/modules/auth';
import { getProjectFormOptions, listProjectOptions, PAGE_SIZES, searchProjects, type ProjectStatus } from '@/modules/project';
import { getContainer } from '@/platform/container';
import { Card, CardHeader } from '@/ui/components/card';
import { EmptyState } from '@/ui/components/empty-state';
import { FilterBar } from '@/ui/components/filter-bar';
import { LinkButton } from '@/ui/components/link-controls';
import { PaginationBar } from '@/ui/components/pagination-bar';
import { SegmentedLinks } from '@/ui/components/segmented-links';
import { StatusStrip } from '@/ui/components/status-strip';
import { PROJECT_STATUS_ORDER, PROJECT_STATUS_TEXT } from '@/ui/format/project-labels';
import { buildTimeline, defaultWindow, monthLabel, shiftMonthKey, type Zoom } from '@/ui/gantt/timeline';
import { requirePageSession } from '../../_lib/session';
import { GanttChart } from './_components/gantt-chart';
import { GanttLegend } from './_components/gantt-legend';
import { PeriodPicker, ProjectAdvancedFilters, ProjectPrimaryFilters } from './_components/project-filter-fields';
import { ProjectListTable } from './_components/project-list-table';
import { advancedFilterCount, buildActiveFilters } from './_lib/active-filters';
import { activeFilterCount, buildProjectHref, parseProjectParams, type RawSearchParams } from './_lib/search-params';

/** Warna titik tiap status pada strip ringkasan (token mockup). */
const STATUS_DOT: Readonly<Record<ProjectStatus, string>> = {
  BACKLOG: 'var(--bk)',
  RUNNING: 'var(--run)',
  DEFERRED: 'var(--warn)',
  CANCELLED: 'var(--cancel)',
  COMPLETED: 'var(--ok)',
};

/** Nama zoom untuk kontrol skala waktu. */
const ZOOM_OPTIONS: ReadonlyArray<{ key: Zoom; label: string }> = [
  { key: 'DAY', label: 'Hari' },
  { key: 'WEEK', label: 'Minggu' },
  { key: 'MONTH', label: 'Bulan' },
];

/**
 * Tab Project (Screen [010]) seperti mockup v0.2: strip status project, kartu Project dengan pilihan tampilan Daftar
 * atau Gantt, skala waktu, satu bar filter bersama (dengan periode dan filter lanjutan), isi tampilan, pagination, dan
 * legenda. Semua keadaan berada di URL; penyaringan dan paging dilakukan di server.
 * Masukan: parameter URL. Keluaran: halaman Project.
 * Efek samping: memvalidasi sesi dan membaca project (hanya baca).
 * Rujukan: BL-41, FR-10-01, FR-10-02, FR-12-01, FR-14-02, FR-15-01, NFR-08.
 */
export default async function ProjectPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { actor } = await requirePageSession();
  const container = getContainer();
  const today = container.clock.today();
  const raw = await searchParams;
  const params = parseProjectParams(raw, actor.picId, today);
  const [result, options, projectOptions] = await Promise.all([
    searchProjects(container.project, actor, { mode: params.mode, filter: params.filter, page: params.page, pageSize: params.pageSize }),
    getProjectFormOptions(container.project),
    listProjectOptions(container.project),
  ]);

  const defaults = defaultWindow(today);
  const hrefFor = (overrides: Parameters<typeof buildProjectHref>[1]): string => buildProjectHref(params, overrides, defaults);
  const filterCount = activeFilterCount(params);
  const resetHref = hrefFor({ filter: {}, mineOnly: false, page: 1 });
  const isGantt = params.mode === 'GANTT';
  const createdCode = typeof raw.dibuat === 'string' && /^PRJ-\d+$/.test(raw.dibuat) ? raw.dibuat : null;
  const totalProjects = Object.values(result.statusCounts).reduce((sum, value) => sum + value, 0);

  const preserve: Record<string, string> = {};
  if (!isGantt) preserve.v = 'daftar';
  else {
    if (params.zoom !== 'WEEK') preserve.zoom = params.zoom;
    if (params.window.from !== defaults.from || params.window.to !== defaults.to) {
      preserve.dari = params.window.from;
      preserve.sampai = params.window.to;
    }
    if (!params.showLayers) preserve.lapisan = '0';
  }

  const shifted = (months: number) => ({ from: shiftMonthKey(params.window.from, months), to: shiftMonthKey(params.window.to, months) });
  const subtitle = (
    <>
      {isGantt ? `${monthLabel(params.window.from)} - ${monthLabel(params.window.to)} · ${result.total} project` : `${result.total} dari ${totalProjects} project`}
      {filterCount > 0 ? ` · ${filterCount} filter aktif` : ''}
    </>
  );

  return (
    <>
      {createdCode ? (
        <Alert severity="success" role="status">
          Project {createdCode} berhasil dibuat.
          {raw.lengkap === '0' ? ' Perencanaan belum lengkap: cari project ini lewat filter Kelengkapan perencanaan untuk melengkapi PIC dan timeline.' : ''}
        </Alert>
      ) : null}

      <StatusStrip
        title="Status project"
        active={params.filter.status ?? 'ALL'}
        hint="Klik untuk menyaring"
        options={[
          { key: 'ALL', label: 'Semua', count: totalProjects, href: hrefFor({ filter: { ...params.filter, status: undefined }, page: 1 }) },
          ...PROJECT_STATUS_ORDER.map((status) => ({
            key: status,
            label: PROJECT_STATUS_TEXT[status],
            count: result.statusCounts[status],
            dotColor: STATUS_DOT[status],
            href: hrefFor({ filter: { ...params.filter, status: params.filter.status === status ? undefined : status }, page: 1 }),
          })),
        ]}
      />

      <Card>
        <CardHeader
          title="Project"
          subtitle={subtitle}
          actions={
            <>
              <SegmentedLinks
                label="Tampilan project"
                active={isGantt ? 'GANTT' : 'LIST'}
                options={[
                  { key: 'LIST', label: 'Daftar', href: hrefFor({ mode: 'LIST', page: 1, pageSize: 0 }) },
                  { key: 'GANTT', label: 'Gantt', href: hrefFor({ mode: 'GANTT', page: 1, pageSize: 0 }) },
                ]}
              />
              {isGantt ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Skala waktu</span>
                  <SegmentedLinks label="Skala waktu" active={params.zoom} options={ZOOM_OPTIONS.map((zoom) => ({ key: zoom.key, label: zoom.label, href: hrefFor({ zoom: zoom.key }) }))} />
                </>
              ) : null}
              {can(actor, 'project.create') ? <LinkButton href="/project/baru" variant="contained">+ Buat project</LinkButton> : null}
            </>
          }
        />

        <FilterBar
          action="/project"
          preserve={preserve}
          resetHref={resetHref}
          advancedActiveCount={advancedFilterCount(params)}
          activeFilters={buildActiveFilters(params, { pics: options.pics, projects: projectOptions }, hrefFor)}
          primary={
            <>
              <ProjectPrimaryFilters params={params} projectOptions={projectOptions} />
              {isGantt ? (
                <PeriodPicker
                  window={params.window}
                  defaults={defaults}
                  today={today}
                  previousHref={hrefFor({ window: shifted(-1), page: 1 })}
                  nextHref={hrefFor({ window: shifted(1), page: 1 })}
                  nowHref={hrefFor({ window: defaults, page: 1 })}
                />
              ) : null}
            </>
          }
          advanced={<ProjectAdvancedFilters params={params} pics={options.pics} isPic={actor.picId !== null} />}
        />

        {result.projects.length === 0 ? (
          <EmptyState
            message={filterCount > 0 ? 'Tidak ada project yang cocok dengan filter.' : 'Belum ada project.'}
            action={filterCount > 0 ? <LinkButton href={resetHref} variant="outlined">Reset filter</LinkButton> : undefined}
          />
        ) : isGantt ? (
          <GanttChart projects={result.projects} timeline={buildTimeline(params.window, params.zoom, today)} showLayers={params.showLayers} highlightPicId={params.filter.picId} />
        ) : (
          <ProjectListTable projects={result.projects} />
        )}

        {result.projects.length > 0 ? (
          <PaginationBar
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            pageSizeOptions={PAGE_SIZES[params.mode].options}
            defaultSize={PAGE_SIZES[params.mode].default}
            sizeLabel={isGantt ? 'Project per halaman' : 'Baris'}
            hrefFor={(page) => hrefFor({ page })}
            unit="project"
          />
        ) : null}

        {isGantt && result.projects.length > 0 ? (
          <>
            <GanttLegend showLayers={params.showLayers} toggleHref={hrefFor({ showLayers: !params.showLayers })} />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              Klik bar untuk memperbarui tahapan bila Anda berhak; selain itu bar membuka Detail Project. Bar bertepi biru = tahapan milik Anda. Memilih PIC menyaring
              project; seluruh tahapan project itu tetap tampil. Klik nama project untuk membuka detail.
            </p>
          </>
        ) : null}
      </Card>
    </>
  );
}
