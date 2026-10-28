'use client';

import { useState } from 'react';
import { DateField } from '@/ui/components/date-field';
import { MultiSelectField, type Choice } from '@/ui/components/multi-select-field';
import { PlainInput, PlainSelect, PlainTextarea } from '@/ui/components/plain-field';
import styles from '@/ui/components/plain-field.module.css';
import { PROJECT_STATUS_TEXT, PROJECT_TYPE_TEXT } from '@/ui/format/project-labels';

/** Nilai awal isian informasi project (kosong untuk project baru). */
export interface ProjectInfoDefaults {
  readonly code?: string;
  readonly name?: string;
  readonly referenceNo?: string | null;
  readonly projectType?: string | null;
  readonly applicationIds?: ReadonlyArray<number>;
  readonly businessOwner?: string | null;
  readonly department?: string | null;
  readonly requestDate?: string | null;
  readonly description?: string | null;
  readonly status?: string;
  readonly statusReason?: string | null;
}

/** Properti isian informasi project. */
interface ProjectInfoFieldsProps {
  readonly defaults?: ProjectInfoDefaults;
  /** Pilihan aplikasi; aplikasi nonaktif yang sudah dipakai tetap muncul dengan penanda "(nonaktif)". */
  readonly applications: ReadonlyArray<Choice>;
  /** Status yang boleh dipilih (Selesai tidak ditawarkan saat membuat project, BL-21). */
  readonly statusChoices: ReadonlyArray<string>;
  readonly fieldErrors: Readonly<Record<string, string>>;
}

/**
 * Isian informasi project yang dipakai bersama oleh halaman Buat project dan dialog Ubah informasi: nama, no.
 * referensi, jenis, aplikasi, business owner, department, request date, deskripsi, status, dan alasan.
 * Masukan: nilai awal, pilihan aplikasi, pilihan status, dan galat per isian. Keluaran: kumpulan isian.
 * Efek samping: menyimpan status terpilih di state komponen agar isian Alasan hanya tampil untuk Ditunda dan Batal.
 * Rujukan: Screen [013], Screen [015], FR-02-01 butir 3 dan 4, FR-11-02, EC-11-02.04.
 */
export function ProjectInfoFields({ defaults = {}, applications, statusChoices, fieldErrors }: ProjectInfoFieldsProps) {
  const [status, setStatus] = useState(defaults.status ?? 'BACKLOG');
  const needsReason = status === 'DEFERRED' || status === 'CANCELLED';
  return (
    <div className={styles.formWrap}>
      <div className={styles.fgrid}>
        <PlainInput id="pi-code" name="code" label="ID Project" value={defaults.code ?? 'Dibuat otomatis'} disabled type="text" />
        <PlainInput id="pi-name" name="name" label="Nama project" required type="text" className={styles.span2} defaultValue={defaults.name ?? ''} placeholder="Nama project" maxLength={200} error={fieldErrors.name} />
        <PlainInput id="pi-ref" name="referenceNo" label="No. referensi" type="text" defaultValue={defaults.referenceNo ?? ''} placeholder="mis. JIRA-1234" error={fieldErrors.referenceNo} />
        <PlainSelect id="pi-type" name="projectType" label="Jenis project" emptyLabel="Pilih jenis" defaultValue={defaults.projectType ?? ''} options={Object.entries(PROJECT_TYPE_TEXT).map(([value, label]) => ({ value, label }))} error={fieldErrors.projectType} />
        <MultiSelectField plain className={styles.span2} name="applicationIds" label="Aplikasi terdampak (boleh lebih dari satu)" placeholder="Pilih aplikasi" options={applications} defaultIds={defaults.applicationIds} error={fieldErrors.applicationIds} />
        <PlainInput id="pi-owner" name="businessOwner" label="Business owner" type="text" defaultValue={defaults.businessOwner ?? ''} error={fieldErrors.businessOwner} />
        <PlainInput id="pi-dept" name="department" label="Department" type="text" defaultValue={defaults.department ?? ''} error={fieldErrors.department} />
        <DateField plain name="requestDate" label="Request date" defaultValue={defaults.requestDate} error={fieldErrors.requestDate} />
        <PlainSelect id="pi-status" name="status" label="Status project" emptyLabel={null} defaultValue={defaults.status ?? 'BACKLOG'} onValueChange={setStatus} options={statusChoices.map((value) => ({ value, label: PROJECT_STATUS_TEXT[value as keyof typeof PROJECT_STATUS_TEXT] }))} error={fieldErrors.status} />
        {needsReason ? <PlainInput id="pi-reason" name="statusReason" label="Alasan" required type="text" defaultValue={defaults.statusReason ?? ''} hint="Wajib untuk status Ditunda dan Batal." error={fieldErrors.statusReason} /> : null}
        <PlainTextarea id="pi-desc" name="description" label="Deskripsi project" className={styles.span4} defaultValue={defaults.description ?? ''} placeholder="Ringkasan singkat project" rows={3} error={fieldErrors.description} />
        {needsReason ? null : <span className={`${styles.hint} ${styles.span4}`}>Alasan hanya diisi untuk status Ditunda atau Batal.</span>}
      </div>
    </div>
  );
}
