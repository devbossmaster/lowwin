# Home, Winners and secure launch

24 October 2026. Review branch: `redesign/lowin-arifpay-mobile`. Production and hosted databases are unchanged.

## Customer behavior

- Home preserves the existing logo, compact account header and photographic banner. The order is main categories, horizontally scrolling sorting, live auctions in batches of ten, recent winners, then the [illustrated bidding guide](home-guide.md). A single Terms and conditions apply link replaces the separate Home footer. Category, search and sort survive pagination; duplicate auction codes are discarded.
- Bottom navigation is Home, Winners, My Bids and Profile. The header hammer opens auction browsing with Live and Upcoming tabs. Old Draws links resolve to Winners or Upcoming browsing as appropriate. Personal bids remain separate.
- Winners contains genuine completed winner settlements only. Cards reuse product imagery; there are no fabricated announcements or unconsented winner portraits. Clearly labeled QA records in these screenshots exist only in disposable local databases.
- The separately guarded [local staging preview](ui-preview-seed.md) can show labeled, committed demo settlements. Normal and production environments continue excluding demo/test-run results. [Current card styling and mobile captures](auction-cards.md).
- Learn More and results load on demand in rounded scrolling sheets. Close, backdrop, Escape, browser Back and Telegram Back dismiss the top sheet and restore focus. English and Amharic are supported.
- Learn More retains the written explanation, three steps and example when no video is configured. Optional `LOWIN_YOUTUBE_URL`, or `LOWIN_HOW_TO_VIDEO_PATH=/videos/example.mp4` (also WebM), supplies a tutorial. Optional `LOWIN_HOW_TO_POSTER_PATH` supplies a local poster. The player is created only after Play; local video uses `preload="none"`. Failed local playback leaves the written guide usable. No real tutorial URL is invented.

## Result privacy and rules

`GET /api/results/:auctionCode/breakdown` requires the existing authenticated Mini App session. It returns private, non-cacheable responses and reveals no breakdown until a public non-demo auction has a committed final settlement. Live, upcoming and unsettled auctions are rejected before bid aggregates are read.

Amount pages contain exactly twenty distinct amounts, except the last page. Sorting is numeric By amount or count-descending Most picked, with stable numeric tie ordering and a server-calculated winner jump. Participant pages contain twenty submissions. Total bids and distinct players cover the complete frozen result, independent of either page. Queries use the settlement's bid and acceptance cutoffs and verify its accepted count.

Contact decryption stays server-side. Responses contain only a masked display phone and submission time; exactly three middle national digits are replaced, for example `+251911***904`. Full phone numbers, contact ciphertext, hashes, participant IDs and names are not sent to the browser. Revoked, invalid or unavailable contact evidence becomes anonymous.

The stored settlement determines the winner. V4 numbers are displayed as numbers and are never described as money owed. Only the disclosed submission fee applies. Legacy amounts retain their own frozen rules and currency formatting. This update adds no database migration or financial command and does not change checkout, funding flags or settlement logic.

## Launch improvements and measurements

The banner fonts previously passed through authentication and returned redirects. Their exact static paths now return public cacheable assets, and only the selected language's banner font is preloaded. The persistent customer identity provider avoids the second sign-in and full document reload during `/telegram` to Home navigation. Server session/contact checks remain authoritative. The existing user-scoped TanStack cache receives the authoritative account bootstrap and deduplicates account refreshes; private cache entries are cleared on identity changes. No persistent private cache or optimistic financial success is introduced.

Optimized Chromium observations on a disposable loopback database, milliseconds:

| Viewport | Launch to Home before / after | Slow network before / after | Account API p95 before / after |
| --- | --- | --- | --- |
| 360px | 2845 / 1378 | 7208 / 4612 | 48 / 24 |
| 430px | 1856 / 1265 | 7259 / 4437 | 30 / 29 |

The SDK fixture waits 250ms. Slow transport uses 150ms RTT, 125kB/s down and 64kB/s up. Each account p95 uses twenty requests. Sign-in calls decrease from two to one; the second document request disappears. These are local observations, not production or physical-device latency guarantees. The fixture catalog changed during testing, so the table is not a controlled statistical study. Raw observations are in [timings/home-winners](timings/home-winners).

## Focused verification

- 79/79 focused tests pass, with no skipped cases: final-result pagination, exact masking and privacy, contact revocation, full counts, versioned submission-fee rules, ledger reconciliation, account-cache identity isolation, Telegram auth/entry/avatar and catalog behavior.
- Eight optimized browser checks pass across 360px and 430px: English/Amharic banner, focus, complete homepage/navigation/results flow and launch measurements. Four additional configured-video checks pass for local and YouTube poster-first transport; external playback is replaced by explicit fixtures. The final live-auctions-before-winners order is checked at both widths. Separate account-header and contact-gate checks also pass. Browser fixtures use real local command/settlement/ledger operations with synthetic signed Telegram accounts.
- Typecheck passes in both the review checkout and the user's running checkout. An optimized webpack build passes. Dependency audit reports zero vulnerabilities after patching the existing Zod dependency to 4.6.7; no new dependency is added. Preserve this patch during rollback: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- No physical Android/iOS Telegram run, production query-plan/API p95 measurement, real merchant payment, or external tutorial playback is claimed. These remain staging/device checks.

## Screenshots and release

Current screenshots: [360px Home English](screenshots/home-winners/home-360-en.png), [360px Home Amharic](screenshots/home-winners/home-360-am.png), [430px Home English](screenshots/home-winners/home-430-en.png), [430px Home Amharic](screenshots/home-winners/home-430-am.png), [Home recent winners](screenshots/home-winners/recent-winners-430-en.png), [result](screenshots/home-winners/result-430-en.png), [participants](screenshots/home-winners/participants-430-en.png), [Winners](screenshots/home-winners/winners-430-en.png), [Learn More](screenshots/home-winners/learn-more-430-am.png). Both widths for every screen are in the same folder. Prior screenshots remain in the earlier [banner report](home-banner.md) and [redesign gallery](README.md).

Use the existing [staging, canary and rollback procedure](release.md). This follow-up needs no migration or hosted cleanup. Deploy to staging with existing funding flags unchanged, check signed Telegram/contact gating, legacy links, tutorial configuration, result privacy, ledger reconciliation and real device safe areas before a canary. Record the current compatible web/worker revisions. Roll back this presentation/auth-transport follow-up by reverting its feature commit while retaining the Zod security patch and compatible payment recovery workers. Never reset records to simplify rollback. Production deployment remains a separately reviewable step.
