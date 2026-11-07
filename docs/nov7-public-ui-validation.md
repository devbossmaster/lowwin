# Public entry and auction UI validation — 7 November 2026

The Home toolbar keeps the real wallet for registered players and offers explicit Log in for visitors. Its help button opens the public `/how-it-works` route. Notifications and the unread count are in Profile; the existing five bottom destinations remain. The first-visit introduction stores only `lowwin:introduction:v1=dismissed`; managed video sources mount only after Play. Missing/unplayable video leaves written instructions available.

Auction cards show recorded views from the existing batched activity channel, with no new per-card reads or change to qualified-view counting. The four countdown units retain server receipt anchors, use monotonic elapsed time against device wall-clock changes, pause hidden/offscreen intervals, and suppress resume/reduced-motion flips. Financial acceptance still uses server deadlines.

## Executed checks

- Focused countdown, introduction, tutorial, existing clock and activity tests: **18 passed**, **6 database activity cases skipped** in that unit-only invocation.
- Full TypeScript check: **passed**.
- Optimized browser baseline at `c6fe5e02d540a2b774709bfe709369775fd63120`: **4 passed** (normal/throttled at 360/430 px).
- Updated optimized UI/browser scenarios: **10 passed** (normal/throttled cached routes/sheets, public intro and lazy video failure, English/Amharic, browser Back/Escape, hidden/resumed and reduced-motion countdown, Profile unread and five navigation items).
- Explicit registration scenarios: **10 passed** at 360/430 px, including held private bootstrap, no automatic contact request, decline/unsupported clients, late callbacks, bounded server-proof polling and registered-account restoration.
- Existing bid/wallet and full authenticated screen compatibility scenarios: **4 passed** at 360/430 px on the rebuilt application. These retain bilingual and short-keyboard checks, draft restoration after top-up, disabled financial actions before merchant activation, saved-balance refresh recovery, and zero browser financial writes. Mock quote previews only price the displayed review; isolated ledger reconciliation remains clean.
- Screenshots were visually inspected for image rendering, readable tiles, badge separation, header layout and mobile overflow. Payment writes during the measured flows: **0**.

The fixture database is a separate disposable loopback `_test` database. It contains synthetic catalog/contact records. Authentication uses signed synthetic Telegram launches; wallet/alerts/provider availability are deterministic browser mocks. No live Chapa calls, production migrations or balance changes were performed by this harness.

## Observed production-build samples

Each cell is **baseline → updated**, in milliseconds unless noted, from the first completed isolated run of each revision. These are single observed samples for each viewport/network combination, not statistical guarantees. Browser caches were cleared; server, database and image caches may have been warm. Throttling uses 150 ms RTT, 1.6 Mbit/s down, 750 Kbit/s up and 4× CPU slowdown in Chrome. The logged cohort summary is preserved in `test-results/nov7-evidence/clean-summary.json`. Later query-pinned reruns have separate raw traces; their final 430 px case overlapped another local browser suite and is excluded from this comparison.

| Viewport / network | First public Home | Home with authenticated wallet | First / reopened sheet | Return to cached Home | Cold requests | Cold encoded bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 360 / normal | 3167 → 3114 | 3190 → 3138 | 58 / 28 → 59 / 30 | 328 → 332 | 53 → 54 | 471279 → 500845 |
| 430 / normal | 1218 → 952 | 1293 → 977 | 60 / 32 → 49 / 28 | 333 → 330 | 51 → 53 | 455388 → 502914 |
| 360 / throttled | 6453 → 5999 | 6791 → 6348 | 503 / 210 → 426 / 179 | 697 → 670 | 54 → 55 | 475721 → 526248 |
| 430 / throttled | 6902 → 5893 | 7452 → 6227 | 476 / 245 → 430 / 212 | 615 → 646 | 53 → 55 | 474746 → 526246 |

Normal sheet feedback met the 100 ms target in these samples. Warm route presentation remained about 330 ms normally, and the throttled first sheet remained over 400 ms, so the broader UI targets are **not all met**. Cold transferred bytes increased with the new functionality; there is no payload-reduction claim. These local timings do not measure production database, carrier, Chapa authorization/settlement, native contact consent or Telegram device latency.

`tests/nov7-browser/public-ui.spec.ts` records request paths, encoded bytes and available `Server-Timing` headers under `test-results/nov7-evidence/{before,after}/performance-*.json`, separate from Playwright's automatically cleaned run directory. It never records authorization headers or customer payloads. `playwright.nov7.config.ts` and `tests/nov7-production-server.mjs` run each already-built source revision with the same isolated configuration. Set `NOV7_SOURCE_DIR`, `NOV7_STAGE` and `NOV7_PORT` for the chosen revision; use `LOWIN_UI_TEST_MODE=chapa` for its separate optimized build. On Windows an explicitly owned server can be used with `NOV7_EXTERNAL_SERVER=1`, avoiding Playwright's slow child-server teardown. Local execution used `PLAYWRIGHT_CHANNEL=chrome`.

Real Telegram/native-contact, actual Chapa TEST delivery/authorization and production-service measurements remain separate acceptance checks.
