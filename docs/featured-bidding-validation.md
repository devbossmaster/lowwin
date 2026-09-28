# Featured bidding, retry screen and typography — 2026-09-28

## Delivered

- Home Featured section: image-led white card, DEMO label, favorite, published fee/code, a larger 15px burnt-orange countdown, bid amount stepper, confirmation dialog and auction-details link. Primary actions use the existing lime Place a bid color.
- Confirmation shows the bid, previous/new maximum hold, extra reservation, fee, newly unavailable amount, projected remaining balance and remaining submissions. Explicit agreement is required. The existing private bid endpoint remains authoritative; no optimistic debit or success is displayed.
- Bid drafts and confirmations pause the carousel. Submission blocks duplicate taps and Escape dismissal; interrupted requests preserve their idempotency key for retry. Identity changes remount the private form. No public activity counts or uniqueness hints were added.
- Sonner 2.0.8 supplies success/error toasts for Featured bids, detail-page bids and favorites. Critical errors remain in the form. Other existing notification/inbox behavior is unchanged.
- Retry/Telegram entry background and Telegram chrome match loading: `#6D9410`.
- Global Poppins 400/500/600/700 uses local WOFF2 files totaling 31,480 bytes. Existing Ethiopic font remains the Amharic fallback. License/source accompany assets. No external font request is required.

## Files

`src/components/featured-carousel.tsx`, `featured-carousel.module.css`, `featured-bid.tsx`, `home-banner.module.css`, `mini-notice.tsx`, `bid-form.tsx`, `favorite-button.tsx`, `telegram-entry.module.css`, `telegram-provider.tsx`; `src/app/(mini)/page.tsx`, `(mini)/layout.tsx`, `src/app/layout.tsx`, `globals.css`; `public/fonts/poppins-latin-{400,500,600,700}.woff2`, font source/license; package manifest/lock; focused browser tests. Earlier translation/header edits in the checkout were preserved.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `BID_TEST_DATABASE_URL=postgresql://lowin_test@127.0.0.1:55440/lowwin_featured_bid_test node node_modules/vitest/vitest.mjs run tests/bids.test.ts`: **13 passed, 0 skipped**, 61.35 seconds. Includes signed/guest requests, fee/hold math, limits, duplicate amounts, concurrent retries, rollback, deadline lock wait, privacy and reconciliation (`[]`, no drift).
- `node node_modules/@playwright/test/cli.js test tests/header-browser/featured.spec.ts tests/header-browser/home-hero.spec.ts tests/header-browser/header.spec.ts --config=playwright.header.config.ts --grep 'featured|lost replies|reduced motion|401 retry|real-response|AM and EN'`: **12 passed, 0 skipped**, 1.1 minutes, both 360x800 and 430x932. Covers accepted receipts, confirmation agreement, header balance refresh, invalid/duplicate/insufficient bids, lost-response retry keys, pending submission dismissal, paused/reduced-motion carousel, language switching, header links, funding restrictions and retry screen. Browser account/bid responses are explicit mocks; database tests exercise the real command separately.
- Production build: `node node_modules/next/dist/bin/next build`, with DATABASE_URL and DIRECT_URL explicitly set to the loopback test database: passed compilation, TypeScript and all page generation.
- `git diff --check`: passed (line-ending warnings only).
- Browser font inspection confirmed Poppins is actually loaded from local assets; retry background computed to RGB(109,148,16).
- An earlier browser run had two screenshot-locator failures after changing to Amharic; corrected the localized locator and reran successfully.

## Screenshots

- [Featured 360](screenshots/featured-360.png), [Featured 430](screenshots/featured-430.png)
- [Confirmation 360](screenshots/featured-confirm-360.png), [Confirmation 430](screenshots/featured-confirm-430.png)
- [Amharic 360](screenshots/featured-am-360.png), [Amharic 430](screenshots/featured-am-430.png)
- [Retry 360](screenshots/telegram-retry-simple-360.png), [Retry 430](screenshots/telegram-retry-simple-430.png)

## Database and release boundary

Only disposable loopback databases were used. The preview received 8 live and 8 upcoming labeled DEMO fixtures under batch `featured-preview-20260928`; no live Animals fixture. Bid tests applied existing checked-in migrations to a new disposable database. No migration was added or edited, and no staging/Supabase database was migrated or seeded by this work.

Real Telegram phone/WebView interaction and production/Supabase permissions were not retested. No deployment. Full Mini App translation and unrelated historical phase work were outside this focused finish.
