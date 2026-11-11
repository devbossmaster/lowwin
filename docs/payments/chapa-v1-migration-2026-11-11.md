# Chapa v1 migration — 11 November 2026

New bid and top-up payments now prepare an owned Chapa v1 intent. Existing v2 payments keep their original credentials, references, history, signed-webhook profile and v2 verification path. No existing payment is converted or deleted.

## Customer flow

The bid sheet keeps a responsive 1840:800 product banner, localized description, fee/count/countdown, two-decimal entry, editable/removable chips, coupons and fee-based totals. A valid number still in the input is included exactly once on Continue. Canonical duplicates are rejected without changing the existing selection or total.

One number proceeds directly to the shared Pay securely form. Multiple numbers first show Review bids with their fees, total and actual wallet balance. Back/Edit amounts preserve the draft and quote. Only an explicit final Pay submits the reviewed internal-wallet command or prepares the owned v1 payment.

Top-ups use Amount → the same external payment form. The form supports only configured methods, editable registered payer phone, provider-specific normalization, gold selection/checkmarks and real logos. Wallet funding is available only for bids. CBE Bank opens an optional approved video guide within the same dialog, then the standard hosted checkout; it never claims to force bank selection.

The shared processing/result surface uses owned backend state. Verified terminal failures offer Change payment, Try again and Close. Change payment reopens the preserved form without charging. Try again reconciles the old attempt and revalidates the draft before a safe fresh attempt; changed prices return to review. Uncertain outcomes retain their original key/reference. Closing removes the SDK browsing context and hides the sheet without cancelling the provider payment.

## Inspected Inline artifact

The unmodified official browser artifact is pinned at `public/vendor/chapa-inline-v1.c9e7f64f.js` (13,912 bytes; SHA-256 `c9e7f64f4f443bfa068cfc8d93bda9d160f5cb89bdb3501c74c3d66eacd1f27d`). License/provenance files are alongside it. The adapter validates the actual `window.ChapaCheckout` global, documented `initialize` method and rendered Pay button instead of assuming an ESM export or invented cleanup method.

The SDK has global IDs, its own three-second verification loop and no destroy API. One disposable iframe contains that instance, and the SDK-rendered Pay button is activated once only after explicit Lowwin Pay and durable owned preparation. Closing, account changes and terminal completion remove the browsing context and its polling. Reopening checks the original owned attempt instead of dispatching the SDK again. Callback data never becomes financial evidence.

The inspected SDK does not implement an OTP input or supported OTP API. No undocumented authorization request was added. The supported hosted branch delegates any gateway-requested challenge to Chapa; historical v2 provider-requested OTP recovery remains available. Native wallet PINs stay outside Lowwin.

## Financial boundary

`ChapaCheckout.initialization.apiVersion = "v1"` and `flowVersion = 3` identify new v1 intents. The database guards keep this marker, ownership, principal, quote and merchant reference immutable. `chargeType` is `INLINE` or `HOSTED`; old `DIRECT` and `HOSTED` v2 intents remain supported for recovery.

The server prices and persists the entire bid batch or deposit before returning an Inline configuration. Its exact server-generated merchant reference becomes the SDK's `tx_ref`. All v1 amounts use major ETB units on the wire; verification converts them back to integer cents and requires the stored principal, currency, merchant reference and mode to match. Provider references remain separate from `tx_ref`.

Only verified server evidence can commit wallet credit or accepted bids. Existing atomic batch fulfillment, ledger balancing, duplicate reference protection, account authorization and late-payment funds preservation are reused. A verified payment arriving after an auction closes credits the funds to the user's wallet; it does not backdate bids.

The Inline configuration is issued only when the owned intent is first created. A repeated or interrupted preparation reconciles that original intent and does not issue another SDK initialization configuration. An authenticated read-only `GET /api/payments/chapa/v1?key=<original UUID>` recovers an owned intent when the first response was lost before the browser learned its payment ID. It cannot call Chapa, change state or return another Inline configuration. Missing, historical-v2 and other-account keys return the same sanitized 404. v1 hosted initialization is also dispatched once: v1 does not document the v2 write-idempotency header, so a lost initialization response is checked by its original `tx_ref` instead of blindly repeated.

The real/default v2 creation services reject new keys with `PAYMENT_VERSION_RETIRED`. Historical same-key recovery and verification retain their original version. Browser callback fields, redirects and SDK success/failure callbacks are recovery hints only. A network-related SDK failure cannot prove that a transaction is unpaid.

## Configuration

Configure these on WEB and the Chapa payment worker, using the same reviewed merchant environment. Do not paste their values into logs or a repository.

| Setting | Purpose |
| --- | --- |
| `CHAPA_V1_SECRET_KEY` | Backend v1 secret key for the selected test/live environment |
| `CHAPA_V1_PUBLIC_KEY` | Matching public key supplied to the client-only Inline adapter |
| `CHAPA_V1_WEBHOOK_SECRET` | Random webhook secret, at least 32 characters |
| `CHAPA_V1_ENABLED=true` | Enables new v1 preparation after configuration checks |
| `CHAPA_V1_RECOVERY_ENABLED=true` | Keeps v1 reconciliation available while new creation is paused |
| `CHAPA_V1_METHODS` | Comma-separated merchant-reviewed whitelist; supported values are `telebirr,cbebirr,mpesa,ebirr` |
| `CHAPA_V1_CBE_BANK_ENABLED=true` | Enables the distinct CBE Bank hosted-checkout branch after merchant review |
| `CHAPA_V1_CBE_GUIDE_URL` | Optional approved HTTPS override; otherwise uses the supplied local `/video/cbe-bank-payment.mp4` |

The method whitelist defaults to empty. It is an explicit merchant configuration, not a fabricated v1 capability endpoint. List only methods Chapa has enabled for the actual merchant. Selecting a method never creates a payment. The CBE Bank branch uses the standard hosted initialization endpoint; it does not send an invented bank slug or guarantee automatic bank selection.

The supplied CBE guide now plays from `public/video/cbe-bank-payment.mp4`: H.264/AAC, 720×720, 29.65 seconds, 1,445,298 bytes, with its metadata before the media data for progressive playback. Only that exact GET/HEAD video path bypasses Mini App authentication. The native player has controls, no autoplay and `preload="none"`; displaying the guide does not create a payment. No video environment setting is needed for this asset.

Existing common gates still apply: `PAYMENT_GATEWAY=CHAPA`, `CHAPA_SCHEMA_READY=true`, `CHAPA_MODE`, secure matching `MINI_APP_URL`/`BETTER_AUTH_URL`, and the existing test/live environment review gates. Live mode also requires the existing live-payment and reviewed-merchant settings. Test keys cannot enable live mode or vice versa.

Keep `CHAPA_PRIVATE_KEY`, `CHAPA_WEBHOOK_SECRET`, `CHAPA_WEBHOOK_SIGNATURE_PROFILE` and `CHAPA_RECOVERY_ENABLED=true` for unresolved historical v2 payments. Preserve the actual reviewed v2 signature profile, including an explicitly configured `legacy_secret` profile where applicable. Do not replace v2 credentials with v1 credentials. During transition, keeping the existing v2 enable flags allows original same-key initialization recovery; new real v2 keys are still rejected by the server migration guard.

## Webhooks and recovery

Configure the v1 merchant dashboard webhook as:

`https://lowwin.shop/api/payments/chapa/v1/webhook`

Use `CHAPA_V1_WEBHOOK_SECRET` as its secret. The v1 endpoint authenticates exact-body `x-chapa-signature` HMAC or the documented `chapa-signature` HMAC of the secret using itself. Either valid documented proof is sufficient. The latter proves a reusable credential rather than payload integrity, so the handler treats every delivery as a bounded lookup hint and verifies financial evidence independently.

The standard v1 `charge.success` event is routed by merchant `tx_ref`. Authenticated unrelated event categories are acknowledged without financial effects. Malformed charge hints, wrong environment/currency and missing/invalid signatures do not queue settlement. Repeated hints for one owned intent are coalesced with cooldowns, leases and durable retries. The response acknowledges durable recording before provider HTTP.

Historical v2 webhooks continue at `/api/payments/chapa/webhook`. Never move their unresolved references through the v1 verifier. Callback navigation uses `/api/payments/chapa/v1/callback`; its parameters cannot authorize credit. The owned return flow automatically checks the stored attempt.

The Chapa worker now reports `v1RecoveryEnabled` and `v2RecoveryEnabled` separately. It reconciles each supported version with that version's credentials and parser, while continuing existing payment receipts.

## Release preparation

Migration `202611110001_chapa_v1_checkout` extends the current SQL checks to permit immutable v1/Inline intents and adds a bounded reconciliation index. Apply it before starting the updated WEB/worker revision:

```sh
npx --no-install prisma migrate deploy
npx --no-install prisma generate
```

Use the same application revision on WEB and the Chapa payment worker. Preserve the v2 configuration until historical attempts are resolved. This task did not run production migrations, deploy either service, merge or send live payments. The migration changes database guards/indexes; it does not reset data, balances, pending payments or webhook records.

## Local validation and limits

- 113 unit/contract tests passed across v1 provider, existing provider transport, readiness, event handling and direct-request suites.
- 17 PostgreSQL integration tests passed in a disposable loopback database. They cover one-time SDK preparation, read-only owned-key recovery without side effects, exact principal, atomic bid batches, concurrent/duplicate verification, duplicate durable v1 webhook jobs, account isolation, tampered amount/reference/currency/mode, cancellation followed by late success, late auction funds preservation, hosted response recovery without replay, phone/provider mismatch, retired real v2 creation and historical v2 verification.
- Final combined unit/contract run: **242 tests across 15 suites passed**, covering the shared form, bid/phone rules, pinned SDK, status classification, original-attempt retention, polling, provider contracts, readiness and delivery handling. This overlaps the earlier 113-test backend run; the counts are not additive.
- TypeScript typecheck and the optimized production webpack build passed with isolated loopback fixture configuration and real payment credentials disabled.
- **21 production-mode mobile browser cases passed** at 320px, 360px and 430px, in English and Amharic. Eighteen repeated width/lifecycle combinations are intentionally skipped. The final full run was green after correcting two harness assumptions: a radio unmounts when its selection opens the bank guide, and lost-response recovery runs automatically on reopening. No production behavior was changed to hide those assertions.

The mobile checks cover single/multiple bid navigation, canonical duplicate rejection, adding/removing numbers and fee totals, top-up self-funding exclusion, phone/provider mismatch, one explicit dispatch, changed-price review, same-attempt recovery, forged/network callback hints, cancellation, verified PIN-reason presentation, fresh retry, six minutes backgrounded, hosted guide/recovery and committed wallet credit. The actual vendored SDK was exercised with intercepted HTTP to verify exact `tx_ref`, major-unit amount, national phone, selected method and polling teardown. No live provider request was used for that contract test.

Visual inspection covered entry, review, payment and processing at narrow widths. The final presentation pass removes a repeated review heading and replaces the old 2.11 MB padded CBE banner with a genuine compact 15.6 KB WebP emblem; provenance is in `public/payments/SOURCES.md`.

After those presentation changes, the production build passed again and all four English/Amharic navigation/layout confirmation cases at 320px and 430px passed. The earlier 21-case functional results are separate from these four confirmation cases. Final local logs are `.local/chapa-v1-browser-final.log` and `.local/chapa-v1-browser-confirmation.log`.

Official v1 documentation was reviewed for [Inline](https://docs.chapa.global/docs/v1/integrations/inline-js), [hosted initialization](https://docs.chapa.global/docs/v1/integrations/accept-payment), [verification](https://docs.chapa.global/docs/v1/integrations/verify-payment) and [webhooks](https://docs.chapa.global/docs/v1/integrations/webhooks). Local fixtures do not establish physical USSD arrival speed, merchant method activation or real provider callback behavior.

Native PIN entry is outside Lowwin. An incorrect PIN, cancellation or insufficient-funds explanation appears only if an actual provider response supports it. Generic failures and local timers cannot establish those reasons or a terminal payment outcome. The initial v1 launch still requires test-mode and physical-phone verification with the merchant's actual approved credentials and methods.
