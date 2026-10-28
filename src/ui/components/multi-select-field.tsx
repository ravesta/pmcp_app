'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { useEffect, useId, useRef, useState } from 'react';
import { PlainField } from './plain-field';
import styles from './plain-field.module.css';

/** Satu pilihan pada isian pilihan ganda. */
export interface Choice {
  readonly id: number;
  readonly label: string;
}

/** Nama peristiwa DOM yang dikirim saat pilihan berubah, agar bar filter dapat menerapkan perubahan langsung. */
export const MULTI_SELECT_CHANGE_EVENT = 'pmcp:multiselect-change';

/** Properti isian pilihan ganda. */
interface MultiSelectFieldProps {
  /** Nama isian; setiap pilihan dikirim sebagai pasangan `name=id` (isian berulang). */
  readonly name: string;
  readonly label: string;
  readonly options: ReadonlyArray<Choice>;
  readonly defaultIds?: ReadonlyArray<number>;
  readonly error?: string;
  readonly helperText?: string;
  /** Tampilan polos seperti mockup (label di atas, petunjuk di dalam); bila false memakai kotak MUI. */
  readonly plain?: boolean;
  /** Petunjuk saat belum ada pilihan (tampilan polos). */
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * Isian pilihan ganda dengan pencarian (Autocomplete) yang mengirim id terpilih sebagai isian tersembunyi berulang.
 * Masukan: nama, label, pilihan, id awal, galat, keterangan, gaya, dan petunjuk. Keluaran: isian dan isian tersembunyi.
 * Efek samping: menyimpan pilihan di state komponen; setiap perubahan pilihan mengirim peristiwa `pmcp:multiselect-change`.
 * Rujukan: handoff UX/UI §4 (pilihan ganda dengan pencarian: nama project, PIC, aplikasi), FR-02-01, FR-02-02, mockup v0.2 (ms-btn).
 */
export function MultiSelectField({ name, label, options, defaultIds = [], error, helperText, plain = false, placeholder, className }: MultiSelectFieldProps) {
  const id = useId();
  const [selected, setSelected] = useState<Choice[]>(options.filter((o) => defaultIds.includes(o.id)));
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    root.current?.dispatchEvent(new CustomEvent(MULTI_SELECT_CHANGE_EVENT, { bubbles: true }));
  }, [selected]);

  const autocomplete = (
    <Autocomplete
      multiple
      id={id}
      options={[...options]}
      value={selected}
      onChange={(_event, next) => setSelected(next)}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText="Tidak ada pilihan"
      slotProps={plain ? { chip: { size: 'small' } } : undefined}
      renderInput={(params) =>
        plain ? (
          <div ref={params.slotProps.input.ref} onMouseDown={params.slotProps.input.onMouseDown} className={styles.msBox} data-invalid={error ? 'true' : undefined}>
            {params.slotProps.input.startAdornment}
            <input {...params.slotProps.htmlInput} placeholder={selected.length === 0 ? placeholder : undefined} />
            <span className={styles.caret} aria-hidden>▾</span>
          </div>
        ) : (
          <TextField {...params} label={label} error={Boolean(error)} helperText={error ?? helperText} />
        )
      }
    />
  );
  return (
    <div ref={root} className={className} style={{ minWidth: 0 }}>
      {plain ? <PlainField label={label} htmlFor={id} error={error} hint={helperText}>{autocomplete}</PlainField> : autocomplete}
      {selected.map((choice) => (
        <input key={choice.id} type="hidden" name={name} value={choice.id} />
      ))}
    </div>
  );
}
