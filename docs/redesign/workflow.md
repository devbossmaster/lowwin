# Signed-in workflow follow-up

Historical checkpoint: the later [wallet retirement and admin update](walletless.md) supersedes the balance-funded bid flow and its confirmation timings described below. Cache isolation, sorting and navigation changes remain current.

The public [Onebid review](../research/onebid-public-review.md) informed the browsing and receipt flow. Lowin retains its own identity, authentication, fee-only v4 rules and ArifPay integration. Onebid's private admin design remains unverified.

## Customer changes

- Home and Browse expose Newest, Closing soon, Lowest fee and Highest fee. Fee ordering happens before pagination and uses the latest fee revision actually displayed on each card. Search, category, status and sorting survive navigation; changing a filter resets the page. Explicit old `sort=code` links still work.
- Upcoming Draws show live countdowns using the server clock, alongside the actual schedule and disclosed fee. Final-result sources and anonymous winner behavior are unchanged.
- Accepted bid receipts link directly to My Bids. The detailed receipt links to Draws or wins and payment history. English and Amharic links have 44px targets in a two-column layout.
- Ordinary actions retain muted gold; payment and fee confirmation actions retain near-black. Loading remains a small spinner with bounded requests and useful Retry states.

## TanStack beneath the existing hook

`usePrivateQuery` keeps its existing public interface and Telegram session/event contract. Its backing store now uses TanStack Query 5.104.5 for payload storage and in-flight deduplication. This is an incremental cache migration; the existing hook still owns React effects, visibility refresh and polling. It does not introduce a second payload cache or migrate authentication.

Keys include the authenticated session identity, canonical endpoint parameters and any language variant. Snapshots stay in this tab's memory, with the existing freshness, 48-entry limit and ten-minute retention. Logout, account changes and authorization failures clear the client and abort obsolete reads. Generation guards reject late responses, including an old session's 401. Reads have no automatic retry and retain the 15-second transport deadline.

Financial mutations still use the existing server commands and idempotency protection. A successful mutation invalidates private reads immediately; concurrent readers share the subsequent refresh. Saved display data may remain visible while refreshing, but it never authorizes a charge or confirms payment. No charge, credit or bid is optimistically inserted or automatically retried by TanStack.

## Deadline correction

Integration tests against the local PostgreSQL server, whose timezone is Africa/Nairobi, exposed raw catalog comparisons binding UTC dates as zoned timestamps against Prisma's unzoned UTC columns. This could make an open listing disappear from fee-sorted results or category counts. Catalog raw queries now bind ISO UTC text with an explicit `timestamp` cast. ORM and raw-query filters agree. This changes public reads only; it does not edit any deadline, published term or settlement behavior.

## Verification

The focused unit and disposable-PostgreSQL runs passed 71 distinct tests across nine files. Coverage includes session isolation, cancellation, stale responses, authorization failure, deduplication, retention, revised-fee pagination, search/category/status consistency, public response allowlists, fee-only bid replay, insufficient funds, deadline races, provider-evidence mismatches, duplicate payments and wallet reconciliation.

All eight optimized Next.js 16.4.2 browser checks pass at 360px and 430px in English and Amharic: sorting, browser Back, preserved filters, search, countdowns, receipt navigation, profile-cache reuse, spinner/retry, banner assets, notifications, profile editing, bid success and insufficient balance. Real local bids charge ETB 30 from ETB 1,000 and leave ETB 970 with no hold. ArifPay rendering tests use explicit transport fixtures; real provider calls remain disabled. [Browser results](screenshots/workflow/browser-results.json), [wallet/payment reconciliation with zero drift](screenshots/workflow/reconciliation.json) and the [zero-vulnerability dependency audit](screenshots/workflow/security-audit.json) record the final checks. Typecheck passes in both checkouts, the optimized build passes and Impeccable reports no findings in changed components.

The original before/after captures and timing evidence remain unchanged. Follow-up captures contain only synthetic users and disposable local inventory.

| View | 360px | 430px |
| --- | --- | --- |
| Fee-sorted Browse | [Capture](screenshots/workflow/browse-360-en.png) | [Capture](screenshots/workflow/browse-430-en.png) |
| Browse, Amharic | [Capture](screenshots/workflow/browse-360-am.png) | [Capture](screenshots/workflow/browse-430-am.png) |
| Upcoming Draws, English | [Capture](screenshots/workflow/draws-360-en.png) | [Capture](screenshots/workflow/draws-430-en.png) |
| Upcoming Draws, Amharic | [Capture](screenshots/workflow/draws-360-am.png) | [Capture](screenshots/workflow/draws-430-am.png) |
| Bid receipt links, English | [Capture](screenshots/workflow/my-bid-details-360-en.png) | [Capture](screenshots/workflow/my-bid-details-430-en.png) |
| Bid receipt links, Amharic | [Capture](screenshots/workflow/my-bid-details-360-am.png) | [Capture](screenshots/workflow/my-bid-details-430-am.png) |

Cache request counts and fee-sorted API p50/p95 are in [360px JSON](screenshots/workflow/cache-360.json) and [430px JSON](screenshots/workflow/cache-430.json). Current launch, Home, navigation, bid and API samples are in [360px timings](screenshots/workflow/timings-360.json) and [430px timings](screenshots/workflow/timings-430.json). These are optimized Chromium observations on loopback, not physical Telegram or production performance. Cache reuse already existed before this follow-up; these counts verify that the TanStack migration preserves it rather than proving a speedup over the old custom cache.

| Current observation | 360px | 430px |
| --- | ---: | ---: |
| Authenticated launch | 1,501ms | 1,249ms |
| Home render | 1,137ms | 1,078ms |
| Simulated slow-connection Home | 2,647ms | 2,662ms |
| Client navigation to My Bids | 615ms | 648ms |
| Accepted bid confirmation | 205ms | 192ms |
| Fee-sorted catalog API p95, 20 requests | 33ms | 36ms |
| Additional profile reads after My Bids → Profile | 0 | 0 |

Browser action rows each have one observation per width; API percentiles use 20 sequential samples. Slow Home uses 150ms simulated latency, 1.28Mbps download/600kbps upload and disabled browser cache. These observations do not establish an improvement over an identically controlled previous-cache baseline.

## Staging and rollback

This follow-up needs no additional migration or production flag. Use the existing [staging/canary/rollback procedure](release.md), deploy matching reviewed web/worker revisions, keep funding gates unchanged and check existing-customer navigation plus fresh reconciliation. Roll back this workflow commit to restore the previous cache and browse interface; retain all accepted operations and unresolved payment recovery. No customer, auction, ledger or provider record should be removed for rollback.

Production deployment, merchant sandbox/USSD acceptance, real provider latency and physical Android/iOS Telegram keyboards/safe areas remain separate release checks. No production data, live bot configuration or funding activation changed during this follow-up.
