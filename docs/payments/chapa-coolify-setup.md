# Chapa v2: Coolify production preparation

For the explicit Basic Auth webhook alternative and protected runtime settings,
see [Basic Auth setup](chapa-basic-webhook.md). Signature remains the default.

For the current Transactions release, also review additive migration
`202610290002_chapa_event_transactions` and the
[event-worker contract](chapa-transactions-2026-10-29.md). The Chapa worker now
processes durable received events. Keep `CHAPA_LEGACY_SWEEP_ENABLED=false`.
The historical migration inventory below predates that additive change.

Prepare these settings in the production resource's **Environment Variables** screen. Keep existing database, authentication, Telegram, contact-encryption, Redis and Resend secrets. Add or edit individual variables; do not replace the whole environment with this partial list. Private merchant keys must be server-only, with no `NEXT_PUBLIC_` prefix.

This is a paused deployment configuration. Merchant TEST webhook authentication and provider automatic-return compatibility are still unresolved. Do not enable live charges from this guide.

## 1. Web application

Use the reviewed PR #12 release commit after all six hosted checks pass. The final commit and TEST deployment evidence belong in the PR; do not deploy a moving branch while reviewing it. Keep Node 24 and the existing web build/start configuration (`npm run build`, `npm run start`).

```ini
NODE_ENV=production
APP_ENV=production
BETTER_AUTH_URL=https://lowwin.shop
MINI_APP_URL=https://lowwin.shop/telegram
PAYMENT_GATEWAY=CHAPA
CHAPA_MODE=live
CHAPA_BASE_URL=https://api.chapa.global
CHAPA_CURRENCY=ETB
CHAPA_ENABLED=false
CHAPA_RECOVERY_ENABLED=false
CHAPA_SCHEMA_READY=false
CHAPA_LIVE_ENABLED=false
CHAPA_MERCHANT_REVIEWED=false
CHAPA_TEST_ENVIRONMENT_REVIEWED=false
WALLET_BIDS_ENABLED=false
WALLET_BIDS_LIVE_ENABLED=false
PAYMENTS_LIVE_ENABLED=false
ARIFPAY_ENABLED=false
ARIFPAY_RECOVERY_ENABLED=false
VERIFY_ET_SCHEMA_READY=false
DEV_IDENTITY_ENABLED=false
DEV_POINTS_ENABLED=false
STAGING_DEMO_ENABLED=false
```

Privately prepare `CHAPA_PRIVATE_KEY` with the production business's `CHAPA_LIVE_…` private key and `CHAPA_WEBHOOK_SECRET` with a separate random secret of 32–256 characters. Make both runtime-only in Coolify. Do not copy the TEST key or rotate a credential used by unresolved attempts. Keep the existing `BETTER_AUTH_SECRET`, production bot token/username/webhook secret, `PHONE_CONTACT_KEY_ID`, `PHONE_CONTACT_KEYS` and `PHONE_CONTACT_HASH_KEY` unchanged. Keep the existing verified Resend sender and API key.

`DATABASE_URL` must use the restricted production runtime login. In normal application resources, `DIRECT_URL` uses that same restricted runtime connection, not a migration/owner login. Keep the migration credential outside application and worker resources. Preserve the current `REFERRAL_REWARDS_SCHEMA_READY` value until its migration and schema have been reviewed; do not turn it on just to remove an error.

If an existing production recovery service has unresolved payments, preserve its original key/mode and authorized recovery configuration. Stage the paused configuration separately until those bindings have been inventoried.

## 2. Chapa dashboard

In the same verified **global** business, prepare the **Live** environment's private key with Payments Create, Payments Hosted Write, Payments Read and Payment Methods Read permissions. Test and live use the same API origin; the private key and business environment must match.

Prepare **Settings → Webhooks → Create → Chapa Signature → PAYMENT** with:

```text
Webhook URL: https://lowwin.shop/api/payments/chapa/webhook
Secret Hash: the exact protected CHAPA_WEBHOOK_SECRET value
```

Use the canonical HTTPS hostname without `www` or ngrok. Do not activate live payments until actual TEST delivery authenticates according to the documented raw-body signature contract and duplicate delivery is proven safe. A production hostname does not by itself resolve a signing-contract mismatch.

## 3. Schema and workers

The fixes add no new migration. The production snapshot has four pending historical migrations listed in the [release runbook](chapa-release-2026-10-29.md#production-schema-snapshot-and-applicability). Recheck the target, back up and rehearse those exact files on an isolated restored database before a separately approved owner-only migration. Never run reset, seeds or `db push` against production.

Prepare a separate Coolify `lowwin-chapa` resource at the same reviewed commit as web and bot. Build: `npm run db:generate`. Start: `npm run worker:chapa`. No public domain or port. Give it the same protected Chapa, bot, origin, contact-key and applicable referral configuration, with a restricted database URL using `connection_limit=1&pool_timeout=20`. Keep it stopped while recovery is disabled. Preserve the existing bot resource's `npm run worker` command; this change does not require starting unrelated auction or notification workers.

## 4. Activation and rollback gates

Before a later explicit live activation: all final hosted checks green, final exact-commit TEST deployment checked, actual TEST webhook and duplicate delivery accepted, original bid/top-up return and same-attempt Resume verified on Telegram, schema/grants/reconciliation reviewed, and matching web/bot/recovery workers ready. The failed optional `return_url` trial means automatic provider return is not yet certified; existing intents keep their minimal immutable requests.

Only then review setting `CHAPA_SCHEMA_READY`, `CHAPA_MERCHANT_REVIEWED`, `CHAPA_LIVE_ENABLED`, `CHAPA_ENABLED` and `CHAPA_RECOVERY_ENABLED` to `true`. Wallet bidding additionally requires both `WALLET_BIDS_ENABLED` and `WALLET_BIDS_LIVE_ENABLED`. Legacy gateway flags stay false. These are future activation gates, not settings to enable now.

For rollback, pause new initialization with `CHAPA_ENABLED=false`, retain original merchant bindings and already-authorized recovery, and restore the inventoried compatible application commit. Never delete payment attempts, alter balances or reverse database history as an application rollback.

Sources: [Coolify environment configuration](https://coolify.io/docs/applications/configuration/environment-variables), [Chapa v2 environments](https://docs.chapa.global/docs/v2/integrations/test-live-mode), [payment webhooks](https://docs.chapa.global/docs/v2/webhooks/payment).
