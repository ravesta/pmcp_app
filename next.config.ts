import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/platform/security-headers';

/** Asal aplikasi di belakang proxy; dipakai Server Action untuk memeriksa `Origin` (CSRF, Security Design §8). */
const appHost = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).host : undefined;

/**
 * Konfigurasi Next.js PMCP.
 * Tujuan: menghasilkan artefak `standalone` (satu proses Node di server lokal, Technical Design §15), tidak
 * membocorkan `X-Powered-By`, memasang header keamanan, dan membatasi asal Server Action.
 * Efek samping: tidak ada (hanya objek konfigurasi).
 * Rujukan: Technology Baseline §6, Technical Design §15, Security Design §8.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: appHost ? { serverActions: { allowedOrigins: [appHost] } } : undefined,
  async headers() {
    // HSTS dipasang oleh proxy.ts saat berjalan karena APP_ENV tidak tentu saat build
    const securityHeaders = buildSecurityHeaders({ secureTransport: false });
    // Aset statis bernama hash boleh di-cache; semua yang lain tidak (respons ber-sesi).
    return [{ source: '/((?!_next/static|_next/image).*)', headers: securityHeaders.map((h) => ({ ...h })) }];
  },
};

export default nextConfig;
