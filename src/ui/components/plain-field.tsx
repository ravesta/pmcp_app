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
  /** Menampilkan tanda bintang merah untuk isian wajib. */
  readonly required?: boolean;
  /** Pesan galat (merah) atau keterangan (abu-abu) di bawah isian. */
  readonly error?: string;
  readonly hint?: string;
  /** Kelas tambahan untuk penempatan pada grid (mis. rentang kolom). */
  readonly className?: string;
}

/**
 * Pembungkus isian bergaya mockup: label kecil di atas dan kontrol di bawahnya, dengan label terhubung ke kontrol.
 * Masukan: label, id kontrol, dan kontrol. Keluaran: blok isian.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas field), NFR-05 (label terhubung), handoff UX/UI §4.
 */
export function PlainField({ label, htmlFor, children, required, error, hint, className }: PlainFieldProps) {
  return (
    <div className={className ? `${styles.field} ${className}` : styles.field}>
      <label htmlFor={htmlFor}>{label}{required ? <span className={styles.req} aria-hidden> *</span> : null}</label>
      {children}
      {error ? <span className={styles.err} role="alert">{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
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
  readonly disabled?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly className?: string;
  /** Nilai tetap (untuk isian yang hanya dibaca, mis. ID Project). */
  readonly value?: string;
}

/**
 * Isian teks bergaya mockup (dirender server, tanpa JavaScript klien) untuk formulir GET.
 * Masukan: id, nama, label, nilai awal, dan petunjuk isian. Keluaran: isian berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] field 1 (Cari), mockup v0.2.
 */
export function PlainInput({ id, name, label, defaultValue, placeholder, maxLength, type = 'search', required, disabled, error, hint, className, value }: PlainInputProps) {
  const valueProps = value === undefined ? { defaultValue } : { value, readOnly: true };
  return (
    <PlainField label={label} htmlFor={id} required={required} error={error} hint={hint} className={className}>
      <input id={id} name={name} type={type} className={styles.control} {...valueProps} placeholder={placeholder} maxLength={maxLength} disabled={disabled} aria-invalid={error ? true : undefined} />
    </PlainField>
  );
}

/** Properti area teks polos. */
interface PlainTextareaProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly rows?: number;
  readonly error?: string;
  readonly className?: string;
}

/**
 * Area teks bergaya mockup (label di atas, tepi tipis) untuk deskripsi panjang.
 * Masukan: id, nama, label, nilai awal, petunjuk, dan galat. Keluaran: isian berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [013] (Deskripsi project), mockup v0.2.
 */
export function PlainTextarea({ id, name, label, defaultValue, placeholder, maxLength, rows = 3, error, className }: PlainTextareaProps) {
  return (
    <PlainField label={label} htmlFor={id} error={error} className={className}>
      <textarea id={id} name={name} className={styles.control} rows={rows} defaultValue={defaultValue} placeholder={placeholder} maxLength={maxLength} aria-invalid={error ? true : undefined} />
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
  readonly required?: boolean;
  readonly error?: string;
  readonly className?: string;
  /** Dipanggil saat pilihan berubah (hanya untuk pemakaian di komponen klien). */
  readonly onValueChange?: (value: string) => void;
}

/**
 * Dropdown bawaan browser bergaya mockup, berfungsi tanpa JavaScript klien sehingga halaman tetap dirender server.
 * Masukan: id, nama, label, pilihan, nilai awal, dan label pilihan kosong. Keluaran: dropdown berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] (bar filter), mockup v0.2, handoff UX/UI §4 (Select).
 */
export function PlainSelect({ id, name, label, options, defaultValue = '', emptyLabel = 'Semua', required, error, className, onValueChange }: PlainSelectProps) {
  return (
    <PlainField label={label} htmlFor={id} required={required} error={error} className={className}>
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
  /** True bila berdiri sendiri pada barisnya (tanpa ruang label kosong di atasnya). */
  readonly inline?: boolean;
}

/**
 * Kotak centang berbentuk pil bergaya mockup (dirender server) untuk formulir GET.
 * Masukan: nama, label, nilai terkirim, dan keadaan awal. Keluaran: kotak centang berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] field 9 ("Hanya milik saya"), mockup v0.2 (kelas ck).
 */
export function PlainCheckbox({ name, label, value = '1', defaultChecked, inline = false }: PlainCheckboxProps) {
  const box = (
    <label className={styles.ck}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} /> {label}
    </label>
  );
  if (inline) return <div className={styles.inlineCk}>{box}</div>;
  return (
    <div className={styles.field}>
      <span className={styles.label} aria-hidden>&nbsp;</span>
      {box}
    </div>
  );
}
