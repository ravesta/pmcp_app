/**
 * Use case ganti password sendiri (FR-01-02), termasuk penggantian wajib setelah password sementara.
 */
import { MESSAGES, passwordViolationMessage, throttledMessage } from '@/platform/messages';
import { formatClockTime, minutesUntil } from '@/shared/format';
import { fail, ok, type Result } from '@/shared/result';
import { can } from '../domain/actor';
import { validatePassword } from '../domain/password-policy';
import { lockedUntil, THROTTLE_RULES } from '../domain/throttle';
import { normalizeUsername } from '../domain/username';
import type { AuthDeps } from './ports';
import type { AuthenticatedSession } from './session-use-cases';

/** Masukan formulir Ubah Password. */
export interface ChangePasswordInput {
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
}

/**
 * Mengganti password milik sendiri.
 * Masukan: dependensi, sesi terautentikasi, dan isian formulir. Keluaran: berhasil (null), atau galat
 * VALIDATION dengan `fields` (current, next, confirm) atau THROTTLED. Salah password saat ini memakai
 * penghitung yang SAMA dengan login (EC-01-02.01).
 * Efek samping: dalam satu transaksi menyimpan hash baru, menghapus penanda wajib ganti, mengakhiri semua sesi
 * LAIN akun itu (sesi ini tetap), mereset penghitung login, dan mencatat audit Akun tanpa password.
 * Rujukan: FR-01-02, FR-01-05 butir 3, EC-01-02.01 sampai EC-01-02.04, Security Design §4.4.
 */
export async function changeOwnPassword(
  deps: AuthDeps,
  session: AuthenticatedSession,
  input: ChangePasswordInput,
): Promise<Result<null>> {
  const { actor } = session;
  if (!can(actor, 'password.changeOwn')) return fail({ code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN });
  const user = await deps.repository.findUserById(actor.userId);
  if (!user || !user.isActive) return fail({ code: 'AUTHENTICATION', message: MESSAGES.SESSION_REQUIRED });

  const fields: Record<string, string> = {};
  if (input.current.length === 0) fields.current = MESSAGES.PASSWORD_CURRENT_REQUIRED;
  const violations = validatePassword(input.next, { username: normalizeUsername(user.username), currentPassword: input.current });
  if (violations.length > 0) fields.next = passwordViolationMessage(violations[0] as string);
  if (input.next !== input.confirm) fields.confirm = MESSAGES.PASSWORD_CONFIRM_MISMATCH;
  if (Object.keys(fields).length > 0) {
    return fail({ code: 'VALIDATION', message: Object.values(fields)[0] as string, fields });
  }

  const now = deps.clock.now();
  const throttle = await deps.repository.getThrottle('USER', user.username);
  const lock = lockedUntil(throttle, now);
  if (lock) return fail({ code: 'THROTTLED', message: throttledMessage(formatClockTime(lock), minutesUntil(now, lock)) });

  const currentOk = await deps.hasher.verify(user.passwordHash, input.current);
  if (!currentOk) {
    await deps.repository.recordFailure('USER', user.username, { now, maxFailures: THROTTLE_RULES.userMaxFailures, lockMinutes: THROTTLE_RULES.lockMinutes });
    await deps.writeAudit(null, {
      actorUserId: user.id,
      actorLabel: user.displayName,
      category: 'SECURITY',
      action: 'password.change_failed',
      entityType: 'app_user',
      entityId: String(user.id),
      summary: 'Ganti password gagal: password saat ini salah',
    });
    return fail({ code: 'VALIDATION', message: MESSAGES.PASSWORD_CURRENT_WRONG, fields: { current: MESSAGES.PASSWORD_CURRENT_WRONG } });
  }

  const newHash = await deps.hasher.hash(input.next);
  await deps.transactor.run(async (tx) => {
    await deps.repository.updatePassword(tx, user.id, newHash, false, now);
    await deps.repository.revokeUserSessions(tx, user.id, now, session.tokenHash);
    await deps.repository.clearThrottle(tx, 'USER', user.username);
    await deps.writeAudit(tx, {
      actorUserId: user.id,
      actorLabel: user.displayName,
      category: 'ACCOUNT',
      action: 'account.password_changed',
      entityType: 'app_user',
      entityId: String(user.id),
      summary: `${user.displayName} mengganti password sendiri`,
    });
  });
  return ok(null);
}
