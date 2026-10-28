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
}

/**
 * Pembungkus isian bergaya mockup: label kecil di atas dan kontrol di bawahnya, dengan label terhubung ke kontrol.
 * Masukan: label, id kontrol, dan kontrol. Keluaran: blok isian.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: mockup v0.2 (kelas field), NFR-05 (label terhubung), handoff UX/UI §4.
 */
export function PlainField({ label, htmlFor, children }: PlainFieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
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
}

/**
 * Isian teks bergaya mockup (dirender server, tanpa JavaScript klien) untuk formulir GET.
 * Masukan: id, nama, label, nilai awal, dan petunjuk isian. Keluaran: isian berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] field 1 (Cari), mockup v0.2.
 */
export function PlainInput({ id, name, label, defaultValue, placeholder, maxLength, type = 'search' }: PlainInputProps) {
  return (
    <PlainField label={label} htmlFor={id}>
      <input id={id} name={name} type={type} className={styles.control} defaultValue={defaultValue} placeholder={placeholder} maxLength={maxLength} />
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
}

/**
 * Dropdown bawaan browser bergaya mockup, berfungsi tanpa JavaScript klien sehingga halaman tetap dirender server.
 * Masukan: id, nama, label, pilihan, nilai awal, dan label pilihan kosong. Keluaran: dropdown berlabel.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: Screen [010] (bar filter), mockup v0.2, handoff UX/UI §4 (Select).
 */
export function PlainSelect({ id, name, label, options, defaultValue = '', emptyLabel = 'Semua' }: PlainSelectProps) {
  return (
    <PlainField label={label} htmlFor={id}>
      <select id={id} name={name} className={styles.control} defaultValue={defaultValue}>
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
