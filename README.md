# Lowin — Phase 4B results and personal pages

A mobile-first Telegram Mini App for lowest unique **integer point** auctions. This repository is independent of Gojo Games. Deterministic settlement now has anonymous public results and private bid history, wallet activity, profile, confirmed wins and persistent favorites. Admin, fulfillment, notification delivery, provider funding and phone login remain future work. See [Phase 4B implementation and validation](docs/phase4b-results-personal.md) and [Phase 4A settlement](docs/phase4a-settlement.md).

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

Open http://localhost:3000. The public catalog/rules work without authentication. Authenticated routes fail closed if configuration is missing. Demo inventory is explicitly labeled; test bids are accepted only in an isolated local/test environment on a loopback `_test` database. Production rejects DEMO bids.

To populate a **disposable loopback PostgreSQL database whose name ends `_test`**, set `DATABASE_URL` and `DIRECT_URL` to that database, then run `npm run db:migrate` and `npm run db:seed:catalog`. The idempotent seed creates nine categories and 14 clearly marked DEMO auctions with original local SVG illustrations; it rejects remote or non-test database targets. See [Phase 2 catalog notes](docs/phase2-catalog.md).

For an explicit local test identity, use a **loopback PostgreSQL database**, `APP_ENV=local`, matching loopback `BETTER_AUTH_URL` / `MINI_APP_URL`, and `DEV_IDENTITY_ENABLED=true`. Set a private random `DEV_IDENTITY_ACCESS_KEY` (32–256 characters) in server configuration, then manually enter that key on Profile and choose **Use local test identity**. The key is not rendered in HTML, sent to the browser automatically, stored in browser storage, or placed in a URL. To seed that identity once, set `DEV_POINTS_ENABLED=true` and run `npm run db:seed`. The fixed seed key makes retries return the original 1,000-point result. These switches reject production, Vercel (including previews), and remote databases. No HTTP credit endpoint exists. Disable both flags before any hosted build.

**When using ngrok or any public origin, set `DEV_IDENTITY_ENABLED=false` and restart Next.** Public Mini App/auth configuration rejects the dev flag even if a proxy rewrites URL/Host/Origin to localhost. Local-looking request headers never authorize this feature: the separate operator key is also required. Public/ambiguous request metadata denies access and hides the action. Do not tunnel a local-identity-enabled instance or share its key; use a separate instance/configuration with identity disabled for tunnels. Signed Telegram login remains available over HTTPS.

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
| `DEV_IDENTITY_ACCESS_KEY` | Private random 32–256 character operator capability, required only for localhost test identity; never `NEXT_PUBLIC_*` |
| `DEV_POINTS_ENABLED` | `false` in all hosted environments |
| `TEST_DATABASE_URL` | Optional local disposable database ending `_test`; never shared or production |
| `BID_TEST_DATABASE_URL` | Separate disposable loopback `_test` database for fresh scheduled Phase 3 fixtures |
| `SETTLEMENT_TEST_DATABASE_URL` | Optional isolated settlement test database; defaults to `BID_TEST_DATABASE_URL` |
| `PERSONAL_TEST_DATABASE_URL` | Separate disposable loopback `_test` database for Phase 4B results, profiles and favorites |

Generate secrets locally with `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"`. Save them directly in your secret manager or `.env`; do not paste them into issues or logs.

## Telegram and ngrok

1. Run the app on port 3000 and `ngrok http 3000`.
2. Put the HTTPS ngrok origin in `BETTER_AUTH_URL` and `MINI_APP_URL`, set `DEV_IDENTITY_ENABLED=false`, then restart Next. A public URL with the dev flag enabled fails closed.
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
- Auction holds have one row per wallet/auction. The Phase 1.5 migration enforces `HELD balance = SUM(AuctionHold.points)` at commit through deferred constraint triggers on both hold mutations and account projections. Every queued event checks the final state. Existing drift fails migration rather than being silently repaired. Zero holds remain valid.
- A database-owned `WalletHoldGuard` revision write serializes hold/account/posting changes per wallet and rejects stale repeatable-read writers. `adjustAuctionHold()` is an internal atomic reserve/release command; `adjustAuctionHoldInTransaction()` composes it into the bid transaction. Positive integer deltas move AVAILABLE ↔ HELD, with immutable operation/journal/audit references. Retries replay the original result; changed payloads cannot reuse the key. Full release leaves a zero hold. There is no HTTP hold endpoint.
- Bid acceptance locks the auction first, then the wallet advisory key and hold guard. The database stamps `acceptedAt` after any lock wait and rejects an insert outside the published start/end window or frozen terms. Retry the **whole transaction** with the same idempotency key after a serialization/deadlock failure; never retry a fragment of an aborted transaction.
- `npm run wallet:reconcile` checks posting/projection drift, hold totals, bid fees, cancellation refunds and winner charges in one SQL snapshot, and exits nonzero on drift. Values serialize as decimal strings. It does not silently repair history.
- TopUpIntent / ExternalEvent uniqueness and the server-side `FundingProvider` contract reserve the integration boundary. There is no registered provider, conversion policy, browser credit callback or public funding route.
- Supabase RLS is enabled with no anon/authenticated policies, and table privileges are revoked from those roles. Use server-side database access only. Database-owner credentials can alter triggers; keep migration/owner credentials separate from runtime privileges before production.

## Public catalog

`Category`, `Product`, `ProductImage`, the extended `Auction`, `AuctionTerms`, and `PublicAuctionResult` are defined in a versioned migration. The existing Auction `id`, `code`, and hold relationship remain intact. Published terms and public results are immutable. Public reads use PostgreSQL and explicit response allowlists; live bid amounts, uniqueness hints, wallet state and bidder identities are absent. Status is derived using database time, so an expired listing does not remain live merely because its stored status has not yet changed. All seeded examples and results say DEMO. Animals is visible with no live listing.

Home, Auctions, category, Winners, result detail and FAQ remain public reads. Auction detail adds an authenticated bid form; `/wallet` and `/my-bids` show only the verified user's data. Private responses are no-store. There is no top-up or payment flow. See [Phase 3 bidding notes](docs/phase3-bidding.md).

## Authentication review

Pinned **better-auth 1.6.33 + better-auth-telegram 2.0.1**, on Node 24. See [the compatibility/security review](docs/auth-review.md). Raw `Telegram.WebApp.initData` is checked for HMAC signature, a five-minute lifetime, limited clock skew, required user and unique query fields. The plugin also validates signatures. A transaction wraps plugin account/session creation and serializes sign-ins per Telegram identity. Cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. The client never submits `initDataUnsafe` or separately asserted profile data.

Only Mini App sign-in, session read, sign-out, and guarded local identity endpoints are exposed. Linking/unlinking, Login Widget, OIDC and arbitrary Better Auth mutation routes are not exposed. Future phone linking must prove an active session plus SMS OTP, enforce unique verified E.164 and explicitly recover conflicts without merging wallets.

## Validation

```sh
npm test                       # unit/security checks; DB suite skipped unless opted in
# Set TEST_DATABASE_URL, BID_TEST_DATABASE_URL, SETTLEMENT_TEST_DATABASE_URL,
# and PERSONAL_TEST_DATABASE_URL to separate disposable loopback *_test databases:
npm test                       # combined database suite; missing variables skip their suites
# Set BID_TEST_DATABASE_URL to a separate loopback *_test database:
npx vitest run tests/bids.test.ts
npm run typecheck
npm run build
npx playwright install chromium
npm run test:ui                # isolated localhost/tunnel-config servers on 3107/3108, 360px and 430px
npm audit
```

The DB suites are additive (random test users); use disposable databases and destroy them when done. They never drop a database or accept a remote test target. Bid tests use a separate database because accepted bids are immutable and need freshly scheduled fixtures. Browser identity success uses the opt-in database; without it, browser checks cover guest/rejected paths. Browser servers use fixture-only settings, separate build directories and no existing app on port 3000. Tests cover HMAC rejection, session cookies, hold and posting integrity, scoped retries, catalog privacy, bid limits, deadline-lock races, concurrent bids, closing/cancellation races, process crashes, atomic rollback and wallet/fee reconciliation.

## Deployment shape: Vercel first, VPS later

Vercel builds with `npm run build`, Node 24, Next.js Node runtime. Use a stable HTTPS domain and its exact trusted origin. Do not expose real Telegram sign-in on arbitrary preview origins. Apply migrations once in a controlled release job using `DIRECT_URL`, not on every serverless invocation. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [Prisma setup](https://supabase.com/docs/guides/database/prisma).

Run `npm run worker` on a small always-on Node host (VPS/container) with the same database and server secrets. Use a direct PostgreSQL connection on IPv6, or Supabase session pooler on an IPv4-only worker host. Next can later move to the same VPS with `npm run build && npm start`; no domain migration to another datastore is needed. Use a process supervisor and terminate gracefully with SIGTERM.

The bot worker handles commands only. Run `npm run worker:auctions` separately for durable auction closing; `-- --once` performs a single claim. Settlement creates outbox intents; external dispatch arrives in Phase 5. Telegram sendMessage has no idempotency key: normal webhook retries are deduplicated, but a worker crash after an external send and before its DB commit can repeat a welcome/help reply. See [operations](docs/operations.md).

## Before live launch

Phase 5A adds invite-only Owner administration; the application remains a DEMO preview. Follow the [Owner runbook](docs/owner-runbook.md) for bootstrap, MFA, recovery, publication and cancellation. See [Phase 5A validation](docs/phase5a-validation.md) for migrations, exact test results and remaining release work. Production email is unavailable until a provider is implemented. Later phases must complete fulfillment, notification dispatch and release validation. The owner must review entry fees, holds, no-winner/refund terms, prize eligibility/delivery and local legal/provider requirements. Points alone do not establish legal classification. No provider, ETB rate or legal approval has been invented.


The source catalog defines 9 categories:
1. Home Furniture
2. Vehicles
3. Accessories
4. Computer & Office Equipment
5. Home Furnishings
6. Jewelry
7. Watches
8. Phones
9. Animals