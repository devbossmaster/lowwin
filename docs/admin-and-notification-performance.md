# Admin and Telegram delivery update

This update keeps the existing Next.js, TanStack Query, authenticated admin boundary and durable notification outbox. It does not activate payments or send a production campaign.

## Admin

Overview uses four linked cards and two independent reads: summary counts and a bounded five-auction list. Neither section waits for the other. Existing table pages stay visible during refresh; initial loading is separate from background fetching. Query keys include staff identity and normalized filters. Intent prefetch is restricted to permitted routes and a small time-limited budget. Product and auction editors load secondary resources when needed.

Mutations invalidate affected read models instead of the whole workspace. Confirmed suspension/delivery responses can update their matching cached rows immediately. Identity changes, logout and authorization failures clear private data; stale responses cannot update a different account.

Payments exposes All, Done and Failed. Unresolved records show “Checking payment…” with their original Details action. Done follows committed funds, including verified funds preserved in a wallet when an entry cannot be accepted. Failed requires a verified terminal provider response. Internal diagnostic states and reconciliation remain intact. Multi-entry external payments are not repeated as wallet charges in the same admin list.

## Delivery

Scheduling, audience expansion, verification and Telegram sends run in independent bounded lanes. Short claims commit before content preparation, rate waits and HTTP. Outbox lease tokens prevent stale workers from finalizing a newer claim. Expired claims can be resumed. Campaign audience cursors and unique recipient keys remain durable.

All production Telegram API instances share a per-bot database budget, recipient pacing and 429 cooldown. A reserved personal-message lane and bulk fairness prevent a campaign from monopolizing the worker. Ordinary configured defaults are conservative; paid broadcasts remain disabled. Telegram documents ordinary bulk and per-chat limits in its [Bot FAQ](https://core.telegram.org/bots/faq#how-can-i-message-all-of-my-bot-s-subscribers-at-once), and provides `retry_after` through [ResponseParameters](https://core.telegram.org/bots/api#responseparameters).

Bot/media-version file IDs persist across workers, with an upload lease to avoid concurrent duplicate preparation. Each delivery keeps its own caption, language and button. Successful acknowledgements retain Telegram message IDs.

Stop and maintenance prevent additional sends after the final pre-send check. An HTTP request already accepted or in flight cannot be recalled. A crash after Telegram accepts a message but before the database records its message ID can produce an uncertain delivery and a later duplicate; this is not an exactly-once transport guarantee.

## Rollout preparation

Apply the additive `202611100002_notification_leases` migration with the existing owner migration connection, then generate Prisma Client as part of the normal application build. The runtime role needs the migration's coordination-table/function grants. Do not edit old payment intents or balances.

Deploy the reviewed WEB, bot, Chapa receipt and notification worker code together so every sender uses the same budget. Stop old sender workers before starting the new generation; old code cannot participate in the new shared budget. The notification worker command remains `npm run worker:notifications`.

Optional runtime tuning is documented in `.env.example`: send concurrency, expansion batches, aggregate/bulk send rates, per-chat intervals and maximum rate wait. Defaults work without adding new secrets. Keep the existing database, bot token, Mini App and payment configuration protected. No paid-broadcast flag is required or enabled.

For a code rollback, stop the new sender workers, revert application code and restart the reviewed previous worker generation. Retain this additive migration and durable outbox/message records; dropping coordination tables during a rollback would discard recovery evidence. Reconcile uncertain in-flight sends before restarting campaigns.

## Validation

Measurements use disposable loopback PostgreSQL data, local optimized production builds and simulated Telegram. They are not production throughput or Telegram acceptance claims. Generated reports and screenshots stay under ignored `test-results/` and `.local/`.

| Data-only Overview, same local dataset | Previous combined read | New independent reads, combined |
|---|---:|---:|
| SQL queries | 7 | 2 |
| Serialized response bytes | 3,016 | 1,429 |
| Mean of five warm reads | 25.15 ms | 6.05 ms |

The profile uses `scripts/measure-admin-speed.ts` and records `EXPLAIN (ANALYZE, BUFFERS)` in `test-results/admin-speed/sql.json`. No new index was justified or added. Each new endpoint still authorizes its own request. The UI makes two independently rendered reads instead of the previous single combined request.

Browser measurements use real local staff sign-in and mocked read APIs. The baseline browser sign-in-to-visible-Overview observation was 2,018 ms; later observations were 573–1,056 ms. Server/browser warmup differs across these single-session samples, so this is not a controlled production speed claim. The final cold Players observation was 191 ms versus 181 ms before: no cold-table improvement is claimed. Cached return was 78 ms versus 91 ms, with **zero extra API reads in both versions**. A real isolated suspension took 345 ms, submitted once and refreshed only the player list/detail while keeping the populated table visible.

The controlled Telegram comparison and reproducible guarded benchmark are in [notification-delivery-validation.md](notification-delivery-validation.md). For 30 bulk messages plus one registration with 75 ms simulated HTTP, completion was 5.18 s → 2.80 s and urgent queue-to-send was 3.65 s → 61 ms. Enqueue was 94 ms → 78 ms. First send was slightly slower (234 ms → 269 ms), and SQL statements rose from 356 to 1,330. Shared coordination and final ownership/eligibility checks remain a remote-database latency concern. Actual Telegram delivery and multi-host production failure behavior remain unmeasured.

Completed checks:

- 127 focused admin/payment presentation and recovery-policy tests.
- 145 notification tests, 24 rate/worker/command tests and five published-result database cases (some existing suites overlap; these counts are not a unique combined total).
- Five selected isolated Chapa cases for verified failures followed by late success and late bid-payment preservation. The remaining 63 cases in that file were excluded by the test-name filter.
- Five Chrome browser scenarios covering progressive Overview, cached navigation, a real isolated mutation, ordinary admin payment labels and English/Amharic customer payment labels. Overview was visually checked at 360/430/1440 px; payment views at 320/430 px. Geometry assertions require visible, positively sized cards, not merely attached streamed HTML.
- `npm run typecheck`, the optimized production build and `git diff --check` passed.

Run the focused frontend checks with a disposable loopback `TEST_DATABASE_URL` and `playwright.admin-speed.config.ts`. All provider and Telegram acceptance scenarios used mocked/intercepted transport. No production migrations, real payments, live broadcasts, merge or deployment were performed.
