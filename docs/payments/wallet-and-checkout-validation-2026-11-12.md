# Internal wallet and shared checkout — 12 November 2026

This extends the [Chapa v1 migration](chapa-v1-migration-2026-11-11.md). New external payments use official v1 Inline or the explicit hosted CBE Bank branch. Historical v2 attempts retain their original verification/recovery path. Lowwin Wallet remains an independent internal funding source.

## Wallet payment

The shared payment form separates **Pay from Lowwin Wallet** from **Pay through Chapa**. Wallet selection shows the actual available balance and a dedicated “Pay [total] ETB from wallet” action, without a phone input. External configuration outages cannot block an enabled wallet payment. Wallet payment loads no Chapa SDK and performs no provider initialization, authorization or webhook wait.

The final authenticated wallet command locks auction, wallet and batch, then validates the owned immutable quote, deadline and eligibility. It checks the complete submission-fee total before accepting any bid, and commits every bid, exact debit, receipt and notification-outbox event together. A failed command rolls back all effects. Already accepted batches replay their existing receipt without a second debit; a Chapa-bound batch cannot switch to wallet settlement. Chapa creation uses the same batch ownership/locking boundary.

The response includes accepted bid IDs, charged fee total, internal gateway identification and the committed wallet balance/revision. The UI applies this response to the current account's wallet and already cached Live My Bids pages, deduplicated by stable bid ID. A real monotonic wallet revision prevents an older receipt from replacing a newer balance. Relevant data refreshes quietly afterward; no absent pagination or outcome is invented. Telegram delivery remains asynchronous after commit.

Final review also caught an accepted Chapa-funded batch replay being labeled as Internal wallet if called through the wallet endpoint. The endpoint now rejects any Chapa-bound batch before replaying an internal receipt. The regression verifies that this rejection adds no ledger, bid, outbox or checkout effects. A retained funding draft is also cleared after confirmed external bid acceptance, so reopening does not restore numbers that were already submitted.

Insufficient funds return available balance, required total and shortfall with no accepted bids or debit. The form preserves the chosen numbers and offers explicit Top up or external payment. An ambiguous wallet response retains the original batch/quote and retries only that operation. It cannot silently switch to Chapa, overdraw or split funding. Legitimate zero-fee/coupon submissions remain internal.

## Top-up and recovery

Top up uses amount → shared external form → shared result inside the existing dialog. Wallet is excluded as a top-up funding source. A top-up opened from bidding retains an account-scoped draft in the existing private query cache. Verified, committed wallet credit returns to that draft, refreshes server pricing/eligibility and requires another explicit wallet Pay. Merely returning, choosing a provider or closing does not pay.

The browser regression caught a real restoration defect: clearing the old quote after credit did not rerun the quote effect when the selected numbers and step were unchanged. The credit callback now explicitly requests fresh pricing through the existing quote retry generation. The test requires fresh pricing and zero wallet commands until the next explicit Pay.

The pinned Inline asset has a versioned immutable cache header and loads only when needed. A script-load failure before SDK execution can retry the same retained configuration/reference. After SDK dispatch, callbacks are reconciliation hints and cannot authorize another initialization or a hosted fallback. Closing disposes the SDK browsing context without claiming to cancel the provider transaction. Reopening recovers owned state.

The supplied CBE instructional video uses the actual local asset and native lazy playback. See the migration document for its format and configuration. No native wallet PIN is collected. Specific incorrect-PIN/cancellation wording requires actual provider evidence.

## Local command timings

Measured against disposable loopback PostgreSQL, using the complete `payBidBatchWallet` transaction and real session/contact-binding reauthorization query:

| Bid count | Fresh Prisma client, n=1 | Warm p50, n=20 | Warm p95 |
| --- | ---: | ---: | ---: |
| 1 | 421.937 ms | 109.670 ms | 132.252 ms |
| 5 | 475.851 ms | 167.866 ms | 224.227 ms |

Nearest-rank quantiles. PostgreSQL was already warm from fixture setup. These are service-command timings, excluding prior quotes, cookie-auth HTTP, network, rendering and Telegram delivery; they are not cold-app or production latency measurements. The run verified 126 accepted bids, 126.00 ETB fees, 874.00 ETB remaining balance, zero unbalanced journals and zero outbound HTTP calls. There is no comparable pre-change timing sample, so no numerical speedup is claimed. Local benchmark details are in `.local/wallet-command-benchmark.json`.

## Validation

- 11 dedicated wallet PostgreSQL tests passed: sufficient/insufficient funds, complete-batch rollback, same-operation replay, concurrent spending, competing external funding, accepted external-receipt isolation and authorization/quote checks.
- 9 wallet header/API tests passed, including the coherent balance/revision projection and internal wallet policy.
- The existing 60 shared-payment PostgreSQL tests and 17 v1 database tests passed after the backend edits.
- 113 focused unit/contract tests across nine suites passed for the shared form/status, wallet receipt cache, retained drafts, phone/batch/client validation, proxy media access and actual Inline adapter contract.
- TypeScript typecheck passed after the final receipt/draft changes.
- 35 production browser cases passed at 320px, 360px and 430px, including English/Amharic, exact shortfalls, wallet independence from external outages, one wallet submission for duplicate taps, immediate receipt-driven cache updates, ambiguous recovery, top-up draft restoration with fresh pricing, SDK connection recovery, and real local CBE video playback. The run intentionally skips 34 duplicate-width lifecycle combinations. Provider HTTP and wallet commands are intercepted; real financial transaction correctness is covered separately by PostgreSQL tests.
- The isolated production webpack build passed again after the final receipt/draft corrections. All six focused wallet browser regressions then passed on the final artifact, including external acceptance clearing the retained funding draft. Two visual cases are intentionally skipped in this 360px lifecycle rerun because their 320/430px review already passed. These six cases overlap the full suite; they are not six additional distinct scenarios.

The batched visual review inspected actual 320/430px English/Amharic wallet selections with a 12,345.67 ETB balance, plus insufficient-balance screens. Wallet and external providers are distinct; logos render, gold selection is visible, and the footer action stays accessible. Smaller screens use normal sheet scrolling for additional methods rather than clipping controls. Full-run evidence is in `.local/shared-checkout-wallet-final.log`.

All provider HTTP is intercepted in browser fixtures. Database fixtures are disposable and loopback-only. These checks do not prove live USSD timing, merchant activation or physical phone behavior. No production data was changed, live payments/broadcasts sent, merge performed or deployment triggered.

This wallet/video extension adds no migration or environment variable. The earlier v1 migration and reviewed v1 credentials/method whitelist are still required for deployment; preserve historical v2 recovery configuration.
