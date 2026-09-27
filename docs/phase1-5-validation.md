# Phase 1.5 hardening — 2026-09-27

This implements only the focused hold-integrity and local-identity hardening request. The attached phased brief supplies context; its later-phase prompts are not authorization to start catalog work. No bidding, fee charging, payment provider, or public hold/credit endpoint was added.

## Changes

| Area | Files |
| --- | --- |
| Database guard | `prisma/migrations/202609270001_hold_integrity/migration.sql`, `prisma/schema.prisma` |
| Internal reserve/release | `src/modules/wallet/holds.ts`, `src/modules/wallet/ledger.ts` |
| Local identity gates | `src/lib/env.ts`, `src/modules/auth/local-identity.ts`, auth `handler.ts` / `server.ts` |
| Test-action visibility and manual key entry | `src/app/layout.tsx`, `src/components/telegram-provider.tsx`, `src/components/identity-state.tsx` |
| Verification | `tests/holds.test.ts`, `tests/local-identity.test.ts`, updated foundation fixtures, `tests/browser/local-identity.spec.ts`, `playwright.config.ts`, `tsconfig.ui-tests.json` |
| Setup/runbook | `.env.example`, `README.md`, `docs/auth-review.md`, `docs/operations.md` |

Browser-test build directories are isolated through `next.config.ts` and ignored by `.gitignore`. Next dev generated `AGENTS.md` / `CLAUDE.md`; these contain its standard bundled-documentation guidance. Existing Phase 1 screenshots were preserved; new captures have the `hardening-` prefix.

## Hold proof

The migration queues deferred checks for every hold insert/update/delete and account insert/update, without a state-dependent `WHEN` filter. At commit, HELD must equal the sum of the wallet's holds. HELD postings update the projection in the existing posting trigger, which queues the new account check. Direct account edits/deletes remain blocked by the existing ledger invariants. Hold ownership is immutable and hold/account truncation is blocked.

Each relevant write also updates a per-wallet guard revision before proceeding. This serializes raw database writers as well as application commands; stale repeatable-read transactions abort rather than checking a stale hold total. The guard is concurrency metadata, not an account or funding source. The migration checks existing balances and aborts on drift instead of repairing money silently.

The internal command transfers a positive integer amount AVAILABLE ↔ HELD and updates the auction hold, immutable operation result and balanced journal in one transaction. Full release keeps a zero hold. The scope/user/key combination deduplicates retries; the request hash includes auction, direction, points and audit reference. Same-key changed requests fail. A transaction-composable variant lets Phase 3 add bid acceptance later without an intermediate commit. No auction bid is accepted by this code.

Reconciliation tags discrepancies as `POSTING` or `HOLD` using one SQL snapshot. Tests observe an unmatched hold inside an uncommitted transaction, assert the reported drift, and deliberately roll back. No production constraint is disabled to create that fixture.

References for the database design: PostgreSQL [deferred trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html) and [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html). The implementation was exercised on PostgreSQL 17 locally.

## Local identity proof

- Both configured app/auth origins must match and be exact loopback hosts. A public origin (including ngrok), remote DB, hosted runtime, production setting, absent key, or disabled flag fails closed.
- Incoming public/ambiguous URL, Host, forwarded host, Origin and proxy metadata are rejection signals. They are never accepted as proof of local access.
- A separate random `DEV_IDENTITY_ACCESS_KEY`, available only to the local operator, is required in the request body. A proxy rewriting every visible header to localhost cannot replace this key. Both the wrapper and internal Better Auth endpoint enforce the gate.
- The key is never rendered or automatically sent to a browser. The local password input requires manual entry and clears after submit. Server-side availability checks and the browser's actual hostname hide the action on public pages; the browser check is only a visibility measure.
- Correct public/tunnel setup is `DEV_IDENTITY_ENABLED=false` with both URLs set to the HTTPS app origin. Real pinned-plugin tests still issue Secure Telegram sessions from signed fixtures under that configuration. These fixtures do not establish a live ngrok/Telegram smoke test.

## Exact recorded validation

Disposable target: `lowin_hardening_test` on loopback PostgreSQL 17, port 55439. No migration or test was run against the app's configured Supabase database.

| Command | Result |
| --- | --- |
| `$env:TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_hardening_test'; npm test` | **67 passed, 4 test files** |
| `npm run typecheck` | **Passed** |
| `npm run build` | **Passed**, including Prisma generation and Next production compilation/type checking |
| `npm run test:ui` with that same `TEST_DATABASE_URL` | **8 passed** at 360×800 and 430×932; dedicated local/public-config servers on 3107/3108 |
| `npm run wallet:reconcile` with `DATABASE_URL` / `DIRECT_URL` set to the disposable DB | **`{"reconciled":true,"drift":[]}`** |
| `git diff --check` | **Passed**; only Windows line-ending notices |

The tests cover unmatched positive holds and HELD postings failing at commit; both ordering variants of matching writes; zero-then-positive holds; reserve/release across auctions; outer-transaction rollback; concurrent same-key reserves/releases; original response replay after later movements; changed-key rejection; competing insufficient-balance reserves; over-release; deletion/reassignment; raw-writer serialization; repeatable-read conflict; public configuration and forged metadata producing no user/session; correct local operator login; and signed HTTPS Telegram login with local identity off. Existing bot/auth/ledger tests remain passing.

The first mobile run hit a 30-second cold dev-compilation timeout in one test. The harness now warms the auth route with an unauthenticated rejected request and gives cold-start compilation a 60-second budget; the final full run passed 8/8. The first Prisma regeneration hit Windows' loaded native DLL lock. The verified workspace dev process was stopped for the successful full build, then restarted. No dependency downgrade was needed.

Inspected screenshots: [local rejection 360](screenshots/hardening-local-mobile-360.png), [local rejection 430](screenshots/hardening-local-mobile-430.png), [public configuration 360](screenshots/hardening-tunnel-mobile-360.png), [public configuration 430](screenshots/hardening-tunnel-mobile-430.png). Local operator controls fit; public configuration has no local identity control. Additional Home/Wallet captures are in the same directory.

## Remaining risks and owner steps

1. Apply the new migration to the intended **development** database before exercising wallet code there. It takes table locks during installation and will fail if existing holds drift; investigate any discrepancy, do not bypass the guard.
2. For a tunnel, set `DEV_IDENTITY_ENABLED=false` and restart. For localhost identity, configure a private random `DEV_IDENTITY_ACCESS_KEY` and manually enter it. Never share this key or tunnel a local-identity-enabled instance. Headers alone cannot identify a trustworthy network peer in a rewritten proxy request.
3. **Real Telegram Android/iOS launch, /start/menu, and live ngrok verification remain unverified.** Bot credentials/webhook configuration were not changed and no real Telegram messages were sent.
4. **Production Supabase runtime-role grants and RLS remain unverified.** Local DB tests use the disposable owner role. The new guard table/functions need reviewed runtime grants; production credentials must not be able to disable triggers or run DDL/TRUNCATE. No deployment-readiness claim follows from these tests.
5. Future callers must lock auction before wallet, and retry an entire transaction after serialization/deadlock errors. This primitive does not validate future auction status/deadlines, bid limits or settlement policy.

Phase 2 has not started. No commit, push, deployment or production migration was performed.
