# Current Chapa v2 Direct contract

New top-ups and auction payments use private-key Direct, checkout flow version 5.
The existing financial engine, owned recovery, ledger, committed SSE and receipts
remain shared. Version 4 Inline and older attempts retain their original protocol,
merchant reference, credential binding and recovery; no existing payment is reset.

The official pages below were read in full, including the six webhook JSON
examples supplied by the user on 17 November 2026. The malformed combined webhook
link was resolved to the integration overview and payment lifecycle page.

## Initialization and authorization

[Initiate Direct payment](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment):
POST `/v2/payments/direct` with the server private key, stable `Idempotency-Key`,
integer cent amount, ETB currency, method, merchant reference and nested
`customer.phone_number`. Direct sends `metadata`, including this immutable
checkout's ID. The intent commits before provider HTTP. Retrying an unknown result
uses its original key and body. Both `chapa_reference` and `request_id` are retained.
An API success or initial `PENDING` result grants no money or bids.

[Authorize Direct payment](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment):
POST `/v2/payments/direct/validate` with the original reference and method; include
`otp` only when required. Do not send `auth_type` or `auth_value`, invent an
`/{reference}/authorize` route, cache authorization responses, persist or log OTPs.
USSD guidance and OTP stay in the original payment sheet. A successful validation
signals immediate private verification even after a recent pending read.

The Direct authorization response example contains an Inline wording typo;
business decisions use structured fields, never the human-readable message.

## Capabilities and financial verification

[Payment methods](https://docs.chapa.global/docs/v2/integrations/payment-methods):
the shared credential/mode-bound catalog requires `can_process_payments` and
`can_process_direct_charge`. ETB and Ethiopia must be enabled. Country-specific
integer cent minimum/maximum override currency defaults. The UI offers only the
supported enabled Telebirr, CBEbirr and M-Pesa rails; no guessed bank slug or extra
provider discovery is inserted inside a financial transaction.

[Verify payment](https://docs.chapa.global/docs/v2/integrations/verify-payment):
the private GET accepts the original merchant or Chapa reference. Fulfillment
requires structured uppercase `data.status === 'SUCCESS'`, matching amount,
currency, merchant reference, method, original configuration and any returned
metadata expectations. Metadata is supplementary and may be omitted by the
provider; conflicting returned metadata is rejected. The authenticated owner sees
success only after the financial transaction and durable receipt commit. Redirects,
webhook hints and validation success cannot independently credit a wallet.

[All transactions](https://docs.chapa.global/docs/v2/transaction/all-transactions):
the response demonstrates cursor pagination but does not document request filter
or cursor parameter names. No speculative `page`/`per_page` synchronization is
introduced into payment completion. Owned reference verification remains primary.

## Webhook lifecycle

[Webhook overview](https://docs.chapa.global/docs/v2/integrations/webhooks) and
[payment events](https://docs.chapa.global/docs/v2/webhooks/payment): authenticate
the exact raw bytes using HMAC SHA-256 and `x-chapa-signature`. `raw_body` is the
documented default. Existing explicitly configured `legacy_secret` compatibility
is retained for historical merchant delivery; there is no signature autodetection
or payload-authenticity claim for that compatibility profile.

Durably record/deduplicate mode- and configuration-scoped raw-body hashes before
acknowledging. Operations remain separately idempotent. Event time/order is a
reconciliation hint, not financial truth. No webhook delivery SLA is documented.

The six supplied examples establish these distinctions:

| Event | Meaning for Lowwin |
| --- | --- |
| `payment.success` | Top-level `webhook_type=payment`, matching event and lowercase status form a success hint; privately verify before credit. |
| `payment.failed` | Failure/reason hint, including `INSUFFICIENT_FUNDS`; verify the original attempt. |
| `payment.cancelled` | Preserve supported USER/SYSTEM cancellation attribution; never infer a new charge. |
| `payment.incomplete` | TIMEOUT/ABANDONED may prompt reconciliation; pending is not paid. |
| `payment.auth_needed` | Phone authorization guidance; PIN is never collected in the web form. |
| `payment.blocked` | Review hint; never credit or recharge based on COMPLIANCE_REVIEW. |

Amounts and fees in webhook examples are strings in cents. Method can be absent.
The response may call metadata `meta` although the Direct request uses `metadata`.
`payment_type` identifies the flow, not success. An expiry hint can equal its update
time; it does not reset the immutable intent. Raw event/OTP/PIN/customer secrets
are excluded from public DTOs and diagnostic logs.

## Validation boundary

Provider and database fixtures verify the contract and exactly-once effects.
Browser fixtures verify the shared form, recovery and committed status display.
They do not measure Chapa/operator/device response time. A controlled merchant
TEST payment from a phone is still required after deployment; no real charges or
customer broadcasts were initiated during this implementation.
