# Lowin mobile redesign: release procedure

This branch changes the customer interface and adds a separately gated ArifPay checkout. Existing customers, Telegram identities and contact verification, balances, ledger history, accepted bids, frozen auction terms, settlement proofs, staff permissions and existing payment audit records remain in place. Do not reset or reseed a hosted database for this release.

## Staging

1. Record the current web and worker revisions, deployment environment, migration list, customer count and wallet/payment reconciliation result. Take an encrypted database backup and verify a restore into an isolated database. Keep provider secrets out of logs and screenshots.
2. Apply the reviewed additive migration to staging. Deploy matching web and worker revisions with production funding switches unchanged and ArifPay disabled until the merchant contract is verified.
3. Use an isolated Telegram staging bot and test accounts. Verify existing-customer login, own-contact gating, English/Amharic, deep links, Home, auctions, Draws, My Bids, Profile, notifications and wallet history. Compare the 360px/430px captures in `screenshots/` with the supplied reference images.
4. Exercise v4 fee-only bids and older terms separately. Check accepted receipt replay, stale fee quotes, insufficient balance, deadline races, duplicate callbacks and reconciliation. A chosen v4 number must never become a monetary reserve or winning charge.
5. Confirm the merchant-specific sandbox and verification contract with ArifPay first. The current transport follows the published production direct endpoints and remains disabled; the public sandbox collection differs, so do not substitute sandbox hosts or keys into this transport. Complete the provider exercise in its documented sandbox, then review the production merchant configuration. Test cancel, failed, unknown, delayed and duplicate provider events. The return page must never create a credit or accepted bid merely because the browser says success.
6. Confirm how late successful payments are reviewed/refunded when an auction closes or its fee changes. Preserve their provider evidence and audit trail. Do not claim that a paid checkout guarantees bid acceptance after a published deadline.

## Canary and production approval

Production deployment and funding activation are a separate approval step. Prepare a concrete release containing the commit, exact migration SQL, backup/restore evidence, current safeguards, provider sandbox evidence and known limitations before requesting approval.

Release the interface first with ArifPay disabled. Inspect authenticated error rate, login/contact failures, API p50/p95, bid failures, pending payment age, duplicate/replay counts and reconciliation. Set ARIFPAY_CANARY_USER_IDS and ARIFPAY_CANARY_AUCTION_SLUGS to the approved internal customer IDs and exact auction slugs before enabling new checkout. Start with staff-owned player test accounts, then a small consented canary. Keep legacy wallet history and unresolved funding records accessible throughout the transition. Activate additional customer traffic only after the merchant and server verification checks succeed. Do not enable Verify.et flags as a side effect of this redesign.

## Rollback

- Disable the new checkout first; retain pending checkout records and let the reviewed reconciliation/recovery path process confirmed payments.
- Roll back the customer web to the recorded compatible revision while keeping the reviewed ArifPay recovery worker and its required configuration running until every accepted provider charge is reconciled. Existing settlement/Verify.et workers must remain compatible. Retain the additive checkout table; do not drop payment history.
- Confirm Telegram login, current balances, old auction deep links, bid receipts and admin access after rollback. Run read-only wallet and payment reconciliation again and compare counts with the pre-release audit.
- Restore a backup only for a confirmed data incident under a separate recovery decision. Restoring an old snapshot can lose legitimate customer operations accepted after the snapshot; reconcile provider transactions and the append-only ledger before reopening traffic.

## Verification boundaries

Local browser evidence uses a fresh PostgreSQL cluster bound to `127.0.0.1`, disposable `_test` databases, synthetic signed Telegram launches and clearly labeled DEMO inventory. It does not establish production database performance, real Telegram Android/iOS behavior, keyboard/safe-area behavior on physical devices, real merchant payment acceptance, or external provider p95 latency. Complete those staging/device checks before a broad release.

Never use a screenshot, image OCR, browser redirect, client amount or optimistic UI as proof of payment. Preserve provider status, receiver/amount/reference checks, transaction ownership and duplicate protection, idempotency, server authorization, ledger invariants and the audit trail.

## Local workstation limitation

C: filled during a dependency patch attempt. Automatic approval rejected both generated cache cleanup and replacing partial dependency directories with npm's retained copies, returning blocked by policy. No rejected action executed. The complete, built and tested review checkout is D:/lowin-redesign-qa/patched-deps/app with patched dependencies in its parent. The original C: source tree is preserved, but its interrupted node_modules install needs repair after space is freed. Do not treat C: dependencies as verified. No production service or database was involved.

## Published policy discrepancy

The existing published terms include old manual-funding and photo-consent wording, while Privacy currently has no published sections. This redesign preserves published legal records and requires explicit verified consent/moderation before any winner photo/story workflow. The owner must review and publish consistent Terms/Privacy before rollout; this branch does not invent legal policy text or retroactively change auction terms.
