const codePattern = /^[A-Za-z0-9_-]{12}$/;
export const WEBSITE_REFERRAL_PARAMETER = 'ref';
export const REFERRAL_BOT_RECOVERY_PARAMETER = 'telegramReferralCode';

export function referralInviteCode(value: unknown) {
  return typeof value === 'string' && codePattern.test(value) ? value : null;
}

export function referralCodeFromParams(params: URLSearchParams, name = WEBSITE_REFERRAL_PARAMETER) {
  const values = params.getAll(name);
  return values.length === 1 ? referralInviteCode(values[0]) : null;
}

export function botReferralShareUrl(token: string, username: string | undefined) {
  return referralInviteCode(token) && username && /^[A-Za-z0-9_]+bot$/i.test(username)
    ? `https://t.me/${username}?start=ref_${token}`
    : null;
}

export function botRegistrationReferralUrl(botUrl: string | null, code: string | null) {
  if (!botUrl || !code) return botUrl;
  try {
    const url = new URL(botUrl);
    if (url.origin !== 'https://t.me') return botUrl;
    return botReferralShareUrl(code, url.pathname.slice(1)) ?? botUrl;
  } catch {
    return botUrl;
  }
}

export function websiteReferralShareUrl(token: string, configuredUrl: string | undefined) {
  if (!referralInviteCode(token) || !configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password) return null;
    const landing = new URL('/', url.origin);
    landing.searchParams.set(WEBSITE_REFERRAL_PARAMETER, token);
    return landing.href;
  } catch {
    return null;
  }
}
