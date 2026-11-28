import {afterEach, describe, expect, it, vi} from 'vitest';
import {formatAddisDateTimeLocal, formatAddisTimestamp, parseAddisDateTimeLocal} from '../src/lib/addis-time';

afterEach(() => vi.unstubAllEnvs());

describe('Addis Ababa timestamps', () => {
  it.each(['America/Los_Angeles', 'Asia/Tokyo'])('round-trips the local midnight boundary on a device in %s', (timeZone) => {
    vi.stubEnv('TZ', timeZone);
    const instant = '2026-12-31T21:30:00.000Z';
    const input = '2027-01-01T00:30';

    expect(formatAddisDateTimeLocal(instant)).toBe(input);
    expect(parseAddisDateTimeLocal(input).toISOString()).toBe(instant);
    expect(formatAddisTimestamp(instant)).toBe('1 Jan 2027, 12:30 AM');
  });

  it('keeps second precision for manually entered transfer times and leaves empty schedules blank', () => {
    expect(parseAddisDateTimeLocal('2027-01-01T00:30:54').toISOString()).toBe('2026-12-31T21:30:54.000Z');
    expect(formatAddisDateTimeLocal(null)).toBe('');
    expect(formatAddisTimestamp(undefined)).toBe('Not scheduled');
  });

  it.each(['en-ET', 'am-ET'])('shows AM/PM in %s regardless of device timezone', (locale) => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const instant = '2026-12-31T21:30:54Z';

    expect(formatAddisTimestamp(instant, locale)).toMatch(/12:30 AM$/);
    expect(formatAddisTimestamp(instant, locale, 'compact')).toMatch(/12:30 AM$/);
    expect(formatAddisTimestamp(instant, locale, 'time')).toBe('12:30 AM');
    expect(formatAddisTimestamp(instant, locale, 'withSeconds')).toMatch(/12:30:54 AM$/);
    expect(formatAddisTimestamp('2027-01-01T09:00:00Z', locale, 'time')).toBe('12:00 PM');
    expect(formatAddisTimestamp('2027-01-01T17:15:00Z', locale, 'time')).toBe('8:15 PM');
  });
});
