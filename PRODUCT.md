# Lowin

## Platform
web

Lowwin serves Ethiopian customers in the Telegram Mini App and ordinary mobile/desktop browsers. Website login uses official Telegram OpenID Connect; Mini App login keeps signed launch and self-contact sharing. Both paths use the same Telegram-bound account, wallet and history. Staff administration has a separate permission-controlled workspace.

## Current product truth

The repository supports frozen, versioned auction terms. Current `lowest-unique-v5` auctions treat the entered bid number as a number, never a monetary hold or winner payment. Only the disclosed ETB submission fee is deducted. A cancellation automatically returns actual net paid cash fees to wallet cash and restores bonus-funded amounts as bonus with original expiry; discounts and promotional value never become cash. Completed historical auctions keep their original terms, receipts and financial facts. Unsettled auctions adopt v5 only through an explicit audited transition.

The lowest unique eligible accepted number wins at the authoritative cutoff. Fewer than two eligible participants or no unique number cancels the auction. A repeated number cannot win under v5. Historical completed results remain accurate to the policy under which they settled.

## Identity and financial records

Better Auth user IDs, verified Telegram identity/contact binding, encrypted phone keys and existing balances remain authoritative. Browser data cannot authenticate a customer or confirm a payment. Ledger postings, holds, audit history and admin permissions remain intact.

Customers top up their wallet or pay submission fees through Lowwin’s shared Chapa v2 Inline REST checkout and enabled methods. An owned immutable attempt and idempotency key precede provider dispatch. Private server verification remains required. Internal wallet bidding settles atomically without initializing Chapa. The chosen bid number is never charged as money. Historical hosted, direct, ArifPay and transfer records retain their recovery and accounting paths.

Closing a waiting sheet changes only the UI. Transactions lists owned top-ups and bid-payment attempts, including unpaid and unresolved attempts. Uncertain outcomes retain their original reference and idempotency key. A confirmed safe retry restores the draft and still requires another explicit Pay. Old attempts can still complete, and every successful incoming payment is accounted for once. Only one bid for the same user, auction and number can be accepted; additional verified funds stay in the wallet.

Authenticated webhooks create durable event jobs under the configured signing profile. Merchant verification must report SUCCESS and match the original amount, currency, reference, metadata expectations and configuration before the existing locked ledger/bid command runs. Owned foreground status checks, durable webhook processing and bounded reconciliation refresh the same attempt. Leases and throttling prevent overlapping verification. Temporary connection problems and local display deadlines are not payment outcomes. Read-only ledger integrity checks stay available.

Deposit offers are disabled by default. Authorized staff can configure 10–100%, a minimum deposit, optional cap, validity and offer end. Each new top-up freezes its approved offer. Verified principal credit and bonus award commit atomically, once. Bonus funds stay separate, expire from actual credit, and pay only eligible real v4 submission fees before cash. Coupons reduce fees first. Bonus cannot pay old monetary holds, external bid payments or winner charges and is never silently converted into cash.

## Brand and experience

Use the supplied Lowwin logo. The latest November 13 direction uses white/soft-gray surfaces, charcoal/slate text and blue primary buttons. Violet remains the brand accent; yellow/gold highlights deposit offers. Self-host Inter variable for English and keep the existing Ethiopic font for Amharic. Home, Winners, My Bids, Transactions and Profile form the five-item navigation. There is no Deposit navigation action. Real finalized and explicitly published settlement records supply public results. Winner identities are masked; no public winner stories or photos exist without a separate consent and moderation workflow.

## Release boundary

This branch contains code and additive migration files only. Production deployment, migration execution, provider activation and real transfers are separate reviewable operations. Do not run seeds, resets or cleanup against production. Keep payment recovery running for unresolved charges during rollback.
