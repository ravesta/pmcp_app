'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './multi-select-field.module.css';

/** Satu pilihan pada isian pilihan ganda. */
export interface Choice {
  readonly id: number;
  readonly label: string;
}

/** Properti isian pilihan ganda. */
interface MultiSelectFieldProps {
  /** Nama isian; setiap pilihan dikirim sebagai pasangan `name=id` (isian berulang). */
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<Choice>;
  readonly defaultIds?: ReadonlyArray<number>;
  readonly error?: string;
  readonly helperText?: string;
  /** Teks tombol bila belum ada pilihan (bawaan "Pilih"). */
  readonly placeholder?: string;
  /** Tampilkan kotak pencarian di panel. */
  readonly searchable?: boolean;
  /** Kirim formulir induk saat panel ditutup dan pilihan berubah (untuk filter yang berlaku langsung). */
  readonly submitOnClose?: boolean;
}

/**
 * Dropdown pilihan ganda bergaya mockup v0.2: tombol menampilkan tag terpilih, panel berisi kotak centang dengan
 * pencarian opsional. Centang berada di formulir sehingga terkirim sebagai isian berulang tanpa JavaScript tambahan.
 * Esc menutup panel; Enter pada kotak pencarian memilih atau melepas hasil pertama.
 * Masukan: nama, label, pilihan, id awal, galat, keterangan, petunjuk, pencarian, dan penanda kirim saat tutup. Keluaran: isian.
 * Efek samping: menyimpan pilihan dan buka/tutup panel di state komponen; mengirim formulir induk saat panel ditutup
 * setelah pilihan berubah bila `submitOnClose`.
 * Rujukan: handoff UX/UI §4 (pilihan ganda dengan pencarian: nama project, PIC, aplikasi), FR-02-01, FR-02-02, mockup v0.2 (kelas ms).
 */
export function MultiSelectField({ name, label, options, defaultIds = [], error, helperText, placeholder = 'Pilih', searchable = false, submitOnClose = false }: MultiSelectFieldProps) {
  const [selected, setSelected] = useState<ReadonlyArray<number>>(defaultIds);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const labelId = useId();
  const needle = query.trim().toLowerCase();
  const visible = options.filter((option) => !needle || option.label.toLowerCase().includes(needle));
  const tags = options.filter((option) => selected.includes(option.id));

  /** Menutup panel; bila pilihan berubah dan `submitOnClose`, mengirim formulir induk. Efek samping: state, requestSubmit. */
  function close(): void {
    if (!open) return;
    setOpen(false);
    if (submitOnClose && dirtyRef.current) rootRef.current?.closest('form')?.requestSubmit();
    dirtyRef.current = false;
  }

  /** Membalik status pilih satu pilihan. Efek samping: state pilihan. */
  function toggle(id: number): void {
    dirtyRef.current = true;
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  /** Enter pada pencarian memilih hasil pertama; Esc menutup. Efek samping: state. */
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (visible[0]) toggle(visible[0].id);
    }
  }

  // klik di luar komponen menutup panel
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // close membaca state terbaru lewat penutup efek ini; dipasang ulang tiap `open` berubah
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            close();
          }
        }}
      >
        <button type="button" className={`${styles.btn} ${error ? styles.btnError : ''}`} aria-haspopup="true" aria-expanded={open} aria-labelledby={labelId} onClick={() => (open ? close() : (setQuery(''), setOpen(true)))}>
          <span className={styles.val}>
            {tags.length > 0 ? tags.map((tag) => <span key={tag.id} className={styles.tag}>{tag.label}</span>) : <span className={styles.ph}>{placeholder}</span>}
          </span>
          <span className={styles.car} aria-hidden="true">▾</span>
        </button>
        <div className={styles.panel} hidden={!open} role="group" aria-label={label}>
          {searchable ? <input type="search" className={styles.q} placeholder="Ketik untuk mencari..." aria-label="Cari pilihan" autoComplete="off" data-defer-submit="" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} /> : null}
          <div className={styles.list}>
            {options.map((option) => (
              <label key={option.id} className={styles.opt} hidden={!visible.includes(option)}>
                <input type="checkbox" name={name} value={option.id} checked={selected.includes(option.id)} onChange={() => toggle(option.id)} data-defer-submit="" />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {options.length === 0 ? <div className={styles.none}>Belum ada pilihan.</div> : visible.length === 0 ? <div className={styles.none}>Tidak ada yang cocok</div> : null}
          {submitOnClose ? <div className={styles.foot}><button type="button" className={styles.done} onClick={close}>Terapkan</button></div> : null}
        </div>
      </div>
      {error ? <span className={styles.error} role="alert">{error}</span> : helperText ? <span className={styles.help}>{helperText}</span> : null}
    </div>
  );
}
