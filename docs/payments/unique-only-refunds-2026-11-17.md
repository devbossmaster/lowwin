# Unique-only auction policy and cancellation refunds

The current policy is `lowest-unique-v5`. At least two eligible participants are required. The lowest accepted number used exactly once wins. If every number is repeated, the decision is `NO_UNIQUE_BID` and the auction is cancelled. Choosing a number does not reserve or charge that number's value. Consecutive numbers are allowed; the separate limit remains 100 distinct numbers per participant, with at most two decimal places.

## Activation and historical evidence

`202611180001_unique_refunds_v5` is additive. It records a full original terms snapshot in `AuctionPolicyTransition`, then changes unsettled draft, scheduled and live auctions from v1–v4 to v5. An `AuctionControlRevision` records the policy change. Existing accepted bids, payment receipts, fee revisions, journal postings, acceptance order values and completed historical results stay unchanged. This includes completed historical repeated-number winners. Old v1 bids retain their original null acceptance order; v5 does not use acceptance order as a tie breaker.

New terms default to v5 in Prisma and PostgreSQL, and admin creation selects v5. The former `auction:fee-only` converter is retired and throws instead of reinstating v4. The terms guard permits only the audited migration transition; it does not disable immutable financial triggers.

## What a cancellation returns

Refunds use immutable funding evidence for each accepted bid, rather than the current auction fee. `AuctionBidFunding` reads the original `BID_FEE` fee posting, the corresponding `REFERRAL_DISCOUNT` posting and original `DepositBonusUse` rows. Fee revisions and discounts therefore retain their original amounts.

- Actual cash paid returns to available wallet cash.
- Promotional funding returns to the original bonus lot while its original expiry is still in the future.
- Promotional funding whose original expiry has passed returns to issuance, rather than becoming spendable bonus or cash. The private receipt exposes this amount separately.
- Coupon discounts create no refundable cash or bonus. Referral coupons remain subject to the existing 5–15 percent product constraint; a 100 percent referral coupon is rejected.
- Legacy reserved holds release through a separate `HOLD_RELEASE` operation. They are not counted twice as a submission-fee refund.

A successful auction retains its disclosed submission fees. A zero-paid fee creates no credit journal. A provider payment confirmed after closure without an accepted bid follows the existing late-payment wallet-credit path; it has no accepted-bid refund claim.

## Commit, recovery and delivery

Settlement uses the database clock and the frozen exclusive cutoff `acceptedAt < endsAt`. Its transaction commits the decision and one immutable `AuctionRefund` intent per participant or nonzero legacy hold. The result may publish while refunds are pending; publication is not evidence of a wallet credit.

The existing auction worker processes one refund wallet per transaction. It locks the intent and auction with `FOR UPDATE ... SKIP LOCKED`, acquires the wallet advisory lock, creates ledger and bonus-restoration evidence, releases any hold and marks completion in the same transaction. A crash before commit rolls the work back; committed intents cannot be replayed. Unique settlement/user, operation and bonus-use constraints reject duplicate effects. A worker iteration also services bounded publication recovery and a due auction, so a refund backlog does not consume the entire closing queue.

`AUCTION_FEE_REFUNDED` is enqueued only with a committed credit. Its final notification gate rechecks recipient-bound completed refund, matching cancelled settlement, operation and journal evidence before Telegram HTTP. Cancellation messages describe automatic processing without claiming completion. Private My Bids and transaction views expose committed cash, restored bonus and expired bonus separately; pending fees refunded remain zero.

The additive guards validate unique-only winner proofs, participant and cutoff counts, actual refund funding, the completion transaction, allowed ledger destinations and original bonus expiry. Reconciliation checks refund journal evidence and restored bonus projections in addition to generic ledger balances.

## Validation and measurement

Scoped database checks cover current settlement/refunds, audited historical transitions, v3/v4 behavior, Direct batches, the cent upgrade and private refund projections. Coverage includes concurrent settlement/refund workers, rollback after ledger work before commit, mixed cash/bonus/coupon funding, historical fee revisions, original bonus expiry, zero-paid fees, a non-UTC database session, proof tampering and mocked late Inline payment confirmation. The current range regression accepts all 100 numbers from 1.00 through 1.99 in one real-auction wallet batch, rejects a 101st distinct number and excess decimal precision, and settles with no consecutive-number limit in its v5 proof. A focused follow-up confirms that a 70 ETB fee funded by 50 expired promotional ETB and 20 cash reports only 20 as refunded spendable value in the private bid DTO.

`scripts/benchmark-unique-refunds.ts` is guarded to explicit loopback `_test` databases with live payments disabled. It uses real synthetic batch purchases at 10, 100 and 1,000 bids, with three samples per size and two or ten refund recipients. It separates committed decision time, publication time and serial one-wallet refund completion. The JSON artifact records raw samples, p50/p95 and slow query prefixes. These are local database measurements; provider, Telegram and browser refresh latency are separate measurements.

| Accepted bids | Refund wallets | Deadline to committed decision p50 / p95 | Publication p50 / p95 | Decision to all refunds p50 / p95 |
| --- | --- | --- | --- | --- |
| 10 | 2 | 70.7 / 117.0 ms | 22.4 / 41.5 ms | 95.1 / 106.8 ms |
| 100 | 2 | 382.5 / 846.4 ms | 22.8 / 27.3 ms | 87.7 / 96.0 ms |
| 1,000 | 10 | 645.2 / 848.0 ms | 43.8 / 45.8 ms | 405.6 / 406.4 ms |

The decision-to-refund column includes publication, which the probe runs before refunds. In the ten-wallet samples the post-publication refund processor completed about 28 wallets per second. This exercises the same one-wallet transactions called by the worker, and excludes the worker's additional scheduler/recovery queries. Slow-query capture recorded a 341 ms funding insertion and 368–468 ms deferred constraint commit checks; the largest complete decision transaction was 829 ms.

The first combined close/publication probe contained a 59-second 1,000-bid outlier and is retained as `evidence/unique-refund-timings-baseline-2026-11-17.json`. Its timestamp gap does not distinguish queue work before settlement commit from publication work. The separated probe did not reproduce it. A later funding-query `EXPLAIN ANALYZE` returned 1,000 source bids, ten groups and expected per-bid indexed subplans, without multiplicative joined rows. Its recorded warm execution was 191 ms with no JIT section (`evidence/unique-refund-funding-explain-2026-11-17.json`). These observations do not identify the original stall or prove it eliminated. The separated probe is recorded in `evidence/unique-refund-timings-2026-11-17.json`. Three observations per size are not a production p95 estimate.

## Deployment scope

Apply all additive migrations from this release with the migration owner before starting the matching web and worker code. If the runtime role is provisioned separately, apply the updated `deploy/runtime-role.sql`; the migration also grants the new narrowly scoped table/view privileges when that role already exists. Deploy the web service and existing auction worker from the same release so the durable queue is drained. Notification delivery remains in the existing notification worker.

No production database, live payment or Telegram delivery was used for these financial tests. Keep the retired converter disabled; do not rewrite historical receipts or edit old migrations to activate the policy.
