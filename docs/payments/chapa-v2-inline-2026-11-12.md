# Current-key v2 Inline checkout — 12 November 2026

## Why this change

The merchant dashboard supplies `CHAPA_LIVE_PUB_…` public keys and v2 private keys. The previous v1 adapter correctly rejected those formats for its legacy protocol. That diagnostic did not mean Coolify failed to load the values or that Chapa considered the public key invalid. A documented read-only v2 service check accepted the supplied public key with HTTP 200; that check did not create a payment or prove Inline creation permissions.

New payments now use Chapa's documented [v2 Inline API](https://docs.chapa.global/docs/v2/integrations/inline-js), retaining the shared Lowwin bid/top-up form. The old pinned v1 SDK is not loaded for a new v2 payment. Existing v1 and earlier v2 attempts remain bound to their original version, credentials and references.

## Provider boundary

- Initialization calls `POST https://api.chapa.global/v2/payments/inline` with the public key, integer-cent amount, a merchant reference of at most 20 characters, payer phone and a stable `Idempotency-Key`.
- A durable owned intent and immutable server-priced bid quote or top-up principal exist before provider HTTP. Financial locks do not contain network requests.
- Provider-requested OTP/USSD validation uses `/v2/payments/inline/validate` and the returned reference. Lowwin never collects a wallet PIN.
- The browser observes the owned Lowwin endpoint. It does not create another charge to check payment status or trust browser callbacks as settlement evidence.
- Final fulfillment still requires private-key server verification with matching amount, currency, merchant reference, owner and environment. Bids need accepted-bid receipts; top-ups need committed wallet credit.
- New Inline and reviewed CBE Bank hosted attempts carry `flowVersion: 4`, `apiVersion: "v2"` and a public-key fingerprint in their immutable initialization data. Historical v1 `flowVersion: 3` and earlier v2 attempts keep their original recovery adapters.
- Lost initialization responses retain the original operation key. Reopening can read it through `GET /api/payments/chapa/inline?key=…`; any permitted initialization replay retains the exact provider idempotency key.

Internal-wallet bidding remains a separate atomic ledger command, without Chapa initialization, SDK loading, payer-phone input or webhook dependency.

## Coolify configuration

Set the following privately on **WEB and the Chapa payment worker**, using the same merchant and environment:

```dotenv
PAYMENT_GATEWAY=CHAPA
CHAPA_MODE=live
CHAPA_ENABLED=true
CHAPA_INLINE_ENABLED=true
CHAPA_RECOVERY_ENABLED=true
CHAPA_SCHEMA_READY=true
CHAPA_LIVE_ENABLED=true
CHAPA_MERCHANT_REVIEWED=true
CHAPA_INLINE_METHODS=telebirr,cbebirr,mpesa
```

Keep the real v2 private key in `CHAPA_PRIVATE_KEY`. Put the matching current-format public key in `CHAPA_PUBLIC_KEY`; it begins `CHAPA_LIVE_PUB_` in live mode or `CHAPA_TEST_PUB_` in test mode. Store the existing webhook secret and reviewed signature profile in `CHAPA_WEBHOOK_SECRET` and `CHAPA_WEBHOOK_SIGNATURE_PROFILE`. All key values remain out of source control and diagnostics.

The v2 dashboard webhook remains `https://lowwin.shop/api/payments/chapa/webhook`. Preserve the profile confirmed for this merchant, including an existing `legacy_secret` profile where applicable; both profiles still require private server verification before fulfillment.

Only general enabled wallet capabilities returned by this merchant's payment-method catalog are offered. `CHAPA_INLINE_METHODS` narrows the list; it does not activate a disabled merchant method. eBirr requires explicit inclusion and confirmed capabilities. Enable the separate reviewed CBE Bank hosted branch with `CHAPA_INLINE_CBE_BANK_ENABLED=true` if supported. Its guide uses the supplied local video by default; `CHAPA_INLINE_CBE_GUIDE_URL` is an optional approved override.

Historical v1 settings are needed only for actual v1 attempts. Keep original v1 credentials/recovery configuration for those attempts; v2 credentials cannot be converted by changing their prefix. The old `CHAPA_V1_ENABLED` switch does not enable the new checkout.

## Migration and verification

Deploy the matching application revision to WEB and the Chapa worker. Apply the additive `202611120001_chapa_v2_inline` migration before starting new creation:

```sh
npx --no-install prisma migrate deploy
npx --no-install prisma migrate status
```

The migration extends version/identity guards and adds a bounded reconciliation index. It does not convert historical rows, reset balances or replay payments. Prisma generation remains part of the normal build.

Run the new redacted diagnostic on both resources:

```sh
npx --no-install tsx scripts/check-chapa-inline.ts --schema
```

It checks configuration and schema metadata without provider HTTP or financial/customer reads. `ready: true` means the local configuration/schema checks passed; merchant activation and physical-phone authorization remain separate acceptance checks. An offline run without `--schema` explicitly reports `schema.status: "not-requested"`.

## Validation evidence

Local validation on 12 November 2026:

- 213 focused unit/service tests passed, including the redacted Inline readiness checks.
- 16 v2 Inline integration cases passed against a disposable, loopback PostgreSQL database in 16.97 seconds. They cover pre-HTTP intent persistence, concurrent replay, original-key recovery, account/quote binding, exactly-once local credit/bid fulfillment, mismatched evidence, OTP, immutable authorization identity, late funds, hosted CBE and historical v1 recovery.
- The existing 17-case historical v1 database suite passed.
- The production webpack build and its TypeScript check passed.
- The redacted `check-chapa-inline.ts --schema` diagnostic found the migration, identity constraint, guard trigger and reconciliation index on the isolated database. Payment creation remained disabled; the diagnostic made no provider request.
- Production-mode Playwright completed 19 cases successfully. English/Amharic bid-payment and top-up layouts ran at 320px, 360px and 430px; seven additional payment lifecycle cases ran once at 360px, with 14 intentional duplicate-project skips. Coverage includes duplicate taps, authorization beyond 90 seconds, background/resume, temporary verification failure, success after fulfillment, terminal retry, lost-response recovery, OTP, CBE guide, historical v1 restoration and wallet independence during an external outage.
- The browser fixtures observed one initialization for duplicate taps and uncertain recovery, no legacy SDK download for new v2 attempts, and at most one active status check per owned attempt. Layout checks found no horizontal page overflow. The 320px English bid-payment and 430px Amharic top-up screenshots were visually inspected.

These are isolated fixture results, not live Chapa throughput or USSD delivery measurements. Real phone-prompt arrival, merchant method activation and production configuration remain deployment acceptance checks. No live payment, broadcast, production migration, merge or deployment was performed for this local change.
