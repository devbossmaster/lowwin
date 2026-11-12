# Wallet checkout speed and recovery — 12 November 2026

This update keeps Lowwin Wallet payment separate from Chapa, reduces the work before an internal payment commits, and automatically retrieves the original receipt when the payment response is slow or lost. It adds no migration and does not change submission fees, bid rules, wallet accounting or provider verification.

## What caused the avoidable delay

The previous client submitted a quote request and then a wallet-payment request in series. Both authenticated independently. Inside the database, quote validation, batch fulfillment and the first individual bid repeated eligibility, price, contact and auction/wallet-lock work.

The shared JSON client has a 15-second request deadline. That deadline interrupts the browser's wait; it does not prove that the server transaction failed or cancel a committed debit. Previously, an interrupted wallet response showed an uncertain state and required the user to retry the original wallet command manually. There was no automatic read-only receipt check. A retry could then return the receipt already committed by the first request.

The supplied 30.9-second recording showed an extended wallet spinner, a manual retry and then acceptance. It is consistent with this response/recovery gap, but the recording does not contain a server trace. It cannot establish whether that particular delay came from authentication, network latency, database waiting or transaction execution. No production latency or first-request server error has been inferred from the recording alone.

## Current payment path

1. A final explicit Pay sends one `POST /api/payments/chapa/batches/wallet` containing the original operation key, bid selection, fee version, optional coupon and approved total.
2. One database transaction takes the shared maintenance barrier, auction lock and wallet lock in that order, then reauthorizes the session after any lock wait. It validates the complete batch and server-calculated total once, persists its immutable quote, records the accepted bids and exact submission-fee debit, saves the receipt and notification outbox, and commits together.
3. A changed authoritative total returns `{kind: "quote", quote}` without a debit. The new total must be shown and explicitly confirmed through the saved-quote adapter. Changing amounts, coupon, fee version or approved total under the same operation key is rejected. Numerically equivalent totals such as `20` and `20.00` use the same canonical identity.
4. The response contains accepted bid IDs and the committed wallet balance/revision. The client updates the relevant private caches immediately and refreshes affected data in the background.

The validated first-bid recorder reuses the same locked batch snapshot. It retains database acceptance checks, coupon redemption and first-bid referral qualification before inserting the remaining batch entries. It no longer repeats the full batch validation. Existing saved-quote payment remains available at `POST /api/payments/chapa/batches/[id]/wallet`.

Wallet payment performs no Chapa initialization, method-capability request, SDK load, phone authorization or webhook wait. Telegram delivery remains asynchronous after commit; the transaction saves outbox events but does not send messages.

## Automatic observation and fresh entry

The client retains the immutable original command in account-scoped private query state before dispatch. Fast successful responses need no extra request. If the original POST is still outstanding after two seconds, one bounded observer begins checking its receipt. A fast ambiguous error starts observation immediately. The two-second threshold starts a read; it is not an artificial payment delay.

The observer uses only:

- `GET /api/payments/chapa/batches/wallet?key=<original key>`; or
- `GET /api/payments/chapa/batches/[id]/wallet?quoteHash=<original hash>` for an existing quote.

These authenticated, owner-scoped endpoints never create a quote, debit a wallet or invoke Chapa. A committed wallet receipt returns `200`. An unknown, uncommitted or quoted operation returns `202`, `kind: "pending"`, and retry guidance. An unavailable receipt is not converted into a false payment failure. A Chapa-owned batch cannot be relabeled as an internal-wallet receipt.

The current observer uses a 20-second observation budget, at most ten status reads, bounded request timeouts and backoff. It stops on resolution, cancellation of the client observer, an account change or the observation limit. The original POST keeps its existing 15-second HTTP deadline. Checking a payment never starts another debit. If observation remains uncertain, the original key and command remain available for safe recovery; a new operation is not invented.

Reopening bid entry shows the editable bid form first. An outstanding original payment appears as a compact notice with a View payment status action. New drafts remain editable, but an unresolved earlier payment must be checked before another charge. Closing a status surface hides it; it does not cancel the financial operation. Confirmed receipts can be viewed without forcing the progress view every time entry opens.

## Lean coupon availability

The coupon control now uses the authenticated `/api/referrals/coupon-count` projection. It reads the actual owned, unspent, unexpired count in one SQL statement when the referral schema is enabled. It does not fetch the full referral overview or initialize an invitation link merely to display a badge.

The checkout's existing bid-state projection omits its duplicate count query. Loading, unavailable and unconfigured counts stay distinct from a confirmed zero. Applying a coupon still requests the existing authoritative discount quote, and payment still validates and redeems it transactionally. The count itself never authorizes a discount.

## Measured local comparison

Seven paired measurements ran against the same migrated, disposable PostgreSQL 17 database on loopback port 55608. Each pair used the same verified fixture user and open real-rule fixture auction, two valid chosen amounts, a 10 ETB fee per bid and development-only seeded funds. The two paths used different valid amount selections to avoid duplicate-bid rejection. Chapa was disabled and no provider HTTP was sent.

The baseline loaded the pre-change `HEAD` batch module. The comparison used the new combined command. Fixture creation and funding were outside the measurement. Prisma query-event logging counted statements, including transaction boundaries. The first pair was discarded from the warm summary; six pairs remain. These are service-level measurements, not browser-to-production timings.

| Measurement | Previous quote + wallet commands | Combined wallet command |
| --- | ---: | ---: |
| Mutation HTTP requests required by the client | 2 | 1 |
| SQL statements in the measured service calls | 76 | 43 |
| Contact reads | 3 | 1 |
| Explicit auction lock queries | 4 | 1 |
| Warm median duration, six pairs | 143.68 ms | 84.35 ms |

This is **43.4% fewer SQL statements** and a **41.3% lower warm local median**. In the same run, an owned committed-receipt read used six statements and approximately 7–10 ms. Measured combined-command stages were approximately 4–7 ms for locks, 12–20 ms for pricing/eligibility and 51–72 ms for fulfillment. Timing categories overlap the enclosing transaction total and must not be added to that total again.

The direct-service benchmark did **not** pass the optional session-reauthorization callback. Therefore both HTTP/session authentication and its in-transaction session query are excluded from the statement counts and durations. Actual HTTP routes retain session reauthorization after locks. The new initial flow performs it once, while the former serial quote/payment flow performed it twice.

Internet latency, production database/pool contention, cold application startup and physical-device rendering were not measured. The initial pair is not a controlled cold-start comparison, and six warm samples do not justify a production p95. Under five seconds is a target for the normal wallet flow, not a guaranteed production SLA.

The local reproducible harness is `.local/measure-wallet-command.ts`; `.local/wallet-speed-baseline-batch.ts` contains the isolated `HEAD` baseline. Both are ignored local validation artifacts. No production connection string or customer data was used.

## Validation status

- **18 isolated PostgreSQL wallet cases passed**, including duplicate concurrent calls, original-key receipt recovery, an observer during an uncommitted operation, private ownership, changed approved-total rejection, explicit price review, insufficient-balance rollback, later-write rollback, internal/external payment exclusion, referral qualification, single coupon redemption and balanced ledger projections.
- **16 isolated PostgreSQL v2 Inline cases passed** in the separate run started at 12:22:54, confirming the shared fulfillment refactor did not break the existing external-payment database scenarios.
- **245 focused unit/service tests passed**, with **12 intentionally skipped database-gated cases** in that run. This includes the new seven-case wallet command/receipt HTTP suite; the real database cases were run separately as listed above.
- The production build, including its TypeScript check, **passed** for this follow-up after 12:25. No Prisma migration files changed.
- **32 production-mode browser checks passed** across 320px, 360px and 430px with English/Amharic; 28 duplicate-project cases were intentionally skipped. The run completed in 2.9 minutes with exit code zero. It covered the single wallet mutation, zero preliminary quote HTTP, automatic slow/lost-reply recovery, duplicate taps, changed-total confirmation, editable pending re-entry, background receipt arrival, external authorization recovery, and coupon loading/cache reuse.
- Both synthetic slow/lost wallet-response cases passed the **under-five-second Pay-to-receipt assertion**, with one original mutation and no manual retry. Their provider/payment responses were isolated fixtures: these are frontend recovery checks, not proof of production database/network latency or a live five-second guarantee. The independent coupon count appeared while the heavier bid-details response was deliberately held, and reopening reused one cached count request.

The scoped changes preserve authorization, own-contact requirements, restrictions, maintenance, database-relative auction deadlines, two-decimal/duplicate/consecutive rules, submission limits, immutable pricing, coupons, wallet locking, all-or-none batch acceptance and application-level idempotency. A failed transaction rolls back its new quote and financial effects together. No financial table is reset or reinterpreted.

## External-payment configuration remains separate

The user-provided deployed WEB diagnostic reported v2/live mode, a private key present, **`CHAPA_PUBLIC_KEY` missing**, creation/recovery unavailable, no disabled creation flags and the three configured external methods. Its schema status was `not-requested`; that output did not validate the deployed schema. The deployed revision and effective Chapa-worker settings are still unconfirmed.

Add the matching live public key privately to `CHAPA_PUBLIC_KEY` on WEB and the Chapa payment worker, retain the matching server-only private key and reviewed v2 settings, and follow the normal deployment/readiness process in [the checkout repair guide](chapa-checkout-repair-2026-11-12.md). A missing external key must not disable internal-wallet payment. Do not rename v2 keys into retired v1 variables or change the reviewed webhook signature profile as part of this wallet optimization.

No live payments, production migrations, merge or deployment were performed for this update.
