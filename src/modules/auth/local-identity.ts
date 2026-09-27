import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assertLocalDevelopment, localOrigin } from '@/lib/env';

/** Header checks only DENY access; they cannot establish that a peer is local.
 * Even an all-local header set needs the separate operator-held access key.
 */
export function assertLocalIdentitySurface(headers: Headers, raw: Record<string, string | undefined> = process.env, requestUrl?: string) {
  assertLocalDevelopment('identity', raw);
  const origin = localOrigin(raw.BETTER_AUTH_URL)!;
  if (requestUrl && localOrigin(requestUrl) !== origin) throw new Error('Local identity is unavailable on this URL');
  const requestOrigin = headers.get('origin');
  if (requestOrigin && requestOrigin !== origin) throw new Error('Local identity is unavailable on this origin');
  const protocol = new URL(origin).protocol;
  for (const name of ['host', 'x-forwarded-host', 'x-original-host']) {
    const value = headers.get(name);
    if (value && (value.includes(',') || /[\s/@?#\\]/.test(value) || localOrigin(`${protocol}//${value}`) !== origin)) throw new Error('Local identity is unavailable through this host');
  }
  // Unknown/ambiguous proxy paths fail closed. Next may synthesize the other
  // x-forwarded-* fields even for a direct local request; none are trusted proof.
  if (headers.has('forwarded') || headers.has('x-original-url') || headers.has('x-rewrite-url')) throw new Error('Local identity is unavailable through this proxy');
  for (const name of ['x-forwarded-for', 'x-real-ip']) {
    const value = headers.get(name);
    if (value && value.split(',').some(ip => !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip.trim()))) throw new Error('Local identity is unavailable through this proxy');
  }
}

const bodySchema = z.object({ accessKey: z.string().min(32).max(256) }).strict();
export function assertLocalIdentityAccess(headers: Headers, body: unknown, raw: Record<string, string | undefined> = process.env, requestUrl?: string) {
  assertLocalIdentitySurface(headers, raw, requestUrl);
  if (headers.get('origin') !== localOrigin(raw.BETTER_AUTH_URL)) throw new Error('Local identity requires the configured origin');
  const { accessKey } = bodySchema.parse(body);
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(accessKey), digest(raw.DEV_IDENTITY_ACCESS_KEY!))) throw new Error('Local identity access denied');
}
