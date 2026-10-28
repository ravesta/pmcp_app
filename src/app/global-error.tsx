'use client';

/**
 * Batas galat terakhir bila kerangka halaman sendiri gagal dirender; memakai elemen html dan body sendiri tanpa tema.
 * Masukan: galat dan fungsi mencoba ulang. Keluaran: halaman galat sederhana dengan tombol "Coba lagi".
 * Efek samping: tombol memanggil `reset`.
 * Rujukan: EC-15-01.01.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: 'sans-serif', padding: 24 }}>
        <p role="alert">Gagal memuat halaman. Periksa koneksi Anda lalu coba lagi.{error.digest ? ` (Kode galat: ${error.digest})` : ''}</p>
        <button type="button" onClick={reset}>Coba lagi</button>
      </body>
    </html>
  );
}
