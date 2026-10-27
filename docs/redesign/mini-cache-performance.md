# Mini App cache and navigation verification

2026-10-27. Existing Next.js 16.4.2 / React / TanStack Query stack, approved routes and financial rules preserved. No framework migration or competitor research. Validation ran in `D:/lowin-redesign-qa/patched-deps/app`; scoped changes were copied into the main Lowwin checkout. These optimizations have not been deployed.

## Local measurements

Baseline: `3ce6ab0`. Both versions used optimized webpack builds, HTTPS loopback, Chromium at 360 x 800 and 430 x 932, signed synthetic Telegram sessions and a disposable local PostgreSQL database. Slow networking: 150 ms latency, 125 KB/s down, 64 KB/s up. Each profile starts a fresh browser context and follows the same browsing/sheet actions and Home → Winners → My Bids → Profile → Home sequence twice. The external Telegram SDK is blocked in the fixture. No financial submission is made by the measurement.

Times are milliseconds, **visible / complete data**; cold Home reports readiness only. Medians combine both widths. Completion includes the explicit breakdown-section scroll and dialog animation; navigation completion includes the same 150 ms settling window. Counts include intent prefetch and background activity.

| Measurement | Before normal | After normal | Before slow | After slow |
|---|---:|---:|---:|---:|
| Cold Home ready | 1966 | 1534 | 5446 | 5550 |
| First bid sheet | 394 / 434 | 423 / 488 | 350 / 390 | 360 / 791 |
| Repeated bid sheet | 120 / 165 | 144 / 193 | 110 / 148 | 156 / 210 |
| First result sheet | 504 / 550 | 152 / 722 | 1028 / 1064 | 138 / 784 |
| Repeated result sheet | 100 / 136 | 132 / 322 | 96 / 132 | 127 / 315 |
| First auction browser | 196 / 232 | 174 / 218 | 103 / 496 | 128 / 538 |
| Warm Winners | 102 / 465 | 106 / 673 | 80 / 899 | 94 / 924 |
| Warm My Bids | 130 / 326 | 89 / 283 | 423 / 714 | 260 / 683 |
| Warm Profile | 125 / 302 | 79 / 316 | 284 / 838 | 244 / 798 |
| Warm Home return | 424 / 610 | 255 / 460 | 434 / 632 | 424 / 623 |
| Whole flow requests | 104 | 105 | 105 | 110 |
| Recorded response bytes | 936.0 KiB | 832.1 KiB | 851.1 KiB | 1058.8 KiB |

Recorded response bytes sum Playwright's recorded body/header sizes. Some in-flight responses lack completed size samples; this is not a wire-level bandwidth-saving claim. Additional synthetic fixtures accumulated during validation, and lazy-image/background scheduling varies with navigation timing. Total bytes/counts are observations, not a controlled production bandwidth comparison. [Raw reports and summary](timings/mini-cache/summary.json).

Specific request reductions are repeatable: warm Home uses **one RSC fetch instead of three**; Home's seeded results serve Winners with **zero immediate dedicated Winners GETs**; matching unfiltered live ten-row Home batches serve compact browsing without another list GET. Every Home re-entry performs exactly **one wallet GET**, shared by readers. Settled-result and participant pages reuse their cache on reopening. Performance flows observed no overlapping duplicate API requests or JavaScript page errors.

Result previews appear before breakdown code/data finishes. Cold bid forms and complete breakdowns still incur chunk, server and animation work; completion times and total requests do not improve uniformly. Shared framework JavaScript, fonts, auth bootstrap, server queries, scheduled activity reads and images remain cold-load costs. Production latency and physical Telegram WebViews were not measured.

## Policies

| Resource | Freshness | Retention | Refresh |
|---|---|---|---|
| Settled results / breakdowns | 5 min | 30 min | Selected pages; participants only after amount selection |
| Live catalog / auction details | 15 sec | 10 min | Resume/reconnect and authoritative expiry refresh |
| Account/profile | 60 sec | 10 min | Confirmed edits and stale re-entry |
| Wallet / bootstrap / availability | 5 sec default; existing mounted wallet views use 15 sec | 60 sec | Shared forced Home re-entry and resume/reconnect; header polls every 60 sec |
| Own bids | 15 sec | 5 min | Confirmed acceptance and resume/reconnect |
| Other private data | 30 sec | 10 min | Relevant mutations and stale re-entry |

One browser QueryClient persists above customer routes and Telegram auth. Server clients have request/render lifetimes. Private keys contain verified session identity, resource path, sorted parameters and language. Server-loaded public lists seed the same resources without an immediate duplicate GET. Home metadata and activity counters share the client; auxiliary maps hold subscribers, navigation coordinates or prefetch budgets. The compatibility cache is bounded to 48 private resources and 24 concurrent reads.

Stable sheets immediately show known image/title/status/fee. Heavy forms/results load separately; breakdowns wait for visibility and participants wait for selection. Ten-auction batches and twenty-row breakdown/participant pages remain server-paginated. Sort, pages, loaded batches and scroll survive within the session. Unused selected reads cancel; obsolete identities and pre-mutation responses cannot overwrite current snapshots.

Confirmed bids refresh wallet, own bids, profile counts, relevant auctions and rewards. Confirmed credits/preserved funds refresh wallet/history, bootstrap and alerts. Profile edits and notification reads target their families. Server-originated changes, including refunds, appear through relevant refresh/poll/resume; no server push channel was added. Cached data never authorizes a charge or fabricates financial success. Private responses remain private/no-store; logout/account changes cancel and remove previous private data and view coordinates.

Route intent is capped at four destinations per ten seconds with a thirty-second repeat cooldown; speculative API reads cap at two. Save Data/2G and active critical reads suppress warming. Auction sources retain the 1840 x 800 WebP standard, responsive delivery, reserved dimensions and first-image priority. Authenticated uploads retain cookie-bound URLs. Sheet transitions use transform/opacity and reduced-motion support.

## Validation

Typecheck and optimized production build passed. **44 focused unit tests** cover reuse, scoped invalidation, cancellation, retention, private HTTP behavior, stale responses, identity isolation, navigation and wallet authority. Browser checks at both widths cover normal/slow performance, held chunks/network, retained pagination, masked participants, Home-only header, one wallet read per Home entry, notification reads, saved balances, focus/back behavior and authoritative expiry refresh. Home's streamed data now updates its mounted header without replacing an open sheet. Mechanical UI detector: zero findings.
