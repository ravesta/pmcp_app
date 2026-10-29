'use client';

import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { ProjectView } from '@/modules/project';
import { ActionDialog } from '@/ui/components/action-dialog';
import type { Choice } from '@/ui/components/multi-select-field';
import { updateProjectInfoAction } from '../actions';
import { ProjectInfoFields } from './project-info-fields';

/** Semua status project dapat dipilih saat mengubah informasi (Selesai hanya bila semua tahapan Selesai). */
const ALL_STATUSES = ['BACKLOG', 'RUNNING', 'DEFERRED', 'CANCELLED', 'COMPLETED'];

/** Properti tombol dan dialog Ubah informasi. */
interface EditInfoButtonProps {
  readonly project: ProjectView;
  /** Aplikasi aktif dari master. */
  readonly activeApplications: ReadonlyArray<Choice>;
}

/**
 * Tombol "Ubah informasi" beserta dialognya (Screen [015]): atribut project, status, dan alasan dalam grid empat kolom
 * seperti mockup v0.2 dengan keterangan bahwa setiap perubahan dicatat. Aplikasi nonaktif
 * yang sudah dipakai project tetap tampil terpilih dengan penanda "(nonaktif)" agar tidak terhapus tanpa disengaja.
 * Masukan: project dan daftar aplikasi aktif. Keluaran: tombol dan dialog.
 * Efek samping: menyimpan buka/tutup dialog di state; mengirim `updateProjectInfoAction` saat Simpan.
 * Rujukan: FR-11-02, FR-14-01, EC-11-02.03, EC-11-02.04, Screen [015].
 */
export function EditInfoButton({ project, activeApplications }: EditInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const applicationChoices: Choice[] = [
    ...activeApplications,
    ...project.applications.filter((app) => !app.isActive).map((app) => ({ id: app.id, label: `${app.name} (nonaktif)` })),
  ];
  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>Ubah informasi</Button>
      {open ? (
        <ActionDialog
          title="Ubah informasi project"
          submitLabel="Simpan perubahan"
          action={updateProjectInfoAction}
          hidden={{ projectId: project.id, expectedVersion: project.version }}
          onClose={() => setOpen(false)}
          maxWidth="md"
        >
          {({ fieldErrors }) => (
            <>
              <Typography variant="body2" color="text.secondary">Setiap perubahan dicatat: siapa yang mengubah, kapan, serta nilai lama dan barunya.</Typography>
              <ProjectInfoFields
              defaults={{
                code: project.code,
                name: project.name,
                referenceNo: project.referenceNo,
                projectType: project.projectType,
                applicationIds: project.applications.map((a) => a.id),
                businessOwner: project.businessOwner,
                department: project.department,
                requestDate: project.requestDate,
                description: project.description,
                status: project.status,
                statusReason: project.statusReason,
              }}
              applications={applicationChoices}
              statusChoices={ALL_STATUSES}
              fieldErrors={fieldErrors}
              grid
              />
            </>
          )}
        </ActionDialog>
      ) : null}
    </>
  );
}
