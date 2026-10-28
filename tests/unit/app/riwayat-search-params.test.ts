import { describe, expect, it } from 'vitest';
import { toIsoDate } from '../../../src/shared/iso-date';
import { parseRiwayatParams, riwayatHref, shiftDate } from '../../../src/app/(app)/riwayat/_lib/search-params';

describe('parameter alamat Riwayat', () => {
  it('bawaan: tab Tahapan selesai, semua waktu, mode Hari, 10 baris', () => {
    expect(parseRiwayatParams({})).toMatchObject({ tab: 'tahapan', period: 'ALL', mode: 'DAY', page: 1, pageSize: 10, stage: null, picId: null, date: null });
  });

  it('hanya nilai dikenal yang diterima', () => {
    const parsed = parseRiwayatParams({ tab: 'harian', mode: 'minggu', tanggal: '2026-10-27', selesai: '30', tahap: 'QA', pic: '4', hal: '3', per: '20', q: '  klaim ' });
    expect(parsed).toMatchObject({ tab: 'harian', mode: 'WEEK', date: '2026-10-27', period: 'LAST_30', stage: 'QA', picId: 4, page: 3, pageSize: 20, q: 'klaim' });
    expect(parseRiwayatParams({ tab: 'x', mode: 'x', tanggal: 'bukan', selesai: 'x', tahap: 'X', pic: '1;2', hal: '0' })).toMatchObject({ tab: 'tahapan', mode: 'DAY', date: null, period: 'ALL', stage: null, picId: null, page: 1 });
  });

  it('menyusun alamat dan menggeser tanggal satu hari atau satu minggu', () => {
    expect(riwayatHref({ tab: 'harian', pic: '2' }, { tanggal: '2026-10-27' })).toBe('/riwayat?tab=harian&pic=2&tanggal=2026-10-27');
    expect(riwayatHref({ tab: 'harian', tanggal: '2026-10-27' }, { tanggal: null })).toBe('/riwayat?tab=harian');
    expect(shiftDate(toIsoDate('2026-10-28'), 'DAY', -1)).toBe('2026-10-27');
    expect(shiftDate(toIsoDate('2026-10-28'), 'WEEK', 1)).toBe('2026-11-02');
    expect(shiftDate(toIsoDate('2026-10-28'), 'WEEK', -1)).toBe('2026-10-19');
  });
});
