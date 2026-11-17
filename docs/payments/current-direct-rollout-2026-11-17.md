# Direct checkout and broadcast delivery rollout

New auction payments and top-ups now use Chapa v2 Direct through the existing
payment form and shared financial engine. Amount or bid selection, method and
phone lead to one explicit Pay; USSD guidance or requested OTP and the committed
receipt remain in that sheet. No extra login, provider SDK or hosted redirect is
introduced. Wallet-funded bidding remains independent.

## Payment identity and recovery

New Direct records have `flowVersion=5`, `chargeType=DIRECT`, and an immutable
`initialization` with `apiVersion=v2`, `flowVersion=5`, `flow=DIRECT` and
`metadata.checkout_id` bound to their own ID. Their merchant reference, amount,
currency, method, private-key fingerprint, phone binding, webhook signature
profile and `lowwin-direct-v5:<checkout-id>` initialization key are frozen before
provider HTTP.

The customer API is `/api/payments/chapa/direct/current`, with its `/config`
read and authenticated `?key=` discovery. A reload saves only an account-scoped
opaque key/ID and its protocol. Earlier pointers without a protocol still use
the original Inline endpoint. Existing Inline version 4 and Direct version 2
records keep their original endpoints, references and credentials. Production
creation of new Inline records returns 410; original Inline recovery remains.

Initialization calls the private-key `/v2/payments/direct` endpoint with integer
cents, nested `customer.phone_number` and `metadata`. Validation uses the same
returned reference and method at `/v2/payments/direct/validate`. An OTP is sent
only after the provider requests one, and is never saved or automatically
resubmitted. Lowwin never collects a wallet PIN.

Successful validation immediately triggers private verification, including
after a recent pending private lookup. Only a privately verified matching
success followed by ledger/batch commit produces a customer receipt. A late
auction payment is preserved once in the wallet; it does not backdate bids or
create a second fee refund. The committed SSE observer, polling fallback,
concurrency leases and original-operation retry remain shared.

## Configuration

Keep the configured canonical `MINI_APP_URL` and `BETTER_AUTH_URL`, existing
contact encryption keys, database runtime role, bot identity and Redis namespace.
Use the same reviewed configuration on web and Chapa worker:

- `PAYMENT_GATEWAY=CHAPA`, the intended `CHAPA_MODE`, and the matching
  `CHAPA_PRIVATE_KEY` and `CHAPA_WEBHOOK_SECRET`.
- `CHAPA_SCHEMA_READY=true` only after the reviewed migrations are applied.
- Existing `CHAPA_ENABLED` and `CHAPA_RECOVERY_ENABLED` gates remain authoritative.
  New Direct creation does not require `CHAPA_PUBLIC_KEY` or `CHAPA_INLINE_ENABLED`.
- Preserve the original public key and its binding while unresolved Inline
  records exist. Do not rotate an unresolved operation's private/public keys.
- Preserve the configured webhook signature profile and each intent's pinned
  profile. `raw_body` remains the documented default. Historical explicit
  `legacy_secret` remains a hint requiring private verification, with no automatic
  downgrade from a raw-body-pinned intent.
- Live mode still requires the existing production/merchant review and
  `CHAPA_LIVE_ENABLED` gates. This rollout does not enable them automatically.

The shared method catalog is cached/coalesced by private credential, mode and
capability configuration. A method must explicitly support payments and Direct,
ETB and Ethiopia, with applicable integer-cent limits. Only Telebirr, CBE Birr
and M-Pesa are offered. Wallet bidding retains its separate wallet gates.

## Broadcasting and delivery history

Broadcast preview, enqueue, expansion and final send now recognize a published,
visible, started `SCHEDULED` auction as accepting bids, just like `LIVE`.
Database time supplies deadline checks; settled, expired, hidden, demo and test
auctions remain ineligible. The general composer also binds and validates a
linked auction rather than bypassing this check.

Broadcasting has Compose/Review, Active Queue and Delivery History areas. History
retains the original caption, image ID or path, button, destination and delivery
counts. Resend from the item or image opens one accessible Yes/No confirmation.
Yes queues a fresh child campaign with the original content, a new audience
cutoff and current auction/media validation. Duplicate confirmations share one
campaign identity; a later intentional resend has another identity. The original
campaign remains intact.

Delete stops remaining sends and queues durable, bounded batches over recorded
`TelegramMessage` IDs. It waits for acknowledgements of sends already in HTTP,
checks Telegram's 48-hour window again immediately before deletion, and reports
deleted, pending, failed and unavailable results. It never deletes shared media,
campaign audit history or payment records. Stop remains available for active
campaigns.

Contact sharing is not required for public broadcasts or service/beta messages.
Recipients must be linked non-staff users who started a private bot chat, have
not opted out and have not blocked the bot. The existing 250-recipient fan-out,
bounded worker lanes, bot-scoped media IDs and shared rate limiter remain.
Personal/refund notices have reserved priority capacity; bulk delivery honors
per-chat pacing and `429 retry_after`. Paid broadcasting is not enabled.

The image-permission checkbox is removed from broadcast composition. Validated
catalog media, server authorization and audit remain; winner-photo consent is
unchanged.

## Deployment and validation boundary

Apply the reviewed additive migrations with the migration credential:
`202611180001_unique_refunds_v5`,
`202611180002_broadcast_history_deletion_indexes`, and
`202611180003_current_direct_v2`. Do not reset the database or edit old migrations.

Deploy the same reviewed revision to `lowwin-web`, `lowwin-chapa`,
`lowwin-notifications`, `lowwin-auctions` and `lowwin-bot` for this combined
release. Deploy the workers before allowing the new web commands to enqueue
Direct5/refund/deletion jobs. The existing notification worker understands the
new `BROADCAST_DELETE` control job and refund priority; the bot reloads updated
auction help. No customer broadcast, real charge, production migration or
production deployment was performed by this implementation.

Focused checks include 107 unit tests across Direct transport, client recovery,
metadata/provider boundaries and broadcast actions; nine fresh-PostgreSQL Direct5
cases; and fourteen fresh-PostgreSQL delivery durability cases. These are separate
runs, not a claim that all repository CI is green. Both databases were isolated,
used simulated transports only, and were dropped afterward. Coverage includes
duplicate confirmations, contactless eligible recipients, late acknowledgements,
48-hour deletion limits, rate backoff, Direct capability rejection, OTP correction,
immediate private verification, exactly-once batch/top-up/bonus fulfillment and
late-payment preservation. Browser and broader integration results are recorded
with the release evidence separately.

The [focused evidence](evidence/current-direct-broadcast-validation-2026-11-17.json)
also records the isolated broadcast React checks at 360px and 1280px, including
original image rendering, duplicate Yes clicks, fresh intentional resend identity,
Delete confirmation and image upload without a permission checkbox. Six captures
are in `docs/screenshots/broadcast-history/`. These synthetic UI checks do not
substitute for the deployed authenticated admin route.

Actual Chapa acceptance, phone prompts, webhook delivery, production SSE/TLS and
external latency remain deployment/provider checks. Earlier TEST initialization
returned `payable not found`; changing to Direct is not evidence that Chapa has
resolved that merchant-side rejection or that provider processing is faster.

Contracts: [Direct/API review](direct-charge-contract-2026-11-17.md),
[Telegram rate guidance](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this),
[Telegram deletion limits](https://core.telegram.org/bots/api#deletemessage).
