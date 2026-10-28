/**
 * Implementasi Prisma untuk akses data auth (akun, sesi, throttle).
 */
import type { PrismaClient } from '@/generated/prisma/client';
import type { TxContext } from '@/shared/transaction';
import type { StageKind } from '../domain/actor';
import type { ThrottleState } from '../domain/throttle';
import type { AuthRepository, SessionRecord, ThrottleScope, UserRecord } from '../application/ports';

/** Delegasi model yang dipakai; dimiliki bersama oleh klien dan transaksi Prisma. */
type Db = Pick<PrismaClient, 'app_user' | 'session' | 'login_throttle'>;

/**
 * Mengambil klien atau transaksi yang dipakai sebuah operasi.
 * Masukan: klien dasar dan konteks transaksi opsional. Keluaran: delegasi Prisma.
 * Efek samping: tidak ada.
 * Rujukan: Technical Design §6.1 (satu use case = satu transaksi).
 */
function pick(base: PrismaClient, tx: TxContext | null): Db {
  return (tx as unknown as Db | null) ?? base;
}

/** Bentuk baris akun beserta PIC yang dibaca dari database. */
interface UserRow {
  id: bigint;
  username: string;
  role: 'MANAGER' | 'PIC';
  pic_id: bigint | null;
  password_hash: string;
  must_change_password: boolean;
  is_active: boolean;
  pic: { name: string; stage: StageKind } | null;
}

/**
 * Mengubah baris database menjadi `UserRecord` domain.
 * Masukan: baris akun dengan relasi PIC. Keluaran: `UserRecord` (id sebagai number).
 * Efek samping: tidak ada (fungsi murni).
 * Rujukan: FR-01-04 butir 2.
 */
function toUserRecord(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    picId: row.pic_id === null ? null : Number(row.pic_id),
    picStage: row.pic ? row.pic.stage : null,
    displayName: row.pic ? row.pic.name : 'Manager',
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
  };
}

/**
 * Membuat repository auth di atas klien Prisma.
 * Masukan: klien Prisma. Keluaran: `AuthRepository`.
 * Efek samping: tidak ada pada pembuatan; metode yang dikembalikan membaca dan menulis tabel auth.
 * Rujukan: Technical Design §6.1, database-design §3.
 */
export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    /** Mencari akun menurut username ternormalisasi. Efek samping: tidak ada. Rujukan: FR-01-01. */
    async findUserByUsername(username) {
      const row = await prisma.app_user.findUnique({ where: { username }, include: { pic: true } });
      return row ? toUserRecord(row as unknown as UserRow) : null;
    },

    /** Mencari akun menurut id. Efek samping: tidak ada. Rujukan: FR-01-04. */
    async findUserById(userId) {
      const row = await prisma.app_user.findUnique({ where: { id: BigInt(userId) }, include: { pic: true } });
      return row ? toUserRecord(row as unknown as UserRow) : null;
    },

    /** Membuat sesi baru. Efek samping: INSERT `session`. Rujukan: FR-01-01. */
    async createSession(tx, session) {
      await pick(prisma, tx).session.create({
        data: {
          token_hash: Buffer.from(session.tokenHash),
          user_id: BigInt(session.userId),
          created_at: session.now,
          last_seen_at: session.now,
          expires_at: session.expiresAt,
        },
      });
    },

    /** Mencari sesi menurut hash token. Efek samping: tidak ada. Rujukan: FR-01-01 butir 5. */
    async findSession(tokenHash): Promise<SessionRecord | null> {
      const row = await prisma.session.findUnique({ where: { token_hash: Buffer.from(tokenHash) } });
      if (!row) return null;
      return {
        tokenHash,
        userId: Number(row.user_id),
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      };
    },

    /** Memperbarui `last_seen_at`. Efek samping: UPDATE `session`. Rujukan: Security Design §5. */
    async touchSession(tokenHash, now) {
      await prisma.session.update({ where: { token_hash: Buffer.from(tokenHash) }, data: { last_seen_at: now } });
    },

    /** Mencabut satu sesi bila masih aktif. Efek samping: UPDATE `session`. Rujukan: FR-01-03. */
    async revokeSession(tokenHash, now) {
      await prisma.session.updateMany({ where: { token_hash: Buffer.from(tokenHash), revoked_at: null }, data: { revoked_at: now } });
    },

    /** Mencabut semua sesi aktif pengguna, kecuali satu. Efek samping: UPDATE `session`. Rujukan: FR-01-02, FR-01-05. */
    async revokeUserSessions(tx, userId, now, exceptTokenHash) {
      await pick(prisma, tx).session.updateMany({
        where: {
          user_id: BigInt(userId),
          revoked_at: null,
          ...(exceptTokenHash ? { NOT: { token_hash: Buffer.from(exceptTokenHash) } } : {}),
        },
        data: { revoked_at: now },
      });
    },

    /** Membaca penghitung throttle. Efek samping: tidak ada. Rujukan: FR-01-01 butir 3. */
    async getThrottle(scope: ThrottleScope, key: string): Promise<ThrottleState | null> {
      const row = await prisma.login_throttle.findUnique({ where: { scope_key: { scope, key } } });
      return row ? { failures: row.failures, lockedUntil: row.locked_until, updatedAt: row.updated_at } : null;
    },

    /**
     * Mencatat satu kegagalan dengan satu pernyataan UPSERT atomik: siklus baru dimulai dari 1 bila penundaan sudah lewat
     * atau jendela habis, selain itu bertambah satu; penundaan dipasang saat ambang tercapai. Efek samping: UPSERT
     * `login_throttle`. Rujukan: FR-01-01 butir 3, aturan sama dengan `afterFailure`.
     */
    async recordFailure(scope, key, rule) {
      const reset = 'CASE WHEN (t.locked_until IS NOT NULL AND t.locked_until <= $3::timestamptz) OR ($6::int IS NOT NULL AND $3::timestamptz - t.updated_at > make_interval(mins => $6::int)) THEN 1 ELSE t.failures + 1 END';
      const rows = await prisma.$queryRawUnsafe<Array<{ failures: number; locked_until: Date | null; updated_at: Date }>>(
        `INSERT INTO login_throttle AS t (scope, key, failures, locked_until, updated_at)
         VALUES ($1, $2, 1, CASE WHEN 1 >= $4::int THEN $3::timestamptz + make_interval(mins => $5::int) END, $3::timestamptz)
         ON CONFLICT (scope, key) DO UPDATE SET
           failures = ${reset},
           locked_until = CASE WHEN ${reset} >= $4::int THEN $3::timestamptz + make_interval(mins => $5::int) ELSE NULL END,
           updated_at = $3::timestamptz
         RETURNING failures, locked_until, updated_at`,
        scope,
        key,
        rule.now,
        rule.maxFailures,
        rule.lockMinutes,
        rule.windowMinutes ?? null,
      );
      const row = rows[0] as { failures: number; locked_until: Date | null; updated_at: Date };
      return { failures: row.failures, lockedUntil: row.locked_until, updatedAt: row.updated_at };
    },

    /** Menghapus penghitung throttle. Efek samping: DELETE `login_throttle`. Rujukan: FR-01-01 butir 3, FR-01-05 butir 4. */
    async clearThrottle(tx, scope, key) {
      await pick(prisma, tx).login_throttle.deleteMany({ where: { scope, key } });
    },

    /** Menyimpan hash password baru. Efek samping: UPDATE `app_user`. Rujukan: FR-01-02, FR-01-05. */
    async updatePassword(tx, userId, passwordHash, mustChange, now) {
      await pick(prisma, tx).app_user.update({
        where: { id: BigInt(userId) },
        data: { password_hash: passwordHash, must_change_password: mustChange, password_changed_at: now },
      });
    },
  };
}
