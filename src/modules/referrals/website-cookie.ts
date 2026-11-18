import { createHmac, timingSafeEqual } from 'node:crypto';
import { referralInviteCode } from '@/lib/referral-invite';

export const WEBSITE_REFERRAL_COOKIE = 'lowwin-website-referral';
export const WEBSITE_REFERRAL_COOKIE_MAX_AGE = 30 * 60;

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(`lowwin:website-referral:v1:${payload}`).digest();
}

export function sealWebsiteReferral(code: string, secret = process.env.BETTER_AUTH_SECRET, now = Date.now()) {
  if (!referralInviteCode(code) || !secret || secret.length < 32) return null;
  const payload = `${code}.${now + WEBSITE_REFERRAL_COOKIE_MAX_AGE * 1000}`;
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}

export function websiteReferralFromCookie(headers: Headers, secret = process.env.BETTER_AUTH_SECRET, now = Date.now()) {
  if (!secret || secret.length < 32) return null;
  const cookies = headers.get('cookie');
  if (!cookies?.includes(`${WEBSITE_REFERRAL_COOKIE}=`)) return null;
  const prefix = `${WEBSITE_REFERRAL_COOKIE}=`;
  const values = cookies.split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(prefix));
  if (values.length !== 1) return null;
  const parts = /^([A-Za-z0-9_-]{12})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(values[0].slice(prefix.length));
  if (!parts || Number(parts[2]) <= now) return null;
  const expected = signature(`${parts[1]}.${parts[2]}`, secret);
  const supplied = Buffer.from(parts[3], 'base64url');
  return timingSafeEqual(expected, supplied) ? parts[1] : null;
}
