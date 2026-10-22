# Lowin

## Platform
web

Lowin is a Telegram Mini App for Ethiopian customers. The ordinary browser entry directs customers to the Telegram bot. Staff administration has a separate permission-controlled workspace.

## Current product truth

The repository supports frozen, versioned auction terms. Current `lowest-unique-v4` auctions treat the entered bid number as a number, never a monetary hold or winner payment. Only the disclosed ETB submission fee is deducted. Submission fees are non-refundable under v4. Earlier versions keep their own holds, charges, refunds and fallback rules. Existing settlements and published terms are not rewritten by the redesign.

The existing v4 fallback remains the earliest accepted bid at the lowest number when no number is unique. A least-frequent / most-recent fallback would require a separate future rules version.

## Identity and financial records

Better Auth user IDs, verified Telegram identity/contact binding, encrypted phone keys and existing balances remain authoritative. Browser data cannot authenticate a customer or confirm a payment. Ledger postings, holds, audit history and admin permissions remain intact.

New manual deposits are retired from customer UI and create/prepare API actions. Existing transfer records, Verify.et verification/recovery, staff review and wallet history remain supported. Existing available balances can still pay auction fees.

ArifPay Telebirr and M-PESA direct bid-fee checkout is additive and disabled by default. New charges require explicit server configuration, migration readiness, reviewed merchant setup and activation. An independently verified merchant lookup is required before balanced ledger posting and the existing idempotent bid command. Paid but unaccepted bids preserve funds for review. Neither a redirect, callback body nor a USSD prompt proves payment.

## Brand and experience

Use the supplied Lowin logo. Customer screens use warm white, near-black actions and restrained gold; DM Sans Latin and Noto Sans Ethiopic. Home, Draws, centered Auctions, My Bids and Profile form the five-item navigation. There is no Deposit navigation action. Real finalized settlement records supply results. Winner identities are masked; no public winner stories or photos exist without a separate consent and moderation workflow.

## Release boundary

This branch contains code and additive migration files only. Production deployment, migration execution, provider activation and real transfers are separate reviewable operations. Do not run seeds, resets or cleanup against production. Keep payment recovery running for unresolved charges during rollback.
