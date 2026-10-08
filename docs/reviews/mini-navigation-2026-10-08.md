# Mini App loading and repeat-navigation review — 8 October 2026

Implemented locally in the Lowwin checkout. No deployment, production database changes, real payments, or Telegram messages were performed. The GojoGames checkout was not edited.

## Changes

- Retained the shared AppShell, TelegramProvider, header, bottom navigation, public/Redis caching, framework version, and server financial validation.
- Updated route-shaped skeletons for grouped/filtered catalog views, personal bid cards, profile, wallet, and bid details. Loading stays inside the main content area; admin/auth overlays and mutation-button progress remain separate. Reduced motion disables shimmer.
- Removed the search/status/category/sort form from /auctions/all. Status tabs and supported URL filters remain, including category-scoped View all links.
- One authenticated in-memory query cache: 48 LRU entries, 24 current-generation in-flight requests, 10-minute retention, deduplication, and endpoint-specific freshness (15 seconds for wallets/bid quotes, 60 seconds for profile, 30 seconds otherwise). Query keys normalize parameters and support language. Current bilingual responses carry both languages.
- Cache identity includes a non-secret fingerprint of the server session ID as well as the user ID. Identity/session changes and authorization failures clear data; obsolete success/error responses cannot repopulate or revoke a newer session. No private cache is stored in localStorage, sessionStorage or a server cache.
- Mutations mark cached snapshots stale, retaining visible content while relevant mounted queries refresh. Confirmed bids, deposits, favorites, alerts and profile updates invalidate affected private views. Server checks still authorize every bid/payment operation.
- Warm personal-route loading boundaries reuse the real page components and the same cache, avoiding a second skeleton during the Next RSC handoff. That brief transition snapshot is inert so it cannot submit a mutation before the real route is ready; the shared header/navigation remain usable. Public pages retain their existing Next/server caching.
- Browser URL state now preserves personal pagination and bid/wallet tabs for Back navigation. Selected navigation links prefetch on hover, keyboard focus or touch, not every private API endpoint.
- Fee-change retries force a fresh quote. Lost-response retries keep the entered amount and request key.

## Measured navigation

Windows, headless Edge, optimized Next 16.3.6 Webpack builds, loopback HTTPS, disposable PostgreSQL 17 databases. These are individual local observations, not network/device performance guarantees. Timing starts at the click and ends when the target content is visible; warm results include the read-only transition snapshot, not necessarily completion of the RSC request.

| Navigation | Before visible | After visible | Private API requests before / after | Total requests before / after |
| --- | ---: | ---: | ---: | ---: |
| First My Bids visit | 903 ms | 853 ms | 1 / 1 | 7 / 7 |
| Warm My Bids return | 342 ms | 60 ms | 0 / 0 | 1 / 1 |
| Warm Profile return | 419 ms | 50 ms | 0 / 0 | 1 / 1 |

Each measured warm return still made one Next RSC request. The existing cache already avoided fresh private API requests; this change removes the visible route-loader flash. Before: one transient main skeleton. After: zero. Cold visits had one main loading skeleton, never two simultaneous full-page skeletons. Raw results are in [the JSON evidence](mini-navigation-2026-10-08.json).

## Verification

- Typecheck passed. Final production build passed, including TypeScript and static generation. The isolated build emitted a workspace-root warning because its temporary source copy shared the existing node_modules; there were no compilation failures.
- 52 relevant tests passed: private cache (10), Mini App auth client (9), browser server shutdown (3), bids on disposable PostgreSQL (13), submission-fee rules (8), consecutive bid limits (4), public data cache (3), media cache (2).
- Cache regression tests cover bounded entries/pending requests, canonical filter/page/language keys, stale snapshots, mutation invalidation, session rotation, obsolete responses and late authorization failures.
- Production browser checks: 360 px, 430 px and 1280 px; zero document overflow on checked screens; English/Amharic; reduced motion; keyboard navigation; cold skeletons; warm returns; browser Back retaining the History tab.
- Delayed old-account profile response was released after switching to another account in the same tab. Only the new account appeared.
- Simulated 503 refresh retained the saved profile with a clear refresh-error message and working Retry. Simulated /api/me 401 removed private content and returned to the Telegram entry gate.
- A real bid against the disposable fixture was committed, then its HTTP reply was deliberately dropped. Two rapid confirm clicks sent only one initial request. Retry reused the same key: two attempts, one persisted bid, one 10.00 test-credit charge. The wallet updated from 1,000.00 to 990.00 after the confirmed retry.
- Existing database tests verified stale/missing fee versions, no-maximum numbers, expired auctions, duplicate requests, concurrent overspending, immutable receipts and ledger reconciliation.
- Actual private HTTP responses from /api/me, /api/profile, /api/wallet, /api/my-bids and /api/alerts were private, no-store, max-age=0.
- Browser navigation from /auctions and /categories/[slug] reached /auctions/all with supported filters. Category View all live preserved category and status=live. Streaming redirects may initially report HTTP 200 before the browser applies the redirect.

## Screenshots

- [Profile skeleton, 360 px](../screenshots/navigation-2026-10-08/profile-skeleton-360.png) / [content](../screenshots/navigation-2026-10-08/profile-content-360.png)
- [Wallet skeleton, 430 px](../screenshots/navigation-2026-10-08/wallet-skeleton-430.png) / [content](../screenshots/navigation-2026-10-08/wallet-content-430.png)
- [Live auctions, 360 px](../screenshots/navigation-2026-10-08/auctions-live-360.png) / [430 px](../screenshots/navigation-2026-10-08/auctions-live-430.png) / [desktop](../screenshots/navigation-2026-10-08/auctions-live-desktop.png)
- [Grouped auctions](../screenshots/navigation-2026-10-08/auctions-grouped-430.png), [bid confirmation](../screenshots/navigation-2026-10-08/bid-confirm-360.png), [Amharic profile](../screenshots/navigation-2026-10-08/profile-amharic-430.png), [saved content after refresh failure](../screenshots/navigation-2026-10-08/saved-profile-refresh-error-360.png)

## Limits

The supplied screenshots were available; an accessible reference video was not. Native Telegram WebView Back/keyboard behavior, physical-device network conditions and actual payment processing were not tested. Expiration was verified with an injected authorization failure; deleting a database session during an earlier browser check did not complete that assertion before the harness timed out, so it is not reported as a verified natural-expiry test. Public-route instant returns remain governed by existing Next client/server caching; the explicit cached-content handoff covers personal screens. A browser launch/new document intentionally starts a new in-memory cache. Wallet fixtures had deposits disabled; the enabled real-payment flow was not exercised.

The review services use only loopback disposable data and are shut down after capture. Source changes and screenshots are left uncommitted for review.
