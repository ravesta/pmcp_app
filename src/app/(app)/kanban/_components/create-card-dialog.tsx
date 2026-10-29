'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CardFormOptions } from '@/modules/kanban';
import { ActionDialog } from '@/ui/components/action-dialog';
import { DateField } from '@/ui/components/date-field';
import { SearchSelectField } from '@/ui/components/search-select-field';
import { ToneChip } from '@/ui/components/tone-chip';
import { PROJECT_STATUS_TEXT, projectStatusTone, STAGE_FULL_TEXT } from '@/ui/format/project-labels';
import { createCardAction } from '../actions';
import { RevisionFields } from './revision-fields';
import { usePlanPreview } from './use-plan-preview';

/** Properti dialog Buat kartu. */
interface CreateCardDialogProps {
  readonly kind: 'PROJECT' | 'ACTIVITY';
  readonly options: CardFormOptions;
  /** Alamat papan tanpa dialog (tujuan saat ditutup). */
  readonly closeHref: string;
  /** Tanggal hari ini (`YYYY-MM-DD`) sebagai rencana awal isian. */
  readonly today: string;
}

/**
 * Kotak konfirmasi status project Backlog atau Ditunda seperti mockup: jawaban wajib sebelum menyimpan; "Ya" mengubah
 * status menjadi Berjalan saat kartu disimpan. Jawaban dikirim lewat isian tersembunyi `confirmStart`.
 * Masukan: nama project, status project, alasan Ditunda, jawaban, penanganan jawaban, dan galat. Keluaran: kotak.
 * Efek samping: memanggil penanganan jawaban saat tombol ditekan.
 * Rujukan: FR-17-02 butir 1 sampai 3, mockup v0.2 (fungsi kUpRender).
 */
function StatusConfirm({ projectName, status, reason, answer, onAnswer, error }: { readonly projectName: string; readonly status: 'BACKLOG' | 'DEFERRED'; readonly reason: string | null; readonly answer: 'YES' | 'NO' | null; readonly onAnswer: (value: 'YES' | 'NO') => void; readonly error?: string }) {
  const backlog = status === 'BACKLOG';
  const label = backlog ? 'Backlog' : 'Ditunda';
  return (
    <div style={{ background: 'var(--warn-bg)', border: `1px solid ${error ? 'var(--late)' : 'var(--warn)'}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }} role="group" aria-label="Konfirmasi status project">
      <input type="hidden" name="confirmStart" value={answer ?? ''} />
      <div>
        {backlog
          ? <>Project <b>{projectName}</b> masih berstatus <b>Backlog</b> (belum dimulai). Karena Anda akan mulai mengerjakannya, ubah status project menjadi <b>Berjalan</b>?</>
          : <>Project <b>{projectName}</b> saat ini <b>Ditunda</b>{reason ? ` (alasan: ${reason})` : ''}. Karena Anda akan melanjutkan pengerjaannya, ubah status project menjadi <b>Berjalan</b>?</>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" size="small" variant={answer === 'YES' ? 'contained' : 'outlined'} aria-pressed={answer === 'YES'} onClick={() => onAnswer('YES')}>{answer === 'YES' ? '✓ ' : ''}Ya, jadikan Berjalan</Button>
        <Button type="button" size="small" variant={answer === 'NO' ? 'contained' : 'outlined'} aria-pressed={answer === 'NO'} onClick={() => onAnswer('NO')}>{answer === 'NO' ? '✓ ' : ''}Biarkan {label}</Button>
      </div>
      <div style={{ fontSize: 12, color: error ? 'var(--late)' : answer === null ? 'var(--muted)' : 'inherit' }}>
        {error ?? (answer === 'YES' ? 'Status project akan diubah menjadi Berjalan saat kartu disimpan.' : answer === 'NO' ? `Status project tetap ${label}.` : 'Pilih salah satu untuk melanjutkan.')}
      </div>
    </div>
  );
}

/**
 * Dialog Buat kartu rencana (project) atau kartu activity (di luar project, termasuk dadakan). Kartu project: pilih
 * project yang diikuti, step (opsional), judul, rencana, estimasi jam, dadakan, dan kolom awal; konfirmasi status project
 * dan revisi estimasi tahapan muncul sesuai pratinjau dari server. Kartu activity: pilih kategori master.
 * Masukan: jenis, pilihan formulir, alamat penutup, dan tanggal hari ini. Keluaran: dialog.
 * Efek samping: memanggil pratinjau (baca) saat project atau tanggal berubah; mengirim `createCardAction` saat Simpan;
 * menutup dengan menavigasi ke papan.
 * Rujukan: FR-17-01, FR-17-02, FR-21-01, FR-13-05, FR-16-01 butir 5 (hanya PIC), mockup v0.2 (dlgKNew).
 */
export function CreateCardDialog({ kind: initialKind, options, closeHref, today }: CreateCardDialogProps) {
  const router = useRouter();
  const [kind, setKind] = useState(initialKind);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<'YES' | 'NO' | null>(null);
  const [planStart, setPlanStart] = useState(today);
  const [planEnd, setPlanEnd] = useState(today);
  const preview = usePlanPreview(kind === 'PROJECT' ? projectId : null, planStart, planEnd);
  const selected = options.projects.find((project) => project.projectId === projectId) ?? null;
  const isProject = kind === 'PROJECT';

  return (
    <ActionDialog
      title="Buat kartu rencana"
      submitLabel="Simpan kartu"
      action={createCardAction}
      onClose={() => router.replace(closeHref)}
      closeOnSuccess={false}
      hidden={{ kind, returnTo: closeHref }}
    >
      {({ fieldErrors }) => (
        <>
          <Box role="group" aria-label="Jenis kartu" sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Box component="span" sx={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Jenis kartu</Box>
            <ToggleButtonGroup exclusive size="small" sx={{ alignSelf: 'flex-start', bgcolor: 'var(--surface)', '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 500, color: 'var(--muted)', px: '14px' }, '& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover': { bgcolor: 'var(--accent)', color: 'var(--on-accent)' } }} value={kind} onChange={(_event, next: 'PROJECT' | 'ACTIVITY' | null) => { if (next) setKind(next); }} aria-label="Jenis kartu">
              <ToggleButton value="PROJECT">Project</ToggleButton>
              <ToggleButton value="ACTIVITY">Activity (di luar project)</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {isProject ? (
            <>
              <SearchSelectField
                name="projectId"
                label="Project yang akan diproses"
                options={options.projects.map((project) => ({ value: String(project.projectId), label: `${project.name} (${project.code})`, searchText: `${project.code} ${project.name} ${PROJECT_STATUS_TEXT[project.status]}`, trailing: <ToneChip text={PROJECT_STATUS_TEXT[project.status]} tone={projectStatusTone(project.status)} /> }))}
                value={projectId === null ? '' : String(projectId)}
                onChange={(value) => { setProjectId(value === '' ? null : Number(value)); setConfirm(null); }}
                placeholder="Pilih project"
                searchPlaceholder="Ketik ID atau nama project..."
                error={fieldErrors.project}
                helperText={options.projects.length === 0 ? 'Belum ada project yang Anda ikuti.' : 'Menampilkan project berstatus Backlog, Berjalan, dan Ditunda yang Anda ikuti sebagai PIC.'}
              />
              {selected && (selected.status === 'BACKLOG' || selected.status === 'DEFERRED') ? <StatusConfirm projectName={selected.name} status={selected.status} reason={selected.statusReason} answer={confirm} onAnswer={setConfirm} error={fieldErrors.statusConfirm} /> : null}
              <TextField select name="stepName" label="Step tahapan (opsional)" defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} error={Boolean(fieldErrors.step)} helperText={fieldErrors.step}>
                <option value="">(tidak dipilih)</option>
                {options.steps.map((step) => <option key={step.id} value={step.name}>{step.name}</option>)}
              </TextField>
              {selected ? (
                <Box sx={{ bgcolor: 'var(--soft)', borderRadius: '6px', p: '8px 10px', fontSize: 12, lineHeight: 1.6 }}>
                  <b>{selected.code}</b> · {selected.name} <ToneChip text={PROJECT_STATUS_TEXT[selected.status]} tone={projectStatusTone(selected.status)} />
                  {options.stage ? <><br />Tahapan {STAGE_FULL_TEXT[options.stage]}</> : null}
                </Box>
              ) : null}
            </>
          ) : (
            <TextField select name="categoryId" label="Kategori activity" defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} error={Boolean(fieldErrors.category)} helperText={fieldErrors.category}>
              <option value="">Pilih kategori</option>
              {options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </TextField>
          )}
          <TextField name="title" label="Judul rencana" required placeholder="mis. Menyusun BRD v1.0" error={Boolean(fieldErrors.title)} helperText={fieldErrors.title ?? '3 sampai 120 karakter.'} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <DateField name="planStart" label="Rencana mulai (dd/mm/yyyy)" defaultValue={today} error={fieldErrors.plan} onValueChange={setPlanStart} />
            <DateField name="planEnd" label="Rencana selesai (dd/mm/yyyy)" defaultValue={today} onValueChange={setPlanEnd} />
            <TextField name="estimateHours" label="Estimasi jam (opsional)" placeholder="mis. 8" error={Boolean(fieldErrors.estimate)} helperText={fieldErrors.estimate} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          </div>
          {isProject && preview?.kind === 'ADOPT' ? <FormControlLabel control={<Checkbox name="adoptPlan" value="1" />} label="Jadikan rentang rencana ini sebagai estimasi awal tahapan (tahapan belum punya timeline)" /> : null}
          {isProject ? <RevisionFields preview={preview} categories={options.revisionCategories} errors={fieldErrors} /> : null}
          <FormControlLabel control={<Checkbox name="isAdhoc" value="1" />} label="Pekerjaan dadakan (tidak ada dalam rencana)" />
          <TextField select name="column" label="Kolom awal" defaultValue="PLANNED" slotProps={{ select: { native: true } }} error={Boolean(fieldErrors.column)} helperText={fieldErrors.column}>
            <option value="PLANNED">Planned</option>
            <option value="IN_PROGRESS">In Progress</option>
          </TextField>
        </>
      )}
    </ActionDialog>
  );
}
