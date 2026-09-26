# Lowin — Phase 1

A mobile-first Telegram Mini App foundation for lowest unique **integer point** auctions. This repository is independent of Gojo Games. Phases 2–7 have not been implemented: catalog, bidding, settlement, admin, provider funding and phone login must each be reviewed separately.

## Run locally

Requires Node **24.x**, npm, and PostgreSQL 16+ (or a development Supabase project).

```sh
npm ci
cp .env.example .env
# Configure the environment values below; never commit .env.
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:3000. The public shell/rules work without authentication. Authenticated routes fail closed if configuration is missing. No demo inventory or transaction success is fabricated.

For an explicit local test identity, use a **loopback PostgreSQL database**, `APP_ENV=local`, `DEV_IDENTITY_ENABLED=true`, and valid-shaped local fixture configuration. Click **Use local test identity** on Profile. To seed that identity once, set `DEV_POINTS_ENABLED=true` and run `npm run db:seed`. The fixed seed key makes retries return the original 1,000-point result. These switches reject production, Vercel (including previews), and remote databases. No HTTP credit endpoint exists. Disable both flags before any hosted build.

## Environment

See [.env.example](.env.example) for exact names. All secrets are server-only; there are no `NEXT_PUBLIC_*` secrets.

| Variable | Value / purpose |
| --- | --- |
| `APP_ENV` | `local`, `test`, or `production`; use `production` on hosted deployments |
| `DATABASE_URL` | Runtime Prisma PostgreSQL connection; Vercel uses Supabase transaction pooler with `pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Migration connection: Supabase direct PostgreSQL; session pooler is the IPv4 alternative when direct IPv6 is unavailable. Never use transaction pooling for migrations |
| `BETTER_AUTH_URL` | Exact app origin, e.g. `https://your-domain.example`; no wildcard trusted origins |
| `BETTER_AUTH_SECRET` | Generate a random secret of at least 32 characters |
| `TELEGRAM_BOT_TOKEN` | Existing bot's BotFather token |
| `TELEGRAM_BOT_USERNAME` | Existing username, without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32–256 characters from `A-Z a-z 0-9 _ -` |
| `MINI_APP_URL` | Same origin as auth; public HTTPS for Telegram, normally the app root |
| `DEV_IDENTITY_ENABLED` | `false` in all hosted environments |
| `DEV_POINTS_ENABLED` | `false` in all hosted environments |
| `TEST_DATABASE_URL` | Optional local disposable database ending `_test`; never shared or production |

Generate secrets locally with `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"`. Save them directly in your secret manager or `.env`; do not paste them into issues or logs.

## Telegram and ngrok

1. Run the app on port 3000 and `ngrok http 3000`.
2. Put the HTTPS ngrok origin in `BETTER_AUTH_URL` and `MINI_APP_URL`, then restart Next. Disable local identity for actual Telegram testing.
3. In **@BotFather → /mybots → your bot → Bot Settings → Menu Button**, set the URL to the same HTTPS root and the label to **Launch Lowin**. If configuring a Main Mini App, use that same URL there too. The legacy Login Widget /setdomain and OIDC are not used by this Mini App flow.
4. Run `npm run bot:setup`. This idempotently sets `/start`, `/help`, the menu button, and the webhook URL `/api/bot/webhook` with the secret. It retains pending updates. Running it changes your bot configuration; run it only for the intended development or production bot.
5. Run `npm run worker` in a second terminal. The webhook persists and deduplicates updates; the worker runs grammY commands. There is no polling consumer competing with the webhook.
6. Open a **private chat** with your bot, send `/start`, tap **Launch Lowin**. Also verify the menu button. `/help` explains the rules. Bot `/start` alone does not authenticate a web user.
7. When ngrok rotates, update both URL variables, restart app/worker, and rerun `bot:setup`; update the Main Mini App URL in BotFather if enabled.

No setup script has been run against a real bot as part of the automated tests. Actual Android/iOS Telegram launches still require owner credentials and an HTTPS endpoint.

## Database and ledger

`prisma/migrations/` includes generated tables plus hand-written PostgreSQL invariants. Apply with `npm run db:migrate`; for future changes use `prisma migrate dev` against a development database, inspect SQL and commit migrations. Do not use `db push` to replace the trigger-backed migrations.

- Better Auth opaque `user.id` is canonical. The plugin's `user.telegramId` is uniquely constrained; `(providerId, accountId)` is unique too. Phone display fields never confer ownership.
- Each user owns one Wallet and named AVAILABLE/HELD accounts. Platform ISSUANCE, FEES and SETTLEMENT accounts provide counter-postings.
- BIGINT points serialize as decimal strings. Postings are nonzero signed integers; every journal commits with at least two postings summing to zero.
- Posting inserts update projections in the same transaction. User accounts cannot go negative. Direct balance changes, post-commit posting additions, and journal/posting/operation updates/deletes are rejected by SQL triggers.
- Idempotency is `(userId, scope, key)`, with a request hash and immutable original result. Wallet commands use transaction-scoped advisory locks.
- Auction holds have one row per wallet/auction. Catalog terms and accepted-bid tables/constraints arrive in Phases 2–3. There is no bid endpoint now.
- `npm run wallet:reconcile` recomputes balances from postings in one SQL snapshot, reports drift, and exits nonzero if any exists. It does not silently repair history.
- TopUpIntent / ExternalEvent uniqueness and the server-side `FundingProvider` contract reserve the integration boundary. There is no registered provider, conversion policy, browser credit callback or public funding route.
- Supabase RLS is enabled with no anon/authenticated policies, and table privileges are revoked from those roles. Use server-side database access only. Database-owner credentials can alter triggers; keep migration/owner credentials separate from runtime privileges before production.

## Authentication review

Pinned **better-auth 1.6.33 + better-auth-telegram 2.0.1**, on Node 24. See [the compatibility/security review](docs/auth-review.md). Raw `Telegram.WebApp.initData` is checked for HMAC signature, a five-minute lifetime, limited clock skew, required user and unique query fields. The plugin also validates signatures. A transaction wraps plugin account/session creation and serializes sign-ins per Telegram identity. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. The client never submits `initDataUnsafe` or separately asserted profile data.

Only Mini App sign-in, session read, sign-out, and guarded local identity endpoints are exposed. Linking/unlinking, Login Widget, OIDC and arbitrary Better Auth mutation routes are not exposed. Future phone linking must prove an active session plus SMS OTP, enforce unique verified E.164 and explicitly recover conflicts without merging wallets.

## Validation

```sh
npm test                       # unit/security checks; DB suite skipped unless opted in
# Set TEST_DATABASE_URL to an isolated loopback database named lowin_test first:
npm test                       # also migrates and tests real PostgreSQL + pinned auth plugin
npm run typecheck
npm run build
npx playwright install chromium
npm run test:ui                # 360px and 430px; screenshots in docs/screenshots/
npm audit
```

The DB suite is additive (random test users); use a disposable database and destroy it when done. It never drops a database or accepts a remote test target. Tests cover HMAC rejection, concurrent identity mapping, session cookies, server authorization, projection integrity, overdrafts, immutability, scoped retries and duplicate bot updates. Phase 3/4 bid and close concurrency tests are future work, not covered by Phase 1.

## Deployment shape: Vercel first, VPS later

Vercel builds with `npm run build`, Node 24, Next.js Node runtime. Use a stable HTTPS domain and its exact trusted origin. Do not expose real Telegram sign-in on arbitrary preview origins. Apply migrations once in a controlled release job using `DIRECT_URL`, not on every serverless invocation. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [Prisma setup](https://supabase.com/docs/guides/database/prisma).

Run `npm run worker` on a small always-on Node host (VPS/container) with the same database and server secrets. Use a direct PostgreSQL connection on IPv6, or Supabase session pooler on an IPv4-only worker host. Next can later move to the same VPS with `npm run build && npm start`; no domain migration to another datastore is needed. Use a process supervisor and terminate gracefully with SIGTERM.

The Phase 1 worker handles bot commands only. Auction closing and transactional notification dispatch arrive later. Telegram sendMessage has no idempotency key: normal webhook retries are deduplicated, but a worker crash after an external send and before its DB commit can repeat a welcome/help reply. See [operations](docs/operations.md).

## Before live launch

Phase 1 is a foundation, not a live auction release. Later phases must complete catalog, bids, worker settlement, admin, outbox and staged evidence. The owner must review entry fees, holds, no-winner/refund terms, prize eligibility/delivery and local legal/provider requirements. Points alone do not establish legal classification. No provider, ETB rate or legal approval has been invented.
