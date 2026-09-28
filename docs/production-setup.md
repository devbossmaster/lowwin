# Lowwin setup and release procedure

Real credits are disabled in `paymentHealth()` regardless of environment values. Do not send a real transfer, publish a real auction, or switch traffic until the release packet is approved. SSH/VPS deployment is deferred at the Owner's request; this guide covers application configuration and the ngrok staging rehearsal.

## 1. Obtain the inputs

Use different staging and production values. Store secrets in a password manager or secret manager, never Git, screenshots, issue comments, chat, URLs, or browser storage.

| Obtain | Where / purpose | Required before |
|---|---|---|
| HTTPS origin and separate staging origin | Domain/DNS or the current ngrok HTTPS address | Telegram launch |
| Bot token and exact username | Telegram's verified `@BotFather`, `/newbot` or an existing dedicated Lowwin bot | Launch and workers |
| Supabase project, database, migration login and restricted runtime login | Supabase Connect panel and reviewed role provisioning | Authenticated requests |
| Verified email sender domain and Resend sending key | Resend dashboard; verify its DNS records | Owner invitation/reset |
| Owner's separate staff email | A mailbox the Owner controls, distinct from player identity | Bootstrap |
| Authenticator and offline recovery-code storage | Owner/staff device and password manager | Staff access |
| Check.et test/live keys, bank agreement and official receiver evidence | Check.et dashboard and authorized Telebirr/CBE account holder | Funding review only |
| Exact receiver account, holder, ETB bounds, terms and review reference | Independently verify with the account holder/bank | Versioned payment policy |
| Independent encryption/HMAC secrets | Generate locally below; retain historic key versions | Contact/MFA/fulfillment |
| Backup destination, retention, alert recipient, recovery owner | Owner-controlled protected storage | Production GO |

`.env.example` is the inventory of application, bot, worker, test and migration variables. Empty optional keys mean disabled/unconfigured. Do not copy fixture credentials to staging. `NODE_ENV` follows Next's command; `APP_ENV` identifies local/test/staging/production independently.

## 2. Generate independent secrets

Run locally once **per secret**, copy directly into protected configuration, then clear the terminal. These commands print newly generated secrets, not existing credentials:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use base64url for `BETTER_AUTH_SECRET` and `TELEGRAM_WEBHOOK_SECRET`. Use distinct 64-hex values for `ADMIN_MFA_KEY`, `PHONE_CONTACT_HASH_KEY`, each phone encryption key, and each delivery encryption key. The JSON keyring syntax is `{"phone-v1":"<64 hex>"}` / `{"delivery-v1":"<different 64 hex>"}`. Set matching `*_KEY_ID` values. Never share MFA/contact/auth keys.

Back up keyrings alongside—but separately protected from—the database backup. Losing old keys can permanently prevent decrypting MFA or delivery/contact records. Changing `PHONE_CONTACT_HASH_KEY` changes identity lookup and needs a reviewed migration. Key rotation is not an environment-only edit.

## 3. Database connections and preservation

`DATABASE_URL` is used by Next and each worker. On Supabase use the **transaction pooler** URL copied from Connect, usually port 6543, with `sslmode=require&pgbouncer=true&connection_limit=5&connect_timeout=15&pool_timeout=20`. Replace its login with the reviewed restricted server role, using the project-specific username format provided by Supabase. Do not guess the project or use the browser anon/service-role keys.

`DIRECT_URL` is used by Prisma migrations: direct or session-pool connection (usually 5432), with the schema-owning migration login. Do not use transaction pooling for migrations. Runtime environment validation currently requires this variable to exist; **set it equal to the runtime URL in web/worker processes**, and inject the privileged migration URL only into the reviewed migration job. A normal application process should not possess migration credentials.

Runtime must not be a superuser, table owner, BYPASSRLS role, schema creator, or member of the migration role. Review `docs/phase6-role-review.sql`; do not grant broad anon/authenticated policies. Trigger-enforced journal/hold protections must still reject direct financial changes. Actual Supabase role/RLS checks are separate from superuser-backed fixture tests.

Count connections across processes: web pool + bot pool + auction pool + notification pool + migrations/administration. Do not fix pool exhaustion by arbitrarily raising every process limit. Check query duration, number of replicas, database CPU, lock waits and idle transactions first. P1001 means connectivity failed; P2024 means a pool acquisition timed out. Neither is evidence that Telegram or GitHub authentication should be bypassed.

Before any remote migration: identify the target without printing credentials, take a full custom-format backup with PostgreSQL 17 tools, verify its checksum and restore it into a **separate disposable database**, and reconcile the restored data. Inventory the existing `_prisma_migrations` chain. Never use `db push`, `migrate reset`, `TRUNCATE`, fixture seeds, or rewritten historical migrations against retained data.

```sh
npm ci
npm run db:generate
# Only with the reviewed migration-role DIRECT_URL injected:
npm run db:migrate
npm run db:check
npm run wallet:reconcile
```

`db:check` checks connectivity; it does not certify role permissions. Reconciliation must return zero drift. Keep bids, journals, postings, holds, settlement proofs and migration history. Roll back application code to a compatible release; never roll back by deleting financial rows.

## 4. Telegram and ngrok staging

1. Set `APP_ENV=staging`, the dedicated staging bot credentials, contact keys, and both app/auth origins to the current ngrok HTTPS origin (`MINI_APP_URL` may include `/telegram`). Keep all `DEV_*`, `PAYMENTS_TEST_ENABLED`, `WALLET_TEST_PREVIEW` and bootstrap flags false.
2. Start the app and the bot worker against the intended staging database. For performance measurements use `npm run build` then `npm start`, not development compilation. Start ngrok against that application's port. Never expose the email sink or PostgreSQL through ngrok.
3. In BotFather configure the bot's Mini App/menu URL to the same HTTPS `/telegram` URL. Run `npm run bot:setup` with this bot's token and webhook secret to set the menu and authenticated `/api/bot/webhook` endpoint. This changes that bot's configuration; inspect the selected bot/origin first.
4. Verify `getMe`, `getWebhookInfo` and `getChatMenuButton` through a local server-side script that prints only username, configured URL, pending update count and error description. Do not paste token-containing Bot API URLs into a browser or logs. Telegram must report the expected bot and exact origin, no repeated webhook errors.
5. Run `npm run worker` for authenticated webhook inbox processing, `npm run worker:auctions` for settlement, and `npm run worker:notifications` for opted-in notifications. They are independent processes. Do not run duplicate unsupervised workers accidentally. Notification tests must use fixture transports until actual test delivery is authorized.
6. Open the bot in a **private** chat, `/start`, share the account's own contact using Telegram's button, and open the Mini App. Manual contact text, forwarded contact, another Telegram identity, expired/forged initData and ordinary website cookies must not grant access. Never use `initDataUnsafe` as proof.

Changing ngrok origin requires updating both app origins and the bot menu/webhook. Restart the configured app/workers. Reopen the Mini App to obtain fresh signed launch data. Do not remove launch/contact verification to fix timeouts.

## 5. Staff email and first Owner

Set `EMAIL_TRANSPORT=resend`, `EMAIL_FROM` to the exact verified sender email and `RESEND_API_KEY` to a sending key restricted to the appropriate domain. Domain verification/SPF/DKIM and delivery must be confirmed in Resend. The adapter sends only plain-text transactional mail to the requested address, uses a five-second deadline and stable idempotency, and never logs provider response bodies or one-time links. A provider acceptance response does not prove inbox delivery.

In local disposable tests only, `EMAIL_TRANSPORT=local-sink` uses `EMAIL_SINK_URL`; it refuses hosted/remote/production configurations. It is not a production fallback.

Temporarily set `ADMIN_BOOTSTRAP_ENABLED=true` **for the CLI process only**:

```sh
npm run admin:bootstrap -- --email owner@your-domain.example
```

Disable bootstrap immediately afterward. The database permanently records bootstrap consumption. Verify the actual mailbox, accept the one-time 24-hour invitation, set a unique password, enroll TOTP and save the once-displayed recovery codes. Follow [the admin guide](admin-guide.md). Bootstrap, invitations, resets and email delivery must be rehearsed with a staging mailbox before production.

## 6. Controlled funding activation

Check.et verifies an existing transfer; it does not collect payment. Live funding stays off by default. Activation requires the server-only `PAYMENTS_LIVE_ENABLED=true` switch, production mode, HTTPS origins, a live Check.et key, enabled reviewed receiver policies and all development/test/DEMO switches off. See [the v2 release packet](frozen-auction-v2-release.md) for the concrete Owner transfer approval gate. Do not configure a real account as a DEMO account or ask a tester to send money. Tests use mock provider responses on disposable loopback databases only.

Before a controlled activation, supply exact authorized Telebirr/CBE receiver details and official evidence. Verify reference, completed transfer type, exact cents, ETB currency, receiver, timezone-bearing transfer date and official verification method. Provider `duplicate=true` requires investigation; local unique claims remain the independent ownership guard. OCR/SMS merely extract a candidate reference. Case resolution is not credit approval.

The final packet must identify release commit, checks, receiver/policy version, small transfer amount, test identity, reconciliation operator, stop conditions and rollback. **The Owner must explicitly approve that concrete transfer and activation.** No transfer is approved by this guide. Follow the Phase 6 statement/reversal process; never edit a receipt or journal.

## 7. Repeatable checks and phone evidence

Use PostgreSQL 17 on loopback and an explicitly disposable `_test` URL. The release runner creates fresh databases and never resets retained data:

```sh
node scripts/run-db-tests.mjs unit
npm run typecheck
npm run build
npx playwright install chromium
node scripts/run-db-tests.mjs smoke
node scripts/run-db-tests.mjs browser
node scripts/run-db-tests.mjs payments
npm audit --audit-level=low
```

Run `scripts/benchmark-catalog.ts` with explicit `DATABASE_URL`/`DIRECT_URL` for read-only Home/Results measurements; remote measurement additionally requires `--allow-remote-readonly`. It records timings/query counts/payload size only, not rows, cookies or credentials. Keep baseline and after artifacts from the same data and environment. Loopback or emulated mobile numbers do not measure a real Telegram phone.

On Android and iOS Telegram record device/OS/Telegram version, network, release SHA, cold launch, warm reopen, Home, Results, bid review/receipt, wallet, notifications and navigation. Capture 360px/430px EN/AM layouts and large text. Record five runs per case, p50/p95, errors and bytes; never include signed initData, cookie, contact or private bid contents in shared traces. Test offline/retry, double submit, background/foreground and reduced motion. The Owner will supply these real-device results through ngrok; absent results remain unverified.

## 8. Infrastructure validation

TLS proxy limits, public ingress rate limits, Hostinger isolation, process supervision, backup scheduling/restore drill and operational alerts are **not deployed or verified** in this work because VPS/SSH was deferred. Application body limits do not replace edge limits. Before production, cap ordinary JSON requests, allow only the documented 5 MiB receipt route and bounded admin image route, overwrite untrusted forwarding headers, restrict direct app ingress, and validate 413/429 behavior over actual TLS. Monitor pool timeouts, authentication failures, stale settlements, queue age, provider failures and reconciliation drift. Any financial drift stops activation.


## 9. Frozen v2 rollout and service templates

Follow [the versioned rollout order](frozen-auction-v2-release.md) and [isolated deployment](deployment.md). New production publications use v2; old auctions retain v1. Do not run an older worker after a v2 auction is published. Deployment templates are prepared, not proof of installation on Hostinger.
