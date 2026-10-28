/**
 * Proxy Next.js: memasang Content-Security-Policy bernonce pada setiap permintaan halaman.
 *
 * Nonce dibuat per permintaan, diteruskan ke Next.js lewat header permintaan `Content-Security-Policy` (Next.js
 * menempelkannya pada skrip miliknya) dan ke tata letak lewat `x-nonce` (untuk cache gaya MUI). Pemeriksaan sesi tetap
 * dilakukan di server pada setiap permintaan data, bukan di sini (TD-10).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, buildSecurityHeaders, createNonce } from '@/platform/security-headers';

/**
 * Menambahkan CSP bernonce pada permintaan dan respons.
 * Masukan: permintaan masuk. Keluaran: respons lanjutan dengan header CSP.
 * Efek samping: tidak ada selain membuat nonce acak dan menyetel header.
 * Rujukan: Security Design §8.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const csp = buildContentSecurityPolicy(nonce, appEnv === 'development' || appEnv === 'test');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  // HSTS ditentukan saat berjalan (bukan saat build): hanya staging dan produksi, yang wajib HTTPS (TR-07)
  for (const header of buildSecurityHeaders({ secureTransport: appEnv === 'production' || appEnv === 'staging' })) {
    if (header.key === 'Strict-Transport-Security') response.headers.set(header.key, header.value);
  }
  return response;
}

/** Semua halaman dan aksi; aset statis, gambar teroptimasi, dan ikon tidak memerlukan nonce. */
export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
