import { Prisma, type Verification } from '@prisma/client';
import { getAuthStateVerificationIdentifier, type BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { telegramOIDCCallback } from './telegram-oidc-session';
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
          findAccountOwnerByKey: (key: Parameters<typeof internalAdapter.findAccountOwnerByKey>[0]) =>
            measureTelegramAuth('oidc_account_owner', () => internalAdapter.findAccountOwnerByKey(key)),
        } } } };
      }),
    }] },
  };
}
