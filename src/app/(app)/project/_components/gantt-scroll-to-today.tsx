'use client';

import { useEffect, useRef } from 'react';

/** Properti penggulir ke garis hari ini. */
interface GanttScrollToTodayProps {
  /** Berubah bila periode atau skala berganti, sehingga grafik digulir ulang. */
  readonly signature: string;
}

/**
 * Menggulir kotak Gantt secara mendatar agar garis "hari ini" berada sekitar sepertiga dari kiri area terlihat, seperti
 * mockup saat grafik dibuka. Tanpa garis hari ini (periode di luar hari ini) posisi gulir tidak diubah.
 * Masukan: tanda periode dan skala. Keluaran: tidak ada tampilan (penanda tak terlihat).
 * Efek samping: mengubah `scrollLeft` kotak Gantt terdekat (elemen ber-`data-gantt-box`) setelah dirender.
 * Rujukan: mockup v0.2 (gBox.scrollLeft pada ganttBody), FR-12-01.
 */
export function GanttScrollToToday({ signature }: GanttScrollToTodayProps) {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = markerRef.current?.closest<HTMLElement>('[data-gantt-box]');
    const today = box?.querySelector<HTMLElement>('[data-today]');
    if (!box || !today) return;
    box.scrollLeft = Math.max(0, box.scrollLeft + today.getBoundingClientRect().left - box.getBoundingClientRect().left - box.clientWidth / 3);
  }, [signature]);

  return <span ref={markerRef} hidden />;
}
