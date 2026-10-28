# Mini App performance verification — 2026-10-28

The existing Next.js 16.4.2 and TanStack Query implementation remains in place. The UI and financial rules are preserved. Loading now shows a spinner and localized “Loading…” text, without a logo.

## Changes

- Signed Mini App sessions use one indexed database query for the live session, Telegram binding, staff exclusion and contact revocation. Cookie HMAC verification uses the installed Better Auth signer. Authorization results are never retained between requests; payment transactions still reauthorize independently.
- Home starts independent public content and settled-winner reads alongside the database clock. Deadline-sensitive catalog reads still use that clock. Existing server seeds, the persistent browser QueryClient, user/session-scoped keys and resource-specific expiry policies remain intact.
- The cache-only Home observer now uses TanStack's `skipToken`, removing its missing-query-function warning.
- Chapa initialization avoids repeated contact checks and redundant checkout reads. The maintenance lock and fresh halt check remain separate statements; provider HTTP remains outside the transaction. The development command enables Node's configured environment proxy. Checkout responses include authentication/checkout `Server-Timing` values.
- Confirmed Chapa payments now invalidate payment history and top-up transactions alongside wallet/bootstrap/alerts. Confirmed bids additionally refresh own bids, auction and referral resources. A redirect or pending response never credits money.

Existing immediate card previews, lazy forms/video/breakdowns, selected participant pagination, bounded intent prefetching, responsive image delivery and hashed Next.js asset caching were checked and retained. Partial card summaries are not inserted as complete detail responses. Home retains its full header and wallet while the application query provider remains mounted across routes.

## Measured results

Read-only staging comparison: three interleaved samples against the same recent staging session and database, using the previous adapter-plus-binding path and the new joined lookup. No tokens, customer details or financial data were written to the report.

| Session lookup | Previous | Current |
| --- | ---: | ---: |
| Real database SELECT statements | 3 | 1 |
| Median staging duration | 3,297 ms | 1,148 ms |

The current staging connection still takes roughly **986–1,127 ms per warmed `SELECT 1`**; the first connection took 2,549 ms. Database/network latency remains a material bottleneck. The session improvement does not imply every endpoint or Chapa provider call takes 1.1 seconds.

Browser observations used optimized webpack builds, HTTPS loopback, isolated PostgreSQL, synthetic signed Telegram sessions and a 360 × 800 viewport. Slow networking used 150 ms latency, 125 KB/s down and 64 KB/s up. Each profile launched Home, opened/reopened sheets and navigated the same routes twice. Both observations already include the session-query optimization; they compare the subsequent Home changes. These are single runs, not production percentiles.

| Observation | Before | After |
| --- | ---: | ---: |
| Cold Home, normal | 1,071 ms | 592 ms |
| Cold Home, slow | 4,463 ms | 4,449 ms |
| First bid sheet visible, normal / slow | 338 / 357 ms | 365 / 350 ms |
| Third bid sheet opening, normal / slow | 56 / 102 ms | 77 / 82 ms |
| Repeat Home navigation, normal / slow | 79 / 353 ms | 95 / 385 ms |
| Initial requests, normal / slow | 44 / 45 | 44 / 45 |
| Initial recorded response bytes, normal | 398,985 | 399,356 |
| Initial recorded response bytes, slow | 404,905 | 404,854 |
| Whole-flow requests, normal / slow | 102 / 102 | 105 / 105 |
| Whole-flow recorded bytes, normal | 523,915 | 553,596 |
| Whole-flow recorded bytes, slow | 528,058 | 557,837 |

The extra three whole-flow requests were lazy images on the second Home return. Warm navigation and total bytes did not improve in these observations. Some in-flight responses lack recorded size samples; recorded bytes are response body/header observations, not wire-level bandwidth measurements. Synthetic catalog/result fixtures also accumulated between runs. No general bandwidth reduction or consistent cold-launch improvement is claimed. Slow cold launch remains about 4.45 seconds.

The third bid-sheet opening and reopened result sheets made **zero dedicated data requests**. Both flow measurements observed **zero overlapping duplicate API requests, zero JavaScript page errors and zero financial submissions**. Home returns preserved filters, twelve loaded cards and scroll, with one shared wallet read per entry. Raw observations are in `test-results/api-speed/before` and `test-results/api-speed/after`.

## Validation and limits

Production webpack build and TypeScript checks passed. 93 focused unit tests and 58 isolated database tests passed, including forged/expired/revoked sessions, account isolation, cancellation, stale refreshes, exact payment retries, maintenance concurrency and ledger invariants. Mobile browser checks cover 360/430 widths, held chunks and API responses, rapid sheet selection, reopening, masked participant pagination, focus/back behavior, Home restoration, delayed/failed SDK recovery and the spinner-only launch.

The final login-isolation browser check was updated from the former “Continue” label to the current “Sign in” label; the application behavior did not change for that assertion. No production deployment or production database mutation was performed for this performance work. Physical Telegram WebViews, production cold starts and a complete merchant payment remain outside these measurements.
