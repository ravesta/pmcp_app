/**
 * Port modul auth: akses data akun, sesi, dan throttle, serta layanan hash dan token.
 * Diimplementasikan oleh lapisan infrastructure; application hanya mengenal antarmuka ini.
 */
import type { AuditWriter } from '@/shared/audit';
import type { Clock } from '@/shared/clock';
import type { Transactor, TxContext } from '@/shared/transaction';
import type { StageKind } from '../domain/actor';
import type { SessionTimes } from '../domain/session-rules';
import type { ThrottleState } from '../domain/throttle';

/** Akun login beserta data PIC bila ada. */
export interface UserRecord {
  readonly id: number;
  readonly username: string;
  readonly role: 'MANAGER' | 'PIC';
  readonly picId: number | null;
  readonly picStage: StageKind | null;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly isActive: boolean;
}

/** Sesi tersimpan beserta pemiliknya. */
export interface SessionRecord extends SessionTimes {
  readonly tokenHash: Uint8Array;
  readonly userId: number;
}

/** Cakupan penghitung kegagalan login. */
export type ThrottleScope = 'USER' | 'IP';

/** Akses data auth. Semua metode yang menulis menerima `tx` opsional (null = transaksi kecil sendiri). */
/** Aturan pencatatan satu kegagalan login (lihat `THROTTLE_RULES`). */
export interface FailureRule {
  readonly now: Date;
  readonly maxFailures: number;
  readonly lockMinutes: number;
  /** Kegagalan lebih tua dari jendela ini tidak dihitung; kosong = tanpa jendela. */
  readonly windowMinutes?: number;
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<UserRecord | null>;
  findUserById(userId: number): Promise<UserRecord | null>;
  createSession(tx: TxContext | null, session: { tokenHash: Uint8Array; userId: number; now: Date; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: Uint8Array): Promise<SessionRecord | null>;
  touchSession(tokenHash: Uint8Array, now: Date): Promise<void>;
  revokeSession(tokenHash: Uint8Array, now: Date): Promise<void>;
  /** Mencabut semua sesi pengguna, kecuali satu sesi bila `exceptTokenHash` diberikan. */
  revokeUserSessions(tx: TxContext | null, userId: number, now: Date, exceptTokenHash?: Uint8Array): Promise<void>;
  getThrottle(scope: ThrottleScope, key: string): Promise<ThrottleState | null>;
  /**
   * Mencatat satu kegagalan secara atomik (satu pernyataan SQL, tanpa baca-lalu-tulis) sehingga percobaan paralel
   * tidak melewati batas. Aturannya sama dengan `afterFailure` di domain. Mengembalikan keadaan sesudahnya.
   */
  recordFailure(scope: ThrottleScope, key: string, rule: FailureRule): Promise<ThrottleState>;
  clearThrottle(tx: TxContext | null, scope: ThrottleScope, key: string): Promise<void>;
  updatePassword(tx: TxContext | null, userId: number, passwordHash: string, mustChange: boolean, now: Date): Promise<void>;
}

/** Layanan hash password (argon2id). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** Menjalankan satu verifikasi terhadap hash tiruan agar waktu respons seragam (anti enumerasi). */
  verifyDummy(password: string): Promise<void>;
}

/** Layanan token sesi. */
export interface TokenService {
  /** Membuat token acak 256 bit (base64url). */
  generate(): string;
  /** Hash SHA-256 token; hanya hash ini yang disimpan di database. */
  hash(token: string): Uint8Array;
}

/** Ketergantungan yang disuntikkan ke use case auth. */
export interface AuthDeps {
  readonly clock: Clock;
  readonly repository: AuthRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
  readonly transactor: Transactor;
  readonly writeAudit: AuditWriter;
  readonly sessionIdleMinutes: number;
  readonly sessionAbsoluteMinutes: number;
}
