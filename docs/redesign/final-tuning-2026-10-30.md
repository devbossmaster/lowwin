# Customer checkout and reviewed results

The bid entry uses one mounted payment sheet from opening through receipt. The selected card supplies the immediate product preview; missing authenticated details load separately and keep submission disabled until authoritative limits, availability and balance are ready. The product description expands independently. Chapa and Wallet are separate selectors, and the Top up control sits outside both selectors. Earned discounts still use the existing server quote and atomic redemption rules. A chosen bid number is not an additional money charge.

After 90 seconds, an unconfirmed payment uses a quieter waiting view with the original auction, chosen number, submission fee and payment method. This changes presentation only. Bounded, visibility-aware checks continue; the saved checkout and durable server worker remain authoritative after closing the sheet. The five-minute customer window does not manufacture a provider failure or cancel money already received. A later verified result can replace the ended view. Resume uses the original owned checkout; a new attempt requires a new explicit action.

My Bids has All, Active, Successful, Pending and Failed filters. Accepted-bid totals come from actual Bid records. Unaccepted payment attempts have their own bounded server-side status filter and pagination, and do not inflate bid totals. A verification mismatch is distinct from a provider-declared failed payment. Unknown referral availability is shown as unavailable rather than an invented count.

The Profile and header retain the warm white, black and gold brand. Referral configuration is available at **Admin → Players → Referral rewards**; see [Profile setup](profile-referrals.md). Registration, sign-in and password reset share the Show/Hide password control. Authentication remains verified email plus the database-assigned admin role.

## Chapa delivery and financial boundaries

The implementation keeps Chapa v2 hosted checkout: integer cents, stable operation idempotency keys, the returned checkout URL and the persisted per-attempt initialization. A redirect, callback, successful HTTP response or webhook amount never credits money by itself. Server verification must report payment `SUCCESS` and match the expected attempt, principal amount, currency, credential/environment and final reference before the existing idempotent ledger transaction applies value.

The webhook authenticates before processing, persists its deduplicated durable job, then acknowledges. The first provider verification runs using Next.js `after()` following the response; a stopped process does not lose the committed job because the existing worker retries it. Provider HTTP remains outside financial transactions. Explicitly configured legacy-secret signature compatibility is retained for the observed merchant delivery profile; Basic Auth is not restored.

Official references: [Hosted Checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment), [Webhook handling](https://docs.chapa.global/docs/v2/integrations/webhooks), [Payment events](https://docs.chapa.global/docs/v2/webhooks/payment), and [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment).

## Closing and publishing results

The auction worker still closes and financially settles at the deadline. The auction disappears from Live. An administrator can privately review the calculated winner, uniqueness counts, paginated accepted bids and optional consented photo before publishing hours or days later. Publication cannot change the winner or settle money again.

Publish creates two durable notification intents. A worker expands participants in batches of at most 250, reusing unique recipient keys, instead of loading and inserting every participant inside the approval transaction. The review loads 25 bids and at most 100 frequency rows; the complete financial audit loads only when requested. See [result publication and rollout](../result-publication.md).

## Validation and release boundaries

Validation uses disposable loopback PostgreSQL databases, mocked payment providers and synthetic browser accounts. Tests cover duplicate/concurrent verification, late payments, account isolation, durable webhook acknowledgement, approval rollback and competing approvals, unchanged ledger reconciliation, and result privacy before publication. Mobile checks cover 360px/430px and desktop widths, preserved modal input, automatic delayed confirmation and payment filters. Production compilation and TypeScript checks use payment-disabled fixture configuration.

Final local results: **597 tests passed across 43 files**, including disposable database payment/publication/photo checks; **15 production-mode browser checks passed** across desktop, 360px and 430px; TypeScript and the optimized webpack production build passed. The browser captures were reviewed for bid entry, delayed confirmation and transaction details. Three immediate worker fixtures explicitly create due jobs to avoid a millisecond app/database clock assumption; production lease behavior is unchanged. These results are functional evidence, not a throughput benchmark.

Before release, pause the old auction and notification workers, apply `202610300001_result_publication` with the migration-owner connection, verify restricted runtime grants, and deploy matching web/auction/notification workers before resuming. Existing settlements are backfilled as historically published without sending new announcements. Keep the Chapa worker running with the reviewed matching database, mode, key and recovery configuration. Referral activation is a separate explicit policy action and does not enable payments.

Rollback must retain immutable publication and financial evidence. Pause new publication/announcements and use a compatible application release; do not drop tables, delete settlements or reverse ledger entries as a UI rollback.

Local checks do not establish production throughput, physical Telegram handoff, merchant delivery latency or database restore readiness. Capacity planning still needs an agreed workload, production-like load tests, database query plans/pool sizing and monitored canary results. No production migration, real payment, notification send or deployment is performed by this validation.
