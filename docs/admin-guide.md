# Lowwin Owner and staff guide

This guide describes current routes and server permissions. Real funding remains disabled. A DEMO balance, bid or result is not real money or a real prize. Use a separate staff email identity; staff accounts cannot bid.

## First sign-in

Follow [production setup](production-setup.md#5-staff-email-and-first-owner) to verify email delivery, supply the MFA encryption key, and run the one-time Owner invitation CLI. There is no public staff registration. Open `/admin/login`, accept the invitation within 24 hours, choose a unique password of at least 12 characters, enroll an authenticator, and save all ten recovery codes privately. The code/secret screen is sensitive: do not screenshot it for a support ticket.

Password alone never opens the workspace. An exact credential session plus MFA assurance is required. Assurance lasts 15 minutes and credential age is limited to eight hours; sensitive actions require MFA within five minutes. A used TOTP counter cannot be reused—wait for the next authenticator code.

Forgot password sends a one-time 30-minute link without confirming whether an email exists. Reset revokes existing sessions and still requires MFA. A recovery code revokes all sessions and the old authenticator, then requires fresh enrollment. Never remove MFA by editing the database. Lost encryption keys or lost MFA **and** recovery codes require a reviewed operational recovery; there is no public bypass.

If the initial invitation expired before any staff account existed, the one permitted CLI recovery is `npm run admin:reissue -- "reason for recovery"` with bootstrap temporarily enabled. It targets the original email, revokes the old invitation and audits the replacement. It cannot create a second Owner or bypass MFA.

## Permissions

| Role | Permitted work | Restrictions |
|---|---|---|
| Owner | Catalog, publication/cancellation, team, support restrictions, fulfillment, payment settings/investigations, jobs, audit/reconciliation | Fresh MFA and exact confirmation still required; no balance editor/winner override |
| Catalog Manager | Categories/products/images, drafts, content and preflight | Cannot publish or cancel; cannot change frozen published inventory |
| Support | Cases and permitted redacted user/payment status | Cannot credit, change payment settings, read unrelated delivery contact or apply Owner restrictions |
| Fulfillment | Assigned delivery cases and audited contact reads | Cannot inspect unassigned contacts or alter settlements |
| Payments Operator | Wallet evidence, top-up investigations, eligible verification retries and statements | No generic credit, payment-policy publication or financial-history edits |
| Auditor | Read-only audit, results and wallet/payment evidence | No mutations |

Permissions are enforced by server checks on both pages and direct APIs. Hidden buttons are not the access boundary. Team changes revoke affected sessions. You cannot change your own grants or remove the last active Owner.

## Daily opening checklist

1. Open `/admin` and review reconciliation, stale settlements, failed jobs and payment incidents. Zero drift is required before financial operations.
2. Inspect `/admin/reconciliation` and `/admin/wallets`. Investigate unexpected posting/account/hold/payment differences; never edit a balance to conceal them.
3. Review `/admin/auctions`, `/admin/jobs`, `/admin/notifications`, support and delivery cases. An elapsed end time means closing until the settlement worker commits.
4. If funding is eventually approved, reconcile the prior day's independently obtained bank statements before accepting more deposits. Provider success alone is insufficient.

## Catalog, drafts and Home copy

`/admin/categories`: name, slug, description, visibility and eligibility review. Hidden categories/products are excluded from the player catalog. Eligibility-review categories cannot be published without their required workflow.

`/admin/products`: title, description, condition, category, DEMO marker and images. Upload original/licensed/supplied PNG/JPEG/WebP up to 2 MiB, enter source credit and confirm usage rights. The server validates bytes, bounds dimensions, strips metadata and re-encodes. SVG/script and arbitrary remote-URL uploads are rejected. Attach validated images before saving. Referenced published inventory is immutable; create replacements instead.

`/admin/auctions`: create a draft, choose inventory, future start/end, integer ETB minimum/maximum/step, per-accepted-bid fee, delivery region and fulfillment terms. Save, inspect the phone preview, run preflight, then Owner publishes. Starts must be at least one minute ahead and the duration within the allowed 30-day window. Preflight does not publish. Publishing freezes identity, schedule, terms and fulfillment snapshot. Published items cannot be edited into different promises.

`/admin/content`: Home introduction and additional FAQ entries. Saving changes their managed display content; it never changes auction rules. Supply both language versions and verify Home/FAQ on a phone. Permanent rules must continue to explain holds, fees, no-winner and cancellation outcomes accurately.

## Cancellation and results

For an unsettled auction, open **Review cancellation impact**. Read participant count, held ETB to release and entry fees to refund. Enter the reason, type the exact auction code, and complete fresh MFA if requested. If bids changed the preview, refresh and review again. Cancellation is atomic, idempotent and audited; it cannot overwrite a completed result. **It cannot be undone.** Create a replacement draft for a new auction.

`/admin/results` and the auction's **Read decision proof & journals** show actual settlement evidence. The lowest amount accepted exactly once wins. Settlement charges that amount from the winner's hold and releases unused holds; valid no-winner closes retain disclosed fees. Cancellation refunds fees and holds. Public pages never expose live bid distributions or private participant identity.

## Users and support

Use `/admin/support` to assign/investigate/resolve cases with a reason. `/admin/users` permits Owner-reviewed bidding restrictions. Suspension stops new bids; it does not erase accepted bids, release holds arbitrarily or change deterministic outcomes. Players retain history and support access. Do not copy login codes, full payment screenshots or unnecessary personal information into case notes.

## Wallet funding and incidents

`/admin/settings/payments` is Owner-only with fresh MFA. Review the exact previous/proposed receiver, account holder, 1:1 ETB quote, bounds, terms and review reference before publishing an immutable policy version. Saved intents retain their original quote. The channel switch **cannot bypass the global production-credit interlock**. Keys belong in protected server configuration, never this screen.

`/admin/top-ups`: filter requests by status/case, open `/admin/top-ups/[id]`, and compare redacted expected/provider evidence and the verification timeline. Add a reasoned note, assign/escalate or retry an eligible request. Provider duplicate responses need investigation and issue no credit. A locally claimed reference is globally unique for its channel. Resolving a case never changes the receipt or credits the wallet.

`/admin/top-ups/statements`: obtain authorized bank/Telebirr statement evidence independently, archive it privately, then record channel/reference/cents/receiver/date and archive reference. MATCHED/MISMATCH/UNMATCHED entries preserve the evidence. This action never credits or debits ETB. Investigate duplicates, unmatched statements, reversals and provider outages.

An approved reversal uses a separate internal command with fresh Owner MFA, exact intent ID, reason, evidence and idempotency. It creates a compensating balanced journal only when the entire amount remains AVAILABLE. Held or spent funds cannot be forcibly taken. There is no HTTP mint/reversal button, arbitrary credit, payout or automatic external refund. Never delete the original journal.

## Fulfillment

Winners submit a separate delivery contact in **Winning Bids**. Owner assigns the case to an active fulfillment staff member. Assigned staff may audit-read contact and progress CLAIMED → PACKING → SHIPPED (real tracking/reference required) → DELIVERED, or flag DISPUTED. Record actual evidence; a winning result does not imply shipment. Delivery contact does not change Telegram/login identity. It is encrypted and scheduled for deletion 30 days after delivery; a dispute pauses deletion. DEMO items are never shipped.

## Notifications and jobs

`/admin/notifications` and `/admin/jobs` expose durable delivery state and failures. Players choose notification preferences; Telegram delivery requires their opt-in and a private chat they initiated. Owner retry requires an investigation reason. Retry delivery only, never the associated bid/settlement command. Telegram may duplicate a message after a crash between send and commit, while financial facts remain idempotent. Do not send broadcasts as a connectivity test.

## Common errors and response

| Message / code | Owner action |
|---|---|
| Access unavailable / 403 | Check exact staff role and current credential+MFA session; do not reuse a player session |
| Fresh MFA required / reused code | Enter a new authenticator code; verify device/server clock |
| Email delivery unavailable | Check verified sender/domain, key and provider delivery logs without exposing invitation tokens |
| Version / impact changed | Reload and review current facts; do not reuse a stale confirmation |
| P1001 / connection interrupted | Check database availability, network/TLS and the selected pool endpoint |
| P2024 / pool timeout | Inspect query duration/locks and total process connections; do not disable authorization |
| Receiver/amount/date/currency mismatch | Preserve evidence, investigate and issue no manual credit |
| Duplicate review / duplicate conflict | Compare provider verification history, local claim and independent bank statement; do not auto-credit |
| Reconciliation drift | Stop activation/financial operations, preserve evidence and involve the recovery owner |
| Closing / result pending | Inspect auction worker and failed attempts; do not manually declare a winner |

## Screen references and irreversible actions

Reference captures: [payment queue](screenshots/phase6-top-ups-admin-laptop.png), [payment settings](screenshots/phase6-payment-settings-admin-laptop.png), [statements](screenshots/phase6-payment-statements-admin-laptop.png). They are historical fixture captures, not proof of current production state; route/control names above are the authoritative guide.

Publication, cancellation, accepted bids, posted journals, transfer claims, settlement proofs, immutable policy versions and audit records cannot be rewritten through the application. Invitations/recovery codes are one-time; the last Owner is protected. Back up database **and** encryption key versions, perform a separate restore/reconciliation drill, and record the reviewed release SHA. See the current release packet for verified checks and outstanding GO/NO-GO gates.
