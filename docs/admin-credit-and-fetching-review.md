# Admin credit and catalog fetching review — 11 October 2026

Implemented locally; no deployment, real customer credit, provider request or Telegram send was performed.

## Admin action

Owner: **Money → Deposits → Details → Add funds** on an eligible uncredited deposit.
The player is already selected. Enter amount and reason; transaction ID is optional.
No transfer-date field or receipt confirmation checkbox is required for this action.
Other receipt/review actions remain in a disclosure below it. Existing verified receipt approval remains available to Owners and Payments Operators.

Direct funds require Owner access, fresh MFA, enabled payment configuration and an eligible player. Limits are ETB 0.01–10,000. A running verification, protected case, already credited deposit or used reference blocks the action.

One database transaction records an immutable **ADMIN_CREDIT** receipt, exact balanced ledger postings, staff audit, source-review resolution, Mini App inbox alert and bot outbox job. This credit does not claim bank verification. The original deposit is closed and linked to the new credit. The original receipt cannot subsequently credit again.

Repeated requests retain their key. Source-deposit uniqueness also prevents a different key from issuing a second credit. Known customer transaction references cannot be discarded and are protected against reuse by manual and automatic funding. Without a reference, unrelated submissions of the same unknown bank transfer cannot be identified; the credit is explicitly an admin-issued adjustment.

Customer message: “Lowwin admin added ETB … to your wallet”, with Amharic copy and **View wallet** action. Existing bot delivery retry/block handling is preserved. The Mini App alert commits with the credit; Telegram delivery requires a running notification worker and an available bot chat. No real Telegram delivery was tested.

## Required rollout order

1. Review and apply `202610110001_admin_wallet_credit` through the normal Prisma migration path, before running the updated web/payment/notification workers. The migration is transactional and additive; it preserves existing receipt guards and adds separate admin-credit invariants, RLS and runtime grants.
2. Generate Prisma Client as part of the build, then deploy the matching web and workers through your normal process.
3. Existing funding flags and MFA remain required. This work does not turn on paused production funding.

No rollout step was executed on production. Production auth, provider setup and delivery remain unverified.

## Fetching changes

Auction tab counts now use count-only queries instead of retrieving unused rich cards and their relationships. Category lookup is skipped when there is no category filter. Independent public count/list reads run concurrently; financial and authenticated mutation transactions remain unchanged. Existing public/Redis caches, private no-store responses, session cache, authorization and bid validation are preserved.

Local Prisma query instrumentation, 14 disposable catalog fixtures, pool size 5, no Redis, five runs per view (the first omitted from warm medians):

| View | SQL statements before → after | Warm local loader median before → after |
|---|---|---|
| Grouped All | 18 → 8 | 30.5 ms → 32 ms |
| Filtered Live | 18 → 6 | 28.5 ms → 14 ms |

These are actual database-loader measurements, not browser navigation timings. Grouped timing was noisy and did not improve in this small local sample. The HTTP request topology is unchanged. The user's deployed warm `SELECT 1` readings averaged 627.25 ms; this work reduces round trips but does not establish or fix the cause of that remote latency. VPS region and Redis connectivity still need deployed verification.

## Verification

- All 31 migrations applied to fresh disposable loopback PostgreSQL 17 databases.
- Admin-credit integration tests: exact decimals, omitted references, concurrent replay, changed-key/payload protection, reference conflicts with automatic verification, roles, MFA, paused funding, lease/protected cases, transaction rollback on outbox failure, database immutability/receipt guards, reconciliation and customer history.
- Bot dispatcher exercised with a fake API: rate-limit failure then success, one ledger credit and one inbox alert, correct recipient and wallet link. No network send.
- Existing payment, M-Pesa, webhook, manual approval, notification, catalog and safe diagnostic tests passed. Count-only tabs match list totals across statuses, search and categories.
- `npm.cmd run typecheck` passed. Next.js 16.3.6 production Webpack build passed against local fixtures with isolated `.next-ui-local` output.
- Production React component fixture browser checks at 360px, 430px and 1280px: no document overflow or JavaScript errors, keyboard submission, double-click protection, preserved fields and identical retry key after a simulated 503. This is a component fixture preview, not a real authenticated production browser test.
- Existing full admin browser suite was adjusted for the new actions disclosure; the entire authenticated browser suite was not rerun.

Local review artifacts (ignored, available in this workspace): `.local/admin-funds-review/form-360.png`, `form-430.png`, `form-1280.png`, `checks.json`; `.local/catalog-before.json` and `.local/catalog-after.json`.

Design-tool notes: pre-existing brief/buildPath metadata warnings were left outside this change. Impeccable reported an available update; `npx impeccable update` was not run.
