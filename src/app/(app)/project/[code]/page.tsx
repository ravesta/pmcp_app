import Alert from '@mui/material/Alert';
import Link from 'next/link';
import { listProjectHistory } from '@/modules/audit';
import { listProjectPlans, listProjectWorkLogs } from '@/modules/kanban';
import { getProjectDetail } from '@/modules/project';
import { getContainer } from '@/platform/container';
import { addDays, startOfWeek } from '@/shared/calendar';
import { Card, CardHeader, Section } from '@/ui/components/card';
import { LinkButton } from '@/ui/components/link-controls';
import { ToneChip } from '@/ui/components/tone-chip';
import { formatDateOrDash, PROJECT_STATUS_TEXT, PROJECT_TYPE_TEXT, projectStatusTone } from '@/ui/format/project-labels';
import { buildTimelineForRange } from '@/ui/gantt/timeline';
import { requirePageSession } from '../../../_lib/session';
import styles from '../_components/detail.module.css';
import { EditInfoButton } from '../_components/edit-info-dialog';
import { GanttChart } from '../_components/gantt-chart';
import { GanttLegend } from '../_components/gantt-legend';
import { ProjectHistory } from '../_components/project-history';
import { ProjectLogs } from '../_components/project-logs';
import { ProjectPlans } from '../_components/project-plans';
import { StageBox } from '../_components/stage-box';
import { StageHistory } from '../_components/stage-history';

/** Jumlah catatan riwayat perubahan per halaman. */
const HISTORY_PAGE_SIZE = 10;

/**
 * Satu pasang label dan nilai pada bagian informasi (kosong tampil "-").
 * Masukan: label, isi, dan penanda lebar penuh. Keluaran: blok dt/dd.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [014] (Table 25a), mockup v0.2 (kelas di).
 */
function Info({ label, children, wide }: { readonly label: string; readonly children: React.ReactNode; readonly wide?: boolean }) {
  return (
    <div className={`${styles.di} ${wide ? styles.wide : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Detail Project (Screen [014]) seperti mockup v0.2: breadcrumb, judul dengan jenis dan status, bagian Informasi
 * project, Tahapan (tiga kotak berwarna), Jadwal (Gantt project), Rencana kerja dan Log activity, Riwayat estimasi dan
 * penahanan, dan Riwayat perubahan. Semua peran dapat membuka semua project; membuka detail menandai Assignment baru
 * PIC sebagai dilihat.
 * Masukan: kode project pada alamat; parameter `rhal` (halaman riwayat), `ubah` (tahapan yang dialognya dibuka otomatis),
 * dan `lapisan`. Keluaran: halaman detail, atau pesan tidak ditemukan.
 * Efek samping: memvalidasi sesi; menandai penugasan PIC pada project ini sebagai sudah dilihat (BL-45).
 * Rujukan: FR-11-01, FR-07-02, BL-45, EC-11-01.01.
 */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await requirePageSession();
  const { code } = await params;
  const query = await searchParams;
  const container = getContainer();
  const detail = await getProjectDetail(container.project, actor, decodeURIComponent(code));
  if (!detail.ok) {
    return (
      <>
        <Alert severity="error" role="alert">{detail.error.message}</Alert>
        <div><LinkButton href="/project" variant="outlined">Kembali ke Project</LinkButton></div>
      </>
    );
  }

  const { project, revisions, options, revisionThreshold, canEditInfo } = detail.data;
  const pageParam = typeof query.rhal === 'string' && /^\d{1,6}$/.test(query.rhal) ? Number(query.rhal) : 1;
  const logStage = typeof query.lstage === 'string' && ['BA', 'DEV', 'QA'].includes(query.lstage) ? (query.lstage as 'BA' | 'DEV' | 'QA') : null;
  const logPic = typeof query.lpic === 'string' && /^\d{1,9}$/.test(query.lpic) ? Number(query.lpic) : null;
  const logPage = typeof query.lhal === 'string' && /^\d{1,6}$/.test(query.lhal) ? Number(query.lhal) : 1;
  const logSize = typeof query.lper === 'string' && /^\d{1,3}$/.test(query.lper) ? Number(query.lper) : 10;
  const [history, plans, logs] = await Promise.all([
    listProjectHistory(container.auditRepository, project.code, pageParam, HISTORY_PAGE_SIZE),
    listProjectPlans(container.kanban, actor, project.id),
    listProjectWorkLogs(container.kanban, project.id, { stage: logStage, picId: logPic }, logPage, logSize),
  ]);
  const autoOpenKind = typeof query.ubah === 'string' ? query.ubah : null;
  const showLayers = query.lapisan !== '0';
  const base = `/project/${project.code}`;

  const timeline = project.overall
    ? buildTimelineForRange(startOfWeek(project.overall.start), addDays(project.overall.end, 7), 'WEEK', container.clock.today())
    : null;
  const incomplete = project.stages
    .filter((s) => s.assignees.length === 0 || s.estimate === null)
    .map((s) => `${s.label} (${[s.assignees.length === 0 && 'PIC', s.estimate === null && 'timeline'].filter(Boolean).join(' dan ')})`);

  return (
    <Card>
      <div className={styles.crumb}>
        <Link href="/project">Project</Link>
        <span aria-hidden> / </span>
        <span>{project.code}</span>
      </div>
      <CardHeader
        level={1}
        title={project.name}
        subtitle={<span className="mono">{project.code}{project.referenceNo ? ` · ${project.referenceNo}` : ''}</span>}
        actions={
          <>
            {project.projectType ? <ToneChip text={PROJECT_TYPE_TEXT[project.projectType]} tone={project.projectType === 'NEW' ? 'info' : 'warn'} /> : null}
            <ToneChip text={PROJECT_STATUS_TEXT[project.status]} tone={projectStatusTone(project.status)} />
          </>
        }
      />

      <Section title="Informasi project" actions={canEditInfo ? <EditInfoButton project={project} activeApplications={options.applications.map((a) => ({ id: a.id, label: a.name }))} /> : undefined}>
        <dl className={styles.dgrid}>
          <Info label="ID Project"><span className="mono">{project.code}</span></Info>
          <Info label="No. referensi">{project.referenceNo ?? '-'}</Info>
          <Info label="Jenis project">{project.projectType ? PROJECT_TYPE_TEXT[project.projectType] : '-'}</Info>
          <Info label="Status project">
            <ToneChip text={PROJECT_STATUS_TEXT[project.status]} tone={projectStatusTone(project.status)} />
            {project.statusReason && (project.status === 'DEFERRED' || project.status === 'CANCELLED') ? <span className={`${styles.small} ${styles.muted}`}> {project.statusReason}</span> : null}
          </Info>
          <Info label="Business owner">{project.businessOwner ?? '-'}</Info>
          <Info label="Department">{project.department ?? '-'}</Info>
          <Info label="Request date">{formatDateOrDash(project.requestDate)}</Info>
          <Info label="UAT Sign Off">{formatDateOrDash(project.uatSignOffDate)}</Info>
          <Info label="Go Live">{formatDateOrDash(project.goLiveDate)}</Info>
          <Info label="Aplikasi terdampak">
            {project.applications.length > 0 ? project.applications.map((a) => <span key={a.id} className={styles.tag}>{a.isActive ? a.name : `${a.name} (nonaktif)`}</span>) : '-'}
          </Info>
          <Info label="Estimasi keseluruhan">
            {project.overall ? <><span className="mono">{formatDateOrDash(project.overall.start)} - {formatDateOrDash(project.overall.end)}</span>{project.overallPartial ? <span className={`${styles.muted} ${styles.small}`}> (sebagian tahapan)</span> : null}</> : <span className={styles.muted}>Belum ada timeline</span>}
          </Info>
          <Info label="Deskripsi" wide>{project.description ?? '-'}</Info>
        </dl>
      </Section>

      <Section title="Tahapan">
        {incomplete.length > 0 ? <div className={styles.wn} role="status">Perencanaan belum lengkap: {incomplete.join('; ')}. Lengkapi lewat tombol pada kartu tahapan di bawah.</div> : null}
        <div className={styles.stages3}>
          {project.stages.map((stage) => (
            <StageBox key={stage.stageId} projectCode={project.code} projectName={project.name} stage={stage} options={options} revisionThreshold={revisionThreshold} isManager={actor.role === 'MANAGER'} autoOpen={autoOpenKind === stage.kind} />
          ))}
        </div>
      </Section>

      <Section title="Jadwal">
        {timeline ? (
          <>
            <GanttChart projects={[project]} timeline={timeline} showLayers={showLayers} editContext={{ options, revisionThreshold, isManager: actor.role === 'MANAGER' }} showDetailLink={false} />
            <GanttLegend showLayers={showLayers} toggleHref={showLayers ? `${base}?lapisan=0` : base} />
          </>
        ) : (
          <div className={styles.muted} style={{ padding: 16, textAlign: 'center' }}>Belum ada timeline untuk project ini. Timeline akan tampil di sini setelah estimasi tanggal tahapan diisi.</div>
        )}
      </Section>

      <Section title="Rencana kerja">
        <ProjectPlans cards={plans} />
      </Section>
      <Section title="Log activity">
        <ProjectLogs
          page={logs}
          pageNumber={logPage}
          pageSize={[5, 10, 20].includes(logSize) ? logSize : 10}
          stage={logStage ?? ''}
          picId={logPic === null ? '' : String(logPic)}
          baseHref={base}
          hrefFor={(page) => `${base}?${new URLSearchParams({ ...(logStage ? { lstage: logStage } : {}), ...(logPic !== null ? { lpic: String(logPic) } : {}), ...(logSize !== 10 ? { lper: String(logSize) } : {}), ...(page > 1 ? { lhal: String(page) } : {}) }).toString()}`}
        />
      </Section>

      <Section title="Riwayat estimasi dan penahanan">
        <StageHistory stages={project.stages} revisions={revisions} />
      </Section>

      <Section title="Riwayat perubahan">
        <ProjectHistory rows={history.rows} page={history.page} pageSize={history.pageSize} total={history.total} hrefFor={(page) => (page > 1 ? `${base}?rhal=${page}` : base)} />
      </Section>
    </Card>
  );
}
