# Notification delivery and broadcast validation

## Implementation

`202611100002_notification_leases` is additive: Outbox lease ownership/expiry,
logical result-delivery leases, durable bot/content-version Telegram photo IDs,
and shared bot/chat rate budgets. The reservation function is SECURITY INVOKER;
browser roles receive no access. Runtime-only table/EXECUTE grants and RLS are
included. All 49 migrations applied successfully to fresh loopback test databases.

Delivery claims and acknowledgements use short transactions. Media preparation,
rate waiting and Telegram HTTP happen after those transactions end. Current lease
tokens guard completion/retry; an expired owner cannot complete a replacement
claim. A claim near expiry is renewed before HTTP, including its logical-result
lease. Telegram message IDs remain durable. Campaign expansion runs independently
in resumable pages of at most250 reachable recipients, with stable cursors and
unique delivery keys. Published-result subscription/contact restrictions remain.

The default worker has four independent send lanes, including one registration/
confirmed-payment lane, plus separate expansion, scheduling and legacy verification
loops. Its dedicated database pools allow at most seven connections. Shared rate
limits coordinate every instrumented bot sender:20/s total,16/s bulk,1/s private
chat and one group operation per3s, without paid broadcasts. Provider429 cooldowns
are shared; `retry_after` is retained. Waiting bulk receives bounded opportunities
alongside personal traffic.

Immediately before HTTP, the dispatcher checks ownership, Stop/maintenance,
recipient block/role changes, result subscription and relevant auction state.
Stop prevents new fanout and unstarted sends; already in-flight HTTP can complete
and still persist its real message ID. This window is bounded by configured
concurrency and the15-second transport timeout, per worker instance. Retiring
promotions also preserves active ownership rather than discarding acknowledgements.

Photo preparation is single-flight in-process. Upload ownership and Telegram file
IDs persist across workers/restarts and are scoped to bot identity and immutable
media version. An invalid cached file ID is refreshed once;429/403/network errors
do not trigger an immediate second upload. Post-send cache write failures cannot
turn an accepted photo into a failed send. An acknowledgement failure retains its
claim rather than immediately resending.

Broadcast history reports actual materialized eligible recipients, queued,
retrying, in-flight, sent, skipped and failed deliveries. It does not fabricate a
complete audience count while expansion remains pending. Retry/in-flight counts
are disjoint.

## Verified locally

No real Telegram requests, production database writes or deployments were made.

- Typecheck passed.
- Ten focused notification files:145 tests passed, no skips.
- Published result campaign:5 isolated database tests passed, including252
  eligible nonparticipant subscribers, exclusions,250+2 cursor expansion,
  concurrent dispatch, historical alias deduplication,429 and blocked chats.
- New durability tests cover disjoint claims, expired leases, stale completion,
  logical aliases, Stop during HTTP, maintenance, crash acknowledgement,
  near-expiry renewal, stable fanout, media single-flight and cache-write failures.
- A deliberately blocked simulated HTTP call held zero database transactions;
  Stop completed before releasing that HTTP call and its message ID persisted.

Focused command (supply a migrated, disposable loopback `_test` database):

```powershell
$env:TEST_DATABASE_URL='postgresql://test_user@127.0.0.1:PORT/notification_test'
node node_modules/vitest/vitest.mjs run tests/notification-durability.test.ts tests/auction-telegram-delivery.test.ts tests/chapa-receipt.test.ts tests/upcoming-notifications.test.ts tests/participant-results.test.ts tests/broadcast-photo.test.ts tests/broadcast-progress.test.ts tests/notification-photo.test.ts tests/notification-copy.test.ts tests/winner-result-notification.test.ts
```

The result-campaign suite uses its own fresh database through
`RESULT_NOTIFICATION_TEST_DATABASE_URL` and runs
`tests/result-campaign-delivery.test.ts`.

## Controlled load comparison

`scripts/measure-notification-delivery.mjs` intercepts all Telegram transport and
requires a **fresh, migrated loopback database ending in `_test`**. It compares the
checked-in dispatcher at exact commit
`471e76929bd6a555a25152fb4ee517998423e86d` with the new core. Baseline uses the
original single delivery connection and50ms active-loop pause; new delivery uses
four independent lanes and the actual200ms idle interval/shared rate budget.
Each run has30 broadcast recipients and one registration queued after the eighth
send begins. Simulated Telegram latency is75ms.

| Measurement | Checked-in serial | Leased concurrent |
|---|---:|---:|
| Enqueue response |93.6ms|78.1ms|
| Enqueue to first send |234.4ms|268.7ms|
| Complete31 messages |5179.1ms|2803.0ms|
| Throughput |5.99/s|11.06/s|
| Urgent queue to send |3648.6ms|60.6ms|
| Longest sampled idle transaction |109.4ms|27.7ms|
| Peak rolling send starts |7/s|14/s|
| Client SQL statements |356|1330|

These are local simulation measurements, not Telegram delivery/read guarantees
or production forecasts. The initial send is slightly slower. Short ownership/
eligibility checks and shared coordination add SQL work; remote database latency
remains a throughput concern. No index change is claimed: the existing partial
`Outbox_pending_due_idx` is reused. Database sampling included the fixture pool;
its observed2/5 connections are not the configured seven-pool production limit.

```powershell
$env:NOTIFICATION_BENCHMARK_DATABASE_URL='postgresql://test_user@127.0.0.1:PORT/fresh_notification_test'
node --import tsx scripts/measure-notification-delivery.mjs
```

## Release and remaining limits

Apply the additive migration before starting updated senders. Stop/drain old
notification workers before starting new ones: old versions do not honor the new
lease fields or shared rate budgets. Update WEB, bot/payment senders and the
notification worker together so all sender paths share coordination. Existing
bot/database configuration remains required; new tuning variables have validated
defaults in `.env.example`.

Telegram provides no idempotency key for ordinary sends. A process crash after
Telegram accepts a message but before a local acknowledgement commits can still
produce a duplicate after lease recovery; this is an external at-least-once
delivery limitation, not duplicate financial fulfillment. Persistent logical
leases prevent concurrent result aliases and completed replays, and ledger
idempotency is unchanged. Live host/network latency, recipient phone arrival,
Telegram service throttling and multi-host failure behavior require deployment
observation; they were not exercised by these isolated tests.
