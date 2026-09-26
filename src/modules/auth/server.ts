import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { telegram } from 'better-auth-telegram';
import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { assertLocalDevelopment, getEnv } from '@/lib/env';

export function createAuth(client: PrismaClient | Prisma.TransactionClient = db) {
  const env = getEnv();
  return betterAuth({
    appName: 'Lowin', baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(client, { provider: 'postgresql' }),
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith('https:'), defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    plugins: [telegram({ botToken: env.TELEGRAM_BOT_TOKEN, botUsername: env.TELEGRAM_BOT_USERNAME,
      loginWidget: false, maxAuthAge: 300,
      miniApp: { enabled: true, validateInitData: true, allowAutoSignin: true },
    }), {
      id: 'lowin-local-development', endpoints: {
        localIdentity: createAuthEndpoint('/lowin/dev-identity', { method: 'POST' }, async ctx => {
          assertLocalDevelopment('identity');
          const id = 'lowin-local-test-user';
          let user = await ctx.context.internalAdapter.findUserById(id);
          if (!user) user = await ctx.context.internalAdapter.createUser({ id, name: 'Local test player', email: 'local-test@lowin.invalid', emailVerified: false });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        }),
      },
    }],
  });
}
