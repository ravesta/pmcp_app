'use client';

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** Properti formulir yang terkirim otomatis. */
interface AutoSubmitFormProps {
  /** Alamat tujuan formulir (GET). */
  readonly action: string;
  /** Nama yang dibacakan pembaca layar. */
  readonly label: string;
  readonly style?: CSSProperties;
  readonly children: ReactNode;
}

/**
 * Formulir GET yang langsung dikirim saat sebuah isian berubah (pilihan dropdown, kotak centang, atau isian teks
 * yang selesai diedit), sehingga filter berlaku tanpa tombol Terapkan seperti pada mockup. Pasangan tanggal (isian
 * `data-submit-group="dates"`) dikirim setelah fokus keluar dari keduanya, agar mengetik Dari lalu Sampai tidak terpotong. Halaman tujuan tetap
 * dirender server dan keadaan tetap berada di URL. Isian bertanda `data-defer-submit` (centang dalam dropdown pilihan
 * ganda) tidak mengirim sendiri; komponennya mengirim formulir saat panel ditutup.
 * Masukan: tujuan, label, gaya, dan isian sebagai anak. Keluaran: elemen formulir.
 * Efek samping: memasang pendengar peristiwa `change` dan `focusout` pada formulir; mengirim formulir (navigasi GET) saat berubah.
 * Rujukan: mockup v0.2 (filter Kanban berlaku saat diubah), NFR-05 (formulir tetap dapat dikirim dengan Enter).
 */
export function AutoSubmitForm({ action, label, style, children }: AutoSubmitFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return undefined;
    let pendingGroup = false;
    const submit = (): void => form.requestSubmit();
    /** Isian bergrup (`data-submit-group`) hanya menandai perubahan; pengiriman menunggu fokus keluar dari grup. */
    const onChange = (event: Event): void => {
      const target = event.target as HTMLElement;
      if (target.dataset.deferSubmit !== undefined) return;
      if (target.dataset.submitGroup) pendingGroup = true;
      else submit();
    };
    const onFocusOut = (event: FocusEvent): void => {
      const leaving = event.target as HTMLElement;
      const entering = event.relatedTarget as HTMLElement | null;
      if (!pendingGroup || leaving.dataset.submitGroup !== 'dates') return;
      if (entering?.dataset?.submitGroup === 'dates') return;
      pendingGroup = false;
      submit();
    };
    form.addEventListener('change', onChange);
    form.addEventListener('focusout', onFocusOut);
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    <form ref={formRef} method="get" action={action} role="search" aria-label={label} style={style}>
      {children}
      <noscript><button type="submit">Terapkan</button></noscript>
    </form>
  );
}
