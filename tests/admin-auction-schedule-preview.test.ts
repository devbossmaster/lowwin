import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AdminAuctionDeadlineField, AdminAuctionSchedulePreview, parseAuctionScheduleTime} from '../src/components/admin-auction-schedule-preview';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Admin auction countdown preview', () => {
  it('uses Addis Ababa time and shows 5 hours 13 minutes on a US device', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T15:00:00.000Z'));
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const html = renderToStaticMarkup(createElement(AdminAuctionDeadlineField, {endsAt: '2026-11-19T20:13:00.000Z', showPreview: true}));

    expect(html).toContain('value="2026-11-19T23:13"');
    expect(html).toMatch(/<input type="date"[^>]*value="2026-11-19"/);
    expect(html).toMatch(/<input type="text"[^>]*value="23:13"/);
    expect(html).toContain('Time (24-hour)');
    expect(html).toContain('<dt>Ends in</dt><dd>5h 13m</dd>');
    expect(html).toContain('Ends 19 Nov 2026, 23:13 GMT+3');
    expect(html).not.toContain('Shortens');
  });

  it('distinguishes when a draft opens from how long it runs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T15:00:00.000Z'));
    const html = renderToStaticMarkup(createElement(AdminAuctionSchedulePreview, {start: '2026-11-19T19:00', end: '2026-11-20T01:00'}));

    expect(html).toContain('<dt>Starts in</dt><dd>1h</dd>');
    expect(html).toContain('<dt>Ends in</dt><dd>7h</dd>');
    expect(html).toContain('<dt>Runs for</dt><dd>6h</dd>');
  });

  it('shows the size of a proposed deadline change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T15:00:00.000Z'));
    const previousEnd = '2026-11-19T20:13:00.000Z';
    const render = (end: string) => renderToStaticMarkup(createElement(AdminAuctionSchedulePreview, {end, previousEnd}));

    expect(render('2026-11-20T00:13')).toContain('Extends by 1h');
    expect(render('2026-11-19T22:43')).toContain('Shortens by 30m');
  });

  it('shows an earlier Addis start and the current closing time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T15:00:00.000Z'));
    const html = renderToStaticMarkup(createElement(AdminAuctionSchedulePreview, {
      start: '2026-11-19T19:00', end: '2026-11-20T01:00', previousStart: '2026-11-19T17:00:00.000Z',
    }));

    expect(html).toContain('<dt>Starts in</dt><dd>1h</dd>');
    expect(html).toContain('Starts 19 Nov 2026, 19:00 GMT+3<span> · 1h earlier</span>');
    expect(html).toContain('Ends 20 Nov 2026, 01:00 GMT+3');
  });

  it('provides useful feedback before both draft times are valid', () => {
    const render = (end: string) => renderToStaticMarkup(createElement(AdminAuctionSchedulePreview, {start: '2026-11-20T01:00', end}));

    expect(render('')).toContain('Set both times to preview the countdown.');
    expect(render('2026-11-20T24:00')).toContain('Set both times to preview the countdown.');
    expect(render('2026-11-20T00:00')).toContain('The end time must be after the start time.');
  });

  it('accepts only valid minute-precision Addis Ababa times', () => {
    expect(parseAuctionScheduleTime('2026-11-20T03:22')?.toISOString()).toBe('2026-11-20T00:22:00.000Z');
    expect(parseAuctionScheduleTime('2026-11-19T00:00')?.toISOString()).toBe('2026-11-18T21:00:00.000Z');
    expect(parseAuctionScheduleTime('2026-02-30T03:22')).toBeNull();
    expect(parseAuctionScheduleTime('2026-11-20T12:22 PM')).toBeNull();
  });
});
