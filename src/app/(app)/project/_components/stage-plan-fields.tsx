'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { DateField } from '@/ui/components/date-field';
import { MultiSelectField, type Choice } from '@/ui/components/multi-select-field';
import styles from './detail.module.css';

/** Nama isian formulir untuk PIC dan tanggal (berbeda antara Buat project dan dialog tahapan). */
export interface StagePlanNames {
  readonly pics: string;
  readonly start: string;
  readonly end: string;
}

/** Properti isian perencanaan satu tahapan. */
interface StagePlanFieldsProps {
  /** Judul bagian, mis. "Tahapan BA". */
  readonly title: string;
  readonly names: StagePlanNames;
  /** PIC yang boleh dipilih untuk tahapan ini (sudah disaring sesuai tahapan dan aktif). */
  readonly picOptions: ReadonlyArray<Choice>;
  readonly defaultPicIds?: ReadonlyArray<number>;
  /** Estimasi awal untuk tahapan yang timeline-nya masih kosong; tanggal tidak ditampilkan bila `false`. */
  readonly showDates: boolean;
  readonly defaultStart?: string | null;
  readonly defaultEnd?: string | null;
  readonly errors?: { readonly pics?: string; readonly estimate?: string };
  /** Tahapan untuk garis warna kotak (BA/DEV/QA); tanpa nilai, tampil tanpa kotak berwarna. */
  readonly kind?: 'BA' | 'DEV' | 'QA';
  /** Menampilkan isian PIC (bawaan true). */
  readonly showPics?: boolean;
}

/**
 * Isian PIC (pilihan ganda) dan estimasi mulai dan selesai untuk satu tahapan. Dipakai oleh Buat project (tiga
 * tahapan sekaligus) dan dialog Perbarui Tahapan (melengkapi PIC dan timeline).
 * Masukan: judul, nama isian, pilihan PIC, nilai awal, galat, dan penanda tampil. Keluaran: kumpulan isian.
 * Efek samping: tidak ada selain state isian di komponen anak.
 * Rujukan: FR-02-02, FR-03-01, Screen [013] field 12 dan 13, Screen [016] field 8 dan 9.
 */
export function StagePlanFields({ title, names, picOptions, defaultPicIds, showDates, defaultStart, defaultEnd, errors = {}, showPics = true, kind }: StagePlanFieldsProps) {
  return (
    <Box className={kind ? `${styles.sbox} ${styles[kind]}` : undefined} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="h3" sx={{ fontSize: 13, fontWeight: 600 }}>{title}</Typography>
      {showPics ? <MultiSelectField name={names.pics} label="PIC (boleh lebih dari satu)" options={picOptions} defaultIds={defaultPicIds} error={errors.pics} /> : null}
      {showDates ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1.5 }}>
          <DateField name={names.start} label="Estimasi mulai" defaultValue={defaultStart} error={errors.estimate} helperText="Estimasi pertama menjadi estimasi awal." />
          <DateField name={names.end} label="Estimasi selesai" defaultValue={defaultEnd} />
        </Box>
      ) : null}
    </Box>
  );
}
