'use client';

import TextField from '@mui/material/TextField';
import { useId, useState } from 'react';
import { formatDisplayDate, isIsoDate, parseDisplayDate } from '@/shared/iso-date';
import { PlainField } from './plain-field';
import styles from './plain-field.module.css';

/** Properti isian tanggal. */
interface DateFieldProps {
  /** Nama isian yang dikirim ke server; nilainya `YYYY-MM-DD` (atau teks mentah bila tidak valid). */
  readonly name: string;
  readonly label: string;
  /** Nilai awal `YYYY-MM-DD`. */
  readonly defaultValue?: string | null;
  readonly error?: string;
  readonly required?: boolean;
  readonly helperText?: string;
  /** Dipanggil dengan nilai yang dikirim (`YYYY-MM-DD`, teks mentah, atau kosong) setiap kali isian berubah. */
  readonly onValueChange?: (value: string) => void;
  /** Tampilan polos seperti mockup (label di atas); bila false memakai kotak MUI di dalam dialog. */
  readonly plain?: boolean;
}

/**
 * Isian tanggal dd/mm/yyyy untuk pengguna yang mengirim `YYYY-MM-DD` ke server. Tanggal tidak valid dikirim apa
 * adanya supaya server menolaknya dengan pesan yang sama di semua layar (validasi utama di server, NFR-01).
 * Masukan: nama, label, nilai awal, galat, wajib, keterangan, penerima perubahan nilai, dan gaya. Keluaran: isian teks beserta isian tersembunyi.
 * Efek samping: menyimpan teks yang diketik di state komponen.
 * Rujukan: NFR-03 (tanggal tampil dd/mm/yyyy), CL-010, handoff UX/UI §7, mockup v0.2 (field).
 */
export function DateField({ name, label, defaultValue, error, required, helperText, onValueChange, plain = false }: DateFieldProps) {
  const id = useId();
  const [text, setText] = useState(defaultValue && isIsoDate(defaultValue) ? formatDisplayDate(defaultValue) : '');
  const parsed = parseDisplayDate(text);
  const submitted = text.trim() === '' ? '' : (parsed ?? text.trim());
  /** Menyimpan teks yang diketik dan meneruskan nilai terkirimnya. Efek samping: memperbarui state, memanggil penerima. */
  const change = (value: string) => {
    setText(value);
    const next = parseDisplayDate(value);
    onValueChange?.(value.trim() === '' ? '' : (next ?? value.trim()));
  };
  return (
    <>
      {plain ? (
        <PlainField label={label} htmlFor={id} required={required} error={error} hint={helperText}>
          <input id={id} className={styles.control} value={text} onChange={(event) => change(event.target.value)} placeholder="dd/mm/yyyy" inputMode="numeric" autoComplete="off" aria-invalid={error ? true : undefined} />
        </PlainField>
      ) : (
        <TextField
          label={label}
          value={text}
          onChange={(event) => change(event.target.value)}
          placeholder="dd/mm/yyyy"
          required={required}
          error={Boolean(error)}
          helperText={error ?? helperText}
          slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off', 'aria-invalid': Boolean(error) } }}
        />
      )}
      <input type="hidden" name={name} value={submitted} />
    </>
  );
}
