# Chapa checkout and Transactions

Pay freezes an owned command, sends the existing minimal v2 hosted request, and
opens the exact validated checkout URL automatically. Chapa collects the payer's
details. Wallet-funded bidding continues through the existing bid command.

The waiting sheet automatically checks the owned server endpoint while visible,
respecting the server's verification cooldown and lease. Each foreground session
is bounded to five minutes; focus, visibility and network restoration wake checks.
Closing it cancels UI requests and timers without changing the payment. An explicit
owned checkout link restores its modal; old session-storage attempts are not reused.
An interrupted command can be explicitly replayed with its original
key while that sheet remains open. A deliberate Start new checkout detaches that
UI and uses a new command key, reference and current server quote. Earlier attempts
remain eligible for late confirmation. Duplicate bid-number protections preserve
additional verified funds in the wallet instead of accepting another entry.

Transactions at `/payments` lists both purposes with real pagination, test labels,
safe references, known methods and separate provider/fulfillment information.
Details update automatically from the original owned attempt and can link to a fresh checkout. There is no manual Verify status button.
My Bids displays unfinished payment attempts separately from accepted totals.
Accepted Chapa bids link their transaction; failed payment does not close a draw.

## Checkout return and confirmation states

New payment snapshots include the documented HTTPS `return_url` at
`/payments/chapa/return?checkout=<opaque UUID>`. Historical initialization bodies
remain immutable. Returning inside Telegram restores the original owned bid or
top-up modal. Outside Telegram, the return page opens
`https://t.me/<bot>?startapp=chapa_<UUID>` and retains a bot-chat fallback.
Configure the production bot's **Main Mini App** in BotFather with the Lowwin URL
to support that direct app link. Telegram/browser confirmation dialogs may still
require a tap; real-device automatic return must be checked separately.

The signed launch parameter is a locator. After authentication, Lowwin reads the
owned checkout before choosing `/profile?...#wallet` or the original auction.
The return page does not itself launch a duplicate verification request. The
destination modal checks automatically and invalidates affected private queries
only after authoritative credit, bid acceptance or preserved funds.

Delayed verification, review and provider failures have distinct messages rather
than a perpetual loading spinner. A pending payment never blocks a deliberate new
checkout and is never marked failed merely because the user closes Chapa.
Reopening checkout uses the existing owned URL; retrying interrupted initialization
uses the original command and idempotency key. Safe numeric payer phone fields are
normalized in verification responses without changing financial evidence checks.

An HTTP 200 webhook acknowledges delivery; it does not prove that Lowwin applied
the payment. To inspect a stuck payment in the WEB terminal without applying funds:

```sh
npx --no-install tsx scripts/check-chapa-checkout.ts --merchant <merchant-reference> --provider
```

This reads the checkout and recent event states, optionally GETs Chapa verification,
and reports matching results without printing keys or payer contact data. It never
creates a payment, processes an event or credits a wallet. A configuration mismatch,
unavailable provider lookup or evidence mismatch must be resolved on the server;
changing the modal cannot establish payment success.

### Local validation, 30 October 2026

- 214 focused unit/API tests and 34 isolated PostgreSQL financial tests passed.
  Coverage includes concurrent/duplicate verification, late bids, exact money and
  reference matching, identity isolation, numeric payer contact and original-key retries.
- All 16 browser scenarios passed across desktop, 360px English and 430px Amharic
  runs, including direct top-up/bid return, automatic confirmation, review states,
  interrupted initialization, repeated clicks and older transaction access.
- TypeScript and the production webpack build passed. Provider and payment status
  responses in browser checks were mocked; the database was disposable loopback.
- No production migration, live payment, production credit or deployment was run.
  Deploy the web and Chapa worker together, then check a new merchant checkout on
  a real Telegram device. Physical Chapa receipt-to-return navigation remains an
  external acceptance check; a browser may require confirmation to open Telegram.

## Durable event processing

The [signature webhook](chapa-signature-webhook.md) defaults to exact raw-body
HMAC-SHA256 before parsing. Explicit `legacy_secret` compatibility accepts the
observed reusable secret-on-secret proof only as an untrusted existing-payment
lookup hint; it does not provide body integrity. The legacy path requires a
matching stored attempt/environment/currency and atomically reuses one canonical
job per attempt/profile. Queued hints coalesce; later hints rearm completed jobs
with a deferred lookup and a 60-second cooldown, including one deferred follow-up
when a hint arrives during an active lookup. Neither profile uses Basic Auth or
changes payment API versions. Matched new deliveries are durably deduplicated and queued before provider HTTP. It then
tries the shared merchant verifier immediately. `npm run worker:chapa` processes
only received event jobs, with five bounded attempts and leases. It never scans or
reinitializes new pending checkouts. A verification outage retains the job and
last provider outcome. Verified nonterminal `PENDING` / `AUTH_NEEDED` responses
remain queued within the same five-attempt bound instead of completing an event
early; customers see Needs verification and can request a manual
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
configuration must match the web service, including mode, schema, credentials
and `CHAPA_WEBHOOK_SIGNATURE_PROFILE` (`raw_body` by default).
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
