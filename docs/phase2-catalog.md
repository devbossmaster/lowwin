# Phase 2 catalog preview

The catalog migration `202609270002_catalog` extends the original `Auction` table; its `id`, `code`, and `AuctionHold` relationship remain in place. It adds categories, products, original-image records, immutable versioned terms, and immutable public result records. Published auction status, timing, range, fee, 100-distinct-bid cap, condition and fulfillment information are explicit. Status in public reads is derived from database time so a listing whose end has passed is not shown as live.

Public pages and `/api/catalog/auctions` use the same PostgreSQL read model. The JSON projection explicitly selects public fields and omits holds, wallet data, live bid amounts, uniqueness hints and bidder identities. Auction detail has no bid mutation. Authenticated account actions still use the verified session boundary from Phase 1.5.

The repeatable `npm run db:seed:catalog` command only accepts a loopback database ending `_test`. It creates nine categories and 14 DEMO auctions (eight live, three upcoming, three closed at initial seed time), including three illustrative DEMO result records. It seeds no Animals listing. Original vector illustrations live in `public/catalog/`; no third-party images or unverified retail claims are used. Re-running the seed creates no duplicates and does not reset published schedules or immutable terms.

Validation used the disposable PostgreSQL database `lowin_catalog_test` on loopback port 55439:

| Command | Result |
| --- | --- |
| `npx prisma migrate deploy` | Four migrations applied, including Phase 1.5 and catalog |
| `npx prisma migrate status` | Database schema up to date |
| `npm run db:seed:catalog` | 9 categories, 14 auctions; idempotent rerun |
| `npm test -- --reporter=dot` with `TEST_DATABASE_URL` | 72 passed across 5 files; includes catalog and Phase 1.5 hold/ledger tests |
| `npm run wallet:reconcile` | `reconciled: true`, no drift |
| `npm run typecheck` | Passed |
| `npm run build` | Passed after stopping the local dev process that locked Prisma's Windows DLL |
| `npx playwright test --reporter=line` | 8 passed at 360px and 430px, including public-tunnel identity denial |
| `npx playwright test tests/browser/mobile.spec.ts -g 'featured carousel' --reporter=dot` | 1 passed, 1 skipped by project: manual controls, ~4-second advance and reduced motion |

The first full database run had one 20-second timeout in the existing local-identity persistence test. That file passed on rerun, and the next full run passed 72/72. The first final build attempt encountered a Windows DLL file lock held by the local Next dev server; stopping that local process and rerunning the build passed.

Visual captures: [Home 360](screenshots/catalog-home-mobile-360.png), [Home 430](screenshots/catalog-home-mobile-430.png), [Auctions 360](screenshots/catalog-auctions-mobile-360.png), [Auctions 430](screenshots/catalog-auctions-mobile-430.png), [Detail 360](screenshots/catalog-detail-mobile-360.png), [Detail 430](screenshots/catalog-detail-mobile-430.png), [Winners 360](screenshots/catalog-winners-mobile-360.png), [Winners 430](screenshots/catalog-winners-mobile-430.png). Header, carousel, cards, countdown and fixed safe-area navigation were checked without horizontal overflow.

This is a read-only DEMO catalog. Real Telegram Android/iOS WebView behavior, production Supabase roles/RLS, real inventory and fulfillment, and deployed operation remain unverified. Phase 3 must add authenticated bidding; settlement remains later work. No deployment or live bot configuration was changed for this phase.

Only the disposable loopback database received the catalog migration. The repository's pre-existing `.env` database does not yet have the `Category` table, so its local port-3000 server was stopped after validation; pointing this build at that database requires a separately reviewed migration. No remote schema was changed.
