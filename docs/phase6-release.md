# Phase 6: verified-transfer funding and release decision

**Release decision: NO GO for real-money funding or deployment.** The application has an explicit production credit interlock. Only an opted-in, disposable loopback `_test` environment can create or verify funding intents. No remote migration, live transfer, production activation or deployment was performed.

The existing Mini App Home remains the landing page inside Telegram. Ordinary browser visits receive only a Continue with the bot entry screen; staff login remains separate. White surfaces, flat controls, selected green gradients, integer-point wallets and the five-item bottom navigation are retained.

## Provider contract reviewed

Official references inspected on 2026-09-27: [introduction](https://docs.check.et/introduction), [quickstart](https://docs.check.et/quickstart), [authentication](https://docs.check.et/authentication), [verification](https://docs.check.et/api-reference/verify), [Telebirr](https://docs.check.et/guides/telebirr), [CBE](https://docs.check.et/guides/cbe), [developer OCR guidance](https://check.et/developers), [error handling](https://docs.check.et/guides/error-handling), and [webhook status](https://docs.check.et/guides/webhooks). The last two pages were read through an HTTP fetch after the browser search tool could not retrieve them.

Check.et verifies existing transfers; it does not collect funds. This implementation uses synchronous `POST /api/v1/verify` with server bearer credentials, bank and canonical reference. CBE adds the frozen receiving account. Telebirr does not send an account parameter, but must return the exact configured recipient before crediting. Webhooks remain unavailable in the provider documentation, so no webhook or checkout path was added. Branch-scoped duplicate flags are not used as global ownership evidence.

Official receipt URLs are parsed on the server into references and are never fetched. Only exact HTTPS `apps.ethiotelecom.et/receipt/<reference>` and `cbe.com.et/receipt/<reference>` shapes are accepted, without credentials, query strings or fragments. Other bank URL shapes require manual reference entry until reviewed. SMS and OCR are untrusted candidate extraction only.

## Database changes and transaction boundary

New migrations:

- `202609280001_verified_topups`: extends the existing `TopUpIntent`, adds append-only `PaymentPolicy`, `PaymentClaim`, `PaymentAttempt`, and `PaymentStatementEntry`; freezes intent identity/quote/reference; enforces commit-time credit/claim/journal matching; globally unique `(channel, reference)`; private-table RLS and anon/authenticated revocation.
- `202609280002_scheduler_indexes`: reverse favorite lookup plus partial due-outbox and pending-auction indexes. The preceding ten migrations are unchanged.
- `202609280003_telegram_launch_boundary`: nullable exact-session Telegram launch provenance. Existing sessions are not retroactively trusted; reopen through the bot.

Policies are immutable versions with receiving account, holder, rational points-per-ETB-cents quote, bounds, terms and review reference. New versions affect only new intents. Intent creation validates the latest version, converts integer cents exactly, and rejects fractions of a point. Requests expire after 30 minutes. A user may create eight requests per hour; a request permits six verification attempts and three scans. Staff and suspended accounts cannot create funding requests.

Verification uses three stages: lock the intent to claim a 30-second attempt lease; call the provider outside any database transaction; then lock the intent, canonical transfer advisory key and user wallet key to commit evidence and credit. Final access/restriction checks repeat before credit. The current provider deadline is 12 seconds. Identical requests replay, changed references cannot reuse an intent, and concurrent intents cannot claim the same transfer. A crashed lease can be retried after expiry. No external call holds a database transaction open.

Required evidence: confirmed and existing payment, completed transfer, matching bank/reference, official method, ETB currency, exact expected cents, exact unmasked receiver and a timezone-bearing plausible timestamp within the intent window. Unknown/missing/mismatched facts become pending or review states, with zero credit. Provider credentials/quota/outage/rate limits produce visible failure codes and bounded backoff; raw provider bodies, payer details and keys are neither retained nor logged.

The successful transaction creates one immutable operation, balanced ISSUANCE-to-AVAILABLE journal, global transfer claim and recorded outcome. Existing hold/bid/settlement guards are preserved. Reconciliation includes orphan/mismatched payment claims as well as the preceding account, hold, fee and settlement checks. Never edit an old receipt or journal to repair a discrepancy.

## Historical private receipt processing

This section records the former local Tesseract implementation. Current setup uses Verify.et Image Processing as documented in `docs/verify-et-migration.md`.

The screenshot route requires a verified session, correct origin and ownership of an active intent. It reads at most **5 MiB**, checks MIME against PNG/JPEG/WebP signatures, rejects animation/GIF/SVG and excessive dimensions, decodes at most **12 million pixels**, strips metadata and re-encodes before OCR. Longest edges are limited to 6000 before decode and 2400 after normalization.

OCR uses pinned Tesseract.js 6.0.1 with locally installed English trained data 1.0.0. The child process receives normalized image bytes through stdin and no database, provider or authentication environment secrets. It has a 20-second deadline, bounded output and one active scanner per application process. No receipt file is written: zero persistent retention, buffers cleared when processing ends, process terminated on timeout. OCR text never establishes payment. The user reviews the extracted reference; uncertain/ambiguous input falls back to manual entry. English/Latin receipt references are supported; Amharic-only or unsupported layouts may need manual entry.

Next file tracing includes the OCR script, engine and trained data. Hosting-specific process/memory limits still require staging verification; disabling `RECEIPT_OCR` leaves manual input as the fallback. A VPS can run the same bounded Node subprocess. Do not enable screenshots on a platform that cannot package/run the OCR dependency correctly.

## Staff operations

- `/admin/top-ups`: paginated queues, status/case filters and request search.
- `/admin/top-ups/[id]`: redacted expected/verified evidence, frozen quote, immutable issuance links, timeline and case notes. Owner and Payments Operator can note, retry an eligible verification, escalate or resolve an investigation. None can issue points through a note or state update.
- Support receives only status, reason and case assignment; Auditor gets redacted read-only evidence. Exact credential/MFA sessions and live role checks apply to direct APIs and page requests.
- `/admin/settings/payments`: Owner-only; fresh MFA; review of exact previous/proposed values; confirmation hash; optimistic version; immutable audit. API keys never enter this UI. Channel configuration cannot bypass the production interlock.
- `/admin/top-ups/statements`: manually entered, independently reviewed bank evidence, producing MATCHED/MISMATCH/UNMATCHED records. There is no approved automatic statement feed or format.

Dashboard incidents cover aged requests, duplicate claims, provider outage/quota, escalated/reversal investigations, unmatched statements and ledger/issuance drift. Case mutation assigns the acting operator; reasons and the exact session are audited. Financial evidence links point to actual operations/journals.

## Daily bank reconciliation and correction

1. Obtain the bank/Telebirr statement through an authorized account holder, independently of Check.et. Store the original in the operator's access-controlled evidence archive; never paste it into a public case note.
2. Compare channel, canonical reference, cents, receiving account and timestamp against credited transfers. Enter each reviewed row and a private archive reference in Statements. Matching does not credit anything.
3. Leave unmatched/mismatched entries visible, assign and escalate the associated request, and record the investigation. A later appended statement entry preserves the original discrepancy; do not delete history. Do not close an incident merely because Check.et returned success.
4. A later bank reversal requires Owner review of the bank evidence and user/dispute policy. `reverseVerifiedTopup` is an internal command with fresh Owner MFA, reason, evidence reference, typed intent ID and idempotency. It reverses the original credited points through a new balanced journal only when AVAILABLE covers the entire amount. It cannot touch holds, alter bids, or overdraw spent points. No HTTP mint/reversal button exposes it.
5. When points have been spent/held, keep a reversal-review incident open for a separately approved resolution. There is no automatic debt, forced auction cancellation or external refund/payout implementation.

## Delivery-contact keys

Delivery contacts now use a dedicated AES-GCM keyring: `DELIVERY_CONTACT_KEYS` is a server-only JSON map of key IDs to 32-byte hex keys; `DELIVERY_CONTACT_KEY_ID` selects the writing key. Envelopes bind purpose and key ID. Production new writes require this configuration; isolated tests use a separate fixture key, not the MFA key.

Legacy ciphertext remains readable with the old MFA key solely for migration. Back up both the database and required key versions, test restoring them, add the new delivery key, then rotate in a transaction and verify decrypt-before/decrypt-after equality. `npx tsx scripts/rotate-delivery-keys.ts` performs this validation only on disposable loopback databases. A reviewed production equivalent must use a backup, bounded batches, immutable audit and rollback plan. Keep old keys until all records and retained backups are migrated or expired. Never remove the MFA key while authenticator data or legacy contacts depend on it.

## Runtime and release configuration

Next serves HTTPS behind a trusted reverse proxy. Configure matching `BETTER_AUTH_URL`/`MINI_APP_URL`, secure secrets, actual BotFather Mini App URL, signed webhook secret and authenticated Telegram launch. Public tunnels must keep local identity disabled. Vercel was the preferred web host; persistent workers require a separate worker host. A VPS may run separate supervised Next, bot, settlement and notification processes.

- Web: `npm run build`, `npm run start`.
- Bot: `npm run worker`.
- Settlement: `npm run worker:auctions`; one-shot recovery probe `npm run worker:auctions -- --once`.
- Alerts: `npm run worker:notifications`.
- Reconcile: `npm run wallet:reconcile`.
- Isolated OCR: `RECEIPT_OCR=tesseract`; pinned package/script tracing must be present.
- Isolated provider: `PAYMENTS_TEST_ENABLED=true`, `CHECK_ET_MODE=test`, `CHECK_ET_TEST_API_KEY`. Browser mocks additionally use an explicitly loopback-only `CHECK_ET_TEST_ENDPOINT`.
- Live key has a separate `CHECK_ET_LIVE_API_KEY` slot. Setting it does **not** enable production crediting.

Database migrations use the migration owner via the direct URL. Runtime must use a separately reviewed least-privilege role; no browser Supabase client receives financial-table access. Do not run repository commands against an unidentified `.env` target. The configured remote Supabase target remains unchanged.

## Release gates and exact blockers

| Gate | Local evidence / blocker |
| --- | --- |
| Business verification and receiving accounts | Mocked adapter only. Owner must provide Check.et business account approval/key through a secret channel, actual Telebirr/CBE receivers, enabled channels, and documented provider confirmation of receiver fields. |
| Quote and policy | Test quotes only. Owner must review ETB/point rational rate, bounds, eligibility, fees, refunds, disputes, reversals, retention and local points-for-prizes legal/provider review. |
| Production email | Local HTTP sink only. Need chosen provider credentials, verified sender/domain, delivery/recovery test inbox and bounce/failure monitoring. |
| Telegram clients/delivery | Browser signatures and intercepted bot transport only. Need real Android/iOS accounts/devices, HTTPS bot launch and opt-in private bot delivery checks. |
| Supabase roles/RLS | No remote access changes. Need staging Supabase project, migration/runtime roles, grants and RLS/trigger privileges reviewed and exercised. |
| Production HTML headers | Local production-mode HTTP checks passed for guest redirects, bot entry, private API rejection and staff login (no-store, nosniff, no-referrer). Hosted HTTPS ingress and authenticated HTML remain unverified; need staging hosting access and authenticated/guest captures. |
| Load/capacity | Isolated baseline only; test target-concurrency/auction-participant volumes with staging-equivalent CPU, memory, PostgreSQL pool/roles and worker count before release. |
| Backups/keys | Disposable local dump/restore drill only. Need actual encrypted backup retention, restoration access, off-host keys and production recovery objectives. |
| Independent staff-auth review | Implementation/regression tests are not independent review. Need reviewer sign-off for credential/MFA/session binding, recovery and new capabilities. |
| Hosting OCR | Local subprocess tested; hosted memory, timeout and trace packaging need verification. Manual entry remains available when scanning is disabled. |

## Concrete owner-reviewed rollout step

After the above artifacts and decisions exist, prepare one reviewed release change to the production interlock, approved settings and runtime role grants. In a separate staging project: restore a sanitized database, apply the thirteen migrations using the migration role, run the entire opt-in suite with the runtime role where appropriate, verify no anon/authenticated access to private tables, run real staff-email and Telegram smoke tests, and capture production HTTP headers. Drill stopping/restarting all workers and interrupted verification leases; reconcile before and after. Check statement matching against small, owner-approved real transfers before any wider activation. No such transfer is authorized or performed by this implementation prompt.

Monitor failed/stale settlements, outbox age/terminal delivery codes, Check.et 401/402/429/outages, pending requests over one hour, duplicate claims, statement mismatches and any reconciliation drift. Any drift is a stop condition. Pause new channel versions, preserve existing intent/receipt history, disable the release interlock and investigate; do not roll back financial history or replay bank credits manually. Start with a small, capped cohort and a named payment operator watching the first reconciliation cycle. Owner approval of this concrete release packet is the final step, not implied by passing tests.

## Validation results

All database names below are disposable loopback targets at `127.0.0.1:55439`, user `lowin_test`; no password or live credentials were used. The configured remote `.env` Supabase target was not migrated, seeded or changed.

- Combined `npm test`: **14 files, 189 passed, zero skipped**, 108.47 seconds (`.local/phase6-full-complete.log`). Core, bid, settlement, personal, admin, operations, payment and Telegram-bound-session coverage ran with all opt-in variables.
- Payment/entry browser regression: **6 passed, zero skipped**, 56.6 seconds (`npx playwright test --config playwright.payments.config.ts`, `.local/phase6-payment-browser-complete.log`). Covers 360/430px wallet and bot entry, 1366/834px admin queue/detail/settings/statements; blocked direct page/API access, visible bot link, and staff entry separation.
- Final earlier-feature Playwright regression: **19 passed, one intentional duplicate 360px carousel skip**, 2.4 minutes (`.local/phase6-browser-regression-complete.log`). Total distinct browser cases: **25 passed, one skipped**. Entry-only recapture after waiting for launch-check completion: 2 passed, 15.7 seconds.
- `npm run typecheck`: passed. `npx next build`: passed; production compilation 12.6 seconds, TypeScript 12.9 seconds. Final `npx prisma generate`, `npm run typecheck` and post-entry-fragment `npx next build` also passed. Prisma generation initially hit Windows DLL locking from the running development server; it passed after a brief server stop, then the development server was restored.
- **13 migrations actually applied** to each of seven `lowin_6_complete_{core,bid,settlement,personal,admin,ops,payments}_test` databases, and the final isolated browser databases. No remote application.
- Final reconciliation across seven database snapshots: **66 wallets, 343 journals, 29 settlements, 6 verified test credits; zero posting/projection, hold, fee/refund, settlement or payment drift** (`.local/phase6-reconciliation.log`).
- Load baseline: **100 participants/bids**, bid batch 3.802 seconds, scheduler 16.29 ms, atomic settlement **1.867 seconds** against the 120-second transaction limit, 301 outbox rows processed in 1.457 seconds. **200 mocked sends, zero network sends, zero drift** (`.local/phase6-load.log`). The small-fixture EXPLAIN used the partial `Outbox_pending_due_idx`; this is not production-scale capacity or query-plan proof.
- PostgreSQL 17 `pg_dump --format=custom` of `lowin_6_load2_test`, `pg_restore --no-owner --exit-on-error` into `lowin_6_restore_test`: restored reconciliation passed, zero drift (`.local/phase6-backup.dump`, `.local/phase6-restore.log`). Those load/restore databases predate only the nonfinancial session-provenance migration.
- Contact key rotation: one old-key encrypted local contact re-encrypted and verified with the new independent test key (`.local/phase6-key-rotation.log`). Production rotation/recovery is still blocked on owner key custody and staging.
- `npx tsx scripts/staging-http-check.ts`: **five local production-mode HTTP checks passed**, using disposable DB and generated nonsecret configuration; `/` and `/wallet` redirect, `/telegram` and `/admin/login` render, `/api/me` rejects. Each returned no-store, nosniff and no-referrer. No hosted TLS/authenticated cache claim (`.local/phase6-production-headers.log`).
- OCR uses real local Tesseract in database/browser tests; Check.et transport remains mocked. Tests include ambiguous/blank fallback, duplicate image/reference, static magic-byte/dimension/size validation, and memory-only input cleanup.
- Crash/retry evidence is from transaction/lease/outbox tests and subprocess settlement crash tests. An actual production worker supervisor stop/restart drill remains unverified.
- Independent UI verdict: **ship for the three scored payment fixes** (header balance, immutable accepted receipt presentation, statement empty state). All 16 payment captures reviewed. Telegram entry and security were outside that review; entry has separate browser assertions and builder inspection. No independent staff-auth security review is claimed.

Reproduce the database run with these variables set before `npm test`:

```powershell
$base = 'postgresql://lowin_test@127.0.0.1:55439/'
$env:TEST_DATABASE_URL = $base + 'lowin_6_complete_core_test'
$env:BID_TEST_DATABASE_URL = $base + 'lowin_6_complete_bid_test'
$env:SETTLEMENT_TEST_DATABASE_URL = $base + 'lowin_6_complete_settlement_test'
$env:PERSONAL_TEST_DATABASE_URL = $base + 'lowin_6_complete_personal_test'
$env:ADMIN_TEST_DATABASE_URL = $base + 'lowin_6_complete_admin_test'
$env:OPS_TEST_DATABASE_URL = $base + 'lowin_6_complete_ops_test'
$env:PAYMENT_TEST_DATABASE_URL = $base + 'lowin_6_complete_payments_test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:DIRECT_URL = $env:DATABASE_URL
npm test
```

Create fresh `_test` databases for a clean rerun; immutable fixtures intentionally are not all reusable. Browser runs likewise require their own freshly migrated/seeded disposable database. The payment browser tests create their own policy fixtures.

The original development server was restored with the unchanged `.env`. Its remote-backed Telegram sign-in returned HTTP 503 during the final check. No remote diagnostic/migration was performed to attribute that failure; this is not a verified live Telegram environment. The new migrations are applied only to disposable databases.

## Telegram-only boundary

`src/proxy.ts` gates player pages and APIs before rendering; the Mini App layout and private data helpers repeat session authorization. Only the signed Telegram login handler can stamp `session.telegramLaunchId` after matching the issued session's stored Telegram identity. Guest, old unbound, mismatched, expired/revoked and staff sessions cannot open player APIs. No user-agent, host, forwarded header, `initDataUnsafe` or ordinary website credential cookie grants Telegram proof. The client also requires Telegram launch data before showing the Mini App shell. The launch fragment stays in the browser when continuing to Home.

The only development preview exception requires the existing explicit local identity configuration, a loopback database and matching localhost-only URLs; its actual test login still requires the private operator key. Public/ngrok/production configuration cannot use that exception. Session cookies remain bearer credentials: neither the browser SDK nor HTTP can cryptographically attest a physical Telegram client against theft/replay of an already valid session. Protect session cookies and verify real client lifecycle behavior before release.

## Changed files and capture inventory

This working tree contains earlier uncommitted phases. Phase 6 changes are concentrated in:

- Schema/migrations: `prisma/schema.prisma`, the three `20260928000*` migration directories above.
- Payment domain: `src/modules/payments/{provider,service,admin,correction,ocr}.ts`; `scripts/receipt-ocr.cjs`.
- HTTP and auth: `src/app/api/wallet/{top-ups,scan}/route.ts`, `src/app/api/admin/payments/[[...path]]/route.ts`, `src/modules/auth/{handler,mini-access,private-api}.ts`, `src/app/api/me/route.ts`, bid route session guard, top-up transaction session recheck, `src/proxy.ts`.
- Player UI: `src/components/{wallet-funding,wallet-funding-preview,telegram-provider,telegram-entry,app-shell}.tsx`, `src/app/(mini)/{layout,wallet/page}.tsx`, `src/app/telegram/page.tsx`, `src/app/globals.css`.
- Staff UI/routing: `src/components/{admin-payments,admin-shell,staff-login}.tsx`, admin catch-all and `src/app/admin/admin.css`.
- Operations: `src/modules/fulfillment/crypto.ts`, fulfillment contact API/admin operations, `src/modules/notifications/service.ts`, `scripts/{reconcile,rotate-delivery-keys,staging-load,staging-http-check,payment-test-sink}.ts`.
- Configuration/tests: `next.config.ts`, `package.json`, lockfile, `.env.example`, `playwright.payments.config.ts`, `tests/payments.test.ts`, `tests/telegram-entry.test.ts`, `tests/payments-browser/{mobile,admin}.spec.ts`.
- Documentation: this report, `docs/phase6-role-review.sql`, `docs/phase6-smoke-plan.md`, Owner runbook supplement, `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`.

18 new screenshots in `docs/screenshots`: `phase6-wallet-{quote,scan,receipt,fallback}-mobile-{360,430}.png`; `phase6-{top-ups,payment-detail,payment-settings,payment-statements}-admin-{laptop,tablet}.png`; `phase6-telegram-entry-mobile-{360,430}.png`. They use nonsecret, non-payable DEMO fixtures. Existing regression screenshots were refreshed separately.
