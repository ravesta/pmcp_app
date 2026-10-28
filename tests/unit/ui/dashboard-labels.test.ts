import { describe, expect, it } from 'vitest';
import { CAPACITY_STATUS, LOG_QUALITY, formatDaysLeft, formatHours } from '@/ui/format/dashboard-labels';

describe('label Dashboard', () => {
  it('jam dengan desimal bila perlu', () => {
    expect(formatHours(2400)).toBe('40 j');
    expect(formatHours(750)).toBe('12,5 j');
    expect(formatHours(0)).toBe('0 j');
  });

  it('sisa hari menuju tenggat', () => {
    expect(formatDaysLeft(0)).toBe('hari ini');
    expect(formatDaysLeft(3)).toBe('3 hari lagi');
  });

  it('status kapasitas dan penilaian memiliki teks dan nada', () => {
    expect(CAPACITY_STATUS.OVER).toEqual({ text: 'Kelebihan beban', tone: 'late' });
    expect(LOG_QUALITY.FAIR.text).toBe('Kurang');
  });
});
