# Live / Upcoming auction sheet

The header auction shortcut now opens the shared bottom sheet instead of navigating away. It has a live-auction count badge, Live / Upcoming tabs, thumbnail rows, localized titles, actual submission fees, Addis Ababa schedules, local countdowns, Refresh and Close. Live cards open the existing bid sheet immediately using their known fields; missing details and private entry state hydrate independently in place. Upcoming cards are display-only and never open a bid sheet. Browse all auctions retains access to the full search/filter page. Home, the approved banner, account controls and financial behavior are preserved.

The badge counts live auctions, not submitted amounts. Public summaries and quick-list responses expose no participant identities, bid amounts, uniqueness hints or private winner data. They use the same publication, inventory visibility, schedule and pinned staging boundaries as the catalog. Counts are server aggregates; each list page contains at most ten auctions.

## Loading and navigation

- The dialog structure is already available in the header bundle and opens without waiting for API data or showing a homepage spinner.
- One small summary read supplies both tab counts. Hover, focus or touch intent prefetches only the selected first page. Constrained/save-data connections skip speculative reads.
- The existing TanStack-backed session cache owns payloads and in-flight deduplication. Opening/reopening uses those entries; no second data cache or browser storage is added.
- Tab selection, loaded-page coordinates and per-tab scroll survive closing/reopening. Page assembly deduplicates auction codes, stops at gaps and filters out the other status. Account changes reset the component and private cache.
- Refresh keeps cached rows visible and resets pagination to the first page. Errors retain saved content and offer Retry. Unknown counts remain unknown; they are not fabricated as zero.
- List rows do not start separate activity or participant requests. Countdowns run locally from the server timestamp and the cache receipt time. Summary polling is bounded to once per minute while visible.
- Live-card intent warms only that card's public details and own-entry state under the existing bounded intent budget. Header wallet data is reused. Nested Close/Back restores the list and originating card focus; no navigation is needed to bid.
- Native dialog focus containment, Escape, backdrop dismissal, Telegram/browser Back, focus restoration, safe areas and reduced-motion behavior come from the existing AccountSheet.

## Verification

Focused catalog/API tests cover pagination, fee revisions, visibility boundaries, schedules, aggregate totals, invalid status/page inputs, no-store headers, safe retry and absence of live/private breakdown fields. Focused cache/navigation/page-assembly tests cover ownership isolation, in-flight deduplication, invalidation, stale account responses, status separation and duplicate/gapped pages.

Mobile Chromium checks passed **4/4** in English/Amharic at 360px and 430px. They verify nested Live bid opening, read-only Upcoming cards, known fields before delayed detail/own-state responses, disabled payment at a deadline, cached reopening with zero extra detail/own-entry reads, close/back/focus, URL/tab/scroll restoration, navigation, pagination and privacy. Actual fixture reads and deliberately delayed/error-controlled GET cases are reported separately: [actual 360](measurements/auction-browser/auction-browser-nested-actual-360.json), [actual 430](measurements/auction-browser/auction-browser-nested-actual-430.json), [controlled 360](measurements/auction-browser/auction-browser-nested-controlled-360.json), [controlled 430](measurements/auction-browser/auction-browser-nested-controlled-430.json).

The checked-in release harness reproduction passed **63/63, zero skipped**, covering the previously failing catalog/referral/result suites and new quick-list API checks. Cache/page/intent checks passed **34/34**. Typecheck passed in the validation checkout. The final optimized build runs in GitHub Checks before merge. [Sanitized validation](measurements/auction-browser/validation.json).

Representative captures: [Live 360 English](screenshots/auction-browser/auction-browser-actual-live-360-en.png), [Live 430 Amharic](screenshots/auction-browser/auction-browser-actual-live-430-am.png), [Upcoming 360](screenshots/auction-browser/auction-browser-actual-upcoming-360-en.png), [Upcoming 430](screenshots/auction-browser/auction-browser-actual-upcoming-430-am.png). The [controlled 360](screenshots/auction-browser/auction-browser-live-360-en.png) and [controlled 430](screenshots/auction-browser/auction-browser-live-430-am.png) fixtures show dense lists independently of current inventory. These are local synthetic fixtures, not customer/winner proof or physical Telegram measurements. No production speed gain is claimed from these checks.

GitHub's earlier integration run exposed isolated-test setup gaps: referral/result suites lacked their own migrated databases and synthetic bot/contact configuration, and their fixtures contaminated catalog baseline counts. The test harness now assigns those suites dedicated loopback `_test` databases and runs their migrations before fixtures. Browser referral tests now create their own actual earned fixture reward instead of depending on ignored local files; legacy screen assertions follow the approved Profile and disabled Wallet/Chapa UI. No application authentication, ledger policy, checks or assertions were weakened to fix the setup.

The old full-screen auction drawer and unused popover styles are removed. The previously retired customer menu/page components stay removed, with small compatibility redirects retained for existing links and owned payment recovery. Historical financial/identity records and canonical legal pages are retained.

No schema migration, hosted database mutation, production funding activation, provider call or financial submission is part of this UI update. The existing referral migration and Chapa/payment release gates remain in [Profile/referral rollout](profile-referrals.md) and [release procedure](release.md). Merging source does not execute that migration or enable a payment flag.
