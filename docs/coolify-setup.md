# Manual Coolify setup for Lowwin

Use the **Low Win** project on the existing server, separate from Gojo Games. Create **five resources** in the dashboard: Redis plus four Git applications. No custom Dockerfile or Compose stack is required. Coolify still manages containers internally.

## 1. Redis first

Choose **Add Resource → Database → Redis**. Name it `lowwin-redis`, keep the generated password and private/internal access, and leave **Publicly Accessible** disabled. Do not reuse Gojo's Redis or Coolify's own Redis. Start it and copy its **Internal URL** into the web application's `REDIS_URL` field; do not paste the password/URL into chat.

Initial resource limit: 384 MiB RAM / 0.25 CPU. In custom Redis configuration set `maxmemory 256mb` and `maxmemory-policy allkeys-lru`, retaining generated password/bind settings. Lowwin stores only short-lived public catalog/results in Redis; balances, identity/session state, durable queues, financial locks, journals and rate limits remain in PostgreSQL. Cache data needs no financial backup. The app falls back to a bounded local cache if Redis fails; investigate the sanitized Redis warning rather than hiding it.

## 2. Common fields for all four applications

Choose **Add Resource → Git Repository**, select the existing GitHub connection and the existing server/destination. Give that connection access to `devbossmaster/lowwin` if the repository is private.

| Field | Value |
|---|---|
| Repository | `devbossmaster/lowwin` |
| Branch | `main` after this review PR is approved and merged |
| Base Directory | `/` |
| Build Pack | `Railpack` if available in this Coolify version |
| Install Command | `npm ci --include=dev` |
| Static Site | Off |
| Auto Deploy | Off while validating this release |
| Build variable | `RAILPACK_NODE_VERSION=24` |
| Build variable | `RAILPACK_PRUNE_DEPS=false` (workers require tsx; admin CLI requires Prisma) |
| Runtime variables | `NODE_ENV=production`, `APP_ENV=production` |

The project requires Node 24. If Railpack is absent, inspect the available build-pack/version screen before deploying; do not silently switch the runtime to Node 22. Coolify currently labels Railpack Beta. Its Node provider supports selecting Node 24 through this variable and command overrides. These dashboard builds still need verification on your server.

| Name | Build Command | Start Command | RAM ceiling | CPU ceiling |
|---|---|---|---:|---:|
| `lowwin-web` | `npm run build` | `npm start -- --hostname 0.0.0.0 --port 3000` | 2 GiB | 1.25 |
| `lowwin-bot` | `npm run db:generate` | `npm run worker` | 384 MiB | 0.25 |
| `lowwin-auctions` | `npm run db:generate` | `npm run worker:auctions` | 512 MiB | 0.50 |
| `lowwin-notifications` | `npm run db:generate` | `npm run worker:notifications` | 384 MiB | 0.25 |

For all three workers leave Domains and host Port Mappings empty and disable HTTP health checks: they do not run HTTP servers. Enable automatic process restart. Do not add another public reverse proxy. Use one replica of each service initially. Limits including Redis total 3.625 GiB and 2.5 CPU cores; they are starting caps, not measured demand or a concurrency promise. Check Gojo's peak use and retain build/OS/proxy headroom. Build applications sequentially; runtime caps do not limit Docker build memory.

## 3. Web domain, health and storage

- Domains: `https://lowwin.shop:3000,https://www.lowwin.shop:3000`. The port routes internally; visitors use normal HTTPS. The app redirects www to `https://lowwin.shop`.
- Ports Exposes: `3000`. Host Port Mappings: empty. Reuse the current Coolify proxy and certificates.
- DNS: A records for `@` and `www` point to the existing VPS IPv4. Remove conflicting AAAA records unless IPv6 is configured. `lowin.shop` is a different spelling and is not included.
- Persistent Storage: add a named volume `lowwin-media-cache` mounted at `/srv/lowwin/shared/media-cache`. Set `LOWWIN_MEDIA_CACHE_DIR` to the same path. Verify the running web user can create files there. Keep the volume when redeploying. Do not mount it into workers.
- Healthcheck: command mode can use `node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))"`, interval 30s, timeout 5s, start period 30s, retries 3. This proves process liveness only, not database readiness.

## 4. Runtime environment

Enter values privately in Coolify. The local `.env` is ignored by Git and is not automatically uploaded. Use `.env.example` as a key inventory, not as real credentials. Do not mark secrets as NEXT_PUBLIC or enable build-time injection unless a build specifically requires them.

All four applications need `NODE_ENV=production`, `APP_ENV=production`, the restricted `DATABASE_URL`, and `DIRECT_URL` set equal to that runtime URL. Use Supabase's transaction pool URL with `sslmode=require&pgbouncer=true&connection_limit=5&connect_timeout=15&pool_timeout=20`. Each worker caps its own connection pool at one; budget eight runtime connections plus deployment/migration headroom.

Web and bot need: `BETTER_AUTH_URL=https://lowwin.shop`, `MINI_APP_URL=https://lowwin.shop/telegram`, `BETTER_AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without @), `TELEGRAM_WEBHOOK_SECRET`, `PHONE_CONTACT_KEY_ID`, `PHONE_CONTACT_KEYS`, `PHONE_CONTACT_HASH_KEY`. Notification worker also needs `TELEGRAM_BOT_TOKEN`, `VERIFY_ET_API_KEY`, `VERIFY_ET_WEBHOOK_SECRET`, `PAYMENTS_LIVE_ENABLED`, `BETTER_AUTH_URL`, and `MINI_APP_URL` to finish queued verifications. Auction worker needs no provider, email or Redis credentials.

Web additionally needs:

```dotenv
REDIS_URL=<copy lowwin-redis Internal URL>
REDIS_CACHE_NAMESPACE=lowwin-production
LOWWIN_MEDIA_CACHE_DIR=/srv/lowwin/shared/media-cache
ADMIN_MFA_KEY=<separate 64-hex key>
DELIVERY_CONTACT_KEY_ID=delivery-v1
DELIVERY_CONTACT_KEYS={"delivery-v1":"<separate 64-hex key>"}
EMAIL_TRANSPORT=resend
EMAIL_FROM=<verified sender email>
RESEND_API_KEY=<sending key>
VERIFY_ET_API_KEY=<Verify.et verification read/write key>
VERIFY_ET_WEBHOOK_SECRET=<dashboard endpoint whsec_ secret>
VERIFY_ET_SCHEMA_READY=false
PAYMENTS_LIVE_ENABLED=false
VERIFY_ET_IMAGE_PROCESSING=false
ADMIN_BOOTSTRAP_ENABLED=false
DEV_IDENTITY_ENABLED=false
DEV_POINTS_ENABLED=false
STAGING_DEMO_ENABLED=false
PAYMENTS_TEST_ENABLED=false
WALLET_TEST_PREVIEW=false
```

For new installations, generate each independent key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; use `base64url` instead for auth/webhook secrets. PHONE_CONTACT_KEYS uses the same JSON format as the delivery keyring, with its own different key and matching key ID. For retained data, preserve the existing contact/MFA/delivery keys and IDs. Never regenerate them casually. Exact receiver account/holder policies belong in the reviewed admin funding configuration.

Verify.et requires an API key with `verification:write` and `verification:read`. Register `https://lowwin.shop/api/payments/verify-et/webhook` in the Verify.et dashboard for `verification.completed`, copy its one-time `whsec_` secret privately, and send a signed test event. The endpoint returns 204 for a valid test. Put the same API key and current webhook secret in the web and notification-worker resources. `VERIFY_ET_SCHEMA_READY` defaults to false: keep it false on both web and notification worker until the additive migration is applied and checked. This prevents an automatic main-branch deployment from querying missing Verify.et tables even if the older `PAYMENTS_LIVE_ENABLED` is still true. Keep live funding off during validation. Receipt uploads use Verify.et Image Processing; enable it and add image credits in the Verify.et billing dashboard, then set `VERIFY_ET_IMAGE_PROCESSING=true` on the web resource. The notification worker does not need that switch because it never uploads images. See `docs/verify-et-migration.md` for the masked receiver rule and rollout sequence.

## 5. Start in order

1. Prepare the correct production database first: backup/restore rehearsal, reviewed additive migrations with the separate migration role (`npm run db:migrate`), restricted runtime grants and zero reconciliation drift. Never use db push/reset or DEMO seeds. Do not store migration-role credentials in normal app environments.
2. Start Redis, then web. In the web terminal run `node --version`, `npm run db:check`, `npm run redis:check`, `npm run wallet:reconcile`. Check actual HTTPS, the writable persistent image cache and DB/Redis logs. Database checks do not certify role permissions.
3. Start the three workers after checking the selected database, bot and queues. Starting them processes existing messages, opted-in notifications and due published auctions; do not point production workers at an unintended staging database.
4. Review bot/origin, then run `npm run bot:setup` once in the web terminal. This updates the chosen bot's commands/menu/webhook and retains pending updates. Set BotFather's Mini App URL to `https://lowwin.shop/telegram`. Verify private `/start`, own-contact verification, launch/reopen on real Telegram.
5. First Owner only: run `ADMIN_BOOTSTRAP_ENABLED=true npm run admin:bootstrap -- --email owner@your-domain.example` in the Linux web terminal. This affects that command only. Verify email, accept invitation, enroll MFA and save recovery codes. For an existing Owner use the documented recovery/reissue workflow.
6. Check latest CI, real Telegram behavior, receiver policy, proxy upload/rate limits, backup/restore and monitoring. Keep funding disabled until the concrete small transfer and activation are approved. Configure proxy limits in the actual Coolify proxy; the nginx example is not automatically applied to Traefik. No successful build alone certifies a production launch.

## Verification and rollback

If the bot repeatedly reports `Inbox unavailable`, open its **Terminal** (not Logs)
and run `npm run db:check -- --bot-inbox`. This uses the bot's single-connection
limit and checks an interactive transaction plus the inbox columns/permissions
without processing messages or returning private payloads. A normal `db:check`
only proves `SELECT 1` works. The JSON diagnostic identifies the failing stage
and safe Prisma/PostgreSQL codes; it never prints raw exception messages or
credentials. Do not reset the database or regenerate auth/contact keys to fix an
inbox error. The npm `config production` warning is separate from this failure.

For slow Mini App pages, run `npm run db:check -- --timings` in the **web**
container. `firstReadMs` includes opening the connection; `warmReadMs` measures
four subsequent `SELECT 1` calls on the same client. These are round-trip
measurements, not timings of real catalog or account queries. Check that
`productionCaching` is true, and use `npm run redis:check` if Redis is configured.
Compare the VPS and Supabase regions and inspect CPU/memory and connection-pool
usage during the delay before increasing pool sizes or upgrading the VPS.

Redis unit tests verify shared hits, expiry, post-commit invalidation and outage fallback using a mocked transport. Real Redis connectivity and Coolify builds must be checked on the server. No browser was connected during preparation, so the dashboard resources have not been created by the agent.

Keep a v2-capable rollback release and the persistent media volume. After publishing any v2 auction, never use a v1-only worker. Preserve migrations and financial rows. Disable PAYMENTS_LIVE_ENABLED to stop new credits. Off-host database/key backups and queue/reconciliation alerts remain essential.

Sources: [Coolify Railpack](https://coolify.io/docs/applications/builds/railpack), [Railpack Node settings](https://railpack.com/languages/node), [Redis](https://coolify.io/docs/databases/redis), [domains/ports](https://coolify.io/docs/applications/configuration/general), [persistent storage](https://coolify.io/docs/applications/configuration/persistent-storage).
