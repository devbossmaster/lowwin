# Phase 4A: atomic closing and cancellation

Run `npm run worker:auctions` separately from the Telegram command worker. `npm run worker:auctions -- --once` claims at most one due auction and exits. Published due auction rows are durable pending work; `FOR UPDATE SKIP LOCKED` allows concurrent workers, and a crash releases the transaction lock. Failures persist a safe error code and a five-second retry timestamp. No point amounts or participant profiles go to logs. External notification delivery is not included.

Commands lock one auction first, then all participant wallet advisory keys in ascending canonical user-ID order, then wallet guard/projection rows in that same order. They read actual PostgreSQL time after the auction lock. Published schedules and inventory identity are frozen. Direct SQL hold writes also acquire the auction lock before the wallet guard. Only immutable accepted bids with `acceptedAt < endsAt` enter the decision. Amounts are sorted numerically; the smallest count of one wins. The database repeats this decision check when inserting the result.

One transaction charges the winner's winning amount from HELD to platform SETTLEMENT, releases the winner's excess and all other holds, and stores the result, participant journal references and notification intents. NO_WINNER and zero-bid cases release every hold. Valid completed auctions retain disclosed entry fees. Original journal, nonnegative-account, accepted-count and commit-time hold guards remain active.

`AuctionSettlement` is a private immutable result separate from Phase 2's `PublicAuctionResult`. Its proof contains rule/terms versions, cutoff, accepted count, sorted amount frequencies, winner user/bid/amount or null, fee policy and per-wallet settlement references. `SettlementMovement` links charges, releases and refunds to immutable operations/journals; it cannot be appended after commit. Public queries do not select this proof. Expired pending auctions display **Closing / result pending**, without a guessed winner. Result/profile redesign remains later work.

`cancelAuction()` is internal, with no HTTP endpoint. It requires a trusted actor capability `{ id, permission: 'auction:cancel' }`, nonempty reason and UUID idempotency key. A future admin boundary must derive that capability from server-verified permission, never a browser assertion. Cancellation uses the same locks, releases all holds and compensates every charged entry fee with FEES-to-AVAILABLE journals. Original fee journals remain unchanged. Identical actor/key/payload retries return the original record; changed input and cancellation after settlement fail. Terminal auctions cannot reopen or accept more bids.

DEMO settlement requires local/test mode, a loopback `_test` database, no Vercel flag and non-production Node mode. Fresh fixtures explicitly set `isSettlementFixture=true`; old Phase 2 seeds retain false. Closing and cancellation reject existing illustrative results. Seeds never reset published schedules or overwrite examples.

## Files and migrations

- `202609270004_auction_settlement`: result and participant records, outbox links/immutability, published schedule protection, terminal and deterministic decision guards.
- `202609270005_settlement_lock_guard`: direct hold locking and transaction-bound movement insertion.
- `prisma/schema.prisma`, `src/modules/auctions/settlement.ts`, `src/modules/wallet/settlement.ts`, `holds.ts`, `ledger.ts`, `scripts/auction-worker.ts`, `scripts/worker.ts`, `package.json`.
- Minimal pending/canceled status changes in catalog queries, auction cards/detail/countdown, bid form and wallet activity labels.
- `tests/settlement.test.ts`, `tests/settlement-crash-worker.ts`, `tests/bid-fixtures.ts`, `tests/browser/settlement.spec.ts`, environment and notification documentation.

The `.env` runtime/migration targets were identified as a remote Supabase pooler before migration and were not changed. All seven migrations were applied only to new loopback databases on port 55439: `lowin_phase4_catalog_test`, `lowin_phase4_bid_test`, and `lowin_phase4_settlement_test`.

## Validation commands

```powershell
$env:TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4_catalog_test'
$env:BID_TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4_bid_test'
$env:SETTLEMENT_TEST_DATABASE_URL='postgresql://lowin_test@127.0.0.1:55439/lowin_phase4_settlement_test'
npm test -- --reporter=dot
npm run typecheck
# Use disposable runtime database and fixture environment overrides for this build.
npm run build
```

Settlement tests default to `BID_TEST_DATABASE_URL` if their separate variable is absent. Catalog tests require their own database because they assert exact seed counts. Tests are additive and create new schedules, users and keys each run.

Coverage includes the 1/2/3/4 example; all-duplicated amounts; zero/one bid; multiple unique bids by one user; numeric 2-before-10 sorting; excess winner hold; fees; concurrent workers and overlapping wallets; actual child-process exits before and after commit; retries and durable backoff; late queued bids; bid/close/cancel races; forced failure midway through closing/cancellation; immutable proof and post-commit append rejection; public privacy; and byte-for-byte preservation of Phase 2 examples.

Reconciliation checks account postings/projections, HELD/hold totals, each bid's charged fee, each cancellation refund and winner charges. Worker smoke testing processed two due disposable DEMO rows in separate invocations and then returned `idle`.

The final combined database suite passed **104 tests across seven files, with zero skipped**: 72 existing checks, 13 bid checks and 19 settlement checks. All three disposable databases report seven migrations applied and schema current. The committed six-bid example's private proof was read back: frequencies `1:2, 2:1, 3:2, 4:1`, winning points `2`, two wallet reference records, total winner charge `2` and hold release `5`. Public responses contain none of that private proof. Existing three Phase 2 illustrative result records were unchanged.

| Final command | Result |
| --- | --- |
| `npm test -- --reporter=dot` with both required database variables and the optional settlement database | 104 passed, 0 skipped, 7 files; 68.98 seconds |
| `npm run typecheck` | Passed |
| `npm run build` with disposable database and fixture environment overrides | Passed |
| `npx prisma migrate status` against each of the three disposable databases | Seven migrations; schema up to date |
| `npm run wallet:reconcile` against each disposable database | `reconciled: true`, `drift: []` |
| `npx playwright test tests/browser/settlement.spec.ts --reporter=dot` | 2 passed, 0 skipped; 360px/430px; 41.4 seconds |
| `npm run worker:auctions -- --once` on the disposable settlement database | Two invocations settled two due fixtures; third returned `idle` |

Screenshots: [Closing 360](screenshots/settlement-closing-mobile-360.png), [Closing 430](screenshots/settlement-closing-mobile-430.png), [Cancelled 360](screenshots/settlement-cancelled-mobile-360.png), [Cancelled 430](screenshots/settlement-cancelled-mobile-430.png). Pending/cancelled labels, absence of a guessed result and horizontal overflow were checked. Prisma generation initially encountered the existing local Next process's Windows DLL lock; stopping that local process resolved it.

Real Telegram Android/iOS behavior, production Supabase runtime-role/RLS privileges, production-scale throughput and external notification delivery remain unverified. No deployment occurred. Whole-auction settlement uses one transaction with a 120-second timeout; load validation is required before enabling large participant counts. Failures roll back, leaving durable work available for retry.
