# Profile and referral discounts

## Current setup entry point

Open **Admin → Players → Referral rewards** at `/admin/users/referrals`. The retired `/admin/settings/referrals` URL stays retired; setup now lives in the compact Players workspace. Access follows [Master Guide Admin](../master-guide-admin.md): verified email, a database-assigned `user.role=admin`, an active staff compatibility record and an eligible password session. There is no bootstrap, invitation or MFA step. The existing policy draft is 10% off one accepted submission fee, valid for 30 days; neither opening the page nor applying migrations enables awards. Review those terms, check **Allow new referral rewards**, enter a reason and save to activate new invitations explicitly. Existing coupons retain their recorded percentage and expiry when the policy changes or pauses.

Before saving, the additive `202610260001_referral_rewards` migration and restricted runtime grants must be present, and `REFERRAL_REWARDS_SCHEMA_READY=true` must agree across Web, bot and payment workers. `TELEGRAM_BOT_USERNAME` must be the correct configured bot username for invitation links. This setup does not enable a payment gateway or alter balances. Profile shows the actual Active/Paused/Unavailable invitation state, server-earned coupon terms and a **Use a discount** link to auctions. It never advertises a free bid for a percentage discount.

Admin sign-in, registration and reset-password fields share an accessible Show/Hide password control. Passwords remain masked initially; the toggle does not submit the form or change the authentication or password rules.

This update replaces the old Profile submenu with the approved English/Amharic layout: a local page header, Telegram photo with initials fallback, verified account card, accurate wallet balance, Top up sheet, activity summary, referral sharing, earned discounts, editable basic information, and confirmed logout. The former wins/favorites/alerts/payment-list cards and unused presentation components are removed. Existing records and legal documents are retained.

## Reward and payment behavior

- One newly referred customer can qualify once, after their first accepted bid. Failed attempts do not qualify; self-referral, existing-account retroactive claims, staff/test sponsors, and reused rewards are rejected.
- Admin → Players → Referral rewards configures a **5–15%** submission-fee discount, valid for **15–30 days**. The unsaved draft is **10% / 30 days / disabled**. Saving values does not enable rewards unless the explicit checkbox is selected. Current role-based admin authorization, origin checks, rate limits, version checks, durable idempotency, and audit records protect changes. Authorization is checked again inside the policy transaction.
- Each earned discount is single-use and snapshots its percentage, expiry and policy version. Later edits or pausing new awards do not rewrite existing coupons. The customer sees a percentage and expiry, rather than an opaque coupon code.
- Attribution uses an authenticated Telegram bot start or HMAC-verified launch payload. A database insert trigger creates transaction-bound registration proof for new Telegram accounts; existing accounts are not backfilled. This avoids app-clock comparisons and supports safe renewal of expired, unused pending attribution without replacing the original referrer.
- Redemption locks and validates the owned, unexpired coupon inside the accepted-bid transaction. Gross frozen bid fees remain unchanged. A balanced contra-fee journal records the discount before the normal gross fee debit; the net wallet cost is gross fee minus discount. Failed, late or conflicting commands roll back reward consumption and all ledger effects together. Database constraints/triggers and reconciliation enforce these relationships.
- The bid sheet requests a private discount quote only after Apply earned discount. Removing it restores the gross fee. Previewing or switching Wallet/Chapa does not consume a coupon or authorize a payment.
- Referral setup does not enable or disable funding. The Top up sheet follows the server's Chapa availability; wallet-funded bids follow the separate wallet-bid capability. New Chapa checkouts, live-mode approval and payment recovery retain their own configuration and server safeguards. A referral policy cannot authorize payment, credit a wallet or accept a bid.
- `REFERRAL_REWARDS_SCHEMA_READY=false` is the default and avoids new-schema reads on older databases. Enabling this storage flag is separate from explicitly enabling new awards in Admin and separate from all funding flags.

## Old links and retained records

| Existing URL | Current destination |
| --- | --- |
| `/wallet` | `/profile#wallet` |
| `/wallet/deposit` | `/profile?topup=1`, opening the existing Top up sheet |
| `/profile/wins`, `/winning-bids` | `/my-bids?view=history` |
| `/profile/favorites` | `/auctions/all` |
| `/profile/alerts` | `/?notifications=1`, opening Notifications |
| `/faq` | `/#how-lowwin-works` |
| `/payments` without a valid owned checkout | `/profile#wallet` |
| `/payments?checkout=…` (also `checkoutId` or `id`) | The authenticated owner's actual `/auctions/{publicCode}?checkout={id}` |

Checkout recovery accepts exactly one well-formed UUID and checks ownership server-side; missing sessions, other users' records and malformed/ambiguous links reveal no checkout. Database errors remain retryable rather than silently discarding checkout identity. Consumed sheet intents are removed from the URL so returning to Profile/Home does not reopen them.

Users, contact verification, wallet/ledger history, bids, auction terms, settlements, payment/provider records, audit evidence, and staff operations are not deleted or reset. Terms, Privacy, support, auction browsing and personal bid history retain meaningful destinations. Removal concerns obsolete customer presentation, not historical financial evidence or provider reconciliation.

## Historical implementation evidence

The results and captures below describe the original Profile/referral implementation, before Master Guide Admin and the current Chapa checkout flow. References to MFA sessions and disabled Top up actions record those historical fixtures; they are not current setup requirements or evidence that funding is disabled now. Use the current setup and capability rules above for today's application.

All screenshots and browser/financial fixtures are **synthetic data in a disposable loopback PostgreSQL `_test` database**. Fixture balances, phones, links, product titles and rewards are not production customer data or commercial claims. Telegram sharing and avatar delivery were intercepted locally; the browser did not send messages, submit bids or initiate payments.

| Focused validation group | Result / scope |
| --- | --- |
| Backend referral/compatibility | **59 passed**: 16 referral financial/database cases plus 43 existing bid/contact/avatar cases; includes clock skew, first-bid concurrency, idempotency, atomic discounts, old-schema behavior and runtime-role access. [Sanitized report](measurements/profile-referrals/backend-validation.json) |
| Admin unit/API/workspace | **37 passed** in the original validation: 26 referral policy cases plus 11 admin workspace cases; ranges, then-current permissions/MFA, idempotency, versions, private responses and unchanged payment settings. |
| Legacy redirect/return compatibility | **30 passed**: 18 legacy route cases and 12 Mini App return-path cases. |
| Profile contact / quote / client auth | **33 passed** on the final integration-owner rerun: private contact fields, discount preview/API checks and logout/session behavior. |
| Customer browser | **4 passed** at 360px/430px in the original validation: English/Amharic, actual server-earned fixture reward, edits, Telegram-avatar path/fallback, sharing interception, then-disabled Top up, intent cleanup, net-fee preview without redemption, empty rewards, private access and logout. [360px](measurements/profile-referrals/profile-ui-360.json), [430px](measurements/profile-referrals/profile-ui-430.json) |
| Admin browser | **2 passed** at 1440px/430px using the former credential/MFA flow: stale-MFA rejection and step-up, same-key retry, invalid bounds, lower/upper settings, explicit pause/enable, audit, unchanged coupon snapshots, reconciliation, 401/403, no overflow or page errors. These captures predate current role-based access. [1440px](measurements/profile-referrals/admin-referral-policy-1440.json), [430px](measurements/profile-referrals/admin-referral-policy-430.json) |
| Typecheck / schema / build | Final TypeScript checks passed in both the D validation worktree and the user's C worktree; backend Prisma validation passed. The final optimized webpack build passed in 2m21s, generating all 21 static pages, against the isolated fixture with provider flags disabled. Next ignored a parent-directory lockfile outside the Git root; this did not prevent the build. |

These are separate runs and may overlap; do not add them into a unique-test grand total. The final root command is `npx.cmd vitest run tests/profile-contact.test.ts tests/bid-discount-preview.test.ts tests/discount-quote-api.test.ts tests/mini-auth-client.test.ts`. Redirect compatibility used `npx.cmd vitest run tests/legacy-customer-redirects.test.ts tests/mini-return.test.ts`.

Representative historical captures:

- Profile: [360px English](screenshots/profile-referrals/profile-360-en-top.png), [basic information](screenshots/profile-referrals/profile-360-en-lower.png), [430px Amharic](screenshots/profile-referrals/profile-430-am-top.png), [Amharic lower section](screenshots/profile-referrals/profile-430-am-lower.png), [new account](screenshots/profile-referrals/profile-empty-360.png).
- Sheets: [English Top up](screenshots/profile-referrals/profile-top-up-360-en.png), [Amharic Top up](screenshots/profile-referrals/profile-top-up-430-am.png), [English earned discount](screenshots/profile-referrals/bid-earned-discount-360-en.png), [Amharic earned discount](screenshots/profile-referrals/bid-earned-discount-430-am.png).
- Admin: [desktop](screenshots/profile-referrals/admin-referral-policy-1440.png), [430px](screenshots/profile-referrals/admin-referral-policy-430.png).

The private read projection also verified a wallet-funded receipt showing gross fee 10, discount 1 and net fee 9, all fixture units: [sanitized projection](measurements/profile-referrals/read-projection.json). Admin browser writes restored the isolated fixture policy to enabled 10% / 30 days afterward, retaining audited version increments; this is not the default or a production activation.

Hosted migration, merchant/provider behavior, real Telegram message/avatar delivery, Android/iOS Telegram WebViews, and production latency/query plans are **not verified** by these local checks. This note does not approve production deployment or payment activation.

## Referral-specific staging and rollout procedure

1. Confirm the exact staging database and take a restorable backup. Review pending migration history, the additive `202610260001_referral_rewards` migration, and `deploy/runtime-role.sql`. For a new referral rollout, keep `REFERRAL_REWARDS_SCHEMA_READY=false` and the new-award policy disabled during preparation. Preserve the correct bot/contact encryption configuration. Funding and provider capabilities are independent; this referral procedure does not change their reviewed configuration.
2. Apply the reviewed migration using the schema-owner connection, then apply the reviewed runtime-role grants/RLS setup. Verify the seven private referral tables, trigger-owned registration proof, immutable reward/redemption evidence and minimal runtime privileges. Do not grant browser roles table access or make the runtime role a table owner. Generate the matching Prisma client and complete the integrated build.
3. Deploy/restart matching web and bot/worker processes with the storage flag still false. Check auth/contact, read-only balance, existing navigation, owned checkout recovery and reconciliation. Avoid mixed-version attribution/bid workers when enabling the feature.
4. On staging only, set `REFERRAL_REWARDS_SCHEMA_READY=true` after migration/grants are confirmed, then restart the matching processes. Sign in through the current verified-email, database-role admin flow. Confirm the admin draft is disabled and configure the actual bot username for referral links. Save reviewed percentage/validity with a reason; enable new awards explicitly only when the staging test is ready. This step must not change Chapa, wallet-bid or other funding capability flags.
5. Rehearse new-account attribution, one first accepted bid, duplicate/concurrent retry, expired/foreign coupon rejection, gross/net receipt and wallet reconciliation in authorized disposable fixtures. Validate Profile/top-up/back navigation and privacy with two accounts. Complete physical Telegram checks before a separately reviewed production canary. Record the baseline and restore-tested rollback artifact before any production step.

For rollback, **pause new awards in Admin first**. This preserves existing coupons and their expiry snapshots. If the feature must be gated off, set `REFERRAL_REWARDS_SCHEMA_READY=false` and restart matching services; use a previously reviewed compatible application build if code rollback is needed. Keep the additive schema, granted safety controls, registration/attribution evidence, coupons, redemptions, journals and audits. Do not drop tables, rewrite completed records or reverse ledger entries as a UI rollback. Keep provider recovery available under its existing reviewed controls without activating new funding.
