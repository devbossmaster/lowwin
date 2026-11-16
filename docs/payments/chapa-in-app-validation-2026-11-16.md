# In-app Chapa v2 validation - 16 November 2026

This update keeps the existing v2 integration and shared bid/top-up status presentation. It tightens the status layout and protects authorization/verification lease ownership. It does not change auction fees or initiate live payments.

## Current real Chapa TEST evidence

The latest capability probe used only `CHAPA_TEST_VALIDATION_PRIVATE_KEY` and `CHAPA_TEST_VALIDATION_PUBLIC_KEY`. It rejects invalid/non-TEST credentials and has no active-key or LIVE fallback. Its fetch guard permits exactly one bodyless GET to `https://api.chapa.global/v2/payments/methods`.

| Check | Latest observed result |
| --- | --- |
| Provider HTTP response | 200 |
| Time to response headers | 827 ms |
| Complete readiness check | 857.1 ms |
| Local configuration / provider connectivity | Ready / reachable |
| Enabled allowed methods | `telebirr`, `cbebirr`, `mpesa` |
| Minimum amount returned | telebirr: 100 cents; CBE Birr: 100 cents; M-PESA: 500 cents |
| Maximum amount returned | 100,000,000 cents for each of these three methods |
| Payment initialization | Separately attempted below using the documented TEST simulator |

These limits are the merchant TEST capability response, not a hardcoded promise for LIVE. The application must continue enforcing its own minimum and the enabled provider limits. Earlier HTTP 500 capability samples were provider failures; this later successful sample does not establish that those failures cannot recur.

The capability probe did not access customer records, dispatch notifications, or change keys/database configuration. Its script is `.local/probe-chapa-methods-test.ts` (local diagnostic artifact, not a production endpoint).

### Real TEST initialization: 16 November, 15:44 EAT

A separate bounded probe used the dedicated TEST public key, `POST /v2/payments/inline`, 10,000 integer cents (100 ETB), and Telegram-independent simulator input from Chapa's [Mobile Money Testing](https://docs.chapa.global/docs/v2/testing/testing-mobile) documentation: success phone `251900000000`. Each method used its own persisted merchant reference and idempotency key. No application database, customer phone, or notification delivery was involved.

| Method | HTTP / provider code | Sanitized response | Headers / total HTTP latency |
| --- | --- | --- | --- |
| `telebirr` | 400 / `INVALID_VALUE` | `payable not found` | 1,316.1 / 1,320 ms |
| `mpesa` | 400 / `INVALID_FORMAT` | `Invalid phone number for the selected payment method` | 1,005 / 1,005.5 ms |
| `cbebirr` | 400 / `INVALID_VALUE` | `payable not found` | 336.8 / 337.5 ms |

None returned an accepted payment status or authorization reference, so authorization, verification and provider completion could not proceed. The documented success phone has a `09` prefix and was rejected for M-PESA; no undocumented real number was substituted. Chapa must confirm a working simulator for these enabled methods and resolve the `payable not found` response before provider end-to-end completion can be demonstrated. These three samples are individual HTTP observations, not p50/p95 estimates or successful-payment timings.

An initial network-restricted attempt produced no HTTP response. Its recovery reused the exact saved original payload, reference and idempotency key. The subsequent run received the three responses above; it did not create another operation to recover that first request. No live keys, live charge or physical USSD were used. The test script and sanitized evidence are `.local/chapa-v2-provider-probe-2026-11-16.ts` and `.local/chapa-v2-provider-probe-2026-11-16-result.json`.

Prior probes from 15 November are historical evidence. Neither the current rejected TEST initializations nor intercepted browser fixtures establish native USSD delivery or a five-second authorization SLA.

## Application changes covered

- Bid fees and top-ups retain one compact status surface, readable summary rows and accessible close/actions. Provider-requested OTP remains in the same flow; LowWin never requests the wallet PIN.
- An outstanding authorization survives temporary verification failures, background/resume and the local display deadline. Transport health remains separate from provider outcome.
- Terminal retry returns to the preserved checkout and needs a new explicit Pay. Unknown outcomes retain the original payment reference/idempotency key for reconciliation.
- OTP responses update only the authorization attempt/lease they own. A delayed response cannot clear a newer verification lease.
- Internal-wallet payments remain separate from Chapa and use committed receipts for success. An external-provider outage must not block an otherwise eligible wallet payment.

## Validation results

- TypeScript `npm run typecheck`: passed.
- Targeted authorization/lease tests: 53 passed (backend validation).
- Targeted shared observer/status tests: 111 passed.
- Production Next.js build: passed in 238.3 seconds with the already-generated Prisma client. The Prisma source schema and generated-client schema were separately verified equivalent after whitespace normalization.
- A separate `npm run build` attempt stopped at Prisma engine replacement with Windows `EPERM`. This was a file-lock failure before Next compilation, not a TypeScript or application build failure. Existing user servers were not terminated to bypass the lock.
- Production-mode mobile browser checks: 23 passed in 4.9 minutes; 11 deliberately skipped duplicate lifecycle cases at 430 px. Layout/presentation cases ran at both 360 px and 430 px. Full lifecycle coverage ran at 360 px.
- Local before/after observer request count: a visibility resume followed by focus after 10 ms and online after another 10 ms issued 3 resume GETs before and 1 after, excluding the initial GET. Responses completed between events. This was measured for both the normal observer and original-attempt discovery. Each retained one scheduled check and zero timers after stop. This measures local request coalescing, not Chapa latency.

The production-mode browser harness uses a fresh loopback-only PostgreSQL test database, fake authentication, disabled live/payment/notification settings and intercepted provider HTTP. Its lifecycle tests verify application behavior without sending charges or Telegram messages. Test DB migrations are separate from any production deployment.

## Browser scenarios

The focused suites are `tests/checkout-v2-inline-browser/checkout.spec.ts` and `tests/reference-bid-browser/payment-status.spec.ts`, at 360 px and 430 px. They cover bilingual provider selection, phone validation, bid drafting, shared bid/top-up presentation, authorization, terminal errors, preserved retry, uncertain initialization recovery, OTP, late verified settlement and internal-wallet separation. Financial acceptance/credit remains required before success is displayed.

The harness also checks a single active status request, no background polling while hidden, same-attempt resume and no gateway request from merely selecting a payment method. Simulated UI/backend outcomes cannot prove production provider latency.

Screenshot artifacts are under `.local/payment-status-final/`: `v2-inline-payment-en.png`, `v2-inline-payment-am.png`, `v2-topup-payment-en.png`, `v2-topup-payment-am.png`, `authorization-waiting-en.png`, `authorization-waiting-am.png`, `authorization-pin-error-en.png`, and `authorization-pin-error-am.png`, each in its scenario's 360/430 directory. The test database was migrated and cleaned by the isolated runner.

## Official references

The integration contract was checked against the complete official pages: [Inline Charge](https://docs.chapa.global/docs/v2/integrations/inline-js), [Payment Methods](https://docs.chapa.global/docs/v2/integrations/payment-methods), [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment), [Webhooks](https://docs.chapa.global/docs/v2/integrations/webhooks), [Payment Events](https://docs.chapa.global/docs/v2/webhooks/payment), and [Keys and Environments](https://docs.chapa.global/docs/v2/integrations/test-live-mode).

Initialization acceptance and webhook notifications are not fulfillment proof. Server verification must still match the saved amount, currency, owner/reference/environment and completed fulfillment. No timeouts, verification requirements or financial safeguards were shortened to imitate the reference video's apparent speed.

## Remaining external checks

Resolve the provider TEST initialization responses above, then measure authorization/verification/completion with confirmed supported simulator inputs. Physical-device Telegram handoff and USSD require separate explicitly authorized device checks; Chapa's TEST simulator does not send real USSD/SMS. Record application preparation, provider HTTP and phone delivery separately. No production migration, merge, deployment or live payment was performed for this validation update.

## Compact checkout and wallet loading follow-up

The payment step now shows the product title, Edit action, selected number/count and a short submission-fee note. The repeated readiness heading and duplicate fee total were removed; the accurate total remains next to Pay. English and Amharic single/multiple-bid layouts passed at 320, 360 and 430 px, with the summary bounded to 144 px and Edit retaining a 44 px touch target.

Switching external providers previously aborted and restarted an unchanged fee-quote request. It now keeps that request alive across telebirr, M-PESA and CBE Birr selection. A pending external quote no longer blocks internal-wallet payment. Twelve production-mode fixture browser checks passed, including a deliberately held quote, provider switching without initialization, and successful wallet payment while the external response remains held. Provider HTTP was intercepted; these tests made no real charges. Screenshots and results are in `.local/compact-checkout-20261116/`.

Home already preloads the authenticated wallet through the shared private query cache. The remaining server improvement overlaps schema readiness with authentication and shares concurrent readiness probes with the existing 30-second, database-client-scoped cache. User ledger reads still require authentication; balances themselves are not cached on the server. Fourteen focused wallet/readiness tests passed, including denied authentication, cold concurrent reads, forced schema refresh and retry after synchronous/asynchronous failures. This removes redundant database work; no production latency figure is claimed.
