import { Prisma, type Verification } from '@prisma/client';
import { getAuthStateVerificationIdentifier, type BetterAuthPlugin, type User as AuthUser } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { TELEGRAM_LOGIN_PROVIDER } from './telegram-login';
import { oidcProof, telegramOIDCCallback } from './telegram-oidc-session';
import { measureTelegramAuth } from './telegram-timing';

/** Consume the browser-bound state in a single statement. Better Auth still
 * parses the saved state and enforces its cookie, expiration, PKCE and nonce. */
export function telegramOIDCState(client: Prisma.TransactionClient): BetterAuthPlugin {
  let pruneDueAt = 0;
  return {
    id: 'lowwin-telegram-oidc-state',
    hooks: { before: [{
      matcher: ctx => telegramOIDCCallback(ctx),
      handler: createAuthMiddleware(async ctx => {
        const state = ctx.query?.state;
        if (ctx.method !== 'GET' || typeof state !== 'string' || !state) return;
        const identifier = getAuthStateVerificationIdentifier(state);
        const { internalAdapter, secret } = ctx.context;
        const cookie = ctx.context.createAuthCookie('state');
        const browserBound = await ctx.getSignedCookie(cookie.name, secret) === state;
        let consumed = false;

        return { context: { context: { internalAdapter: {
          ...internalAdapter,
          async findVerificationValue(key: string) {
            if (key !== identifier) return internalAdapter.findVerificationValue(key);
            if (!browserBound) return null;
            // Keep cleanup bounded and off normal callbacks. Locked rows can
            // wait for the next pass without slowing another sign-in.
            const now = Date.now();
            const prune = now >= pruneDueAt;
            if (prune) pruneDueAt = now + 15_000;
            const expiredRows = prune ? Prisma.sql`
              , expired AS (
                DELETE FROM "verification" WHERE id IN (
                  SELECT id FROM "verification"
                  WHERE identifier <> ${identifier}
                    AND "expiresAt" < (statement_timestamp() AT TIME ZONE 'UTC')
                  LIMIT 512 FOR UPDATE SKIP LOCKED
                )
              )` : Prisma.empty;
            const [verification] = await measureTelegramAuth('oidc_state', () => client.$queryRaw<Verification[]>`
              WITH removed AS (
                DELETE FROM "verification"
                WHERE identifier = ${identifier}
                RETURNING *
              ) ${expiredRows}
              SELECT * FROM removed
              ORDER BY "createdAt" DESC
              LIMIT 1`);
            consumed = true;
            return verification ?? null;
          },
          async deleteVerificationByIdentifier(key: string) {
            if (key === identifier && consumed) return;
            return internalAdapter.deleteVerificationByIdentifier(key);
          },
          async findAccountOwnerByKey(key: Parameters<typeof internalAdapter.findAccountOwnerByKey>[0]) {
            const proof = await oidcProof.get();
            if (key.providerId !== TELEGRAM_LOGIN_PROVIDER || proof?.subject !== key.accountId) return internalAdapter.findAccountOwnerByKey(key);
            return measureTelegramAuth('oidc_account_owner', async () => {
              // This exact key has already passed verified profile mapping. Read
              // its current owner in one query, with the session insert still
              // responsible for rechecking the binding and verified contact.
              const row = await client.account.findUnique({
                where: { providerId_accountId: key },
                relationLoadStrategy: 'join',
                include: { user: true },
              });
              if (!row) return null;
              const { user, ...account } = row;
              // The existing adapter preserves nullable email for Telegram-only
              // users, although Better Auth's base user type requires a string.
              return user ? { kind: 'owned' as const, account, user: user as AuthUser } : { kind: 'orphaned' as const, account };
            });
          },
        } } } };
      }),
    }] },
  };
}
