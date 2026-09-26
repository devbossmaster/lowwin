# Phase 1 validation — 2026-09-27

Implemented: independent Next.js foundation, mobile routes and identity states, real Better Auth/Telegram integration, grammY commands, durable webhook inbox/worker, PostgreSQL migrations with double-entry ledger invariants, local-only identity/seed, reconciliation, and an inactive provider-neutral top-up boundary.

## Recorded checks

| Check | Result |
| --- | --- |
| `npm test` with `TEST_DATABASE_URL` on isolated PostgreSQL 17, loopback port 55439 | **34 passed**; migrations applied to `lowin_test` |
| `npm run typecheck` | Passed on final typed code |
| `npm run build` | Passed initial full generation/build; a later repeat hit Windows DLL lock from an active dev server during Prisma regeneration |
| `npx next build` using the already generated, unchanged Prisma client | **Passed on final code**, including Next's TypeScript check |
| `npm run test:ui` | **4 passed**, Chromium 360×800 and 430×932; navigation, overflow, hydration and expired-launch retry |
| `npm run wallet:reconcile` against the disposable test DB | **reconciled: true, drift: []** |
| `npm audit` | **0 vulnerabilities** at validation time |
| Impeccable mechanical detector | No findings |
| Final mobile visual review | **ship within Phase 1 scope**; three listed fixes resolved |
| Secret hygiene | `.env`, local DB data and unpacked review dependency sources are ignored by Git |

On Windows, stop the development server before regenerating Prisma's native query engine; a loaded DLL cannot be replaced. No package downgrade or production DB change was used to work around this.

## Test coverage

Real pinned plugin + Prisma integration proves one opaque user for repeated/concurrent Telegram launches, session validation and HTTPS cookie flags. Unit checks reject changed hashes, expired/future timestamps, wrong bot token, missing/invalid user/data, duplicate query fields and altered signed data. Routes reject forbidden origins and unsupported auth flows. Local identity is stable and not a Telegram identity; production fixtures/dev features are rejected.

Ledger tests exercise idempotent and concurrent credits, original result replay, changed-key reuse rejection, balanced/empty journals, overdrafts, immutable records, projection bypass attempts, adding postings after commit, unique wallets and nonnegative holds. These are actual PostgreSQL constraints, not an in-memory ledger mock. Bot tests cover bad secrets, concurrent duplicate updates, /start's launch button through an intercepted grammY transport, concurrent workers and failed-delivery retry scheduling. No Telegram message was sent by the test transport.

## Screenshots

- [Home, 360px](screenshots/home-mobile-360.png)
- [Home, 430px](screenshots/home-mobile-430.png)
- [Wallet guest state, 360px](screenshots/wallet-mobile-360.png)
- [Wallet guest state, 430px](screenshots/wallet-mobile-430.png)
- Full Home captures are also in `docs/screenshots/`; a fixed bottom bar appears at its original viewport boundary in full-page captures.

## Remaining verification and scope

- No real bot configuration, public webhook, ngrok/Vercel deployment, Supabase deployment, or Android/iOS Telegram client was verified. README contains the exact environment and BotFather/setup steps.
- Successful auth uses cryptographically signed local fixtures and the real plugin/database. Browser screenshots show guest states; expired auth is browser-tested with a mocked rejection.
- Actual catalog/search/categories and bid acceptance are Phase 2/3 work. Worker closing, winner selection/settlement and cancellation/refund concurrency are Phase 4. No claim of auction readiness is made.
- Production DB role separation, host-level rate limits, inbox retention, backup/restore and operational monitoring remain release work. Telegram's external send cannot guarantee exactly-once delivery across a crash after send.
- No live top-up provider, point conversion, phone linkage, legal clearance, deployment, commit or push was performed.
