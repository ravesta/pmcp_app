'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './multi-select-field.module.css';

/** Satu pilihan pada dropdown pilihan tunggal yang dapat dicari. */
export interface SearchOption {
  readonly value: string;
  /** Teks pilihan (tampil pada tombol setelah dipilih). */
  readonly label: string;
  /** Teks tambahan untuk pencarian (mis. kode dan status). */
  readonly searchText?: string;
  /** Penanda di kanan pilihan (mis. chip status). */
  readonly trailing?: ReactNode;
}

/** Properti dropdown pilihan tunggal yang dapat dicari. */
interface SearchSelectFieldProps {
  /** Nama isian tersembunyi yang dikirim bersama formulir. */
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<SearchOption>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly searchPlaceholder: string;
  readonly error?: string;
  readonly helperText?: string;
}

/**
 * Dropdown pilihan tunggal dengan kotak pencarian bergaya mockup v0.2 (kelas ss): tombol berisi pilihan terpilih, panel
 * berisi kotak cari dan daftar pilihan. Enter memilih hasil pertama; Esc menutup panel; klik di luar menutup panel.
 * Masukan: nama, label, pilihan, nilai, penanganan perubahan, petunjuk, galat, dan keterangan. Keluaran: isian.
 * Efek samping: menyimpan buka/tutup panel dan kata cari di state komponen; memanggil `onChange` saat memilih.
 * Rujukan: handoff UX/UI §4 (pilih project dengan pencarian), FR-17-01, mockup v0.2 (kelas ss, fungsi ssPick).
 */
export function SearchSelectField({ name, label, options, value, onChange, placeholder, searchPlaceholder, error, helperText }: SearchSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const needle = query.trim().toLowerCase();
  const visible = options.filter((option) => !needle || `${option.label} ${option.searchText ?? ''}`.toLowerCase().includes(needle));
  const selected = options.find((option) => option.value === value);

  /** Memilih satu pilihan lalu menutup panel. Efek samping: state dan `onChange`. */
  function pick(next: string): void {
    onChange(next);
    setOpen(false);
  }

  /** Enter pada pencarian memilih hasil pertama. Efek samping: state dan `onChange`. */
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (visible[0]) pick(visible[0].value);
  }

  // klik di luar komponen menutup panel
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className={styles.field}>
      <span className={styles.label} id={labelId}>{label}</span>
      <div
        className={styles.ms}
        ref={rootRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <button type="button" className={`${styles.btn} ${error ? styles.btnError : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={labelId} onClick={() => (open ? setOpen(false) : (setQuery(''), setOpen(true)))}>
          <span className={styles.val}>{selected ? selected.label : <span className={styles.ph}>{placeholder}</span>}</span>
          <span className={styles.car} aria-hidden="true">▾</span>
        </button>
        <input type="hidden" name={name} value={value} />
        <div className={styles.panel} hidden={!open}>
          <input type="search" className={styles.q} placeholder={searchPlaceholder} aria-label={label} autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} />
          <div className={styles.list} role="listbox">
            {visible.map((option) => (
              <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={styles.opt} style={{ justifyContent: 'space-between', width: '100%', background: 'none', border: 0, textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => pick(option.value)}>
                <span>{option.label}</span>
                {option.trailing}
              </button>
            ))}
          </div>
          {visible.length === 0 ? <div className={styles.none}>Tidak ada yang cocok</div> : null}
        </div>
      </div>
      {error ? <span className={styles.error} role="alert">{error}</span> : helperText ? <span className={styles.help}>{helperText}</span> : null}
    </div>
  );
}
