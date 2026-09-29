# Cent-money v3 and notification release packet

Review branch: `release/frozen-auction-v2-20260929` (PR #2). This packet supersedes the new-publication instructions in the earlier v2 report. No production migration, credit activation, auction publication or Telegram broadcast was performed while preparing this change.

## Behavior and changed areas

- New publications freeze `lowest-unique-v3`: minimum **ETB 1.00**, step **ETB 0.01**, at most two decimal places, and 100 distinct accepted amounts per participant. A participant cannot create four adjacent cent amounts in one auction. `1.01, 1.02, 1.03` prevents `1.04`; `1.05` is allowed. Filling gaps later or concurrent requests cannot bypass this rule. Rejections charge no fee and consume no acceptance sequence.
- The v2 two-person minimum, lowest-unique priority, and first-database-accepted lowest fallback continue in v3. Existing published v1/v2 auctions retain their original behavior, including v1 no-unique outcomes. UI/FAQ/bot help disclose the versioned rules in English and Amharic.
- `prisma/schema.prisma` and additive migration `202609300001_cent_money_v3` widen monetary columns to exact PostgreSQL numeric, with checks rejecting more than two decimals. **Amounts remain ETB**, not reinterpreted cents. Historical balances, postings, receipts and proofs are not rescaled or rewritten. Existing migrations remain intact.
- Wallet, hold, bid, settlement, payment and correction modules use exact Decimal arithmetic; browser calculations use integer cents. Quotes, receipts, wallet activity and reconciliation preserve fractions. SQL guards also enforce precision, v3 patterns, acceptance ordering and outcome/proof consistency.
- Notification campaigns use immutable outbox intents and batches of 250 recipients. Automatic Telegram categories are publication, less than 24 hours remaining, final result/cancellation, and credited deposit (only its owner). Owner-only audited broadcasts support a validated image, `{name}`, preview, and a **Bid** inline button. Private bot initiation and blocked-chat handling remain enforced; preference switches are removed. Financial commands are never retried by delivery workers.

## Rollout order

1. Review this branch and passing checks. Record deployed SHA, current migration status, reconciliation, balances and immutable record counts. Verify a restorable database backup and required encryption keys in a separate protected location.
2. Schedule a maintenance window. **Stop every writer**: web traffic to mutations, bot worker, auction worker, notification worker, administrative scripts and old replicas. Do not interrupt an in-flight settlement; allow transactions to finish. Do not run old and new clients together.
3. Build the reviewed artifact with Node 24, `npm ci`, `npm run db:generate`, `npm run typecheck`, and `npm run build`. Use isolated build configuration, never a development/demo identity against production.
4. Use the migration role's protected `DIRECT_URL` to run `npm run db:migrate`. The new migration obtains exclusive locks and aborts rather than waiting indefinitely. Do not bypass a failed guard or mark a failed migration applied without investigation. No seed/reset command belongs in this rollout.
5. Deploy matching decimal-aware web, bot, auction and notification artifacts. Keep the restricted runtime database role for services, not the migration owner. Flush only namespaced **public catalog/result cache** entries or let their bounded TTL expire before reviewing new-publication terms. Do not cache balances, identity or private bid data.
6. Check liveness/readiness, migration status, zero reconciliation drift, old auction views and v3 draft preflight. Reopen traffic and the auction worker only after the compatible application is healthy. Review pending notification jobs before starting the notification worker; no test broadcast to real users.
7. Owner separately reviews EN/AM wording and Telegram Android/iOS launch/contact/bid/wallet flows. Real funding still requires the existing reviewed receiver/provider/activation configuration and an explicitly approved small transfer, followed by reconciliation. This patch changes neither production flags nor credentials.

## Rollback limits

Before any fractional write, a reviewed database restore plus matching old artifacts is possible only with traffic stopped and all post-backup activity accounted for. After fractional writes, **do not cast numeric back to bigint, deploy integer-only code, or restore over new financial activity**. Pause writes and repair forward with decimal-compatible code. Preserve every accepted bid, journal, hold, claim and proof. A delivery crash may duplicate a Telegram message after send-before-commit; the outbox cannot promise exactly-once external Telegram delivery, but it never repeats the financial operation.

## Verification evidence

- Full opt-in database suite: **329/329 tests passed in 35 files**. This includes v1/v2 preservation, nine v3 settlement/concurrency cases, exact cent funding for Telebirr/CBE, immutable upgrade rehearsal, notification batching and Owner broadcast guards.
- Production build: passed with Next.js 16.3.6; strict TypeScript check: passed.
- Essential mobile browser suite: all **8 scenarios passed** in installed Chrome at 360×800 and 430×932, including signed contact, decimal bid confirmation/receipt, the three-adjacent-cent rule, fractional wallet rendering, EN/AM v3 disclosure, v2 fallback wording, navigation and blurred loading. The wrapper required manual termination after its Next development server remained open; all eight Playwright cases had completed successfully before termination.
- Dependency audit: the previous branch audit reported zero vulnerabilities. A fresh audit attempt for this exact tree could not reach the registry audit endpoint and was not marked as a current pass. No dependency or lockfile changed in this patch.
- `git diff --check`: passed. Telegram/provider calls were intercepted; no message, credit, publication, migration or production traffic change was made.

All database fixtures were disposable loopback databases. Browser viewport checks are not real Telegram device tests. Owner native Amharic and real Telegram Android/iOS checks remain external review.

## Release decision

**NO-GO for unattended production activation** until the reviewed migration/deployment window, backup restore verification, actual runtime configuration and Owner device/Amharic review are recorded. The implementation can be reviewed independently of these external checks. Never substitute an earlier commit's successful checks for this release's evidence.
