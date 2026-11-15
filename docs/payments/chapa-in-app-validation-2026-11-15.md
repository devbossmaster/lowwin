# In-app v2 checkout validation — 15 November 2026

The final requested flow is **in-app Chapa v2**, following `video_2026-11-15_00-41-20.mp4`. It supersedes the earlier request to create new hosted sessions. New external payments retain LowWin's existing v2 Inline implementation; historical hosted/direct/Inline attempts keep their original recovery path.

## Changes

- Compact product header, always-available Add action, one-by-one/range entry, editable chips and immediate submission-fee totals. No multiple-number toggle. Existing decimal, duplicate, consecutive-number, limit and coupon rules remain authoritative.
- Shared payment form for bid fees and deposits. New external choices are only `telebirr`, `cbebirr` and `mpesa`, further limited by server-discovered merchant capabilities and amount bounds. LowWin Wallet is available only for bids.
- One compact shared external status surface; internal-wallet payment retains its separate brief paying/receipt surface. No PIN collection, artificial percentage or automatic new charge on polling errors.
- Independent schema/capability preparation overlaps outside financial locks. Unsupported new methods and top-up amounts reject before the financial transaction. Dispatch timing marks the actual provider-call boundary.
- New intents freeze the actual configured webhook signature profile. A saved raw-body requirement cannot be downgraded to reusable legacy-secret proof. Raw-body HMAC can upgrade the historical hint profile; fulfillment still requires private verification.
- Successful Inline evidence must include the exact saved payment method. Missing or mismatched method evidence never credits funds.
- Historical v1 recovery is explicitly opt-in and verification-only, using the original endpoint, credentials, fingerprint and v1 major-ETB units. It cannot create v1 payments or fall through to v2 verification. Its worker can run while v2 creation is paused. Historical v1 callbacks are not newly added; original-version polling handles recovery.
- The desktop Home header puts centered customer navigation and existing account controls in one row. Mobile retains its compact arrangement. No duplicate account hooks were introduced.

## Actual Chapa TEST results

Separate `CHAPA_TEST_VALIDATION_PRIVATE_KEY` and `CHAPA_TEST_VALIDATION_PUBLIC_KEY` were used. Existing live settings were not changed. Only newly created loopback records were used; no production wallet, bid or notification was changed.

After the TEST API key was activated, `GET /v2/payments/methods` returned **200**, including all three requested methods. One read took **863 ms**. The service validation read took **889 ms**. Actual enabled ETB minimums were Telebirr 100 cents, CBE Birr 100 cents and M-Pesa 500 cents. LowWin retains its **5.00 ETB deposit minimum**.

Three actual 5 ETB TEST Inline initialization requests used the documented minimal payload, public-key authorization, integer cents, unique 20-character merchant references and stable idempotency keys:

| Method | Service time before dispatch | Provider initialization HTTP | Total service command | Result |
| --- | ---: | ---: | ---: | --- |
| Telebirr | 96 ms | 985 ms | 1,105 ms | HTTP 400, `INVALID_VALUE` |
| M-Pesa | 27 ms | 334 ms | 370 ms | HTTP 400, `INVALID_VALUE` |
| CBE Birr | 22 ms | 304 ms | 338 ms | HTTP 400, `INVALID_VALUE` |

Replaying the original Telebirr request for a sanitized diagnostic returned **`payable not found`**, with no additional details. One separate documented private-key TEST Direct Telebirr probe returned the same error in **1,200 ms**, so the observed failure was not confined to Inline.

The [official mobile-testing page](https://docs.chapa.global/docs/v2/testing/testing-mobile) was then read in full. A new Inline Telebirr request using its documented success phone, `251900000000`, returned the same error at 500 cents in **1,116 ms**. A separate Direct request using that phone and the documentation's 10,000-cent example also returned the same error in **1,040 ms**. These two bounded probes used new saved references/keys because their payloads differed; they did not alter or replace the original attempts. The failure therefore persisted with the documented success fixture and a higher example amount.

No authorization reference was returned. Private verification of each original Inline merchant reference returned **404 `NOT_FOUND`**. Therefore `/inline/validate`, successful fulfillment, cancellation and actual phone-prompt delivery could not be validated against Chapa in this run.

Each same-key application replay returned its original owned attempt and made **zero further provider calls**. No wallet credit was created. Method discovery was performed first and reused for the creation commands; a cold capability read adds its own network latency. These are individual local service observations, not p50/p95 statistics, production latency or an authorization-delivery SLA. Authentication HTTP overhead, remote database latency and a physical device are outside those preparation measurements. No comparable pre-change actual-provider sample exists, so no before/after speedup is claimed.

The payload matches the required fields on the official Inline page. The precise cause of `payable not found` remains unconfirmed; method discovery alone does not establish operational initialization for these TEST credentials. Do not weaken verification or switch gateways automatically to hide the response.

## Merchant configuration and follow-up

Current v2 creation uses `CHAPA_MODE`, `CHAPA_PRIVATE_KEY`, `CHAPA_PUBLIC_KEY`, `CHAPA_WEBHOOK_SECRET`, `CHAPA_WEBHOOK_SIGNATURE_PROFILE`, `CHAPA_SCHEMA_READY`, `CHAPA_ENABLED`, `CHAPA_INLINE_ENABLED` and `CHAPA_INLINE_METHODS=telebirr,cbebirr,mpesa`, together with existing environment/review gates. Worker recovery uses `CHAPA_RECOVERY_ENABLED`. Keep matching merchant/environment keys and HTTPS application origins.

Use the existing webhook URL `/api/payments/chapa/webhook`. Prefer documented exact-raw-body HMAC. For this merchant, the prior support-confirmed legacy profile remains an explicit compatibility setting: it authenticates a delivery hint rather than the payload contents. A private lookup matching the owned frozen payment remains mandatory.

Optional historical v1 recovery requires its original `CHAPA_V1_SECRET_KEY`, explicit `CHAPA_V1_MODE`, reviewed original `CHAPA_V1_BASE_URL` and `CHAPA_V1_RECOVERY_ENABLED=true`; live/test safety gates still apply. Do not put current v2 keys into v1 settings. Audited per-order rotation bindings are separate from new-payment configuration.

This update adds **no database migration**. Preserve committed migration history. Redacted current-v2 readiness can be checked with `npx --no-install tsx scripts/check-chapa-inline.ts --schema`; worker startup configuration distinguishes v2 recovery from original-v1 recovery.

For Chapa support: the activated TEST private key lists enabled methods; documented Inline and Direct initialization return HTTP 400 `INVALID_VALUE`, message `payable not found`, at 500 cents. Ask them to confirm the TEST key pair's merchant binding and payment-initialization availability, and whether an undocumented prerequisite exists. Share request references through their secure support channel, never keys or OTPs.

## Official contracts reviewed

- [Inline initialization and validation](https://docs.chapa.global/docs/v2/integrations/inline-js): public-key REST, top-level `mobile`; no documented JavaScript SDK/widget dependency.
- [Direct charge](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment): private-key flow with nested `customer.phone_number`; retained recovery is not an automatic fallback.
- [Private verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), [webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks), [payment events](https://docs.chapa.global/docs/v2/webhooks/payment), [methods](https://docs.chapa.global/docs/v2/integrations/payment-methods), [environments](https://docs.chapa.global/docs/v2/integrations/test-live-mode), [migration](https://docs.chapa.global/docs/v2/migration) and [structured errors](https://docs.chapa.global/docs/v2/error-codes).

## Application validation

- Focused service/timing checks: **31 passed**. Provider allowlist checks: **17 passed**. Worker readiness: **20 passed**.
- Focused settlement, original-version recovery and evidence checks: **135 passed** across nine files. Webhook/API/profile/event checks: **90 passed**. Client/progress/navigation/recovery checks: **112 passed**. These groups overlap; their counts must not be added as a unique-test total.
- The safe local **production build passed**, including Next's TypeScript check and generation of 38 static pages; build wall time was 188.8 seconds. This build duration is not application request latency.
- Production-mode desktop header geometry: **8/8 passed**, including English/Amharic at 1024, 1280 and 1440px. Navigation centers geometrically at 1280px and above; 1024px centers it between the brand and controls. No overlaps or page overflow. Guest checks at 360/1440px made zero private wallet/alert requests.
- The first bounded production-mode payment UI pass recorded **nine passed, one failed and two intentional width skips**. The failure was an obsolete exact test label (`Lowwin Wallet` versus the current `LowWin Wallet`); it was corrected. Passed checks cover entry/payment layouts and deposits in English/Amharic at 360/430px, phone placement, provider selection and verified-credit presentation. Browser payment responses in these UI checks are fixtures and do not establish provider settlement or physical-phone timing.
- A corrected bounded lifecycle rerun then passed **2/2 in 14.9 seconds**: one explicit external Pay retained one owned attempt until accepted bids; wallet duplicate taps used one command and one debit, with zero quote, provider, SDK or status calls. No product changes were made after the successful build. This targeted rerun does not replace the original sweep's recorded exit status.

- The final targeted production-mode rerun passed **2/2 in 14.9 seconds**: one explicit external Pay retains one owned attempt until accepted bids; wallet payment remains independent during an external-method outage, and duplicate taps produce one committed wallet debit with zero external initialization, SDK, quote or status requests. Clean entry, external progress, wallet paying and wallet receipt screenshots were captured. These are UI fixtures, not provider-speed measurements. The owned local HTTPS server and disposable databases were cleaned up.

The earlier development-header harness stopped on a webpack chunk-load error. Its incomplete run is not reported as successful; the optimized production-header check above passed. Build and UI fixtures used only separately owned loopback databases.

No merge, deployment, live charge or production migration was performed.
