'use client';

import { useState } from 'react';
import { formatDisplayDate, isIsoDate, parseDisplayDate } from '@/shared/iso-date';
import { PlainField } from './plain-field';
import styles from './plain-field.module.css';

/** Properti isian tanggal polos. */
interface PlainDateFieldProps {
  readonly id: string;
  /** Nama isian yang dikirim ke server; nilainya `YYYY-MM-DD` (atau teks mentah bila tidak valid). */
  readonly name: string;
  readonly label: string;
  /** Nilai awal `YYYY-MM-DD`. */
  readonly defaultValue?: string | null;
  readonly error?: string;
}

/**
 * Isian tanggal dd/mm/yyyy bergaya mockup (label kecil di atas, kontrol polos) untuk formulir GET. Pengguna
 * mengetik dd/mm/yyyy; yang dikirim ke server `YYYY-MM-DD`, atau teks mentah bila tidak valid agar server yang menolak.
 * Masukan: id, nama, label, dan nilai awal. Keluaran: isian berlabel beserta isian tersembunyi.
 * Efek samping: menyimpan teks yang diketik di state komponen.
 * Rujukan: NFR-03 (tanggal tampil dd/mm/yyyy), mockup v0.2 (isian Dari dan Sampai pada Kanban).
 */
export function PlainDateField({ id, name, label, defaultValue, error }: PlainDateFieldProps) {
  const [text, setText] = useState(defaultValue && isIsoDate(defaultValue) ? formatDisplayDate(defaultValue) : '');
  const trimmed = text.trim();
  const submitted = trimmed === '' ? '' : (parseDisplayDate(trimmed) ?? trimmed);
  return (
    <PlainField label={label} htmlFor={id} error={error}>
      <input id={id} type="text" className={styles.control} value={text} onChange={(event) => setText(event.target.value)} inputMode="numeric" autoComplete="off" data-submit-group="dates" placeholder="dd/mm/yyyy" />
      <input type="hidden" name={name} value={submitted} />
    </PlainField>
  );
}
