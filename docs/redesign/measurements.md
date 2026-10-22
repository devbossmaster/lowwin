# Local mobile verification

The original design verification at `da9625aa` (Next.js 16.3.8) passed six optimized Chromium browser regressions at 360×800 and 430×932. They used genuine server-side Telegram signatures, contact verification, private sessions and a fresh disposable PostgreSQL database on loopback. No production customer or financial data was changed.

The checked screens include Home, auction search/list/detail, Draws, My Bids and receipt details, Profile and its saved editor, existing wallet history, notifications, Learn More and bid sheets. English and Amharic screenshots are in `screenshots/after/`. The hero image was asserted decoded, rather than accepting a broken-image screenshot.

The final pass verifies native modal focus restoration, Escape, winner scrolling/focus, reduced motion, and a focused bid input remaining visible when the viewport shrinks to 450px. Forced authentication failure exits the spinner and Retry opens the app. A real local v4 submission charges ETB 30 from ETB 1,000, returns ETB 970, and creates no auction hold. A second actual local account with zero balance reaches direct checkout and sees its disabled production-safe state.

Files named `checkout-*-fixture` use explicitly mocked browser responses to display Telebirr/M-PESA options, pending and review states. A failed transport retry preserves the exact original phone, channel, bid number and idempotency key. The test confirms that these mocked responses create no database checkout. These screenshots are rendering/retry evidence, not provider acceptance or credited-payment evidence.

## Timing observations

Values are milliseconds, before → after, from the original design verification above. Each width has one browser timing observation per action. The API p95 rows use 20 sequential samples per endpoint and width. Per-run timing summaries are in `screenshots/{before,after}/timings-{360,430}.json`. These observations are not measurements of the later framework patch.

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

The original optimized builds and typecheck passed. Physical Android/iOS Telegram WebViews, real keyboards/notches, merchant sandbox/production payment behavior, live customer database reconciliation and production latency remain staging/canary checks in `release.md`.

## Framework security revalidation — 2026-10-22

A fresh dependency audit identified newly indexed Next.js advisories after the initial verification. The branch now pins Next.js 16.4.2 and its matching runtime/compiler packages, addressing the published [image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) and [Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r). This is a dependency finding; it is not evidence of exploitation. The existing Sharp 0.35.5 pin is retained.

The refreshed `security-audit.json` reports **zero vulnerabilities**, using Node.js 24.11.0 and npm 11.6.2. The repaired C: dependency installation also passes typecheck, the native Sharp WebP check, generated Prisma ArifPay delegate checks, and its fresh dependency audit. Its earlier uncommitted source is preserved; the D: PR checkout remains authoritative.

On the current framework pin, Prisma generation, standalone typecheck, the normal optimized production build and the isolated browser-mode optimized build all pass. The full opt-in PostgreSQL suite again passes **757/757 tests in 72 files**, with zero failures, skips or todos (353.85 seconds). All database work used fresh disposable loopback databases; no production migration or deployment occurred.

All **six optimized mobile browser checks** pass again, with zero skips, failures or flaky tests (80.48 seconds), covering both requested widths. Fresh wallet/payment reconciliation on that run's disposable database reports `reconciled: true` and `drift: []`. The 76 patch-regression captures are stored locally in `D:/lowin-redesign-qa/security-patch-screenshots`; `REDESIGN_CAPTURE_DIR` selects this separate output location without overwriting the original design/timing evidence. Logs are in the adjacent `security-patch-{build,browser-build,unit,browser}.log` files. Physical-device and merchant-provider validation boundaries remain unchanged.
