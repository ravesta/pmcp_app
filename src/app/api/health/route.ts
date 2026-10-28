import { getContainer } from '@/platform/container';
import { loadConfig } from '@/platform/config';
import { createClockFor } from '@/platform/clock-provider';
import { log } from '@/platform/logger';

/** Health check harus selalu dihitung ulang, tidak di-cache. */
export const dynamic = 'force-dynamic';

/**
 * Health check untuk reverse proxy dan CI/CD: proses hidup dan database dapat dijangkau (`SELECT 1`).
 * Masukan: permintaan GET tanpa autentikasi. Keluaran: JSON status, versi, dan tanggal bisnis server; status 503 bila
 * database tidak dapat dijangkau. Tidak membuka detail internal.
 * Efek samping: satu kueri `SELECT 1`; mencatat log peringatan bila database gagal.
 * Rujukan: Technical Design §8 dan §15.
 */
export async function GET(): Promise<Response> {
  const config = loadConfig();
  const headers = { 'Cache-Control': 'no-store' };
  const clock = createClockFor(config);
  try {
    await getContainer().prisma.$queryRawUnsafe('SELECT 1');
  } catch (error) {
    log('warn', 'Health check: database tidak dapat dijangkau', { reason: error instanceof Error ? error.message.slice(0, 120) : 'tidak diketahui' });
    return Response.json({ status: 'database-tidak-tersedia', service: 'pmcp', version: config.appVersion, today: clock.today() }, { status: 503, headers });
  }
  return Response.json({ status: 'ok', service: 'pmcp', version: config.appVersion, today: clock.today() }, { headers });
}
