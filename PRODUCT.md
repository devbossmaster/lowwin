# Lowin

## Platform
web

Lowin is a Telegram Mini App for Ethiopian customers. The ordinary browser entry directs customers to the Telegram bot. Staff administration has a separate permission-controlled workspace.

## Current product truth

The repository supports frozen, versioned auction terms. Current `lowest-unique-v4` auctions treat the entered bid number as a number, never a monetary hold or winner payment. Only the disclosed ETB submission fee is deducted. Submission fees are non-refundable under v4. Earlier versions keep their own holds, charges, refunds and fallback rules. Existing settlements and published terms are not rewritten by the redesign.

The existing v4 fallback remains the earliest accepted bid at the lowest number when no number is unique. A least-frequent / most-recent fallback would require a separate future rules version.

## Identity and financial records

Better Auth user IDs, verified Telegram identity/contact binding, encrypted phone keys and existing balances remain authoritative. Browser data cannot authenticate a customer or confirm a payment. Ledger postings, holds, audit history and admin permissions remain intact.

Customers top up their wallet or pay an auction submission fee through Chapa v2 hosted checkout. Pay persists an owned attempt and opens Chapa automatically. Chapa collects payer details. Wallet-funded bidding remains available only behind its existing reviewed gates. The entered bid number is never charged as money. Historical ArifPay and transfer records remain intact.

Closing a waiting sheet changes only the UI. Transactions lists owned top-ups and bid-payment attempts, including unpaid and unresolved attempts. Explicit Start new checkout creates a new frozen command and merchant reference; replaying the same key retains its original attempt. Old attempts can still complete, and every successful incoming payment is accounted for once. Only one bid for the same user, auction and number can be accepted; additional verified funds stay in the wallet.

Authenticated raw-body webhooks create durable event jobs. Merchant verification must report SUCCESS and match the original amount, currency, reference, metadata expectations and configuration before the existing locked ledger/bid command runs. Waiting UI reads only database status for a bounded foreground window. Provider verification is event-driven or manually requested; new attempts are never periodically swept or automatically resumed. Read-only ledger integrity checks stay available.

## Brand and experience

Use the supplied Lowin logo. Customer screens use warm white, near-black actions and restrained gold; DM Sans Latin and Noto Sans Ethiopic. Home, Winners, My Bids, Transactions and Profile form the five-item navigation. There is no Deposit navigation action. Real finalized settlement records supply results. Winner identities are masked; no public winner stories or photos exist without a separate consent and moderation workflow.

## Release boundary

This branch contains code and additive migration files only. Production deployment, migration execution, provider activation and real transfers are separate reviewable operations. Do not run seeds, resets or cleanup against production. Keep payment recovery running for unresolved charges during rollback.
