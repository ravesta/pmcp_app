import Link from 'next/link';
import styles from './gantt.module.css';

/** Properti legenda Gantt. */
interface GanttLegendProps {
  readonly showLayers: boolean;
  /** Alamat untuk menyalakan atau mematikan lapisan estimasi awal dan aktual. */
  readonly toggleHref: string;
}

/**
 * Legenda warna dan penanda Gantt beserta pilihan "Tampilkan estimasi awal & aktual".
 * Masukan: keadaan lapisan dan alamat pengalih. Keluaran: baris legenda.
 * Efek samping: tidak ada (komponen murni; pengalih berupa tautan).
 * Rujukan: FR-12-01 butir 8 (legenda warna dan penanda), FR-12-02 butir 7, mockup v0.2 (kelas legend).
 */
export function GanttLegend({ showLayers, toggleHref }: GanttLegendProps) {
  return (
    <div className={styles.legend}>
      <span><i style={{ background: 'var(--ba)' }} />BA</span>
      <span><i style={{ background: 'var(--dev)' }} />Development</span>
      <span><i style={{ background: 'var(--qa)' }} />QA</span>
      <span><i style={{ background: 'repeating-linear-gradient(45deg,rgba(255,184,64,.93) 0 3px,rgba(176,98,0,.93) 3px 6px)' }} />Tambahan waktu hasil revisi (setelah estimasi awal)</span>
      <span><i style={{ background: 'repeating-linear-gradient(45deg,var(--late) 0 3px,#7d2318 3px 6px)' }} />Telat dari estimasi terkini</span>
      <span><i style={{ background: 'var(--soft)', border: '1px solid var(--line)' }} />Akhir pekan</span>
      <span><i style={{ background: 'var(--today)', width: 3 }} />Hari ini</span>
      <span><i style={{ border: '2px dashed var(--muted)', background: 'transparent' }} />Estimasi awal (bila direvisi)</span>
      <span><i style={{ background: 'var(--ink)', height: 4 }} />Aktual</span>
      <span><i style={{ background: 'repeating-linear-gradient(45deg,var(--hold),var(--hold) 3px,#7a64b3 3px,#7a64b3 6px)' }} />Ditahan ⏸</span>
      <span>Rn = direvisi n kali</span>
      <span><i style={{ background: 'transparent', boxShadow: 'inset 0 0 0 2px var(--late)' }} />Selesai terlambat</span>
      <span>◀ ▶ = bar berlanjut di luar periode. Bagian gelap = progres.</span>
      <Link href={toggleHref} className={`${styles.ck} ${showLayers ? styles.on : ''}`} aria-pressed={showLayers}>
        <span className={styles.cbx} data-on={showLayers} aria-hidden /> Tampilkan estimasi awal &amp; aktual
      </Link>
    </div>
  );
}
