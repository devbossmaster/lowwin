import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
  DATABASE_URL: z.string().url(), DIRECT_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url(), BETTER_AUTH_SECRET: z.string().min(32),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]+bot$/i),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  MINI_APP_URL: z.string().url(),
  DEV_IDENTITY_ENABLED: z.enum(['true','false']).default('false'),
  DEV_POINTS_ENABLED: z.enum(['true','false']).default('false'),
});
export function parseEnv(raw: Record<string, string | undefined>) {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const env = result.data;
  const production = env.NODE_ENV === 'production' || env.APP_ENV === 'production' || !!raw.VERCEL;
  if (production && (env.DEV_IDENTITY_ENABLED === 'true' || env.DEV_POINTS_ENABLED === 'true')) throw new Error('Development features forbidden in production or hosted deployments');
  if (production && [env.BETTER_AUTH_SECRET, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET].some(value => /REPLACE|CHANGE_ME|fixture/i.test(value))) throw new Error('Example credentials forbidden in hosted deployments');
  if (production && (new URL(env.BETTER_AUTH_URL).protocol !== 'https:' || new URL(env.MINI_APP_URL).protocol !== 'https:')) throw new Error('HTTPS required');
  if (new URL(env.MINI_APP_URL).origin !== new URL(env.BETTER_AUTH_URL).origin) throw new Error('Mini App and auth origins must match');
  return env;
}
export function getEnv() { return parseEnv(process.env); }
export function assertLocalDevelopment(feature: 'identity' | 'points', raw: Record<string, string | undefined> = process.env) {
  const db = new URL(raw.DATABASE_URL ?? 'postgresql://invalid');
  if (raw.NODE_ENV === 'production' || raw.APP_ENV !== 'local' || raw.VERCEL || !['localhost','127.0.0.1','[::1]'].includes(db.hostname) || raw[feature === 'points' ? 'DEV_POINTS_ENABLED' : 'DEV_IDENTITY_ENABLED'] !== 'true') {
    throw new Error('Development feature requires an explicit local environment and loopback database');
  }
}
