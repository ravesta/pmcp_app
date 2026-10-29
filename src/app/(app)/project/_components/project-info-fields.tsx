'use client';

import { useState } from 'react';
import { MultiSelectField, type Choice } from '@/ui/components/multi-select-field';
import { PlainDateField } from '@/ui/components/plain-date-field';
import { PlainInput, PlainSelect, PlainTextarea } from '@/ui/components/plain-field';
import { PROJECT_STATUS_TEXT, PROJECT_TYPE_TEXT } from '@/ui/format/project-labels';
import styles from './detail.module.css';

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
  /** True bila isian disusun dalam grid empat kolom seperti mockup (halaman Buat project); bawaan satu kolom (dialog). */
  readonly grid?: boolean;
}

/**
 * Isian informasi project yang dipakai bersama oleh halaman Buat project dan dialog Ubah informasi: nama, no.
 * referensi, jenis, aplikasi, business owner, department, request date, deskripsi, status, dan alasan.
 * Masukan: nilai awal, pilihan aplikasi, pilihan status, dan galat per isian. Keluaran: kumpulan isian.
 * Efek samping: menyimpan status terpilih di state komponen agar isian Alasan hanya tampil untuk Ditunda dan Batal.
 * Rujukan: Screen [013], Screen [015], FR-02-01 butir 3 dan 4, FR-11-02, EC-11-02.04.
 */
export function ProjectInfoFields({ defaults = {}, applications, statusChoices, fieldErrors, grid = false }: ProjectInfoFieldsProps) {
  const [status, setStatus] = useState(defaults.status ?? 'BACKLOG');
  const needsReason = status === 'DEFERRED' || status === 'CANCELLED';
  const span2 = grid ? styles.span2 : undefined;
  const span4 = grid ? styles.span4 : undefined;
  return (
    <div className={grid ? styles.fgrid : undefined} style={grid ? undefined : { display: 'contents' }}>
      <PlainInput id="info-id" name="displayCode" label="ID Project" type="text" defaultValue={defaults.code ?? 'Dibuat otomatis'} readOnly />
      <div className={span2}><PlainInput id="info-name" name="name" label="Nama project" type="text" required defaultValue={defaults.name ?? ''} maxLength={200} error={fieldErrors.name} /></div>
      <PlainInput id="info-ref" name="referenceNo" label="No. referensi" type="text" placeholder="mis. JIRA-1234" defaultValue={defaults.referenceNo ?? ''} maxLength={50} error={fieldErrors.referenceNo} />
      <PlainSelect id="info-type" name="projectType" label="Jenis project" emptyLabel="Pilih jenis" defaultValue={defaults.projectType ?? ''} options={Object.entries(PROJECT_TYPE_TEXT).map(([value, label]) => ({ value, label }))} error={fieldErrors.projectType} />
      <div className={span2}><MultiSelectField name="applicationIds" label="Aplikasi terdampak" options={applications} defaultIds={defaults.applicationIds} error={fieldErrors.applicationIds} placeholder="Pilih aplikasi" searchable /></div>
      <PlainInput id="info-owner" name="businessOwner" label="Business owner" type="text" defaultValue={defaults.businessOwner ?? ''} maxLength={100} error={fieldErrors.businessOwner} />
      <PlainInput id="info-dept" name="department" label="Department" type="text" defaultValue={defaults.department ?? ''} maxLength={100} error={fieldErrors.department} />
      <PlainDateField id="info-request" name="requestDate" label="Request date" defaultValue={defaults.requestDate} error={fieldErrors.requestDate} />
      <PlainSelect id="info-status" name="status" label="Status project" emptyLabel={null} defaultValue={defaults.status ?? 'BACKLOG'} onValueChange={setStatus} options={statusChoices.map((value) => ({ value, label: PROJECT_STATUS_TEXT[value as keyof typeof PROJECT_STATUS_TEXT] }))} error={fieldErrors.status} />
      {needsReason ? (
        <div className={grid ? styles.span3 : undefined}><PlainInput id="info-reason" name="statusReason" label="Alasan" type="text" required defaultValue={defaults.statusReason ?? ''} maxLength={200} placeholder="Wajib untuk status Ditunda atau Batal" error={fieldErrors.statusReason} /></div>
      ) : grid ? null : (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Alasan hanya diisi untuk status Ditunda atau Batal.</span>
      )}
      <div className={span4}><PlainTextarea id="info-desc" name="description" label="Deskripsi project" defaultValue={defaults.description ?? ''} maxLength={1000} rows={3} error={fieldErrors.description} /></div>
    </div>
  );
}
