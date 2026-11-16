# Payment backend reliability validation — 16 November 2026

Base revision: `3dd1d7f19f9353db4d85d6ee98fa3bd90083fdc5`. These changes retain the existing in-app Chapa v2 Inline flow and internal wallet settlement. No UI redesign, migration, deployment, merge, or live payment was performed.

## Changes and causes

- Verification previously allowed a delayed provider response to write after its lease expired and another verifier acquired the checkout. Every verification response now carries its exact lease into conditional writes and locked settlement. An older request cannot clear a newer lease or overwrite newer evidence.
- Inline initialization had the same problem: delayed initialization/recovery responses could clear a verification lease acquired in the meantime. Initialization success and error writes now require the original lease. Authoritative payment evidence remains protected.
- Duplicate initialization while a lease is active now returns the owned checkout projection without an extra transaction, authorization/maintenance pass, rate-budget write, lease-claim write, or owned-order read. New dispatches still acquire the lease and pass the checks. Provider HTTP remains outside transactions.
- Reload recovery retains an account- and purpose-scoped opaque operation key and checkout ID in session storage. It stores no payment payload, amount, phone, token or credential. Recovery reads the authenticated original operation; restoring a pointer never creates a charge. Another unresolved key cannot overwrite the pointer, and account change/logout clears private pointers.
- Readiness distinguishes missing local configuration from provider authentication, environment mismatch, rate limiting and outages. `scripts/check-chapa-inline.ts --methods` supports an explicit read-only TEST capability check and blocks LIVE. Diagnostics contain only allowlisted codes/static explanations, never raw provider responses or keys.
- Capability caching remains bounded, single-flight and isolated by environment and merchant credentials. Only the supported telebirr, M-PESA and CBE Birr methods can pass the existing server allowlist and amount/currency checks.

## Validation

| Check | Actual result |
| --- | --- |
| Combined payment/recovery/lease regression run | 142/142 tests passed across 8 files; 5.04 seconds |
| Capability/readiness-focused run | 130/130 tests passed across 6 files; 2.31 seconds; overlaps the combined run |
| Wallet transaction integration | 18/18 passed; 6.89 seconds |
| Payment settlement integration | 68/68 passed; 45.99 seconds |
| Existing migrations on a disposable local database | Passed; 2.401 seconds |
| TypeScript, no incremental cache | Passed; 29.331 seconds |
| Next.js production build with webpack | Passed; 84.711 seconds |
| Diff whitespace check | Passed |

The two transaction suites used disposable PostgreSQL databases on loopback and mocked provider HTTP, not the configured production database. They cover complete-batch rollback, competing funding paths, insufficient funds, duplicate effects, original ownership, durable webhook handling, verification mismatches, unavailable verification, late credit and account isolation. The wallet test expectation was corrected to the existing one-notification-per-batch contract; wallet accounting was not changed.

An attempted Prisma client regeneration was blocked by a Windows engine DLL lock (`EPERM` on rename). Typecheck and build passed with the already-generated client. No Prisma schema changed, and this update requires no new migration. All disposable validation databases were dropped by their runners.

## Controlled latency comparison

The duplicate-initialization benchmark compared the exact base-revision function with the changed function using the same artificial dependency delays, alternating execution, 3 warmups and 40 measured samples per version.

| Active-lease duplicate only | Before | After |
| --- | ---: | ---: |
| p50 | 155.504 ms | 0.016 ms |
| p95 | 157.106 ms | 0.036 ms |
| Additional transactions | 1 | 0 |
| Additional rate-budget writes | 1 | 0 |
| Additional lease writes / owned reads | 1 / 1 | 0 / 0 |
| Provider calls | 0 | 0 |

The original payment ID was preserved. This measures eliminated application work on duplicate requests only. It does not measure initial Pay, real database latency, Chapa authorization, physical USSD arrival or production percentiles. Reproduction harness: ignored `.local/chapa-inline-duplicate-benchmark.mjs`.

## Actual Chapa TEST checks

The guarded probe uses TEST-format credentials, permits exactly one `GET https://api.chapa.global/v2/payments/methods`, rejects other endpoints/methods/bodies and prints no keys. The user's dedicated variables are `CHAPA_TEST_VALIDATION_PRIVATE_KEY` and `CHAPA_TEST_VALIDATION_PUBLIC_KEY`; they are mapped only into the probe's in-memory configuration. They do not enable or overwrite the normal application configuration.

Three completed network samples returned HTTP 500 (`HTTP_ERROR`, sanitized `PROVIDER_UNAVAILABLE`):

| Sample | Response headers | Whole readiness check |
| --- | ---: | ---: |
| Initial TEST capability check | 1042.5 ms | 1050.2 ms |
| Retest after active mode changed to TEST | 1170.9 ms | 1181.6 ms |
| Explicit dedicated-key-only retest | 1121.3 ms | 1128.7 ms |

The previous HTTP 403 environment mismatch did not recur in these samples. HTTP 500 is provider failure evidence, not proof that configuration is missing or that credentials are accepted. No payment initialization/validation/verification request was sent. End-to-end provider payment and physical-phone confirmation remain unverified while enabled capabilities cannot be obtained.

The last probe reads only the dedicated validation pair; it has no fallback to active or LIVE credentials. Both TEST key-format guards and local readiness prerequisites passed, while `providerConnectivity` was `unavailable` and overall `ready` was false.

An earlier restricted-network attempt returned no HTTP response and is excluded from provider measurements. Active runtime inspection also found `CHAPA_PUBLIC_KEY` absent; this is distinct from the dedicated validation pair and matters only when running the normal application's TEST checkout.

## Deployment and configuration scope

This update has not been deployed or merged. When released, deploy WEB and the Chapa reconciliation worker from the same reviewed revision. Keep the existing webhook configuration and required applied migrations. Existing immutable payment records and recovery must retain their original environment/version; changing current credentials does not migrate pending payments.

For normal TEST checkout, the application needs its matching TEST `CHAPA_PRIVATE_KEY` and `CHAPA_PUBLIC_KEY`, `CHAPA_MODE=test`, existing reviewed feature/schema gates, and merchant-enabled capabilities. For the dedicated probe, use only the two `CHAPA_TEST_VALIDATION_*` variables. Never paste secrets into logs or reports. Actual USSD speed and merchant method availability require provider TEST access and physical-device validation; no speed SLA was inferred from isolated tests.

Official pages reviewed: [Inline Charge](https://docs.chapa.global/docs/v2/integrations/inline-js), [Payment Methods](https://docs.chapa.global/docs/v2/integrations/payment-methods), [Verify Payment](https://docs.chapa.global/docs/v2/integrations/verify-payment), [Webhooks](https://docs.chapa.global/docs/v2/integrations/webhooks), [Keys and Environments](https://docs.chapa.global/docs/v2/integrations/test-live-mode), and [Error Codes](https://docs.chapa.global/docs/v2/error-codes).
