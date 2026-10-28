import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listAuditActors, listAuditEvents, type AuditCategory } from '@/modules/audit';
import { getThresholds, listMaster, listPics, MASTER_RULES, type MasterKind } from '@/modules/master';
import { getContainer } from '@/platform/container';
import { formatDateTime } from '@/shared/format';
import { requirePageSession } from '../../../_lib/session';
import { MasterListCard } from '../master-list-card';
import { PicTable } from '../pic-table';
import { ThresholdForm } from '../threshold-form';
import { Card, CardHeader } from '@/ui/components/card';
import { LinkChip } from '@/ui/components/link-controls';

/** Konfigurasi tampilan tiap sub menu master pilihan. */
const LIST_PAGES: Readonly<Record<string, { kind: MasterKind; subtitle: string; usageUnit: string; addLabel: string; threshold?: 'revision' | 'reschedule' }>> = {
  aplikasi: { kind: 'application', subtitle: 'Daftar pilihan untuk isian "Aplikasi terdampak" pada project. Aplikasi tidak dihapus, hanya dinonaktifkan, agar riwayat project tetap utuh.', usageUnit: 'project', addLabel: 'Nama aplikasi baru' },
  'kategori-revisi': { kind: 'revision_category', subtitle: 'Pilihan kategori saat merevisi estimasi tahapan. Kategori tidak dihapus, hanya dinonaktifkan; nama yang tersimpan pada revisi lama tidak ikut berubah.', usageUnit: 'revisi', addLabel: 'Nama kategori baru', threshold: 'revision' },
  'kategori-activity': { kind: 'activity_category', subtitle: 'Kategori untuk kartu Kanban activity di luar project (rapat, pelatihan, dukungan produksi, dan sebagainya). Tidak dihapus, hanya dinonaktifkan.', usageUnit: 'kartu', addLabel: 'Nama kategori baru' },
  'alasan-jadwal-ulang': { kind: 'reschedule_reason', subtitle: 'Alasan yang dipilih PIC saat menjadwal ulang rencana kartu Kanban ke tanggal lain. Tidak dihapus, hanya dinonaktifkan.', usageUnit: 'perpindahan', addLabel: 'Nama alasan baru', threshold: 'reschedule' },
};

/** Jenis peristiwa untuk saringan Jejak Perubahan (FR-09-01). */
const AUDIT_FILTERS: ReadonlyArray<{ value: '' | AuditCategory; label: string }> = [
  { value: '', label: 'Semua' }, { value: 'PROJECT', label: 'Project' }, { value: 'CARD', label: 'Kartu' },
  { value: 'MASTER', label: 'Master' }, { value: 'ACCOUNT', label: 'Akun' }, { value: 'SECURITY', label: 'Keamanan' },
];

/**
 * Halaman satu sub menu Master. Data dimuat di server (hak akses dicek oleh use case, hanya Manager).
 * Masukan: slug sub menu dan parameter pencarian (khusus step dan Jejak). Keluaran: elemen halaman.
 * Efek samping: membaca master, PIC, atau jejak audit; memvalidasi sesi.
 * Rujukan: FR-08-02 sampai FR-08-06, FR-19-01, FR-09-01, Screen [003] sampai [009].
 */
export default async function MasterSlugPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const { actor } = await requirePageSession();
  const container = getContainer();

  if (slug === 'pic') {
    const result = await listPics(container.master, actor);
    if (!result.ok) return <Alert severity="error" role="alert">{result.error.message}</Alert>;
    return <PicTable pics={result.data.map((pic) => ({ id: pic.id, name: pic.name, stage: pic.stage, isActive: pic.isActive, username: pic.username }))} />;
  }

  if (slug === 'step') {
    const stage = query.tahapan === 'QA' ? 'QA' : 'BA';
    const result = await listMaster(container.master, actor, 'stage_step', stage);
    if (!result.ok) return <Alert severity="error" role="alert">{result.error.message}</Alert>;
    return (
      <>
        <Stack direction="row" spacing={1} role="group" aria-label="Tahapan">
          <LinkChip href="/master/step?tahapan=BA" label="Business Analyst" color={stage === 'BA' ? 'primary' : 'default'} />
          <LinkChip href="/master/step?tahapan=QA" label="Quality Assurance" color={stage === 'QA' ? 'primary' : 'default'} />
        </Stack>
        <MasterListCard kind="stage_step" stage={stage} orderable title="Master Step Tahapan" addLabel={`Nama step baru (${stage})`} usageUnit="log" maxLength={MASTER_RULES.stage_step.maxLength}
          subtitle="Step pengerjaan yang dipilih PIC saat membuat log activity di Kanban. Tahapan Development belum memiliki step karena PIC Development tidak login. Step tidak dihapus, hanya dinonaktifkan."
          items={result.data} />
      </>
    );
  }

  if (slug === 'jejak') return <AuditPage actorId={actor} query={query} />;

  const page = LIST_PAGES[slug];
  if (!page) notFound();
  const [list, thresholds] = await Promise.all([listMaster(container.master, actor, page.kind), getThresholds(container.master, actor)]);
  if (!list.ok) return <Alert severity="error" role="alert">{list.error.message}</Alert>;
  return (
    <>
      <MasterListCard kind={page.kind} title={MASTER_RULES[page.kind].label} subtitle={page.subtitle} addLabel={page.addLabel} usageUnit={page.usageUnit} maxLength={MASTER_RULES[page.kind].maxLength} items={list.data} />
      {page.threshold && thresholds.ok ? (
        <ThresholdForm
          settingKey={page.threshold === 'revision' ? 'revision_warn_threshold' : 'reschedule_warn_threshold'}
          label={page.threshold === 'revision' ? 'Peringatan bila sudah direvisi (kali)' : 'Peringatan bila rencana sudah dijadwal ulang (kali)'}
          value={page.threshold === 'revision' ? thresholds.data.revision : thresholds.data.reschedule}
        />
      ) : null}
    </>
  );
}

/**
 * Menu Jejak Perubahan: terbaru di atas, saringan jenis dan pelaku, paging di server (hanya baca).
 * Masukan: pelaku dan parameter pencarian (`jenis`, `pelaku`, `halaman`, `baris`). Keluaran: elemen kartu.
 * Efek samping: membaca jejak audit (hanya baca).
 * Rujukan: FR-09-01, FR-15-01, Screen [009].
 */
async function AuditPage({ actorId, query }: { actorId: Awaited<ReturnType<typeof requirePageSession>>['actor']; query: Record<string, string | string[] | undefined> }) {
  const container = getContainer();
  const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
  const category = AUDIT_FILTERS.find((item) => item.value === one(query.jenis))?.value || undefined;
  const pelaku = Number(one(query.pelaku)) || undefined;
  const result = await listAuditEvents(container.auditRepository, actorId, {
    category: category as AuditCategory | undefined,
    actorUserId: pelaku,
    page: Number(one(query.halaman)) || 1,
    pageSize: Number(one(query.baris)) || 10,
  });
  const actors = await listAuditActors(container.auditRepository, actorId);
  if (!result.ok) return <Alert severity="error" role="alert">{result.error.message}</Alert>;
  const { rows, total, page, pageSize } = result.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (target: number) => `/master/jejak?${new URLSearchParams({ ...(category ? { jenis: category } : {}), ...(pelaku ? { pelaku: String(pelaku) } : {}), baris: String(pageSize), halaman: String(target) }).toString()}`;
  return (
    <Card>
      <CardHeader title="Jejak perubahan" subtitle="Hanya baca. Catatan tidak dapat diubah atau dihapus. Waktu memakai zona Asia/Jakarta." />
      <Box component="form" method="get" sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>Jenis<br /><select name="jenis" defaultValue={category ?? ''} style={{ minHeight: 36 }}>{AUDIT_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>Pelaku<br /><select name="pelaku" defaultValue={pelaku ? String(pelaku) : ''} style={{ minHeight: 36 }}><option value="">Semua</option>{(actors.ok ? actors.data : []).map((item) => <option key={item.userId} value={item.userId}>{item.label}</option>)}</select></label>
        <label>Baris<br /><select name="baris" defaultValue={String(pageSize)} style={{ minHeight: 36 }}>{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <button type="submit" style={{ minHeight: 36, padding: '0 16px' }}>Terapkan</button>
      </Box>
      {rows.length === 0 ? (
        <Alert severity="info">Belum ada perubahan tercatat.</Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left' }}><th style={{ padding: 8 }}>Waktu</th><th style={{ padding: 8 }}>Oleh</th><th style={{ padding: 8 }}>Perubahan</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--mui-palette-divider)', verticalAlign: 'top' }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{formatDateTime(row.occurredAt)}</td>
                  <td style={{ padding: 8 }}>{row.actorLabel}</td>
                  <td style={{ padding: 8 }}>{row.summary}{row.projectCode ? ` (${row.projectCode})` : ''}
                    {row.changes.length > 0 ? <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{row.changes.map((change) => <li key={change.field}><b>{change.field}</b>: {change.old} → {change.new}</li>)}</ul> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">Menampilkan {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}-{(page - 1) * pageSize + rows.length} dari {total}</Typography>
        {page > 1 ? <Link href={link(page - 1)} aria-label="Halaman sebelumnya">‹ Sebelumnya</Link> : null}
        <Typography variant="caption">Halaman {page} dari {pages}</Typography>
        {page < pages ? <Link href={link(page + 1)} aria-label="Halaman berikutnya">Berikutnya ›</Link> : null}
      </Box>
    </Card>
  );
}
