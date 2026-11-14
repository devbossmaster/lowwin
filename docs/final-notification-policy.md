# Final LowWin notification policy

Implemented 14 November 2026. This supersedes earlier notification inventories. There are **13 automatic types**, shared by the bot and the authenticated Mini App inbox. Manual administrator broadcasts remain Telegram-only. Interactive replies to `/start`, help and authentication actions are command responses, not additional scheduled notifications.

| Automatic type | Trigger / audience |
| --- | --- |
| Deposit credited | Owner only, after committed verified wallet credit; actual bonus shown separately when present |
| Auction ending: 3 days | More than 48 and at most 72 hours remaining |
| Auction ending: 2 days | More than 24 and at most 48 hours remaining |
| Auction ending: 24 hours | More than 12 and at most 24 hours remaining |
| Auction ending: 12 hours | More than 1 and at most 12 hours remaining |
| Auction ending: 1 hour | More than zero and at most 1 hour remaining |
| Auction ended | After the immutable result is validated and published; product photo and result button |
| New live auction added | Publication of an auction already accepting entries; fire emoji and recipient greeting |
| Upcoming auction added | Publication before its start time; actual start date/time |
| Upcoming: 1 day | More than 1 and at most 24 hours before start |
| Upcoming: 1 hour | More than zero and at most 1 hour before start |
| Bid purchase | Purchaser only, after complete bid acceptance; one receipt per batch |
| Winner congratulations | Published winning owner only; actual winning number and prize button |

All automatic headings, explanations and buttons are Amharic, including when the app language is English. Product names and recipient display names retain their original spelling. Dates display in `Africa/Addis_Ababa` (UTC+3). Scheduling uses server/database instants, not Ethiopian display-clock arithmetic.

Public auction notices target registered, non-staff users who initiated a reachable private bot chat before the event's audience cutoff. Existing explicit Telegram opt-outs are respected; missing preference records are not created or rewritten. Web-only users who never started the bot are not sent Telegram requests. Inbox content stays account-scoped and respects in-app preferences.

## Message format and privacy

- Ended: product photo, concise ended message, “ውጤቱን ይመልከቱ” button. No winner phone, name, private bid, ranking or uniqueness claims in this public notification.
- Purchase: product photo, chosen number(s), count for multiple bids, actual net submission fee and “ጨረታዎቼን ልይ”. A 100-number purchase produces one receipt, not 100 bot messages. Long selections point to My Bids for the complete list.
- Deposit: credited principal and any actual committed bonus/total breakdown; no unrelated default artwork. A late paid bid preserved in the wallet explicitly says the bid was not accepted.
- Congratulations: only the verified published winner receives the chosen winning number and private prize link. Other participants receive no automatic losing/“not unique” notices.
- Old unsupported jobs are skipped and hidden from the inbox. Financial records and durable delivery evidence are retained. Unknown future kinds fail closed.

## Delivery architecture

The existing transactional outbox remains authoritative. Payment/bid/result changes and their immutable notification intents commit together; Telegram HTTP is outside financial transactions. An authoritative gate rechecks ownership, committed proof, leases, maintenance, Stop, chat eligibility, opt-out and current auction/reminder state immediately before each actual HTTP attempt. Superseded reminders are skipped rather than delivered late as catch-up spam.

Bulk fan-out uses bounded 250-user cursor pages and stable recipient keys. Workers claim disjoint jobs with `SKIP LOCKED`; a reserved lane now serves deposits, purchases and winner messages. Shared database bot/chat budgets cover all replicas. Durable Telegram `file_id` reuse avoids uploading the same auction picture for every recipient. Deposit receipts skip media preparation entirely.

Existing safe defaults are retained: 4 delivery lanes including one reserved personal lane, 20 bot sends/second and 16 bulk sends/second, leaving headroom for personal and interactive bot traffic. No speculative thread increase or paid broadcasts. Telegram documents about 30 free bulk messages/second, roughly one message/second per private chat, and `retry_after` handling:

- [Telegram broadcast limits](https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-39s-subscribers-at-once)
- [SendPhoto and file identifiers](https://core.telegram.org/bots/api#sendphoto)
- [ResponseParameters / retry_after](https://core.telegram.org/bots/api#responseparameters)

No exactly-once transport guarantee is claimed: Telegram has no application idempotency key for sends. Accepted sends with failed acknowledgement retain their durable lease/uncertainty handling rather than being immediately resent.

## Measured verification

60-second isolated run: 1,400 initiated private recipients, real PostgreSQL rate reservations/dispatch/gates/acknowledgements, default 4 lanes and a **simulated 100ms Telegram HTTP response**. No live Telegram request was made.

- 824 committed sends in 60.003 seconds: **13.73/second**. After a 197ms drain: 825 delivered, 575 pending.
- No failures, retries, uncertain acknowledgements or lane errors.
- One media preparation and one cached Telegram file identifier reused for the campaign.
- Claim p50/p95: 11.0/21.7ms; preparation: 1.5/3.3ms; rate waiting: 64.9/240.7ms; final gate: 6.0/11.7ms; simulated HTTP: 105.8/115.1ms; acknowledgement: 7.5/13.9ms.
- 825 final gates for 825 actual sends. 16,001 SQL statements; 6,445ms reported SQL execution. Four sampled DB connections and no sampled database wait; pool acquisition time is included in stage wall times and was not measured independently.
- A 100-bid receipt now needs one notification intent instead of 100. Deposit delivery eliminates its former unrelated-media cache/upload path.

This is local capacity evidence, not a production SLA or a before/after live throughput comparison. Production measurement should use the existing 60-second `notification_worker_window` logs (completed sends/second, queue age, stage percentiles and database activity), and confirm the deployed worker revision/settings/replica count.

Validation passed:

- 162 focused tests across 14 files: type allowlist, reminder windows, Amharic copy, receipt ownership, private delivery, worker lanes, media, notification display and authenticated alert API. Seven database-only rate cases skipped in this run were exercised with the isolated delivery suite.
- 48 direct-payment/batch integration tests, including 100 accepted numbers producing one receipt, final-gate recipient/opt-out checks, insufficient funds, coupons, rollback, uncertain requests and late verification.
- 68 Chapa checkout integration tests, including concurrent/duplicate verified credit producing one deposit notification, exact net-fee bid receipts and late-payment funds preservation.
- 5 published-ended campaign integration tests with 252 recipients, cursor paging, absent preferences, opt-outs, blocked/nonstarted/staff exclusions, concurrent delivery, legacy evidence and `retry_after`.
- 22 publication unit/integration tests, including atomic rollback when the private congratulations intent cannot commit, replay, historical silence and ended-only cancellation.
- 24 shared-rate/durable-delivery tests, including Stop, lease recovery, acknowledgement uncertainty and persistent photo reuse.
- TypeScript `--noEmit`, production `next build --webpack` and `git diff --check` passed. Production build compiled in 74s, completed its TypeScript phase in 74s and generated 38 static pages in 3.1s.

The isolated database uses an East African session timezone. The campaign audience query explicitly converts bound cutoff instants to UTC before comparing timestamp columns, preventing a UTC+3 cast from accidentally including later-started chats. No production schema, data or infrastructure was changed.

## Release scope

No new schema migration or dependency is required. When the owner chooses to release, update **WEB, notification worker, auction worker and Chapa worker** to the same revision so event production and delivery share this policy. Preserve existing outbox/campaign work; do not restart an active campaign with Repeat, reset sent recipients, or clear leases/history. No merge, deployment, real payment or live test broadcast was performed for this update.
