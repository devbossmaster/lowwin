# Deposit bonus

The offer is disabled by default. An approved administrator configures it at `/admin/bonus`: 10–100%, a minimum deposit, an optional per-deposit cap, bonus validity of 1–365 days (draft: 7), and an optional offer end date. Saving requires current verified administrator authorization, an expected policy version, an idempotency key and an audited reason.

A new Chapa v2 top-up freezes the confirmed offer before provider dispatch. Percentages use integer cents, rounded down; caps apply to the bonus. A stale offer is rejected with `DEPOSIT_BONUS_CHANGED` before a payment is created. Retrying an existing payment retains its original quote. Earlier payments without a bonus quote receive no retroactive reward. The end date closes new offers; each credited lot keeps its original validity.

Only a terminal, matching verified payment credits funds. The existing principal `CHAPA_RECEIPT` is unchanged. The same database transaction creates a separate balanced `DEPOSIT_BONUS` journal and immutable bonus lot, with validity starting at actual verified credit. Missing bonus proof rolls back the entire receipt. Retries and concurrent verification cannot duplicate either credit.

Cash stays in the `AVAILABLE` account. Bonus stays in the `BONUS` account and can pay only real `lowest-unique-v4` submission fees. Earliest expiry is consumed first, before cash, with immutable per-lot usage and a balanced bridge tied to an accepted bid in the same transaction. Coupons reduce the fee before bonus consumption. Failed bids roll back usage. External Chapa bid payments, older monetary holds and winner charges use cash only. V4 submission fees retain their published non-refundable policy.

Wallet reads exclude expired lots using database time, even if the worker is stopped. After payment processing, the existing Chapa worker expires up to 20 lots every 30 seconds with a one-second work budget, skips busy wallets, and caps each transaction at 2.5 seconds. Idempotent journals run under the wallet lock. An exhausted lot is closed without zero-value postings. Cash and active bonus are shown separately; the combined amount is usable for eligible fees. Bonus history is authenticated, owner-scoped and paginated at 20 records.

## Rollout

Apply the additive `202611130001_deposit_bonus` migration and the normal runtime-role grants, then deploy Web and the existing Chapa worker. No new environment flag or service is required. Storage availability is checked with a bounded 30-second cache. Before the migration, the customer offer fails closed and the administrator sees a migration-required state. Enabling the offer is a separate explicit administrator save.

Run `wallet:reconcile` to audit the bonus liability alongside the existing wallet, payment and Chapa checks. The legacy privileged auction-reset compensation script rejects an auction containing bonus-funded fees; restoring bonus value requires a reviewed source-preserving policy, not a cash refund.

Local tests do not establish production migration, real provider authorization, Telegram device behavior or deployment success.
