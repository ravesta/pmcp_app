/**
 * Header keamanan respons PMCP (Security Design §8): CSP, HSTS, nosniff, referrer, permissions, dan no-store.
 *
 * Disusun di satu tempat agar dapat diuji dan dipakai `next.config.ts`. Fungsi di sini murni.
 */

/** Pasangan nama dan nilai header. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

/** Pilihan penyusunan header. */
export interface SecurityHeaderOptions {
  /** True hanya bila diterapkan di belakang HTTPS (staging dan produksi): mengaktifkan HSTS. */
  readonly secureTransport: boolean;
}

/**
 * Menyusun Content-Security-Policy bernonce. Skrip hanya boleh yang bernonce (`strict-dynamic` meneruskan kepercayaan ke
 * skrip yang dimuatnya); `<style>` hanya yang bernonce (cache gaya Emotion/MUI diberi nonce yang sama); atribut `style`
 * pada elemen diizinkan terpisah karena nonce tidak berlaku untuk atribut. Tidak boleh di-frame, tidak ada `object`, dan
 * form hanya ke asal sendiri.
 * Masukan: nonce permintaan dan penanda pengembangan (Next dev memerlukan `eval` dan gaya inline). Keluaran: nilai CSP.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Security Design §8 (CSP ketat dengan nonce untuk skrip).
 */
export function buildContentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // di pengembangan Next.js menyisipkan gaya tanpa nonce; 'unsafe-inline' diabaikan browser bila nonce ada
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * Membuat nonce acak untuk satu permintaan (16 byte, base64).
 * Masukan: tidak ada. Keluaran: teks nonce.
 * Efek samping: membaca sumber acak kriptografis (Web Crypto, tersedia di runtime proxy).
 * Rujukan: Security Design §8.
 */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Menyusun header keamanan statis untuk halaman dan respons ber-sesi (CSP dipasang per permintaan oleh `proxy.ts`).
 * Masukan: `SecurityHeaderOptions`. Keluaran: daftar header; HSTS hanya bila `secureTransport`.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: Security Design §8, Technology Baseline TR-07.
 */
export function buildSecurityHeaders(options: SecurityHeaderOptions): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cache-Control', value: 'no-store' },
  ];
  if (options.secureTransport) headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' });
  return headers;
}
