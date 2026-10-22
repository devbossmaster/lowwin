# Local mobile verification

The final optimized build passed six Chromium browser regressions at 360×800 and 430×932. They used genuine server-side Telegram signatures, contact verification, private sessions and a fresh disposable PostgreSQL database on loopback. No production customer or financial data was changed.

The checked screens include Home, auction search/list/detail, Draws, My Bids and receipt details, Profile and its saved editor, existing wallet history, notifications, Learn More and bid sheets. English and Amharic screenshots are in `screenshots/after/`. The hero image was asserted decoded, rather than accepting a broken-image screenshot.

The final pass verifies native modal focus restoration, Escape, winner scrolling/focus, reduced motion, and a focused bid input remaining visible when the viewport shrinks to 450px. Forced authentication failure exits the spinner and Retry opens the app. A real local v4 submission charges ETB 30 from ETB 1,000, returns ETB 970, and creates no auction hold. A second actual local account with zero balance reaches direct checkout and sees its disabled production-safe state.

Files named `checkout-*-fixture` use explicitly mocked browser responses to display Telebirr/M-PESA options, pending and review states. A failed transport retry preserves the exact original phone, channel, bid number and idempotency key. The test confirms that these mocked responses create no database checkout. These screenshots are rendering/retry evidence, not provider acceptance or credited-payment evidence.

## Timing observations

Values are milliseconds, before → after. Each width has one browser timing observation per action. The API p95 rows use 20 sequential samples per endpoint and width. Per-run timing summaries are in `screenshots/{before,after}/timings-{360,430}.json`.

| Measurement | 360px | 430px |
| --- | ---: | ---: |
| Home load/render | 1,529 → 1,141 | 1,298 → 1,074 |
| Simulated slow-connection Home | 5,937 → 2,911 | 6,084 → 2,841 |
| Client navigation to My Bids | 203 → 234 | 573 → 630 |
| Accepted bid confirmation | 458 → 461 | 454 → 208 |
| `/api/me` p95 | 25 → 35 | 25 → 22 |
| `/api/alerts` p95 | 31 → 26 | 39 → 22 |
| Auction detail API p95 | 48 → 37 | 36 → 29 |
| Authenticated app shell ready | 2,222 → 1,017 | 1,227 → 962 |

The simulated connection uses Chromium network shaping: 150ms latency, 1.28Mbps download, 600kbps upload and disabled browser cache. Home is lighter in these observations; navigation and API results do not all improve. These small local samples do not establish statistical significance or a production p95.

Launch results have different server warm-up conditions: the final focus regression exercises authentication and Home before the main timing scenario. Do not describe the launch row as a proven cold-start improvement. No real ArifPay verification latency is reported because merchant payment activation remains disabled and no real provider charge was made.

## Financial and release boundaries

The full opt-in safety run passed 757 tests in 72 files with no skipped tests. It covers existing versioned bids/settlement, authorization, immutable ledger records, payment checks and the new ArifPay integration. The final local `scripts/reconcile.ts` result was `reconciled: true`, with an empty drift list; see `wallet-reconciliation.json`.

Optimized builds and typecheck passed with patched dependencies. The dependency audit reported zero vulnerabilities. Physical Android/iOS Telegram WebViews, real keyboards/notches, merchant sandbox/production payment behavior, live customer database reconciliation and production latency remain staging/canary checks in `release.md`.
