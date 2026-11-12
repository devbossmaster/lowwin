# Native Chapa v2 Inline checkout — 12 November 2026

Lowwin's active external checkout uses the documented [v2 Inline API](https://docs.chapa.global/docs/v2/integrations/inline-js). The browser renders Lowwin's form and observes its owned server state. No Chapa SDK or v1 payment adapter is required.

## Provider contract

1. The final explicit Pay action validates the owned immutable bid quote or top-up principal. Lowwin persists the payment intent and stable operation identity before provider HTTP; network requests remain outside financial database locks.
2. The server calls `POST https://api.chapa.global/v2/payments/inline` with the matching public key, integer-cent amount, selected enabled method, payer phone, a merchant reference of at most 20 characters and the original `Idempotency-Key`.
3. Returned authorization details drive the same payment-status surface. The server uses `POST /v2/payments/inline/validate` with the public key and returned reference for the provider's USSD/OTP requirements. Lowwin never collects a wallet PIN or claims a native phone prompt arrived merely because initialization was accepted.
4. Final fulfillment requires private-key server verification through `GET /v2/payments/{reference}/verify`. The completed payment must match the expected owner, environment, merchant/reference, amount and currency. Bid success additionally requires accepted bid IDs; top-up success requires committed wallet credit.
5. Signed notifications and bounded status observation reconcile the same attempt. An uncertain HTTP response, backgrounding, local timer or dismissed sheet cannot create a fresh charge or fabricate failure. Lost initialization replies can restore the original owned intent through `GET /api/payments/chapa/inline?key=…`.

See [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment) and [Payment Webhooks](https://docs.chapa.global/docs/v2/webhooks/payment). Lowercase webhook `status: "success"` and top-level API-operation `status: "success"` are distinct from verified completion `data.status: "SUCCESS"`.

New Inline intents use immutable `flowVersion: 4`, `apiVersion: "v2"`, reference/principal binding and a public-key fingerprint. Credential rotation cannot silently rebind the original attempt. Private verification remains authoritative.

## Frontend boundary

The reference-style bid form keeps single/multiple selection, One by one/Range entry, editable/removable number chips, actual fee totals and server rules. Its 2×2 payment grid contains only telebirr, CBE Birr, M-PESA and Lowwin Wallet. The external phone field follows the selected provider's existing normalization/validation rules. A valid format is not proof of a registered provider account.

Range uses an explicit positive Step, defaulting to `1.00` or the smallest compatible auction increment at least that large. From `1` through `4` at Step `1.00` produces four selected amounts, not 301 cent-spaced entries. The live preview and pre-Add validation reject incompatible steps, unaligned endpoints, duplicates, submission limits and the existing maximum-three-consecutive rule. Invalid ranges are neither truncated nor silently skipped. Amount precision and server-side auction economics remain unchanged.

Wallet top-up offers the same three external choices, the `10`, `50`, `100`, `200`, `500` and `1,000` ETB presets within actual configured limits, and a payer phone inside the shared provider panel. Wallet cannot fund itself. There are no bonus offers or bonus labels. Selection and draft editing do not initialize payment.

The 40-second reference recording `12.11.2026_11.36.32_REC.mp4` was reviewed. External bidding and deposits use one compact centered status surface with a 48px icon, one heading and main message, a gold activity line and borderless summary rows. Bid summaries contain four rows; top-ups use the corresponding shorter summary. Confirmed errors update this same surface rather than opening another approval screen. No progress percentage or native PIN-entry detection is invented.

Internal-wallet bidding uses the existing authenticated atomic ledger/bid command. It loads no provider SDK, makes no Chapa request and does not wait for phone authorization or webhooks. The wallet progress view stays compact; success comes from its committed receipt. An interrupted wallet response retries only the same original command. Top-up credit restores an embedded bid draft and requires an explicit later Pay before spending the new balance.

## WEB and worker configuration

Set the same reviewed merchant/environment settings on both resources:

```dotenv
PAYMENT_GATEWAY=CHAPA
CHAPA_MODE=live
CHAPA_ENABLED=true
CHAPA_INLINE_ENABLED=true
CHAPA_RECOVERY_ENABLED=true
CHAPA_SCHEMA_READY=true
CHAPA_LIVE_ENABLED=true
CHAPA_MERCHANT_REVIEWED=true
CHAPA_PUBLIC_KEY=<matching current dashboard public key>
CHAPA_PRIVATE_KEY=<matching server-only v2 private key>
CHAPA_INLINE_METHODS=telebirr,cbebirr,mpesa
```

Use matching test credentials and `CHAPA_MODE=test` for provider testing before reviewed production activation. The public key is `CHAPA_LIVE_PUB_…` or `CHAPA_TEST_PUB_…`; it never replaces `CHAPA_PRIVATE_KEY`. The configured method list narrows the merchant capability catalog and cannot enable an unavailable method.

Keep the v2 dashboard webhook URL `https://lowwin.shop/api/payments/chapa/webhook`, `CHAPA_WEBHOOK_SECRET` and the reviewed `CHAPA_WEBHOOK_SIGNATURE_PROFILE`. This merchant's support-confirmed `legacy_secret` signature profile is a v2 dashboard delivery compatibility setting, not a v1 payment API. Do not switch signing profiles without confirming actual authenticated deliveries. Private server verification is required under either profile.

## Schema and historical records

`202611120001_chapa_v2_inline` is existing committed migration history. The current frontend and active-v1-removal cleanup adds no migration, changes no balances and converts no old payment rows. Keep the historical migration files intact.

Active v1 payment routes, worker recovery, SDK and configuration are removed. Existing v1 `flowVersion: 3` rows remain read-only unsupported historical records. They must fail closed rather than initialize, validate or fulfill through a different API version. Earlier v2 records retain their immutable reference and evidence boundaries.

For the intended application revision, use the normal migration process and redacted readiness check:

```sh
npx --no-install prisma migrate status
npx --no-install prisma migrate deploy
npx --no-install tsx scripts/check-chapa-inline.ts --schema
```

The diagnostic performs configuration/schema metadata checks only. It does not contact Chapa or read customer/payment records. Check both WEB and the Chapa worker; repository source alone cannot confirm the effective deployed revision or settings. Readiness does not establish physical-phone delivery or real-payment completion.

## Validation record

- 430 focused unit/service tests passed across 27 suites, with two intentionally skipped database-gated tests.
- Separate real-PostgreSQL runs on isolated local test databases passed 16 v2 Inline cases and 11 atomic-wallet cases.
- The production build and its TypeScript check passed.
- The final main mobile run produced 18 passed checks, 16 intentional duplicate-project skips and two failures of an initial 520px status-height assertion. Both affected Amharic surfaces fit the viewport: 528.48px at 320px width and 526.63px at 430px width. The test ceiling was corrected to the smaller of 560px or viewport height minus 40px, allowing natural Amharic wrapping without changing the application.
- All six final authorization/error modal cases then passed in a focused 33.3-second repeat across English/Amharic and 320px/360px/430px, including confirmed incorrect-PIN text and in-place error updates. Combined with 14 other successful payment checks from the main run, these cover 20 distinct final scenarios. Four cases overlap between runs; they are not counted twice. The main run was not repeated after the assertion-only correction and must not be described as an exit-zero run.

The separate earlier UI baseline passed 36 browser checks with 24 intentional skips in 3.4 minutes; it predates the final geometry checks above. Evidence remains in `.local/v2-cleanup-browser.log`, `.local/reference-bid-browser.log` and `test-results/reference-bid/payment-status*` captures.

The local test-mode configuration check ran **without `--schema`**, reported `schema.status: "not-requested"` and performed no schema query. It found a missing `CHAPA_PUBLIC_KEY` and disabled `CHAPA_INLINE_ENABLED`; payment creation was not activated. Migrations and guards were verified separately only against isolated database fixtures. These results do not establish schema readiness for the current `.env` database or production, nor the deployed WEB/worker configuration.

The integration review read the full official v2 [Inline](https://docs.chapa.global/docs/v2/integrations/inline-js), [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment), [Webhook Overview](https://docs.chapa.global/docs/v2/integrations/webhooks), [Payment Webhooks](https://docs.chapa.global/docs/v2/webhooks/payment), [Security Guide](https://docs.chapa.global/docs/v2/security/security-guide), error-code and direct-charge contract pages. The [direct initiation](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment) and [authorization](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment) contracts were reviewed to keep their boundaries distinct from native Inline; this does not add another active checkout protocol.

No live charges, broadcast, production migration, merge or deployment was performed as part of this local change.
