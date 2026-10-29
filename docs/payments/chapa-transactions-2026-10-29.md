# Chapa checkout and Transactions

Pay freezes an owned command, sends the existing minimal v2 hosted request, and
opens the exact validated checkout URL automatically. Chapa collects the payer's
details. Wallet-funded bidding continues through the existing bid command.

The waiting sheet reads Lowwin's database only, every five seconds while visible
for at most two minutes. Closing it cancels UI requests and timers, without
changing the payment. There is no saved-session restoration or automatic provider
verification. An interrupted command can be explicitly replayed with its original
key while that sheet remains open. A deliberate Start new checkout detaches that
UI and uses a new command key, reference and current server quote. Earlier attempts
remain eligible for late confirmation. Duplicate bid-number protections preserve
additional verified funds in the wallet instead of accepting another entry.

Transactions at `/payments` lists both purposes with real pagination, test labels,
safe references, known methods and separate provider/fulfillment information.
Details can manually verify the original owned attempt or link to a fresh checkout.
My Bids displays unfinished payment attempts separately from accepted totals.
Accepted Chapa bids link their transaction; failed payment does not close a draw.

## Durable event processing

The webhook defaults to authenticating exact raw bytes with HMAC-SHA256 before parsing.
An explicitly configured [Basic Auth dashboard alternative](chapa-basic-webhook.md)
requires separate protected credentials with no signature fallback. A
matching delivery is durably deduplicated and queued before provider HTTP. It then
tries the shared merchant verifier immediately. `npm run worker:chapa` processes
only received event jobs, with five bounded attempts and leases. It never scans or
reinitializes new pending checkouts. A verification outage retains the job and
last provider outcome; customers see Needs verification and can request a manual
check. Only matching merchant verification with payment state SUCCESS can invoke
the existing locked, balanced and idempotent receipt/bid transaction.

INCOMPLETE, BLOCKED, CANCELLED, AUTH_NEEDED and FAILED remain distinct provider
outcomes. Bounded provider errors preserve HTTP category and `error.code` while
discarding raw messages and customer/risk details. A definite initialization
rejection is stored separately from an ambiguous transport interruption.

## Schema and configuration

Review additive migration `202610290002_chapa_event_transactions` before deployment.
It adds provider/verification/initiation fields and bounded event-job bookkeeping,
keeps historical attempts at flow version 1, and defaults new attempts to version 2.
It removes the pending bid-attempt uniqueness index; the existing accepted-bid and
ledger protections remain in force. No users, payment records or journals are erased.
The runtime role receives UPDATE on event bookkeeping, with immutable delivery
identity enforced by a trigger. `deploy/runtime-role.sql` retains those privileges.

Keep `CHAPA_LEGACY_SWEEP_ENABLED=false` (the default). A separately reviewed,
temporary compatibility sweep can cover only flow-version-1 records from the
previous 30 days; it performs no initialization. Historical attempts remain
manually verifiable and can receive new signed notifications without that flag.
Web, bot and Chapa worker must run matching code/schema and protected configuration.
This change introduces no key, provider-activation or optional callback/return field.

This coding task runs only isolated local databases and mocked provider/browser
responses. It does not deploy, run production migrations or initiate merchant
payments. Real webhook signature delivery, merchant checkout and physical Telegram
handoff still require merchant/device acceptance. A real domain does not repair a
signature mismatch; the configured secret must match Chapa's raw-body signature.

Official contracts: [hosted checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment),
[payment events](https://docs.chapa.global/docs/v2/webhooks/payment),
[webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks),
[verification](https://docs.chapa.global/docs/v2/integrations/verify-payment),
[errors](https://docs.chapa.global/docs/v2/error-codes).

## Local validation

166 distinct focused tests passed across Chapa checkout, API authorization,
provider parsing, metadata, recovery bindings, return links, client helpers,
personal account reads, navigation and migration guards. The final 32-test
financial suite passed again after the receipt-label and historical-alias checks.
The disposable PostgreSQL harness applied all 42 migrations without skips.
Four mocked browser scenarios passed at 360px/English and 430px/Amharic, covering
single-click handoff, request deduplication, fresh retries, database-only waiting,
late old-attempt isolation, manual verification, owned history and pagination.
Typecheck and the isolated Next.js production build passed. The UI detector
reported zero findings; waiting/history captures were inspected at both widths.
These are local mocked-provider results, not merchant or physical-device proof.
