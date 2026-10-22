# ArifPay direct bid-fee checkout

This additive integration pays one published v4 submission fee through Telebirr or M-PESA. It does not turn the chosen number into a monetary charge. V1–V3 auctions retain their frozen rules and existing bid command. Existing customers, wallet funds, transfer history, bids, settlements, staff tools and Verify.et records remain intact.

All ArifPay release switches are **false** in `.env.example`. No production database migration, payment activation or real payment has been performed by this change.

## Current primary contract

Reviewed 22 October 2026 against [ArifPay developer documentation](https://developer.arifpay.net/docs), its [Production Postman collection](https://developer.arifpay.net/postman/ArifPay-Production.postman_collection.json), and [Sandbox Postman collection](https://developer.arifpay.net/postman/ArifPay-Sandbox.postman_collection.json). The documentation is a dynamic page; the current deployed documentation JavaScript contains its detailed examples.

- Production merchant host in the current collection: `https://gateway.arifpay.net`. Confirm this host and merchant approval with ArifPay before release.
- Telebirr: `POST /api/checkout/telebirr-ussd/transfer/direct`.
- M-PESA: `POST /api/checkout/mpesa/transfer/direct`, with a `2517…` phone number.
- Definitive merchant nonce lookup: `GET /api/checkout/getSessionByNonce/{nonce}` authenticated by the same server `x-arifpay-key`.
- Direct transfer HTTP 200 and messages such as `USSD sent` mean a request was accepted. They do not prove payment.
- The documented callback is unsigned raw JSON. The gateway does not automatically retry callbacks. Lowin consequently treats callbacks as wake-up signals and independently queries the gateway. A secret in the merchant callback URL reduces unwanted requests; it is not an ArifPay signature.
- The current production nonce example does not include a currency or payment-method field. Its documented local payment amount is ETB. Lowin requires an explicitly reviewed ETB merchant configuration and exact amount, nonce, session and payer-phone equality; any supplied currency or method must also agree. A successful lookup additionally requires a provider transaction reference before any ledger credit. If evidence is missing or contradictory, no credit occurs.
- Sandbox paths differ from production, and the published sandbox M-PESA flow is session creation followed by transfer. This implementation intentionally does not invent a sandbox nonce-lookup route. A provider-approved sandbox contract or controlled merchant test is still required before activation.

## Application API

Authenticated routes use Telegram/contact-bound sessions, same-origin mutations, bounded request bodies and user rate limits. Every private response is `private, no-store` with `Vary: Cookie`.

`GET /api/payments/arifpay` returns `{enabled,recoveryEnabled,channels,currency,reason}`. The interface can display unavailable payment channels truthfully without attempting a charge. `GET /api/payments/arifpay/checkouts` returns the authenticated customer's latest 20 orders as `{items:[...]}` without exposing payer phones; it returns an empty list before schema readiness is enabled.

`POST /api/payments/arifpay/checkouts` accepts:

```json
{"auctionSlug":"example","amount":"3.60","feeVersion":1,"key":"UUID","channel":"TELEBIRR","phone":"0911111111"}
```

`amount` is a **bid number**. The server reads and freezes the actual fee from the auction; the client cannot submit a payment amount. The response is 202 with `{id,auctionSlug,amount,fee,currency,channel,status,reason,receipt,createdAt,expiresAt,pollAfterMs,fundsPreserved}`. `receipt` has the unchanged existing bid receipt shape when accepted.

`GET /api/payments/arifpay/checkouts/{id}` reads only the authenticated customer's order. `POST` to the same path checks provider status and attempts completion. Poll only after `pollAfterMs`, pause while hidden, do not overlap requests, and keep the same checkout ID after a timeout. Bound foreground polling and show a recoverable pending state with a manual check and support access; never spin indefinitely.

States:

| State | Meaning |
| --- | --- |
| SUBMITTING / PENDING | Request in progress or provider evidence insufficient. No bid or credit is implied. |
| BID_ACCEPTED | Provider independently verified and the existing bid command accepted the bid. |
| NEEDS_REVIEW | No accepted bid from this order. If `fundsPreserved=true`, the exact verified fee was retained in the customer's existing ledger balance for review. |
| FAILED / CANCELLED / EXPIRED | Gateway verified a terminal unsuccessful outcome. No credit. |

The browser success/cancel/error return URL carries only a checkout ID. It has no authority to mark a payment paid. A customer closing the Mini App does not cancel the provider payment. The interface saves the exact consented fee, original request key and immutable request details in session-scoped recovery storage before submission. Uncertain requests freeze edits and retry the same body; a changed authenticated identity destroys the prior UI callback scope. Terminal outcomes clear both the saved intent and any legacy request-key slot. All foreground HTTP requests have a 12-second bound and polling has a five-minute budget.

## Financial and concurrency behavior

1. Under the existing auction → wallet lock order, validate current contact, account eligibility, v4 terms, amount pattern, fee revision, bid cap and auction deadline. Refuse a new payment within 30 seconds of closing. Persist one immutable intent, encrypted payer phone and random nonce before provider HTTP.
2. Send the USSD request once. An ambiguous timeout never generates a second session. Repeated keys and refreshed keys for the same unresolved bid intent reuse the original order.
3. A short durable polling lease deduplicates browser, callback and worker checks. Fetch provider evidence outside the database transaction. Confirm exact merchant-scoped nonce, session, fee and payer phone; reject contradictory status and identifiers.
4. Serialize by auction, wallet, checkout and provider transaction reference. Exactly one balanced `ARIFPAY_RECEIPT` journal records the independently confirmed fee. Then call `submitBidInTransaction` with its original idempotency key and frozen fee revision. The normal `BID_FEE` journal debits only the disclosed fee. No v4 hold is created.
5. A savepoint keeps the verified payment journal if the bid loses a deadline/contact/terms/duplicate race. The order becomes `NEEDS_REVIEW`; the customer's funds stay in their existing balance. No automatic external refund is implemented, and the UI must not claim one occurred.

The additive table has foreign keys, unique session/transaction/journal/bid references, an active-intent uniqueness index, immutable financial intent/evidence protection and RLS. There is no delete/reset migration. The existing wallet reconciliation includes the new journal automatically.

## Recovery worker

Run a separate process with the matching reviewed web revision:

```powershell
node.exe --import tsx scripts/arifpay-worker.ts
```

It checks due pending orders every two seconds in bounded batches. Failed provider requests leave the order recoverable; a callback is not required for eventual reconciliation. At expiry, unresolved or contradictory proof becomes `NEEDS_REVIEW` with reason `PROVIDER_CONFIRMATION_REQUIRED`; it never becomes paid based on elapsed time. Autonomous provider checks continue at most 24 hours beyond expiry, then the case remains visible for operator review. Authenticated manual checks and secret callbacks can still obtain later authoritative proof, so late successful payments remain recoverable. Resolve cases with the provider using merchant nonce/reference and audit evidence before making a refund or credit decision. Run and monitor the worker before exposing live payment controls. Never log keys, URL tokens, raw provider payloads or payer phones. Add operational alerting for persistent `EVIDENCE_PENDING`, unusually old pending orders, recovery failures and `NEEDS_REVIEW` outcomes.

## Reviewable release / rollback

1. Take and verify a production backup and record existing customer counts plus ledger reconciliation. Rehearse the additive migration and restore on an isolated clone. Never run the opt-in tests against a production URL.
2. Deploy this branch to isolated staging with all payment switches false. Apply only the reviewed additive migration to staging, validate English/Amharic checkout and return paths, and obtain a confirmed current ArifPay sandbox contract. No real keys are used in automated tests.
3. Independently review the approved merchant, settlement receiver, merchant API scopes, supported Telebirr/M-PESA accounts, ETB-only behavior, callback reachability, encryption key backups and server egress. Capture real merchant response shapes; missing proof must remain pending. Confirm API-key rotation and old nonce recovery with the provider.
4. Run the disposable integration suite, full relevant auth/bid/payment tests, production build, security checks and wallet reconciliation. Test real-device USSD completion/cancellation, abandoned-browser recovery, callback loss, duplicate delivery and closing-time races before enabling.
5. Production activation is a separate operator-reviewed step. Apply the additive migration first while `ARIFPAY_ENABLED=false`; deploy matching web and recovery worker; set the reviewed configuration and schema/merchant gates only after evidence is approved. Start with server-enforced `ARIFPAY_CANARY_USER_IDS` and `ARIFPAY_CANARY_AUCTION_SLUGS` comma-separated allowlists plus a bounded support window. Empty allowlists permit all otherwise eligible accounts/auctions; removing a customer from a canary never blocks recovery of their existing order. Do not silently activate any legacy funding switch.
6. Set `ARIFPAY_ENABLED=false` to stop new sessions while keeping `ARIFPAY_RECOVERY_ENABLED=true`, the reviewed merchant/schema configuration and the matching recovery worker running for existing orders. The callback and verification endpoint also support this recovery-only mode. Preserve the checkout table, journals, users and all provider references; never reverse a ledger journal or delete the additive table as a code rollback. Resolve in-flight payments before retiring the integration or rolling back the backend past the checkout implementation.

## Validation and remaining limits

`tests/arifpay-provider.test.ts` covers fail-closed release flags, accepted USSD versus payment proof and current nonce evidence shape. `tests/arifpay-checkout.test.ts` requires `ARIFPAY_TEST_DATABASE_URL` pointing to a disposable loopback `*_test` database and uses an injected provider transport. It exercises verified-only acceptance, replay, concurrent creation, response timeout, exact-evidence mismatches, private ownership, unsuccessful payments, fee and real deadline races, immutable audit fields and complete wallet reconciliation.

There is no claimed live ArifPay network validation, merchant approval, automatic provider refund, reviewed sandbox end-to-end compatibility or real-device USSD timing. These are release prerequisites. Staff can inspect immutable receipt operations in existing wallet operations, but a purpose-built ArifPay case-management screen is not part of this change.
