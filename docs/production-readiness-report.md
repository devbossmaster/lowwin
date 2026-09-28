# Lowwin release review — 29 September 2026 EAT

**NO-GO for real money, real auctions and production traffic.** This is a review branch based on `devbossmaster/lowwin` main `ad4af69e12f7f5e7bc29fb659783d555c80f054e`. The Owner narrowed this pass to essential checks and deferred SSH/VPS work. No real payment, credit, auction publication, migration against a remote database, email or Telegram notification was initiated by this review.

## Implemented

- Bounded streaming request bodies for authentication, bids, bot webhook and admin JSON, including chunked requests and a read deadline. Verified identities receive atomic database-backed request limits. Bid submission checks same-origin requests. Reverse-proxy enforcement remains a deployment prerequisite.
- Check.et `duplicate: true` goes to investigation, never credit. Missing duplicate/type evidence fails closed. Exact receiver, reference, amount, date/timezone, currency and official-method checks, unique transfer claims, idempotency and balanced journals remain enforced. OCR only proposes a reference. `paymentHealth()` continues to disable production crediting.
- Prisma 6 relation joins reduce catalog database round trips; category totals aggregate in SQL instead of transferring every auction. The hammer menu has a small public-only live-auction response, newest first, numeric detail links and a safe retryable 503 response. No private-response cache was added. Regenerate Prisma and restart the server when checking out this branch.
- Shared spinner and whole-page translucent blur, including private pages such as Winning Bids and Wallet. Concurrent loaders share one overlay; background controls are inert until page requests complete. Reduced-motion users receive a static indicator.
- Wallet controls/account details/status labels, Winning Bids and all 13 standard FAQ entries have Amharic copy. Language selection persists across reloads; root language and Ethiopic wrapping are set. Additional editor-authored FAQ entries, dynamic provider explanations, other player screens, admin and bot copy still need a complete bilingual audit. No native Amharic reviewer was available; these translations are not linguistically approved.
- Home now reads the saved Home editor content. Optional Amharic headline/lead fields were added to the editor. The hero uses responsive Next image delivery. Added fail-closed Resend email transport with request timeout, secret-safe errors and provider idempotency; real email delivery is unverified.
- CI provisions isolated PostgreSQL databases for every opt-in suite, checks type/build, runs four focused mobile flows, audits dependencies and runs pinned Semgrep rules. Official workflow actions are SHA-pinned.

## Evidence and limits

The prior main [CI run 36482816274](https://github.com/devbossmaster/lowwin/actions/runs/36482816274) failed a stale bot button-label assertion. The assertion now verifies the actual Mini App destination. The rest of that old run did not establish a passing build or browser test.

| Check | Evidence in this pass |
|---|---|
| All opt-in database/unit suites | **275 passed, 26 files, zero skipped** on fresh loopback PostgreSQL 17 databases. Includes Telegram/contact, bid races, wallet/holds/journals, settlement, personal access, staff MFA, operations and funding tests. |
| Header catalog projection follow-up | **6 catalog tests passed**, including public-only small header DTO. |
| Typecheck | `tsc --noEmit` passed after application changes. |
| Production build | `next build` passed. No production database was needed or mutated. |
| Dependency audit | `npm audit --audit-level=low`: **0 vulnerabilities** (295 resolved dependencies). |
| Static security | Semgrep `p/ci` and `p/secrets`, 65 rules: **0 findings** in the final local scan; the hosted security job also passed. This is not a penetration test. |
| Mobile Chromium 360px / 430px | Signed contact/authentication, accepted bid confirmation and receipt, public DTO privacy and private wallet balance passed at both widths. All four hosted mobile tests passed, including navigation, centered Deposit, persistent language, full-page blur/inert background and Wallet account-detail toggles. Local Windows dev compilation was slower and initially unstable; this is not a real-device performance result. |
| GitHub branch CI | **GREEN** on implementation commit `46d73b2`: [Checks 36487332478](https://github.com/devbossmaster/lowwin/actions/runs/36487332478), foundation and security successful. Follow-up footer/test-harness/documentation changes trigger a new run; its result must be checked separately. |
| Real Telegram Android/iOS | **Unverified**. The Owner will test via ngrok. Browser viewport emulation is not a Telegram-device result. |

Build/test output and screenshots are under ignored `test-results/release/` and `.local/` in the review checkout; CI uploads sanitized fixture test artifacts for seven days. Test traces use fake identities, test bot credentials and disposable databases only. No existing bids, holds, settlements, journals or migration files were deleted or rewritten. The shared footer now renders only on Home, as requested.

## Read-only staging performance

Three measured warm samples per case, same staging runtime database and public response payload, sequential before/after runs from this Windows machine. These are **catalog service timings**, not full HTTP, cold launch, rendering, Telegram Android/iOS or a load test. Small sample size and shared network/database load limit percentile confidence.

| Public operation | Before median / observed p95 | After median / observed p95 | Payload |
|---|---|---|---|
| Home catalog | 6560 / 6786 ms | 3678 / 3692 ms | 15,585 bytes, unchanged |
| Results | 5399 / 5528 ms | 2410 / 2630 ms | 6,519 bytes, unchanged |

Observed SQL statements fell from 33–35 to 20 per Home sample and 13–14 to 7–8 per Results sample (including connection/pool statements). Medians improved approximately 44% and 55%; remaining multi-second latency is still a release concern. Local loopback medians were Home 33.30→33.97ms and Results 22.89→20.76ms; round-trip reduction should not be presented as a universal CPU/query-plan speedup. A realistic concurrency/pool-capacity test and query plans on production-size data are outstanding.

## Owner packet and next gate

1. Follow [production setup](production-setup.md) and fill the documented environment inventory using separate staging/production secrets. Required external inputs: origins, Telegram bot, restricted runtime database login and migration login, encryption/HMAC keys, verified staff-email sender/domain/key, Owner email/MFA, approved bank receivers/provider keys, backup destination and monitoring owner.
2. Use [admin guide](admin-guide.md) for bootstrap, staff roles, daily auction/content/support work, funding incidents, reconciliation and fulfillment. No staff bootstrap or invitation was sent in this pass.
3. On ngrok, verify fresh and resumed Telegram launch/contact on Android and iOS; test slow/lost connectivity, bid receipt/reload and balance, language persistence, Wallet/FAQ wrapping, account toggle and the hammer menu. Record phone model, OS/Telegram version, connection, timings and failures. Do not send money.
4. Outstanding production checks: database runtime role/RLS/grants; migrations/status and backup restore; proxy TLS/body/rate/header policy; worker resource limits/supervision; monitoring/alert delivery; real email delivery; provider account/evidence contract; load/pool measurements; translation completion and natural-language review. Hostinger and Gojo coexistence deployment is explicitly deferred.
5. Keep real crediting disabled. After all release gates pass, present an exact receiver, tiny amount, reference/evidence capture, expected ledger changes and rollback/reconciliation plan for the Owner's **explicit transfer approval**. Approval has not been given. Real auctions and traffic switching also remain approval gates.

No permanent remedy for an unreachable Supabase server is claimed. Reduced queries lower pressure; network/provider outages still require operational handling and must fail closed.

## Review checkout

Branch `release/production-readiness-20260928` is pushed for review; main is unchanged. The Owner checkout can run the same commit on `review/production-preview-20260929` for ngrok testing. A local preview restart is not production traffic activation.
