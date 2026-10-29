import styles from './dashboard.module.css';

/** Properti bar progres tahapan pada tabel Dashboard. */
interface StageProgressBarProps {
  /** Progres 0..100. */
  readonly value: number;
  /** True bila angka adalah penyesuaian manual (ditandai `*`). */
  readonly manual: boolean;
}

/**
 * Bar progres tipis dengan angka persen di sampingnya; `*` menandai angka manual. Angka selalu terlihat, tidak hanya bar.
 * Masukan: nilai dan penanda manual. Keluaran: bar dan teks persen.
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-05-02, mockup v0.2 (fungsi dprog), NFR-05.
 */
export function StageProgressBar({ value, manual }: StageProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={styles.dprog}>
      <div className={styles.bar} role="img" aria-label={`Progres ${clamped}%`}><i style={{ width: `${clamped}%` }} /></div>
      <span className={`${styles.mono} ${styles.small}`}>{clamped}%{manual ? '*' : ''}</span>
    </div>
  );
}
