import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { botRegistrationReferralUrl, botReferralShareUrl, referralCodeFromParams, websiteReferralShareUrl } from '../src/lib/referral-invite';
import { sealWebsiteReferral, websiteReferralFromCookie, WEBSITE_REFERRAL_COOKIE } from '../src/modules/referrals/website-cookie';
import { proxy } from '../src/proxy';

const code = 'A-b_C123D456';
const secret = 'fixture-website-referral-signing-secret';
const now = 1_800_000_000_000;

describe('website referral handoff', () => {
  it('builds both entry links from the same invitation', () => {
    expect(websiteReferralShareUrl(code, 'https://lowwin.test')).toBe(`https://lowwin.test/?ref=${code}`);
    const bot = `https://t.me/lowwinbot?start=ref_${code}`;
    expect(botReferralShareUrl(code, 'lowwinbot')).toBe(bot);
    expect(botRegistrationReferralUrl('https://t.me/lowwinbot?start=lowin', code)).toBe(bot);
    expect(websiteReferralShareUrl(code, 'https://user:password@lowwin.test')).toBeNull();
    expect(botReferralShareUrl(code, 'example.test/lowwinbot')).toBeNull();
    expect(referralCodeFromParams(new URLSearchParams(`ref=${code}&ref=${code}`))).toBeNull();
  });

  it('rejects an altered, expired, or ambiguous referral cookie', () => {
    const signed = sealWebsiteReferral(code, secret, now);
    const cookie = (value: string | null) => new Headers({ cookie: `${WEBSITE_REFERRAL_COOKIE}=${value}` });
    expect(websiteReferralFromCookie(cookie(signed), secret, now + 1000)).toBe(code);
    expect(websiteReferralFromCookie(cookie(signed!.replace(code, 'ignoredCode1')), secret, now)).toBeNull();
    expect(websiteReferralFromCookie(cookie(signed), secret, now + 30 * 60_000)).toBeNull();
    const duplicate = cookie(signed);
    duplicate.set('cookie', `${duplicate.get('cookie')}; ${duplicate.get('cookie')}`);
    expect(websiteReferralFromCookie(duplicate, secret, now)).toBeNull();
  });

  it('sets private HTTPS landing state for a real browser navigation only', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', secret);
    try {
      const url = `https://lowwin.test/?ref=${code}`;
      const landing = await proxy(new NextRequest(url, { headers: { 'sec-fetch-dest': 'document' } }));
      expect(landing.headers.get('cache-control')).toContain('no-store');
      expect(landing.headers.get('set-cookie')).toMatch(/HttpOnly.*Secure|Secure.*HttpOnly/i);
      const capture = landing.cookies.get(WEBSITE_REFERRAL_COOKIE)?.value;
      expect(websiteReferralFromCookie(new Headers({ cookie: `${WEBSITE_REFERRAL_COOKIE}=${capture}` }), secret)).toBe(code);
      for (const headers of [{ 'sec-fetch-dest': 'image' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }]) {
        const skipped = await proxy(new NextRequest(url, { headers: new Headers(Object.entries(headers) as [string, string][]) }));
        expect(skipped.cookies.get(WEBSITE_REFERRAL_COOKIE)).toBeUndefined();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
