'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ChangeEvent } from 'react';
import styles from './plain-field.module.css';

/** Satu pilihan pada dropdown parameter URL. */
export interface ParamOption {
  readonly value: string;
  readonly label: string;
}

/** Properti dropdown parameter URL. */
interface UrlParamSelectProps {
  /** Nama parameter URL yang diubah. */
  readonly param: string;
  readonly value: string;
  readonly options: ReadonlyArray<ParamOption>;
  /** Nama yang dibacakan pembaca layar. */
  readonly label: string;
  /** Parameter yang dihapus saat nilai berubah (mis. nomor halaman kembali ke 1). */
  readonly resetParams?: ReadonlyArray<string>;
  /** Nilai bawaan; bila dipilih, parameter dihapus dari URL agar alamat tetap pendek. */
  readonly defaultValue?: string;
  /** Id untuk menautkan label terpisah (isian berlabel di atas). */
  readonly id?: string;
  /** Gaya isian formulir penuh lebar seperti mockup (bukan gaya ringkas bar periode). */
  readonly plain?: boolean;
}

/**
 * Dropdown yang langsung mengubah satu parameter URL saat dipilih dan menjaga parameter lain, sehingga halaman
 * tetap dirender server (tahan tombol kembali). Dipakai untuk periode Gantt dan ukuran halaman.
 * Masukan: nama parameter, nilai, pilihan, label, parameter yang direset, dan nilai bawaan. Keluaran: dropdown.
 * Efek samping: menavigasi ke alamat baru saat pilihan berubah.
 * Rujukan: FR-12-01 butir 2 dan 6 (periode, ukuran halaman; berganti ukuran kembali ke halaman 1), mockup v0.2.
 */
export function UrlParamSelect({ param, value, options, label, resetParams = [], defaultValue, id, plain = false }: UrlParamSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Menulis nilai terpilih ke URL dan menavigasi. Efek samping: router.push. */
  function onChange(event: ChangeEvent<HTMLSelectElement>): void {
    const next = new URLSearchParams(searchParams.toString());
    if (event.target.value === defaultValue) next.delete(param);
    else next.set(param, event.target.value);
    for (const name of resetParams) next.delete(name);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      id={id}
      className={plain ? styles.control : undefined}
      aria-label={label}
      value={value}
      onChange={onChange}
      style={plain ? undefined : { minHeight: 32, padding: '2px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', color: 'inherit', font: 'inherit' }}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
