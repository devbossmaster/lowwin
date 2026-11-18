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
    expect(formatAddisTimestamp(instant)).toMatch(/1 Jan 2027, 00:30 GMT\+3$/);
  });

  it('keeps second precision for manually entered transfer times and leaves empty schedules blank', () => {
    expect(parseAddisDateTimeLocal('2027-01-01T00:30:54').toISOString()).toBe('2026-12-31T21:30:54.000Z');
    expect(formatAddisDateTimeLocal(null)).toBe('');
    expect(formatAddisTimestamp(undefined)).toBe('Not scheduled');
  });
});
