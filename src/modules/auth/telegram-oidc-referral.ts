import { AsyncLocalStorage } from 'node:async_hooks';
import { referralInviteCode } from '@/lib/referral-invite';

const contactFallback = new AsyncLocalStorage<{ code: string | null }>();

/** The verified identity mapper can fail before Better Auth sends a redirect. */
export async function withTelegramReferralFallback<T>(callback: () => Promise<T>) {
  const state: { code: string | null } = { code: null };
  const result = await contactFallback.run(state, callback);
  return { result, referral: state.code };
}

export function rememberTelegramReferralFallback(value: unknown) {
  const state = contactFallback.getStore();
  if (state) state.code = referralInviteCode(value);
}
