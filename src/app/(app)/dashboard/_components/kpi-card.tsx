import Link from 'next/link';
import styles from './dashboard.module.css';

/** Properti kartu ringkasan. */
interface KpiCardProps {
  readonly value: number;
  readonly label: string;
  /** Alamat layar terfilter; tanpa alamat kartu hanya menampilkan angka. */
  readonly href?: string;
  /** Penekanan warna bila angka lebih dari 0: `bad` (bahaya), `warn` (peringatan), atau `new` (Assignment baru). */
  readonly emphasis?: 'bad' | 'warn' | 'new';
  readonly title?: string;
}

/**
 * Kartu ringkasan angka besar dengan label. Bila bernilai lebih dari 0 diberi penekanan warna; bila diberi alamat, kartu
 * membuka layar terfilter yang jumlahnya sama dengan angka pada kartu (NFR-14).
 * Masukan: angka, label, alamat, penekanan, dan keterangan. Keluaran: kartu (tautan atau kotak).
 * Efek samping: tidak ada (komponen murni).
 * Rujukan: FR-04-01, FR-07-01, mockup v0.2 (kelas kpi).
 */
export function KpiCard({ value, label, href, emphasis, title }: KpiCardProps) {
  const className = `${styles.kpi} ${value > 0 && emphasis ? styles[emphasis] : ''}`;
  const body = <><b>{value}</b><span>{label}</span></>;
  return href ? <Link href={href} className={className} title={title}>{body}</Link> : <div className={className} title={title}>{body}</div>;
}
