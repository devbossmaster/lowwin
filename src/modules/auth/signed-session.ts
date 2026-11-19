import { parseCookies } from 'better-auth/cookies';
import { constantTimeEqual, makeSignature } from 'better-auth/crypto';
import { getEnv } from '@/lib/env';

export async function signedSessionToken(headers: Headers) {
  const env = getEnv();
  const prefix = env.BETTER_AUTH_URL.startsWith('https:') ? '__Secure-' : '';
  const value = parseCookies(headers.get('cookie') ?? '').get(prefix + 'better-auth.session_token');
  if (!value || value.length > 512) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  // Match Better Auth's cookie protocol. A database token alone is never accepted.
  if (signature.length !== 44 || !signature.endsWith('=')
    || !constantTimeEqual(signature, await makeSignature(token, env.BETTER_AUTH_SECRET))) return null;
  return token;
}
