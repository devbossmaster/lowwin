# Chapa v2 validation — 26 October 2026

The implementation uses Chapa v2 hosted checkout. Actual merchant credentials are not available; creation, recovery and wallet spending remain explicitly disabled by default. No production migrations, customer balance changes, live charges or deployment were performed.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Financial/API/client regression subset | 188/188 passed, no skips | Fresh loopback PostgreSQL; includes 9 additive schema and 19 Chapa service/reconciliation cases, existing bid rules and payment-session revocation |
| Final Chapa database regression run | 29/29 passed, no skips | Includes permanent request-key binding after a lost response and terminal payment, for top-ups and bids |
| Provider switching/admin workspace/notification/proxy subset | 33/33 passed | Some cases overlap the preceding subset; old-schema compatibility and Support redaction included |
| Staff limiter and safe diagnostics | 49/49 passed | Includes six real-database cases; 48 concurrent login attempts permit exactly 12, and 20 password-recovery attempts permit exactly five |
| Mobile browser flows | 2/2 passed | 360px and 430px, each in English and Amharic; payment mutation responses mocked |
| TypeScript | Passed | Full project typecheck |
| Production webpack build | Passed | Isolated loopback configuration with financial switches disabled |
| Dependency audit | Zero reported vulnerabilities | No new dependencies or SDK |

Browser assertions cover disabled controls, pending payment preservation after closing/reopening, duplicate-click protection, confirmed-only balance invalidation, wallet and hosted bid receipts, and anonymous returns performing no private payment reads. Browser fixture money remains 250 ETB with no real accepted bids and zero ledger drift. Real database tests separately exercise actual financial commands with mocked provider transport, exact cents, idempotency, races and balanced receipts.

The new `node scripts/run-db-tests.mjs chapa` CI harness was also executed locally from a fresh database: both browser cases passed, and its owned server stopped and released port 3156. Remote CI is a separate result. The staff limiter suite also passed all six cases starting from a fresh database with zero tables, deploying its own migrations.

See the [integration runbook](../chapa-v2.md) for configuration, reproducible commands, six mobile screenshots, activation gates and rollback. Local checks do not establish provider acceptance, dashboard webhook delivery, physical Android/iOS Telegram checkout behavior or production query latency.

## Reported local wallet/login delays

The reported wallet request spent 14.7 seconds in application code. Read-only checks against the distinct staging database measured 2,884 ms to establish a new TLS connection and 221–236 ms per simple query. No authenticated wallet session was reused for benchmarking, so these measurements do not establish which part of that original request was slow. Wallet responses now expose separate `auth`, `ledger` and `total` Server-Timing values, retaining private/no-store headers and sanitized failure logs.

Staff limiting previously acquired an interactive transaction and ran separate lock, clock, read and upsert statements. It now uses one atomic, row-serialized SQL statement with the same database clock, fixed 15-minute window and limits. The earlier single login observation was 6,763 ms; three subsequent synthetic login checks measured 4,953, 5,127 and 4,958 ms and correctly returned 401 for the uncreated test account. This small local sample is not a controlled cold/warm comparison or p95 result. The earlier 503 was not reproduced after instrumentation; no timeout or authentication gate was weakened.

The staging test invitation must be accepted before that email has a password account. Its private setup file is ignored by Git; no credentials or invitation token are part of this report.
