# Phase 5B — operations, alerts and wallet preview

Scope follows `Lowin_Phase_5B_Codex_Prompt (1).md` and Phase 5B in `Lowin_Codex_Phased_Build_Prompts (10).md`. The later direction makes the existing Mini App Home the landing page: pure white, flat surfaces, with restrained green gradients. There is no separate consumer website or phone-login phase.

## Database and invariants

New migration: `202609270008_operations_notifications` (tenth migration). It adds scoped staff roles, invite roles, last-active-Owner protection, restrictions, support cases, encrypted delivery contact records, preferences/inbox, confirmed private bot chats and outbox retry metadata. The preceding nine migrations remain unchanged. All outbox intent content is immutable; only delivery metadata changes. No bid, journal, hold, terms or settlement/proof guard was weakened.

Only loopback databases on `127.0.0.1:55439`, with names ending `_test`, were migrated. The `.env` target is remote Supabase (`aws-1-eu-west-1.pooler.supabase.com:5432/postgres`) and remains untouched. Its missing `Auction` schema is not repaired automatically; current Home retains the truthful catalog-preparation fallback.

Bid acceptance checks staff/restriction status after acquiring the existing auction-then-wallet locks. Suspension and staff grants acquire the affected wallet key before changing bidding eligibility. All staff identities, even deactivated ones, are excluded from bidding. Suspension never deletes an accepted bid or changes deterministic settlement. Staff mutation permissions are rechecked from the exact credential/MFA session inside the transaction. Publication/cancellation remain Owner-only. Support proposes restrictions; the Owner applies them.

## Implemented surfaces

- Admin: users, support, results, assigned fulfillment, read-only wallets/operations/journals, notifications/jobs, date-filtered analytics, redacted audit, team and settings. Product/auction queues return counts and server pagination; draft inventory has a search action. No 200-record queue truncation.
- Private Mini App: `/profile/alerts`, unread bell, preferences, read/mark-all, `/profile/support`, and delivery claims/disputes in My Wins. Public catalog/result projections are unchanged.
- Wallet: real AVAILABLE/HELD points, selectable Telebirr/CBE preview details and copy, disabled receipt text/upload/submission, support and real journal activity. `WALLET_TEST_PREVIEW=true` only works in an isolated local/test `_test` database; references are explicitly non-payable strings. Otherwise account details say unconfigured. No ETB quote, OCR, Check.et calls, payment intake or credit path exists.

## Authentication review

Reviewed the pinned custom Better Auth staff endpoints, route allowlist, credential/MFA session binding, invitation, bootstrap, reset/recovery and server-derived cancellation actor. Reset now rechecks activation after the staff lock; login refreshes the database clock after lock/password verification. Generic public sign-up and broad password/impersonation/admin plugin endpoints remain absent. An expired, unclaimed initial Owner invitation can be rotated exactly once by the audited CLI; old tokens become unusable and acceptance still requires MFA enrollment. Independent security review is still a release gate, not claimed by these implementation tests.

## Notifications

`npm run worker:notifications` schedules saved-auction starts and ending reminders, processes the existing immutable outbox using `FOR UPDATE SKIP LOCKED`, and purges due delivered-contact ciphertext. `npm run worker` continues processing authenticated webhook commands and records a confirmed private chat only from a genuine `/start` update with matching sender/private chat IDs.

Bid, settlement/cancellation and fulfillment source transactions create their outbox intents and permitted private inbox entries atomically. Scheduled events deduplicate by user/auction/kind, skip illustrative DEMO records, and recheck current status, favorite and preferences at dispatch. Telegram delivery needs explicit preference opt-in plus a confirmed, unblocked private chat. Fixed templates omit live amounts, balances, proof, contact and identity details. All test sends use intercepted grammY transport.

429 responses honor bounded `retry_after`; transient failures back off and terminate after eight attempts. Blocked/private-chat failures become visible terminal jobs. Owner-only, reasoned retries are audited; a blocked user must restart the bot before retry. A crash after Telegram accepts a message but before PostgreSQL commits may repeat the external message. Inbox keys and all financial records remain deduplicated; delivery has no ledger-writing path.

## File groups

- Schema/migration: `prisma/schema.prisma`, `prisma/migrations/202609270008_operations_notifications/migration.sql`.
- Staff/security/operations: `src/modules/admin/{permissions,boundary,bootstrap,ops,operations}.ts`, `src/modules/auth/staff-plugin.ts`, admin/media routes, admin page/layout components, `scripts/admin-reissue.ts`.
- Notifications: `src/modules/notifications/service.ts`, bid/settlement source commands, bot worker, `scripts/notification-worker.ts`, alerts API/page/bell.
- Personal/wallet: fulfillment/support/preview APIs, My Wins/Wallet, delivery/support/funding preview components, shared CSS.
- Verification: `tests/operations.test.ts`, browser operations/admin/personal tests, Playwright configuration. Package commands and `.env.example` document configuration.

## Validation commands

Use distinct fresh local databases for `TEST_DATABASE_URL`, `BID_TEST_DATABASE_URL`, `SETTLEMENT_TEST_DATABASE_URL`, `PERSONAL_TEST_DATABASE_URL`, `ADMIN_TEST_DATABASE_URL`, and `OPS_TEST_DATABASE_URL`.

```powershell
npx prisma migrate deploy
npx tsx scripts/seed-catalog.ts
npx tsx scripts/seed-catalog.ts
npx vitest run
npx playwright test
npm run typecheck
npx next build
```

Final combined suite: **12 files, 150 tests passed, zero skipped** (61.47 seconds). All six database variables above were configured. The clean full browser regression finished with **19 passed, one intentional skip** (2.1 minutes): the carousel manual/reduced-motion case runs at 430px and skips its duplicate at 360px. Browser checks include 360/430px, laptop/tablet admin, account switching/copy, disabled uploads, alerts and persistence. Initial browser failures exposed the controlled preference checkbox and draft product lookup; both were corrected before the final run. `npm run typecheck`, `npx next build` and `git diff --check` passed. Build used the successfully generated current Prisma client. These checks do not validate production runtime HTML headers.

The six final database names were `lowin_5b_final_{core,bid,settlement,personal,admin,ops}_test`, respectively, all on the loopback PostgreSQL instance above. Browser regression used `lowin_5b_verified_ui_test`. Each had all ten migrations applied. The catalog seed ran twice on `lowin_5b_final_ui_test`, retaining nine categories and fourteen auctions without resetting published schedules.

Final reconciliation returned no account/posting, projection or hold drift in any suite database:

| Database suffix | Migrations | Wallets | Journals | Settlements | Drift |
| --- | ---: | ---: | ---: | ---: | --- |
| core | 10 | 15 | 36 | 0 | none |
| bid | 10 | 17 | 134 | 0 | none |
| settlement | 10 | 24 | 115 | 21 | none |
| personal | 10 | 2 | 27 | 3 | none |
| admin | 10 | 2 | 10 | 2 | none |
| ops | 10 | 2 | 9 | 2 | none |

Local command logs: `.local/phase5b-full-final.log`, `.local/phase5b-browser-verified.log`, `.local/phase5b-build.log`, `.local/phase5b-reconciliation.log`. Debug runs also used disposable `lowin_5b_*_test` databases; none used the remote target.

After the final Home heading cleanup, the focused 360/430px browser capture run passed both tests (27.1 seconds), and typecheck and production build passed again. DEMO provenance remains on listings and the rule demonstration. The fresh finish reviewer returned `ship` for the scored UI corrections and design-documentation update. This visual review does not replace the outstanding independent security or release review.

Representative browser captures:

- Home: [360px](screenshots/phase5b-home-viewport-mobile-360.png), [430px](screenshots/phase5b-home-viewport-mobile-430.png).
- Wallet preview: [Telebirr at 360px](screenshots/phase5b-wallet-telebirr-mobile-360.png), [CBE at 430px](screenshots/phase5b-wallet-cbe-mobile-430.png).
- Private pages: [alerts](screenshots/phase5b-alerts-mobile-360.png), [support](screenshots/phase5b-support-mobile-430.png).
- Admin: [team laptop](screenshots/phase5b-team-admin-laptop.png), [wallets tablet](screenshots/phase5b-wallets-admin-tablet.png), [fulfillment laptop](screenshots/phase5b-fulfillment-admin-laptop.png), [jobs tablet](screenshots/phase5b-jobs-admin-tablet.png).

## Remaining release work

Production email delivery is unavailable until a provider adapter is configured. Real Telegram Android/iOS/WebView and private bot delivery, Supabase runtime-role/RLS privileges, production HTML headers, settlement/notification load and operational monitoring, backup/restore and independent custom-auth security review remain unverified. No deployment or remote schema change was performed. Contact encryption currently uses the server MFA encryption key; back it up securely and review dedicated key separation/rotation before production. The scheduler scans eligible saved auctions; load/index tuning and monitoring thresholds must be established before scale.
