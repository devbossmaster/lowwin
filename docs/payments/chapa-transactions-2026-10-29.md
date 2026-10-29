# Chapa checkout and Transactions

Pay freezes an owned command, sends the existing minimal v2 hosted request, and
opens the exact validated checkout URL automatically. Chapa collects the payer's
details. Wallet-funded bidding continues through the existing bid command.

The waiting sheet reads Lowwin's database only, every five seconds while visible
for at most five minutes, and refreshes immediately when it becomes visible. Closing it cancels UI requests and timers, without
changing the payment. There is no saved-session restoration or automatic provider
verification. An interrupted command can be explicitly replayed with its original
key while that sheet remains open. A deliberate Start new checkout detaches that
UI and uses a new command key, reference and current server quote. Earlier attempts
remain eligible for late confirmation. Duplicate bid-number protections preserve
additional verified funds in the wallet instead of accepting another entry.

Transactions at `/payments` lists both purposes with real pagination, test labels,
safe references, known methods and separate provider/fulfillment information.
Details update automatically from the original owned attempt and can link to a fresh checkout. There is no manual Verify status button.
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
The worker's `CHAPA_RECOVERY_ENABLED=true` enables durable event processing while
new checkouts are paused; it does not enable the legacy sweep. Its protected
configuration must match the web service, including mode, schema and credentials.
The normal `npm run worker:chapa` command prints a `chapa_worker_configuration`
JSON record before loading the database. If startup is blocked, read its
`missingPrerequisites` in Coolify Logs; terminal access and a changed start command
are unnecessary. It logs setting names and booleans, never credential values.

New initialization snapshots include Chapa's documented HTTPS `return_url` to
`/payments/chapa/return?checkout=<opaque ID>`. A version marker preserves the
minimal request body on retries of historical snapshots. Lowwin checks ownership
before reopening the original top-up or auction modal. A browser without the
Telegram session offers the existing Open Lowwin in Telegram handoff. Returning
never proves payment success. Existing hosted sessions cannot gain a return URL
retroactively. Merchant TEST checkout and physical Telegram return acceptance of
this optional field remain required before rollout.

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
