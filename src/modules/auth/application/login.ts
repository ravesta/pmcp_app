/**
 * Use case login (FR-01-01): throttle per username dan per sumber alamat, pesan generik, sesi baru.
 */
import { MESSAGES, throttledMessage } from '@/platform/messages';
import { formatClockTime, minutesUntil } from '@/shared/format';
import { fail, ok, type Result } from '@/shared/result';
import { normalizeUsername } from '../domain/username';
import { lockedUntil, THROTTLE_RULES } from '../domain/throttle';
import type { AuthDeps } from './ports';

/** Masukan login dari formulir; `sourceAddress` diisi server dari header proxy tepercaya. */
export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly sourceAddress: string;
}

/** Hasil login berhasil: token mentah (hanya dikirim sekali lewat cookie) dan keadaan akun. */
export interface LoginSuccess {
  readonly token: string;
  readonly expiresAt: Date;
  readonly mustChangePassword: boolean;
}

/** Batas panjang kunci throttle pada database (varchar 100). */
const KEY_MAX = 100;

/** Penanda sumber alamat yang tidak dapat ditentukan; tidak dibuat penghitung agar tidak mengunci semua pengguna. */
const UNKNOWN_ADDRESS = 'tidak-diketahui';

/**
 * Memilih waktu penundaan terlama dari dua penghitung.
 * Masukan: dua waktu boleh-coba-lagi (atau null). Keluaran: yang terlama, atau null bila keduanya null.
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-01-01 butir 3.
 */
function latest(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a ?? b;
}

/**
 * Melakukan login dengan username dan password.
 * Masukan: dependensi dan `LoginInput`. Keluaran: token sesi dan status wajib ganti password, atau galat:
 * VALIDATION (isian kosong, tidak dihitung percobaan), THROTTLED (pesan sama untuk username dikenal maupun
 * tidak), AUTHENTICATION ("Username atau password salah." generik untuk username tak dikenal, password salah,
 * akun nonaktif).
 * Sumber alamat tak diketahui hanya dibatasi per username (tanpa penghitung IP bersama).
 * Efek samping: menulis penghitung throttle, membuat sesi, dan mencatat audit kategori Keamanan. Untuk username
 * tak dikenal, nilai yang diketik TIDAK dicatat (CL-056d).
 * Rujukan: FR-01-01 (butir 1 sampai 7), EC-01-01.01 sampai EC-01-01.03, Security Design §4.3.
 */
export async function login(deps: AuthDeps, input: LoginInput): Promise<Result<LoginSuccess>> {
  const username = normalizeUsername(input.username);
  if (username.length === 0 || input.password.length === 0) {
    return fail({ code: 'VALIDATION', message: MESSAGES.LOGIN_REQUIRED_FIELDS });
  }
  const userKey = username.slice(0, KEY_MAX);
  const ipKey = input.sourceAddress.slice(0, KEY_MAX) || UNKNOWN_ADDRESS;
  const trackIp = ipKey !== UNKNOWN_ADDRESS;
  const now = deps.clock.now();
  const repo = deps.repository;

  const [userState, ipState] = await Promise.all([repo.getThrottle('USER', userKey), trackIp ? repo.getThrottle('IP', ipKey) : Promise.resolve(null)]);
  const user = await repo.findUserByUsername(username);

  const lock = latest(lockedUntil(userState, now), lockedUntil(ipState, now));
  if (lock) {
    await deps.writeAudit(null, {
      actorUserId: user?.id ?? null,
      actorLabel: user ? user.displayName : 'Tidak dikenal',
      category: 'SECURITY',
      action: 'login.throttled',
      entityType: 'session',
      summary: 'Percobaan login ditolak karena penundaan',
    });
    return fail({ code: 'THROTTLED', message: throttledMessage(formatClockTime(lock), minutesUntil(now, lock)) });
  }

  let valid = false;
  if (user && user.isActive) valid = await deps.hasher.verify(user.passwordHash, input.password);
  else await deps.hasher.verifyDummy(input.password);

  if (!valid || !user) {
    await Promise.all([
      repo.recordFailure('USER', userKey, { now, maxFailures: THROTTLE_RULES.userMaxFailures, lockMinutes: THROTTLE_RULES.lockMinutes }),
      trackIp
        ? repo.recordFailure('IP', ipKey, { now, maxFailures: THROTTLE_RULES.ipMaxFailures, lockMinutes: THROTTLE_RULES.lockMinutes, windowMinutes: THROTTLE_RULES.ipWindowMinutes })
        : Promise.resolve(),
    ]);
    await deps.writeAudit(null, {
      actorUserId: user?.id ?? null,
      actorLabel: user ? user.displayName : 'Tidak dikenal',
      category: 'SECURITY',
      action: 'login.failed',
      entityType: 'session',
      summary: user ? `Login gagal untuk ${user.username}` : 'Login gagal untuk username tidak dikenal',
    });
    return fail({ code: 'AUTHENTICATION', message: MESSAGES.LOGIN_FAILED });
  }

  const token = deps.tokens.generate();
  const expiresAt = new Date(now.getTime() + deps.sessionAbsoluteMinutes * 60_000);
  await deps.transactor.run(async (tx) => {
    await repo.clearThrottle(tx, 'USER', userKey);
    await repo.createSession(tx, { tokenHash: deps.tokens.hash(token), userId: user.id, now, expiresAt });
    await deps.writeAudit(tx, {
      actorUserId: user.id,
      actorLabel: user.displayName,
      category: 'SECURITY',
      action: 'login.succeeded',
      entityType: 'session',
      summary: `Login berhasil untuk ${user.username}`,
    });
  });
  return ok({ token, expiresAt, mustChangePassword: user.mustChangePassword });
}
