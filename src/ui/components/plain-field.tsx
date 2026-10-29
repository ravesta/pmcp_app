import type { ReactNode } from 'react';
import styles from './plain-field.module.css';

/** Satu pilihan pada dropdown polos. */
export interface PlainOption {
  readonly value: string;
  readonly label: string;
}

/** Properti pembungkus isian. */
interface PlainFieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: ReactNode;
  /** Menandai isian wajib dengan tanda bintang merah. */
  readonly required?: boolean;
  /** Pesan galat atau keterangan di bawah kontrol. */
  readonly error?: string;
  readonly helperText?: string;
}

/**
 * Pembungkus isian bergaya mockup: label kecil di atas dan kontrol di bawahnya, dengan label terhubung ke kontrol.
 * Masukan: label, id kontrol, kontrol, penanda wajib, galat, dan keterangan. Keluaran: blok isian.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas field), NFR-05 (label terhubung), handoff UX/UI §4.
 */
export function PlainField({ label, htmlFor, children, required = false, error, helperText }: PlainFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}{required ? <> <span className={styles.star} aria-hidden="true">*</span></> : null}</label>
      {children}
      {error ? <span className={styles.error} role="alert">{error}</span> : helperText ? <span className={styles.help}>{helperText}</span> : null}
    </div>
  );
}

/** Properti isian teks polos. */
interface PlainInputProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly type?: 'text' | 'search';
  readonly required?: boolean;
  /** True bila isian hanya dapat dibaca (mis. ID Project); tampil berlatar abu-abu. */
  readonly readOnly?: boolean;
  readonly error?: string;
  readonly helperText?: string;
}

/**
 * Isian teks bergaya mockup (dirender server, tanpa JavaScript klien) untuk formulir GET.
 * Masukan: id, nama, label, nilai awal, dan petunjuk isian. Keluaran: isian berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] field 1 (Cari), mockup v0.2.
 */
export function PlainInput({ id, name, label, defaultValue, placeholder, maxLength, type = 'search', required, readOnly, error, helperText }: PlainInputProps) {
  return (
    <PlainField label={label} htmlFor={id} required={required} error={error} helperText={helperText}>
      <input id={id} name={name} type={type} className={styles.control} defaultValue={defaultValue} placeholder={placeholder} maxLength={maxLength} readOnly={readOnly} aria-readonly={readOnly || undefined} aria-invalid={error ? true : undefined} />
    </PlainField>
  );
}

/** Properti dropdown polos. */
interface PlainSelectProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<PlainOption>;
  readonly defaultValue?: string;
  /** Label pilihan kosong (bawaan "Semua"); null = tanpa pilihan kosong. */
  readonly emptyLabel?: string | null;
  readonly error?: string;
  /** Dipanggil dengan nilai terpilih saat berubah (isian tetap tak terkendali). */
  readonly onValueChange?: (value: string) => void;
}

/**
 * Dropdown bawaan browser bergaya mockup, berfungsi tanpa JavaScript klien sehingga halaman tetap dirender server.
 * Masukan: id, nama, label, pilihan, nilai awal, dan label pilihan kosong. Keluaran: dropdown berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] (bar filter), mockup v0.2, handoff UX/UI §4 (Select).
 */
export function PlainSelect({ id, name, label, options, defaultValue = '', emptyLabel = 'Semua', error, onValueChange }: PlainSelectProps) {
  return (
    <PlainField label={label} htmlFor={id} error={error}>
      <select id={id} name={name} className={styles.control} defaultValue={defaultValue} aria-invalid={error ? true : undefined} onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}>
        {emptyLabel === null ? null : <option value="">{emptyLabel}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </PlainField>
  );
}

/** Properti kotak centang pil. */
interface PlainCheckboxProps {
  readonly name: string;
  readonly label: string;
  readonly value?: string;
  readonly defaultChecked?: boolean;
  /** True bila berdiri sendiri di barisnya (tanpa ruang label kosong untuk sejajar dengan isian lain di grid). */
  readonly standalone?: boolean;
}

/**
 * Kotak centang berbentuk pil bergaya mockup (dirender server) untuk formulir GET.
 * Masukan: nama, label, nilai terkirim, keadaan awal, dan penanda berdiri sendiri. Keluaran: kotak centang berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] field 9 ("Hanya milik saya"), mockup v0.2 (kelas ck).
 */
export function PlainCheckbox({ name, label, value = '1', defaultChecked, standalone = false }: PlainCheckboxProps) {
  return (
    <div className={styles.field} style={standalone ? { alignSelf: 'flex-start' } : undefined}>
      {standalone ? null : <span className={styles.label} aria-hidden>&nbsp;</span>}
      <label className={styles.ck}>
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} /> {label}
      </label>
    </div>
  );
}

/** Properti area teks polos. */
interface PlainTextareaProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue?: string;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly error?: string;
  readonly helperText?: string;
}

/**
 * Area teks bergaya mockup (label kecil di atas, tepi tipis) untuk formulir.
 * Masukan: id, nama, label, nilai awal, batas panjang, tinggi, galat, dan keterangan. Keluaran: area teks berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [013] dan [015] (Deskripsi project), mockup v0.2 (textarea pada kelas field).
 */
export function PlainTextarea({ id, name, label, defaultValue, maxLength, rows = 3, error, helperText }: PlainTextareaProps) {
  return (
    <PlainField label={label} htmlFor={id} error={error} helperText={helperText}>
      <textarea id={id} name={name} className={styles.control} defaultValue={defaultValue} maxLength={maxLength} rows={rows} aria-invalid={error ? true : undefined} style={{ resize: 'vertical' }} />
    </PlainField>
  );
}
