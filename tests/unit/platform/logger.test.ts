import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, shouldLog } from '@/platform/logger';

describe('log aplikasi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('menyaring menurut ambang tingkat', () => {
    expect(shouldLog('debug', 'info')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('error', 'warn')).toBe(true);
  });

  it('menulis satu baris JSON berisi konteks aman; galat ke stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log('error', 'Gagal', { path: '/kanban', digest: 'abc' });
    const line = JSON.parse(String(err.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: 'error', message: 'Gagal', path: '/kanban', digest: 'abc' });
    expect(line.time).toBeUndefined();
  });
});
