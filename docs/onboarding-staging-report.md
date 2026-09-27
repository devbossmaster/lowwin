# Telegram onboarding and staging recovery — 27 September 2026

Staging was reset only after the user's explicit reset authorization, target verification and a successful complete restore rehearsal. No production database, deployment, payment provider, Supabase Auth, Storage or project configuration was reset. The sibling `Desktop/auction` app used the same project and remains stopped; running its old migration chain against this project is unsafe.

## Exact migration conflict

Verified target: Supabase project **dzvltmdojkzofsmxfkob**, database **postgres**, PostgreSQL 17.6, pooler `aws-1-eu-west-1.pooler.supabase.com`. Both configured database URLs identify this project. Target fingerprint: `c7424dc356ce28fcd2776e9ca0b653532eb13540617bdbc3feb5030317aace16`.

The old `_prisma_migrations` contained these finished, non-rolled-back migrations:

| Recorded migration | Recorded checksum |
|---|---|
| 20260926104500_website_auth | bfc2cfca33c58ec105d0da576c9ee6c119c0c2552ac442b07c2b98441ad737a5 |
| 20260926190000_telegram_identity | c8dd105620bb85e75568f7b460ed80906bc193e172bff78249438b16bd4d3683 |
| 20260926210000_telegram_contact_launch | 9a1a8ad67d1ff59b29c2cbeff79cc660a5a57200c75306d05d9f6f23b23da29f |

These names are absent from this repository's migration chain. Their SQL hashes exactly match the sibling `Desktop/auction` repository. This was actual schema divergence: the old public schema held website authentication/contact tables, non-null user email and old phone/Telegram identity fields; it had no Auction, Wallet, Journal or SiteContent tables. It was not merely a stale Prisma status message.

## Backup, restore and reset evidence

- Complete custom-format database backup, with no schema filter: `.local/staging-backups/complete-2026-09-27T19-47-47.391Z.dump` (378,085 bytes).
- SHA-256: `dbc9c34848a3709645664d400366d136c4624763c91decddc12c104ec5f0cf54`.
- Restored into `lowin_full_fidelity_verified` in isolated Docker container `lowin-staging-restore-20260927`, image `public.ecr.aws/supabase/postgres:17.6.1.143`, with no published ports. Restored owners and ACLs; missing local role identities were reproduced as NOLOGIN roles. `pg_restore --exit-on-error` returned 0.
- All **50 tables** matched source row counts and canonical content digests after full restore. An earlier ordinary PostgreSQL rehearsal lacked `supabase_vault`; the successful full-fidelity Supabase-image restore is the backup proof relied on.
- All **39 non-public tables** still matched their restored backup after the reset/migrations. Auth, Storage, Vault, extensions, schemas and project resources were retained. There were no Storage objects/buckets or Vault secrets requiring separate external-object recovery.
- Backup directory is private to the current Windows user and SYSTEM. TLS certificate verification remained enabled using the official Supabase CA.
- Stopped both apps targeting the project and verified no active Lowin workers before reset. One guarded transaction locked and dropped only the exact 11 inventoried Lowin public tables, with `RESTRICT`, never `CASCADE`. Public schema and unrelated objects remained.

Dropped tables: SmsRateLimit, TelegramContactReceipt, TelegramIdentity, TelegramLinkChallenge, TelegramWebhookUpdate, `_prisma_migrations`, account, rateLimit, session, user, verification. Prior row counts were respectively 10, 0, 0, 0, 0, 3, 1, 1, 0, 1, 0. This deliberately removed the old staging account; it remains recoverable from the verified backup.

Private evidence: `.local/staging-backups/complete-result.json`, `complete-verification.json`, `reset-result.json`, `protected-after-verification.json`. Backup contents and credentials are not committed.

## Migrations actually applied

Applied normally with `prisma migrate deploy`, after a clean local rehearsal. All 14 database checksums match repository SQL; every migration finished and none is marked rolled back. No applied SQL was edited and no migration was marked applied to bypass execution.

```
202609260001_foundation
202609260002_ledger_invariants
202609270001_hold_integrity
202609270002_catalog
202609270003_accepted_bids
202609270004_auction_settlement
202609270005_settlement_lock_guard
202609270006_personal_pages
202609270007_admin_foundation
202609270008_operations_notifications
202609280001_verified_topups
202609280002_scheduler_indexes
202609280003_telegram_launch_boundary
202609280004_own_contact
```

The last migration adds encrypted own-contact records and immutable contact-event auditing. Existing journal, hold, auction acceptance, settlement and published-terms guards remain in place.

## DEMO showcase and reconciliation

Seed batches: `staging-20260927` and `staging-catalog-20260927`. Both replay without issuing additional points, creating bids or moving published schedules. The original three illustrative PublicAuctionResult records remain distinct from real rule-based test settlements. Two original image associations were corrected with an audited, idempotent command; no product identity, schedule, terms or result was rewritten.

Snapshot at 20:28 UTC:

| Data | Count |
|---|---:|
| Categories / products / auctions | 9 / 36 / 36 |
| Live / upcoming / closed / cancelled | 17 / 11 / 7 / 1 |
| Ending within 24 hours / pending close | 13 / 0 |
| Accepted bids / wallets / balanced journals | 12 / 3 / 36 |
| Actual settlements / illustrative results | 5 / 3 |
| DEMO funding previews / private inbox entries | 3 / 19 |
| Favorites / support samples / pending fulfillment | 1 / 1 / 2 |

Every inventory item is DEMO; Animals has no live auction. Fresh fixture inventory is separately marked settlement-capable. Original Phase 2 illustrative inventory is preserved and cannot accept staging bids. Counts change naturally with database time; seeds do not move published schedules.

Real domain commands accepted bids and settled five examples:

| Example | Outcome | Charged from HELD | Hold returned | Entry fee refund |
|---|---|---:|---:|---:|
| 1 twice, 2 once, 3 twice, 4 once | 2-point winner | 2 | 8 | 0 |
| One accepted bid | 7-point winner | 7 | 0 | 0 |
| All amounts duplicated | NO_WINNER | 0 | 18 | 0 |
| Zero bids | NO_WINNER | 0 | 0 | 0 |
| Cancellation | CANCELLED | 0 | 11 | 2 |

All five immutable decision proofs were recomputed from accepted bids and matched. The private proof and its frequencies are not sent to player/public responses. Proof digests and migration comparisons are in `.local/staging-final-audit.json`.

Ledger totals: **AVAILABLE 2,958; HELD 11; FEES 22; SETTLEMENT 9; ISSUANCE -3,000**. Total postings balance to zero; HELD equals the 11 points in auction holds. Account/posting/projection/hold/payment reconciliation reports **0 drift**. The 3,000 points are explicit **DEMO issuance**, never verified Telebirr, CBE or Check.et payments. PENDING / NEEDS_REVIEW / REJECTED funding previews have no credit journal or payment claim. Provider mode remains disabled on staging.

Synthetic participants supply private history for isolated browser screenshots. They have no Telegram destination and cannot receive external messages. Real bot users start with their own truthful account, not somebody else's sample history. No staff account or production receiving account was seeded.

At 20:40 UTC, **one real staging user had a server-verified own contact** and the explicit operator grant command issued/replayed **1,000 DEMO points** once. Totals became **4 wallets, 37 journals, AVAILABLE 3,958, ISSUANCE -4,000**; HELD 11, FEES 22 and SETTLEMENT 9 were unchanged, with **zero reconciliation drift**. The bounded allowlist now contains one verified tester; app and workers were restarted to load it. This is server-side receipt evidence, not a claim that Telegram client rendering was visually verified.

## Onboarding and interface changes

`/start` sends an original Lowin welcome photo and Launch Lowin button. Menu/webhook use the same configured HTTPS origin. Exact signed Telegram launch is required; website cookies, user-agent strings and browser headers do not prove identity. The own-contact gate appears before Mini App content. Native callback success only starts polling: authenticated bot receipt, private chat, matching sender/contact/chat identity, current bot binding and server verification are required. Decline closes the Mini App and grants nothing; a bot keyboard is the fallback. Phone values are normalized, encrypted and hashed; only a masked suffix is returned. Cross-account reuse and changed/revoked contact require support, never automatic merging.

Home now follows the supplied PDF order, with white surfaces, readable lime actions, six-number rule example, illustrated categories and full auction cards. Winners has category/search/status/sort/pagination. Detail, My Bids, profile, favorites, alerts and wallet retain private real-data behavior. The five tabs and Telegram safe-area spacing remain. Admin retains its separate design. Browser visitors get Continue with the bot; no separate consumer website was added.

Main changed groups: `src/modules/auth/own-contact.ts`, auth handler/access boundary, `src/app/api/onboarding/contact`, Telegram provider/entry/contact gate, bot webhook/worker/welcome, staging capability and internal ledger issuance, catalog/results/personal projections, Mini App pages/components/styles, showcase/grant/art scripts and integration/browser fixtures. `DESIGN.md` and `.impeccable/design.json` document the implemented UI. No public credit endpoint was added.

## Validation

| Check | Result |
|---|---|
| Combined unit + PostgreSQL suite | **214 passed, 16 files, 0 skipped**, 97.32s |
| Clean general Playwright regression | **19 passed, 1 intentional skip**: carousel test runs only at 430px |
| Payment/contact/Telegram-boundary Playwright | **10 passed, 0 skipped**; isolated mock provider only |
| TypeScript | Passed `npm run typecheck` |
| Production build | Passed `npm run build` against loopback fixtures |
| Mobile capture matrix | 12 routes at 360×800 and 430×932, full-page and viewport, no horizontal overflow/errors |
| Finish review | Material fixes resolved; ship verdict for reviewed corrections; contact states readable at both widths |

A final remote-runtime check found intermittent account-loading transaction timeouts. `/api/me` now reads complete wallets directly and only locks/initializes missing wallets; first-time initialization has an explicit 20-second transaction budget. Financial posting/hold behavior is unchanged. The follow-up contact/session database checks passed **17/17**, typecheck passed, and the final incremental production build was run with `npx next build` in an isolated output directory using the already-generated unchanged Prisma client. The complete 214-test run preceded this narrow account-read fix.

Additional browser checks passed at both widths for result category/sort controls retaining search/status; the live ngrok guest browser showed only Continue with the bot and no Mini App navigation. Live HTTP checks returned 307 for guest Home/Wallet, 401 for guest account/contact/catalog APIs, and 401 for a forged launch. Telegram `getMe`, menu and webhook matched **@lowwintestbot** and the configured origin, with no pending updates. The development `/telegram` HTML response reports `no-cache, must-revalidate`; production HTML headers remain a separate release check.

Database variables were all configured: TEST_DATABASE_URL, BID_TEST_DATABASE_URL, SETTLEMENT_TEST_DATABASE_URL, PERSONAL_TEST_DATABASE_URL, ADMIN_TEST_DATABASE_URL, OPS_TEST_DATABASE_URL and PAYMENT_TEST_DATABASE_URL. Final databases are fresh `lowin_onboard_final_*_test` on loopback port 55439. Main browser database: `lowin_onboard_browser_v3_test`; contact/payment browser database: `lowin_onboard_payment_ui_v2_test`.

Commands: `npm test`, `npm run test:ui`, `npx playwright test -c playwright.payments.config.ts`, `npm run typecheck`, `npm run build`; `npx tsx scripts/seed-showcase.ts --batch staging-20260927`; `npx tsx scripts/seed-showcase-inventory.ts --batch staging-catalog-20260927`; `npx tsx scripts/correct-demo-art.ts`; `npm run bot:setup`.

Earlier failures were retained in ignored logs: stale browser favorite assertions, shared test-address rate limits, loading/scroll capture defects, and a Windows Prisma DLL held open during the first build attempt. Corrected fixtures isolate unrelated simulated clients without changing runtime limits; corrected captures explicitly wait for data and reset scroll. Final results above supersede those attempts.

Screenshots: [Home 360](screenshots/onboarding-after/home-360-viewport.png), [Home 430](screenshots/onboarding-after/home-430-viewport.png), [contact gate](screenshots/onboarding-after/contact-required-mobile-360.png), [detail](screenshots/onboarding-after/detail-360.png), [results](screenshots/onboarding-after/winners-430.png), [wallet](screenshots/onboarding-after/wallet-360.png). Complete before/after sets are under `docs/screenshots/onboarding-before` and `onboarding-after`.

## Operating this staging session

The Lowin development app on port 3000 and separate bot and auction workers were restarted, with hidden windows and logs under `.local/staging-{app,bot-worker,auction-worker}*.log`. Ngrok points to that local app. `npm run worker` handles authenticated webhook inbox updates; `npm run worker:auctions` handles due auction settlement. Notification delivery was not activated. The old sibling app remains stopped.

Anyone starting the bot may onboard. DEMO funding is an explicit operator action, never automatic `/start` or contact credit: `npx tsx scripts/grant-staging-demo.ts --batch staging-20260927` selects only current-bot, verified-contact, non-staff users with an existing bot chat, uses a bounded allowlist and an idempotent journal grant. Restart the staging app/workers if that command reports an allowlist change. Do not change the batch to repeat a grant. Production/Vercel/different-project environments fail closed.

Keep the verified backup and contact encryption keys in protected storage. The backup is sensitive. Restoring it to a live project is a separate reviewed recovery action; do not casually replay it over the new Lowin schema. Never run the sibling repository's migration chain here.

Remaining release work: actual Android/iOS Telegram rendering and native contact dialog/photo delivery; end-to-end real-user bid/receipt verification; production email delivery and Owner provisioning; Supabase least-privilege runtime-role/RLS validation; production HTML headers; settlement load testing; real payment-provider onboarding/legal policy. Local signed fixtures and provider mocks do not establish these. No deployment or verified real payment is claimed.

Staging performance is not release-ready evidence: remote database round trips and development compilation caused multi-second requests; a cold Home request after restart took about 13 seconds. The account-read fix avoids repeated write transactions, but regional placement, query latency and production-mode performance still need measurement.

## Phone results timeout correction

A real phone launch exposed the 5-second default Prisma interactive transaction limit in `src/modules/auctions/results.ts` while Home loaded its results preview. The results query now permits a 10-second wait for a transaction slot and a 30-second transaction, and removes four status-count queries that neither Home nor Winners uses. Its existing result filters, pagination, public projection and repeatable-read snapshot remain. The three direct staging query variants returned successfully in 6.7, 5.2 and 4.9 seconds; the focused disposable PostgreSQL suite passed 9/9 and typecheck passed. The phone client itself was not remotely controlled for this follow-up, so visual confirmation on that device remains with the user.
