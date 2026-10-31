# Provider-driven checkout lifecycle

Lowwin keeps Chapa v2 hosted checkout, server verification and ledger fulfillment separate. The shared handler covers telebirr, M-Pesa, CBE Birr and Awashbirr; it does not infer provider registration from phone prefixes or observe private actions inside the hosted page.

## Delivery and verification

- Authenticate before parsing, using exact raw-body HMAC for the default `raw_body` signature profile. The existing explicit `legacy_secret` compatibility profile remains a credential/lookup hint only; it never makes the payload payment evidence. Invalid signatures remain 401; malformed event/status pairs remain 400.
- Accept documented payment lifecycle pairs and the observed `payment.failed_or_cancelled` / `failed_or_cancelled` pair as durable verification hints. Return 200 only after durable receipt/deduplication. This combined pair is observed merchant evidence, not listed in the current v2 event table.
- Re-query the merchant reference through the v2 verification API. The webhook status, its fee-inclusive amount, a browser redirect, closing checkout and elapsed time cannot credit funds or accept a bid.
- Exact `FAILED_OR_CANCELLED` verification normalizes to the existing non-paid `FAILED` state with `CHAPA_PAYMENT_FAILED_OR_CANCELLED`, unless an exact recognized provider reason is more specific. The customer sees that the provider reported failure or cancellation, without guessing which occurred. No schema change is needed.
- `PENDING` stays pending; `AUTH_NEEDED` requests authorization. Verified `FAILED`, `CANCELLED`, `INCOMPLETE` and `BLOCKED` show the corresponding non-paid outcome. Only verified `SUCCESS` with matching principal amount, currency, merchant/attempt reference, mode/credential and metadata can apply funds once.
- Safe reasons include insufficient funds, incorrect PIN/OTP, unregistered payment account, blocked/cancelled/expired authorization. Arbitrary provider text, customer data, HTML and internal errors are never echoed. Unavailable verification retains the last state rather than inventing a failure.
- Events may arrive late or out of order. A failure hint can resolve to a current verified success; an already committed credit is never reversed by a later failure event. Duplicate deliveries and concurrent checks cannot duplicate the ledger receipt or accepted bid.

## Waiting and expiry

Five minutes bounds active browser checking from the saved attempt; it is not evidence of provider expiry. Longer waits use a quiet saved-payment presentation. Pending rows remain pending in customer history and admin views. Foreground return/reopening requests a fresh authoritative check without starting an endless loop. The durable event worker retries provider checks with bounded backoff.

The recorded `expiresAt` controls availability of the original checkout link. Chapa's optional `expires_at` replaces the initialization fallback when supplied. Historical rows do not distinguish an omitted provider expiry from that fallback, so the UI must not describe either the local five-minute timer or an inferred timestamp as a verified failed payment. If Chapa still reports `PENDING` and sends no terminal event, Lowwin cannot truthfully turn it into `FAILED` or claim to know whether the customer closed the page, mistyped a PIN or cancelled a bank prompt.

Retrying interrupted initialization uses its original intent and idempotency key. Starting a genuinely new checkout uses a new key and preserves the old record for reconciliation. Do not repay an already debited payment while its confirmation is unresolved.

## Deployment and acceptance

Redeploy WEB and the Chapa worker from the same reviewed commit. No new environment variable or migration is required. Resend the existing rejected webhook; do not create another live payment to test parsing. Confirm a new durable delivery returns 200, then verify its owned checkout reflects the authoritative API outcome. A 200 acknowledges receipt and does not itself mean a payment was successful.

Local regressions use mocked providers and isolated databases. Actual provider delivery and phone behavior require post-deployment acceptance; this document is not proof of those checks.

Local validation on 31 October 2026: 227 focused unit tests, 53 disposable PostgreSQL payment tests and 15 production-build browser checks passed. The database suite covers all four payment methods, combined failure without credit/bid/coupon use, conflicting principal rejection and a later success applied exactly once. Browser checks cover 360px, 430px and desktop, original-intent retry, no repeat handoff after known success or elapsed link validity, bounded five-minute waiting and late confirmed returns. Typecheck, production build and diff checks passed. No production data or real payment was used.

Sources: [Hosted Checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment), [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment), [Payment Webhooks](https://docs.chapa.global/docs/v2/webhooks/payment), [Webhook Overview](https://docs.chapa.global/docs/v2/integrations/webhooks).
