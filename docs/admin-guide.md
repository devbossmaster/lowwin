# Lowwin Owner and staff guide

This guide describes current routes and server permissions. Funding availability comes from the current server release gate and versioned receiving accounts; this redesign does not enable funding. A DEMO balance, bid or result is not real money or a real prize. Use a separate staff email identity; staff accounts cannot bid.

## First sign-in

Follow [production setup](production-setup.md#5-staff-email-and-first-owner) to verify email delivery, supply the MFA encryption key, and run the one-time Owner invitation CLI. There is no public staff registration. Open `/admin/login`, accept the invitation within 24 hours, choose a unique password of at least 12 characters, enroll an authenticator, and save all ten recovery codes privately. The code/secret screen is sensitive: do not screenshot it for a support ticket.

Password alone never opens the workspace. An exact credential session plus MFA assurance is required. Assurance lasts 15 minutes and credential age is limited to eight hours; sensitive actions require MFA within five minutes. A used TOTP counter cannot be reused—wait for the next authenticator code.

At authenticator confirmation, **Don’t ask me for 30 days on this device** remembers your own browser after a successful code. Future logins still require your password. A remembered-device login lasts at most eight hours and does not count as fresh MFA: payment settings, staff grants, cancellations and broadcasts can still request a code. The 30-day expiry does not extend on login. Signing out forgets that device; password reset, authenticator recovery/replacement, and staff role or active-state changes revoke remembered devices. Browser storage cleanup also removes the remembered-device cookie. Never enable it on a shared device.

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

## Find your work

The desktop sidebar has five business areas, with Settings at the bottom. On a phone, use **Menu**; Escape closes the drawer and returns focus to Menu. Each area opens the first task your role can access. A missing tab means that role lacks access; direct URLs enforce the same permissions.

| Area | Tasks and screen references |
|---|---|
| Overview | `/admin`: current work counts and Needs attention; Auctions; Business summary |
| Auctions | Auctions, Products & images, Categories, Home & FAQ, Results |
| Money | Deposits, Bank statements, Player balances, Balance checks, Receiving accounts (Owner only) |
| People | Support, Players, Deliveries, Messages |
| Settings | Workspace information, Team access, Staff activity, Message delivery |

## Daily opening checklist

1. Open **Overview**. Counts use database time and include labelled DEMO records. Live means published, started, not ended and not settled. Upcoming has not started; Closing has ended but awaits settlement. People counts distinct participants; accepted bids counts submissions.
2. Follow **Needs attention**: failed closing jobs, deposits, deliveries and support. Deposit reviews count each request once even if it has several review reasons: verification review/duplicate/outage, escalated/reversal review, or pending/verifying for more than an hour. Recent automatic verification is not an incident. Deliveries include winners who have not yet submitted their details; Fulfillment staff see their assignments only. Support counts Open and Investigating, excluding Resolved.
3. Open **Money → Balance checks** before financial operations. Overview does not run reconciliation and never represents an unchecked balance as healthy. A failed or partial read says Unavailable; it does not mean zero. Check the last successful timestamp.
4. Review **Settings → Message delivery**, then reconcile independent bank evidence in **Money → Bank statements**. A statement record is evidence, not a command to credit money.

## Catalog, drafts and Home copy

`/admin/categories`: name, slug, description, visibility and eligibility review. Hidden categories/products are excluded from the player catalog. Eligibility-review categories cannot be published without their required workflow.

`/admin/products`: title, description, condition, category, DEMO marker and images. Upload original/licensed/supplied PNG/JPEG/WebP up to 2 MiB, enter source credit and confirm usage rights. The server validates bytes, bounds dimensions, strips metadata and re-encodes. SVG/script and arbitrary remote-URL uploads are rejected. Attach validated images before saving. An unused draft product may be deleted with the exact confirmation. A product that was ever attached to an auction remains evidence and cannot be deleted.

`/admin/auctions`: create a draft, choose inventory, future start/end, maximum ETB amount, per-accepted-bid fee, deadline-change policy, delivery region and fulfillment terms. New v3 drafts use a fixed ETB 1.00 minimum and ETB 0.01 step. Complete the three form groups, Save draft, inspect Saved preview, then choose Review for publishing. Only the Owner can Publish scheduled auction. Editing invalidates the review; save and review again. Add a product opens a separate tab to preserve your draft, then Find products refreshes the inventory choices. Starts must be at least one minute ahead and the duration within the allowed 30-day window. Preflight does not publish. Publication freezes product identity, core bid rules and fulfillment terms. Owner corrections described below are versioned, prospective and audited.

An unused auction draft may be deleted with its exact code. After publication, use the auction page's **Details**, **Manage** and **History** sections. The Owner may change the fee for future bids, adjust a deadline within its published extension/shortening policy, or correct presentation copy and validated images. Every action requires fresh MFA, a reason and the current control version. Existing bids retain the fee revision accepted with them; settlement and refunds use those exact historical fees. A stale bid confirmation is rejected and must display the latest fee before the player confirms again. Presentation changes cannot replace the product identity or bid rules.

Cancellation still performs the reviewed atomic refund/release command. After that committed result, **Remove cancelled page** removes its public slug and pending promotional inbox jobs while preserving the auction, journals, result proof, audit and message-delivery evidence. The notification worker attempts to delete tracked Telegram promotion messages only while Telegram may still permit deletion; expired, blocked or unavailable messages are recorded honestly rather than claimed deleted. Create a replacement draft for a new offer.

In Settings, an Owner may run the private **Test auction** Create → Finish → Clean up flow only in the permitted local/staging environment. It creates tagged disposable identities, balances, bids, inbox notices and delivery rows under one run ID; no public catalog item, real payment, fulfillment or Telegram send is allowed. Finish uses the normal settlement path. Clean up requires the exact phrase and deletes only the tagged finished run while preserving its staff audit record. Never enable this control in production.

`/admin/content`: Home introduction and additional FAQ entries. Saving changes their managed display content; it never changes auction rules. Supply both language versions and verify Home/FAQ on a phone. Permanent rules must continue to explain holds, fees, no-winner and cancellation outcomes accurately.

## Cancellation and results

For an unsettled auction, expand **Cancel this auction**, then choose **Review cancellation impact**. Read participant count, held ETB to release and entry fees to refund. Enter the reason, type the exact auction code, and complete fresh MFA if requested. If bids changed the preview, refresh and review again. Cancellation is atomic, idempotent and audited; it cannot overwrite a completed result. **It cannot be undone.** Create a replacement draft for a new auction.

`/admin/results` and the auction's **View result evidence** show actual settlement evidence. The frozen rule version controls the result: v1 preserves its no-unique/no-winner behavior; v2/v3 require two distinct eligible participants and use the first database acceptance at the lowest amount only when no amount is unique. A fallback winner is never called unique. A valid winning settlement charges the winning amount from HELD, releases excess and loser holds, and retains disclosed entry fees. Cancellation refunds fees and holds. Public pages never expose live bid distributions or private participant identity.

## Users and support

Use `/admin/support` to assign/investigate/resolve cases with a reason. `/admin/users` permits Owner-reviewed bidding restrictions. Suspension stops new bids; it does not erase accepted bids, release holds arbitrarily or change deterministic outcomes. Players retain history and support access. Do not copy login codes, full payment screenshots or unnecessary personal information into case notes.

## Wallet funding and incidents

`/admin/settings/payments` is Owner-only with fresh MFA. Review the exact previous/proposed receiver, account holder, 1:1 ETB quote, bounds, terms and review reference before publishing an immutable policy version. Saved intents retain their original quote. The channel switch **cannot bypass the global production-credit interlock**. Keys belong in protected server configuration, never this screen.

`/admin/top-ups`: filter requests by status/case, open `/admin/top-ups/[id]`, and compare redacted expected/provider evidence and the verification timeline. Add a reasoned note, assign/escalate or retry an eligible request. Provider duplicate responses need investigation and issue no credit. A locally claimed reference is globally unique for its channel. Resolving a case never changes the receipt or credits the wallet.

New player deposits need only a selected channel, a pasted payment SMS/reference or an uploaded screenshot, and **Submit deposit**. The server freezes the published receiving policy and obtains the amount from official verification. There is no player-entered amount or quote-acceptance checkbox. Until verification succeeds, the amount is shown as awaiting verification. Transfers must fall within the saved limits, be no more than 24 hours old, and be dated after that policy was published. Older amount-based requests retain their original exact-amount and date requirements. A screenshot supplies only a candidate reference; it cannot credit a wallet. Screenshots are still processed in memory and are not retained for staff review.

Ordinary unresolved deposits now offer **Check payment again**. The original deposit and its frozen account, amount limits and transfer-date window remain unchanged. Customer retries allow six total verification attempts, with server cooldowns, until seven days after the original expiry. **Retry** or fresh-MFA **Recover** in the payment detail lets an authorized Owner/Payments Operator use up to twelve total attempts within that same recovery window. Neither action bypasses rejection, escalation, reversal review, ownership conflicts, or transfer validation. After that budget/window, record the deposit ID, obtain independent bank/provider evidence and escalate to the Owner/provider for resolution; any external refund follows the business's reviewed refund process and is recorded as evidence. There is no manual mint button or automatic refund. Do not delete history or create a second claim to reset these limits.

A successful retry records one credit, resolves the ordinary review and clears its assignment. Genuine post-credit escalations/reversal cases stay visible. Provider duplicates can recover only when the documented original API record correlates to a prior local attempt and authoritative receipt evidence still proves the exact receiver and transfer. Insufficient or unrelated evidence stays unresolved. Started requests and completed outcomes are retained as immutable records; a replayed attempt key returns its saved outcome, while **Check payment again** uses a new key. If a process died before saving the outcome, replay seals that attempt as interrupted before a new attempt is allowed.

A submitted reference cannot be edited in place. **Correct a mistaken reference** explicitly starts a separate request using the currently published policy; the previous deposit and history remain intact. Uploads that read a different reference never replace the bound reference. If the corrected reference already exists for that customer/channel, Lowwin reopens that deposit.

`/admin/top-ups/statements`: obtain authorized bank/Telebirr statement evidence independently, archive it privately, then record channel/reference/cents/receiver/date and archive reference. MATCHED/MISMATCH/UNMATCHED entries preserve the evidence. This action never credits or debits ETB. Investigate duplicates, unmatched statements, reversals and provider outages.

An approved reversal uses a separate internal command with fresh Owner MFA, exact intent ID, reason, evidence and idempotency. It creates a compensating balanced journal only when the entire amount remains AVAILABLE. Held or spent funds cannot be forcibly taken. There is no HTTP mint/reversal button, arbitrary credit, payout or automatic external refund. Never delete the original journal.

## Fulfillment

Winners submit a separate delivery contact in **Winning Bids**. Owner assigns the case to an active fulfillment staff member. Assigned staff may audit-read contact and progress CLAIMED → PACKING → SHIPPED (real tracking/reference required) → DELIVERED, or flag DISPUTED. Record actual evidence; a winning result does not imply shipment. Delivery contact does not change Telegram/login identity. It is encrypted and scheduled for deletion 30 days after delivery; a dispute pauses deletion. DEMO items are never shipped.

## Notifications and jobs

`/admin/notifications` and `/admin/jobs` expose durable delivery state and failures. Telegram delivery requires a private bot chat the player initiated. Player notification switches have been removed; blocked chats are respected. Owner retry requires an investigation reason. Retry delivery only, never the associated bid/settlement command. Sent Telegram message IDs are recorded for eligible auction-promotion cleanup. A cancellation or deadline replacement queues best-effort deletion while Telegram may still allow it; the recorded state distinguishes deleted, retrying and unavailable. Telegram may duplicate a message after a crash between send and commit, while financial facts remain idempotent. Do not send broadcasts as a connectivity test.

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

Current local fixture screenshots and exact test evidence are linked in [the admin redesign report](admin-redesign-report.md). They are not production evidence. Route/control names in this guide describe the redesigned workspace.

Publication, cancellation, accepted bids, posted journals, transfer claims, settlement proofs, immutable policy versions and audit records cannot be rewritten through the application. Invitations/recovery codes are one-time; the last Owner is protected. Back up database **and** encryption key versions, perform a separate restore/reconciliation drill, and record the reviewed release SHA. See the current release packet for verified checks and outstanding GO/NO-GO gates.


## New publications: frozen rule v3

Publication preflight now displays the two-person minimum and first-accepted fallback. Two bids by one user do not meet the minimum. Below two eligible participants at the deadline, the worker cancels and refunds every fee and hold; staff do not need to issue manual credits. Otherwise the lowest unique amount wins. Only without any unique amount does the earliest database-accepted bid at the lowest amount win. Staff cannot select or replace a winner.

Results review records `decision`, `participantCount`, `acceptanceCutoff`, amount frequencies, selected acceptance order and financial journal references. Use the immutable proof to investigate; use retry only for failed closing work. `FIRST_ACCEPTED_LOWEST` is not a unique bid. `MINIMUM_PARTICIPANTS` is a cancelled auction with all fees refunded. Existing v1/v2 terms and outcomes remain unchanged. New v3 publications additionally require a minimum bid of ETB 1.00, a step of ETB 0.01, and at most three adjacent cent amounts per participant. The database rejects a fourth adjacent amount, even when submitted out of order. See the [release/Owner review packet](frozen-auction-v2-release.md) for examples, rollout and rollback limits.


## Automatic alerts and Owner broadcasts

There are four automatic Telegram events: a published auction (draft products send nothing), less than 24 hours remaining (once per auction), auction completion/result including cancellation, and a verified credited deposit (only its depositor). Auction events reach all linked player accounts with an available private bot chat; staff are excluded. Private bid/fulfillment receipts remain in the in-app inbox, without additional Telegram messages. Every Telegram message includes the player's name and a **Bid** button. Auction messages link to that auction; deposit/general messages link to all auctions. Result messages also include the public result link. No active bid amounts or private proofs are broadcast.

At `/admin/notifications`, the Owner can compose an informative message, optionally use `{name}`, upload a JPEG/PNG/WebP image up to 2 MiB with confirmed usage rights, and optionally enter an active public auction code. Preview, then choose **Queue broadcast**. This requires fresh MFA and is audited; reusing the same request safely returns the same queue receipt. The audience count is linked accounts, not guaranteed delivery: unstarted or blocked chats are skipped. Queued delivery is performed by the notification worker. General broadcasts are retained delivery records and have no recall control. Auction-promotion cleanup follows the limited tracked deletion process above. Recheck the private job queue before retrying failures. Never use a real broadcast to test connectivity.

See [cent-money v3 rollout](cent-money-v3-release.md) before deploying this version. Do not mix old integer clients with decimal-aware processes.

## Reading reports and delivery states

**Overview → Business summary** filters activity by UTC day, explicitly labelled on the form. Auction deadlines elsewhere display EAT. Current account balances are all-time and do not change when activity dates change. Available, held and platform account balances are not profit. Open **Money → Balance checks** to run an explicit read-only reconciliation; inspect its timestamp and any discrepancies.

Deliveries use Awaiting winner details (PENDING), Ready to pack (CLAIMED), Packing, Shipped, Delivered and Needs attention (DISPUTED). Ready to pack does not mean packed. Only the Owner assigns an active eligible staff member using the searchable selector. Contact reads remain audited and restricted to the Owner or assigned specialist. Shipment references are required for Shipped. Staff cannot bypass the winner claim step.

In Staff activity, Review shows the actor, action, timestamp and recorded reason; technical IDs remain under evidence. Message delivery describes notification jobs. Retrying a failed notification never repeats a financial command. Messages separates Compose message from Delivery history; broadcasts still require the existing preview, SEND confirmation and fresh MFA.

Receiving accounts displays configured availability without claiming the provider was live-tested. Enter deposit limits and statement transfers in ETB (for example 1.97); the request converts them to exact cents. Changing any receiving-account field invalidates its review. A failed write preserves values, displays an error and allows a deliberate retry with the same idempotency key. Case resolution or notes never issue a credit.
