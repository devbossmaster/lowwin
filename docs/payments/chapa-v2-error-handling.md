# Chapa v2 request errors and payment outcomes

The v2 error-code table is the contract for API-request failures. Payment verification and payment lifecycle events remain the contract for whether money moved. No separate bank integration is introduced.

## Request error policy

Lowwin reads the HTTP status and nested `error.code`. Provider `message` and `error.details` never choose retry, conflict handling, ownership or fulfillment. They are not echoed to customers or logged as full payloads.

| HTTP / machine code | Handling |
| --- | --- |
| 400 or 422 validation errors | Stop blind initialization retries; keep the original attempt and show that checkout could not start. |
| 401 / 403 | Treat as a configuration/permission problem, never as proof of failed payment. Customer-triggered verification uses a five-minute cooldown. |
| 404, or 400 `NOT_FOUND` | Preserve the last payment state and reconcile the same reference after one minute. An interrupted initialization can still retry its exact original body/key if it has no conflict. |
| 409, or 400/422 `INVALID_STATE` | Preserve the original attempt, merchant reference and key. Block further hosted initialization for this conflicting record; verification determines its current outcome. Later verification errors must not erase that conflict guard. |
| 500 / network or malformed response | Retain the original intent and retry safely; never create an automatic replacement. Verification backs off for 30 seconds. |
| 429 | Preserve the outcome and use a one-minute verification cooldown. |

An initialization error is cleared after successful initialization. Technical HTTP/code diagnostics remain in protected storage and the read-only server CLI (`scripts/check-chapa-checkout.ts`); the owned customer response provides only a safe category. Customer payment details use readable status/action messages, not raw provider codes, internal confirmation reasons or arbitrary server error text.

The cooldowns above govern customer-triggered status checks. An authenticated new webhook can request an immediate authoritative lookup, and durable event jobs retain their existing bounded retry schedule (at most five attempts with increasing backoff). That queue can retry sooner than a customer cooldown; it does not loop indefinitely or create replacement checkouts.

The optional verified payment `reason` is separate from the API error envelope. Exact recognized reasons can select safe explanatory copy, but cannot change payment status, choose references, credit funds or accept a bid. Unknown or sensitive reasons use generic wording. Payout/refund-specific codes do not introduce payout/refund functionality into this hosted-payment change.

## Security boundaries retained

- Private API keys remain backend-only, with separate mode/key bindings and fixed HTTPS provider origins.
- Hosted requests use integer cents, a saved merchant reference and a stable idempotency key. Return URLs are navigation only.
- Webhooks authenticate before parsing. The default profile uses raw-body HMAC and constant-time comparison. Existing explicit `legacy_secret` compatibility remains a documented lookup-only exception for observed merchant deliveries; it is not silently enabled or switched by this change.
- Delivery deduplication and ledger/business idempotency remain separate. A 200 is sent after durable receipt, not as proof of payment.
- Server verification must match `SUCCESS`, principal amount, currency, merchant/attempt reference, mode/credential and expected metadata before fulfillment. Provider calls stay outside financial transactions; committed payments cannot be reversed by late failure hints.
- Private financial responses remain `no-store`. No PIN, OTP, raw provider response, payer phone/email or secret is added to logs or public errors.

No schema migration or environment change is required. Deploy WEB and the Chapa worker from the same reviewed commit. Actual provider delivery remains a post-deployment acceptance check.

Validation on 31 October 2026: 247 focused unit tests, 68 disposable PostgreSQL payment tests and 21 production-build browser checks passed. The browser checks cover 360px, 430px and desktop: conflict lockout, original-key recovery, hidden technical errors, bounded waiting and late confirmed returns. Typecheck, production build and diff checks passed. No live payment, production database mutation or real Telegram send was used.

Sources: the merchant-supplied v2 Error Codes table; [Security Guide](https://docs.chapa.global/docs/v2/security/security-guide), [Webhook Overview](https://docs.chapa.global/docs/v2/integrations/webhooks), [Hosted Checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment), [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment).
