# Phase 4B — results and personal pages

Phase 4B adds public settlement projections and personal read/edit pages. The Phase 4A closing worker, settlement decision proof, fee policy, journals, hold guards, lock order and immutable bid/terms records are unchanged. No deployment, admin, payments, top-ups, fulfillment workflow or notification delivery was added.

## Boundaries and behavior

- `publicAuctionSelect` is an explicit SQL selection allowlist. Public queries select only settlement outcome, winning points and completion time; they never select the proof, winning user/bid IDs, movements or settlement references. The DTO is a second allowlist. Public winner text is always **Anonymous winner**; there is no consent-verification workflow yet.
- `/winners` searches item titles/codes, filters outcome status and paginates six records at a time. `/winners/[auctionCode]` distinguishes final winner, NO_WINNER, cancellation and **Closing / result pending**. A past deadline is never interpreted as a winning result.
- Phase 2 `PublicAuctionResult` rows remain untouched and show **DEMO example**. Local accepted-bid settlements show **DEMO · settled test**. Illustrations never count as personal wins. Public previews and auction details use the same projection.
- All private data APIs authenticate Better Auth server-side and derive ownership from the session, never request user IDs. Responses, including failures, use `private, no-store, max-age=0`. The private page shells contain no account data; their data arrives through authenticated APIs. Production page caching is checked separately from Next development mode, which overrides HTML headers.
- Favorites persist by `(userId, auctionId)` and idempotent PUT sets the desired saved state. Profile PATCH accepts only bounded display name and bio fields, rejects control/format characters and unknown keys, and writes a separate `PlayerProfile`. The verified User, Telegram ID, email, phone and account linkage are never changed. Mutations enforce the configured same origin.
- My Bids has Live/History tabs, the user's own accepted amounts, final outcomes and cancellation fee refunds. Wallet activity is paginated and uses a consistent database snapshot. Profile counts/balances come from PostgreSQL; own confirmed wins display **Fulfillment pending**. No shipped prize or notification is implied.

## Migration and database scope

New migration: `202609270006_personal_pages`. It creates `PlayerProfile` and `AuctionFavorite`, ownership/auction foreign keys, composite favorite uniqueness, a pagination index, display-field bounds and RLS with anonymous/authenticated-role access revoked. Existing seven migrations were not edited.

The `.env` runtime and direct targets were identified as remote Supabase before migration. They were not changed or migrated. All eight migrations were applied only to disposable PostgreSQL databases at `127.0.0.1:55439`:

- Final combined run: `lowin_phase4b_full_catalog_test`, `lowin_phase4b_full_bid_test`, `lowin_phase4b_full_settlement_test`, `lowin_phase4b_full_personal_test`.
- Browser runs: `lowin_phase4b_browser_test`, `lowin_phase4b_browser_final_test`.
- Earlier diagnostic disposable databases with all eight migrations: `lowin_phase4b_settlement_test`, `lowin_phase4b_personal_test`. `lowin_phase4b_catalog_test` and `lowin_phase4b_bid_test` were created but have **0 applied migrations**; the initial run was interrupted.

No test database was destroyed. Published fixture schedules and Phase 2 seed result records were not reset. The browser database received the repeatable 9-category/14-auction DEMO seed; fresh test fixtures used newly scheduled auctions.

## Commands and recorded results

```powershell
$env:TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4b_full_catalog_test'
$env:BID_TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4b_full_bid_test'
$env:SETTLEMENT_TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4b_full_settlement_test'
$env:PERSONAL_TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4b_full_personal_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:DIRECT_URL=$env:TEST_DATABASE_URL
npm test
```

Combined catalog, foundation, hold, auth, bid, settlement and personal tests: **113 passed, 0 failed, 0 skipped**, 8 files, 50.70 seconds. The nine new database tests cover public allowlists/proof leakage, anonymous display, both DEMO sources, all outcome states, search/pagination, two-user isolation, accurate counts/refunds, guest rejection/no-store errors, favorite persistence across separately signed sessions, and safe profile edits. Existing tests still cover 100/101 bids, deadline lock waits, concurrent retries, multi-wallet rollback, crashes and settlement/cancellation races.

The first focused run found one test-loader dynamic-import issue (8 passed, 1 failed), fixed before the combined pass. An earlier combined run was interrupted before a result was available and is not counted as passing evidence.

```powershell
# Override both database URLs with a disposable browser target first.
npx prisma migrate deploy
npm run db:seed:catalog
npx playwright test
npx playwright test tests/browser/personal.spec.ts
npm run typecheck
npm run build
```

Full browser regression: **13 passed, 2 failed, 1 skipped** in 1.8 minutes. Both failures were a new assertion expecting `no-store` on development HTML; Next dev forces `no-cache, must-revalidate` on HTML. After checking the actual private API header instead, the targeted Phase 4B rerun passed **2/2, 0 skipped** in 1.2 minutes. Thus all 15 distinct executed browser cases have passing evidence across the full and corrective runs. The single intentional skip is the duplicate 360px carousel reduced-motion test, which runs and passes at 430px. No database test was skipped. An earlier personal-only run also used obsolete guest-screen text; this assertion was corrected.

Final `npm run typecheck`: **passed**. Final `npm run build` (`prisma generate && next build`): **passed**, all 28 listed routes dynamic. The build used explicit loopback DATABASE_URL/DIRECT_URL, fixture-only auth values, and both development identity/credit flags disabled. Raw command logs are retained locally under `.local/phase4b/`.

Automatic approval review rejected starting the local production server on loopback port 3110, reporting only **blocked by policy**. No alternate startup was attempted. Production HTTP-header verification is therefore **unverified**. Configured private-page headers and forced dynamic rendering were inspected; authenticated and guest/error private API responses were tested with `no-store`.

The Impeccable finish reviewer initially requested one scoped fix: remove the redundant wallet eyebrow. After new 360px/430px captures, it scored that fix **resolved**, disposition **ship** at fix-list scope. The single detector pass reported 208 advisory global design-token documentation findings and no higher-severity findings; no broad visual refactor was performed.

The documenter recorded the built components in `DESIGN.md`, `.impeccable/design.json` and the scoped surface brief. `PRODUCT.md` retains its historical Phase 1 context; it was not rewritten as part of this implementation.

Independent reconciliation on all four final combined databases plus the final browser database reported **0 discrepancies** in account projections/postings, HELD/auction holds, accepted bid fees, cancellation fee refunds and settlement charges. Each of these five targets has all eight migrations, latest `202609270006_personal_pages`.

## Changed files in this phase

- Schema/migration: `prisma/schema.prisma`, `prisma/migrations/202609270006_personal_pages/migration.sql`.
- Query/security modules: `src/modules/auctions/catalog.ts`, new `results.ts`, new `src/modules/profile/personal.ts`, new `src/modules/auth/private-api.ts`, `src/modules/wallet/view.ts`.
- APIs: new `src/app/api/results/route.ts`, `results/[auctionCode]/route.ts`, `profile/route.ts`, `profile/wins/route.ts`, `favorites/route.ts`, `favorites/[slug]/route.ts`; extended `api/me/route.ts`, `api/my-bids/route.ts`, `api/wallet/route.ts`.
- Pages: `src/app/winners/page.tsx`, `winners/[auctionCode]/page.tsx`, `profile/page.tsx`, new `profile/wins/page.tsx`, new `profile/favorites/page.tsx`, `profile/[section]/page.tsx`, `my-bids/page.tsx`, `wallet/page.tsx`, `faq/page.tsx`, `page.tsx`, `auctions/[slug]/page.tsx`.
- Components/styles: new `result-card.tsx`, `private-query.tsx`, `favorite-button.tsx`; updated `auction-card.tsx`, `telegram-provider.tsx`, `src/app/globals.css`, `next.config.ts`.
- Tests: new `tests/personal.test.ts`, `tests/browser/personal.spec.ts`; updated browser assertions in `bidding.spec.ts`, `local-identity.spec.ts`, `mobile.spec.ts`, `settlement.spec.ts`.
- Evidence/docs: this report, README phase status/test variables, `.env.example` test-variable documentation, screenshots listed below, scoped Impeccable surface contract and finish documentation. The checkout already contained earlier-phase changes; this list is Phase 4B only.

## Screenshots

Both 360×800 and 430×932 viewports were exercised. Each suffix below exists at `docs/screenshots/phase4b-<surface>-mobile-360.png` and `-430.png`:

`winners`, `result`, `pending`, `cancelled`, `profile`, `my-bids-live`, `my-bids-history`, `favorites`, `my-wins`, `wallet`.

The 20 full-page captures cover header, status filters, cards, balances, outcome copy, saved state and bottom navigation. They use original catalog SVG placeholders and fixture-only data. No new shipping raster assets were created. The fixed mobile navigation appears at the original viewport edge in a full-page capture; the underlying content remains scrollable.

## Remaining release work

Real Telegram-client/WebView validation is **unverified**; browser signed fixtures are not a real Telegram client. Production Supabase runtime-role privileges/RLS, deployment pooling and session behavior are **unverified**. Settlement load/capacity testing is **unverified**; functional race/crash tests are not load validation. Production HTML header verification was blocked as recorded above. No deployment occurred. Fulfillment, verified winner-consent disclosure, notification inbox/delivery, admin and point funding remain later work.
