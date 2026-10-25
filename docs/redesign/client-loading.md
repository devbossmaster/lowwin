# Lowwin client loading and My Bids

25 October 2026. This follow-up preserves the approved customer shell, financial commands and frozen auction rules. It reuses the installed TanStack-backed private query layer; no dependency or competing payload cache was added. The separate Wallet/Chapa payment controls remain explicitly unavailable pending their server integration.

## Behavior

- Auction sheets render the card's title, image, disclosed fee and terms immediately. Own-entry details and wallet reads run independently; only unknown fields have small placeholders. Refresh errors keep committed display data and offer Retry. Accepted My Bids rows open their receipt directly without a detail request.
- Home, Winners and personal-page navigation reuse loaded resources. Session-only view coordinates retain the exact filters, loaded Home batches, My Bids page and scroll. These coordinates hold no response payloads and clear with the private user/session cache.
- Winners uses a lightweight route shell and `/api/results/winners?page=N` through that same cache. Its authenticated no-store handler reuses the existing finalized-winners service with twelve records per page. Returning to fresh cached pages avoids repeating the list read; stale refreshes keep visible content. The first visit shows a compact status while data arrives.
- Pointer, focus and touch intent share a four-target/ten-second budget, a thirty-second repeat guard and at most two concurrent speculative API reads. Save Data and slow-2G/2G skip warming. Actual destination requests remain available and join an existing in-flight request. No auction/participant fan-out is performed.
- Home starts with ten server-loaded auctions. Card, category and sort links no longer trigger viewport-wide route prefetching. Passive activity polling changes from two to fifteen seconds, with immediate visibility, focus, online, deadline and confirmed-mutation refresh. View recording no longer causes a redundant activity read.
- Countdown ticks remain local and use the server timestamp plus its client receipt age, including the first frame of a cached remount. No per-second API poll is added.
- The banner is prioritized, and the first product is eager/high priority; lower product images remain lazy. The known public preview raster uses responsive image optimization. Uploaded media retains its existing delivery/authorization path. Existing aspect-ratio containers reserve image space.
- Existing sheet motion remains intact. Scoped button feedback takes 150ms and fine-pointer card feedback 200ms, with at most one pixel of movement and reduced-motion support.

Private payloads remain bounded to the authenticated user **and session**, with no browser storage. Authorization failures/account changes clear them, and generation/request guards reject stale completions. Authenticated HTTP reads retain private/no-store behavior. Confirmed financial mutations invalidate the authoritative reads; cached displays never authorize money, eligibility or bid acceptance.

## My Bids and banner

My Bids now shows global accepted-entry Total, Active and Won counts, newest-first cards, twenty records per page, and separate auction/payment statuses. Failed checkout attempts do not count as accepted entries. Payment labels derive from owned ledger/provider evidence; unsupported methods/references are omitted. Empty, end, refresh-error and Retry states support English and Amharic.

The requested localized banner artwork keeps the existing family scene and complete Lowwin logo. Existing buttons remain HTML controls. Exact accessible headline/supporting copy is retained in HTML; the visible duplicate overlay is removed. See [asset provenance and copy](../../public/images/HOME-BANNER-SOURCES.md). Generated Amharic glyphs still require native copy review before release.

## Measurement method and limits

The baseline is immutable commit `98266020061cbff706ff2d534c244fe879ce3a8b`. Both versions use optimized webpack builds, HTTPS loopback, disposable PostgreSQL, synthetic signed Telegram launches, normal browser HTTP caching, and 360×800 / 430×932 viewports. The external Telegram SDK is blocked in this controlled fixture. The slow profile uses 150ms latency, 125KB/s download and 64KB/s upload.

Sheet **visible** and **complete-data** times are separate. Navigation `completeDataMs` includes a 150ms settling wait and is not an exact data-ready metric. Each connection/width has one first opening and two reopens, plus two navigation loops; these small samples cannot establish p95 or a production/device guarantee. Baseline My Bids defaults to Active while the new default All renders twenty accepted records, so those page payload timings are not equivalent API benchmarks.

Home launch observations include variable server/image-optimizer cache state. The fixture shares one product photograph; it does not measure a real inventory's image diversity. The resource collector omits `/_next/image` byte totals, so no total-image-transfer saving is claimed. Authenticated upload derivatives, production database/provider latency, physical Android/iOS Telegram and external tutorial playback remain separate checks.

The [REA observation report](../research/onebid-client-loading.md) distinguishes guest public evidence from unobserved authenticated behavior. No competitor research was repeated for the final optimization request.

## Focused validation

The focused checks cover query deduplication, delayed responses, session/account isolation, mutation invalidation, bounded/Save Data prefetching, encoded filter URLs, cached countdown age, image priority and supported payment copy. The new Winners handler/cache checks also reject unauthenticated reads, unsupported filters and page sizes, duplicate pages and raw database errors. Existing staging visibility checks retain finalized-only/demo restrictions.

The separate isolated PostgreSQL suites passed thirteen personal/result cases and three My Bids cases. They verify global accepted-entry counts independently of pages, 20+7 records, failed-attempt exclusion, actual owned payment evidence, route ownership and private headers. Read-only reconciliation returned no discrepancies. These were console-verified runs; no standalone database JSON report is claimed.

The delayed-sheet browser checks at both widths hold the real wallet/detail requests, verify immediate card fields and small unknown-field placeholders, reopen while requests are pending, switch selection before a response returns, and restore focus. No financial POST is made.

Typecheck passed in both checkouts and the final optimized webpack build passed. The distinct focused suites passed 71 loading/query/API/copy/image cases, five staging-result visibility cases, and the sixteen isolated PostgreSQL cases above. No full test suite was run. [Final two-width performance/Winners run](measurements/client-loading/validation.json) passes, including normal/slow connections, fresh repeat list reads, twelve-per-page disjoint result IDs, anonymous 401, private/no-store headers and live-fixture exclusion. The [preceding eight-case regression](measurements/client-loading/validation-prior-eight.json) covers My Bids EN/AM accuracy, empty/retry states, receipts, focus/reduced motion and exact Home return; unchanged screens were not redundantly rerun afterward.

## Measured before and after

All times are milliseconds from the controlled browser run described above.

| Viewport / connection | First Home before → after | First auction sheet visible | Sheet complete data |
| --- | ---: | ---: | ---: |
| 360 / normal | 4121 → 2691 | 1055 → 272 | 1122 → 477 |
| 360 / slow | 5534 → 5374 | 1007 → 207 | 1050 → 281 |
| 430 / normal | 1724 → 1470 | 541 → 201 | 622 → 263 |
| 430 / slow | 5534 → 5487 | 999 → 200 | 1076 → 278 |

Startup requests changed from 53–55 to 38–39, with route payload requests **13 → 2** and first-sheet route requests **4 → 0**. Entire observed-flow JavaScript transfer was 261,288 → 255,716 bytes and font transfer 73,360 → 58,196 bytes; these are not first-load bundle-size measurements.

Repeated sheet openings made **zero additional bid-detail GETs in both versions**. Observed repeat visibility was 103–145ms before and 161–178ms afterward, including automation/actionability and animation overhead; no warm-opening speedup is claimed. Exact concurrent duplicate API reads were zero in both measured flows; held-request tests establish the new selection/reopen behavior separately.

New Winners first/fresh-repeat list requests are **1 → 0** in every profile. First/repeat visible navigation was 505/105ms and 499/118ms on normal 360/430 connections, and 1009/466ms and 1001/470ms on slow connections. Framework route/auth round trips remain. Both Home navigation rounds preserve the filter URL, all twelve loaded cards and **zero scroll delta**, versus losing them at baseline (3,202/3,445px scroll delta). The final five-second background window contains only two legitimate viewport view-recording POSTs, with no activity poll, script, image or route fetch in that window; baseline had three or four API requests.

Slow Home launch remains approximately **5.4 seconds**. These data demonstrate faster first-sheet visibility and request reuse; they do not establish a production launch or p95 improvement. [All four profile measurements](measurements/client-loading/comparison.json), [baseline 360](measurements/client-loading/before-360.json), [baseline 430](measurements/client-loading/before-430.json), [final 360](measurements/client-loading/after-360.json), [final 430](measurements/client-loading/after-430.json), [My Bids 360](measurements/client-loading/my-bids-ui-360.json) and [My Bids 430](measurements/client-loading/my-bids-ui-430.json) retain the sanitized observations.

## Mobile captures

All captures use synthetic loopback fixtures, not customer/winner evidence. The before/after return images show the outcome of navigation: the baseline returns to the top and loses the selected list; the final screen returns to the saved card. They are **not** matched top-of-Home design comparisons.

| Screen | 360px English | 430px Amharic |
| --- | --- | --- |
| Home | [Open](screenshots/client-loading/home-360-en.png) | [Open](screenshots/client-loading/home-430-am.png) |
| Auction sheet | [Open](screenshots/client-loading/auction-sheet-360.png) | [430px English](screenshots/client-loading/auction-sheet-430.png) |
| Winners | [Open](screenshots/client-loading/winners-360-en.png) | [Open](screenshots/client-loading/winners-430-am.png) |
| My Bids | [Open](screenshots/client-loading/my-bids-360-en.png) | [Open](screenshots/client-loading/my-bids-430-am.png) |
| Bid receipt | [Open](screenshots/client-loading/my-bid-detail-360-en.png) | [Open](screenshots/client-loading/my-bid-detail-430-am.png) |
| Baseline navigation return | [360px](screenshots/client-loading/before-return-360.png) | [430px English](screenshots/client-loading/before-return-430.png) |
| Final navigation return | [360px](screenshots/client-loading/after-return-360.png) | [430px English](screenshots/client-loading/after-return-430.png) |

Reviewed task files were synced into the C: working folder with scoped backups; its pre-existing omitted banner caption was preserved. D: remains the authoritative PR checkout. No unrelated C: files were reset or bulk-staged.

## Release and rollback

This follow-up has no schema migration, production data change, payment activation or new financial command. Rehearse the changed navigation, back/focus behavior and both languages on the staging bot, then compare API errors, launch latency and read-only wallet reconciliation before a separately reviewed canary. Roll back the follow-up web revision if needed; preserve the patched dependency versions, existing payment/settlement workers, all financial evidence and the disabled payment switches. See the [full release procedure](release.md).
