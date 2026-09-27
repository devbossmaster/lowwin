# Lowin Owner runbook - Phases 5A and 5B

This workspace is invite-only. There is no public staff registration, balance editor, winner override, generic point credit or hard-delete endpoint. Phase 5B adds scoped delegation, support, fulfillment and opt-in notifications; see the operations supplement below. Production release checks remain open.

## Before using a database

Inspect the host, port and database name without printing credentials. The checked-in working `.env` targets remote Supabase (`aws-1-eu-west-1.pooler.supabase.com:5432/postgres`); it was not migrated or changed in this phase. Every verification command supplied explicit disposable loopback URLs. Never run migration, fixture or bootstrap commands against an unidentified target.

Migration `202609270007_admin_foundation` adds staff/session assurance, hashed invitation/reset tokens, a bootstrap singleton, immutable admin audit and image records, draft JSON and editable Home/FAQ records. It adds optimistic versions to products/categories, enables RLS and revokes anon/authenticated access on new private tables. Runtime-role permissions and RLS on real Supabase remain unverified. The preceding eight migrations and ledger/hold/settlement guards remain in force.

## First Owner, local test delivery

1. Create a disposable loopback PostgreSQL database whose name ends `_test`. Set both `DATABASE_URL` and `DIRECT_URL` explicitly to it; set `APP_ENV=local`, the existing Better Auth and Telegram test configuration, and local `BETTER_AUTH_URL`/`MINI_APP_URL`. Run `npm run db:migrate` and, if wanted, `npm run db:seed:catalog`. Existing published catalog schedules must not be reset.
2. Generate a server-only 32-byte random key, stored as 64 hex characters in `ADMIN_MFA_KEY`. Keep it outside source control and back it up securely. Losing it prevents authenticator decryption. Never use the fixture keys outside tests.
3. Set `EMAIL_TRANSPORT=local-sink` and `EMAIL_SINK_URL=http://127.0.0.1:8027`. Run `npm run email:sink` in a separate terminal. It binds only to loopback, receives actual HTTP mail deliveries and writes `.local/email-sink/messages.jsonl`. The file contains credential links; keep it private. It has no HTTP inbox endpoint.
4. Temporarily set `ADMIN_BOOTSTRAP_ENABLED=true`; run `npm run admin:bootstrap -- --email owner@example.test`. This uses a separate staff identity, creates one audited invitation and does not grant permissions. Replays are denied by a durable singleton. Disable bootstrap again.
5. Open the invitation from the local sink within 24 hours. Set a password of 12–128 characters. The one-time email link verifies control of that mailbox; the verified staff identity is never linked to a Telegram player identity. An expired invitation fails closed; there is no automatic bootstrap bypass or manual role-edit recovery flow in this release.
6. Enter the displayed setup key into a compatible TOTP authenticator: SHA-1, six digits, 30-second period, issuer Lowin. Confirm a code. Save all ten recovery codes securely; they are displayed once. Only after successful enrollment does the rotated credential session gain admin assurance.

The email adapter interface is provider-neutral (`ServerEmailAdapter.send`). Only the local sink implementation exists. Production, hosted, remote-database and missing-provider configurations report email unavailable. Real production invitations/resets require a reviewed provider implementation and delivery verification first; no simulated success is returned.

## Authentication and recovery

Better Auth **1.6.33** and better-auth-telegram **2.0.1** remain pinned. The custom staff plugin uses their installed/exported endpoint, scrypt password and signed session-cookie primitives. It does not enable the generic Better Auth admin or two-factor endpoint surface. TOTP is RFC6238 compatible; secrets use AES-256-GCM, recovery/reset/invitation tokens use SHA-256 storage, and consumed counters prevent OTP replay. Clock checks are repeated after staff/token lock waits.

The deliberately allowed staff POST routes are `/api/auth/lowin/staff/{accept-invite,login,enroll,mfa,step-up,forgot,reset,logout}`. Origin checks and durable per-account limits apply; MFA throttling is not keyed to arbitrary browser headers. General email signup/signin, impersonation, arbitrary password-setting, role changes and deletion routes remain unavailable. The existing Telegram, local-identity, sign-out and get-session routes retain their boundaries.

An admin grant belongs to one exact signed session, lasts **15 minutes**, and derives from credentials no older than **8 hours**. Cancellation requires MFA within **5 minutes**. Password-only, reset-only, enrollment, Telegram, local-identity, revoked and expired sessions cannot access admin pages or APIs. Re-enter a new authenticator code for step-up; a previously used code is rejected. Wait for the next code if necessary.

Forgot-password responses are identical for known and unknown accounts when mail is available. Reset links expire after 30 minutes and are one-time. Reset consumes outstanding reset tokens and revokes every account session. Sign in with the new password and authenticator. A recovery code also revokes all sessions and clears the old authenticator/recovery set; re-enrollment is mandatory before any admin access. There is no unauthenticated MFA removal.

## Inventory and publication

Use Categories and Products to create or edit unpublished inventory. Hide unused inventory using its Visible checkbox. Referenced published products/categories cannot be changed by admin commands; create replacements. DEMO inventory cannot become real inventory. New images must be PNG, JPEG or WebP, at most 2 MiB, with source credit and explicit usage rights. The server checks magic bytes, decodes at most 16 million pixels, strips metadata and re-encodes PNG. It does not fetch arbitrary external URLs. SVG/script uploads fail. Prior original catalog SVG placeholders remain unchanged.

Create an auction draft, choose inventory, enter future dates, integer range/step/fee and fulfillment terms, then save. The phone preview shows saved values; it cannot bid. Run publication preflight. It requires visible inventory/category, an image, a start at least one minute ahead, an end within 30 days, aligned positive point terms and a supported category. Eligibility-review categories are blocked until their workflow exists. DEMO publication is isolated to local/test databases.

Publishing is atomic and freezes inventory identity, times, point terms and fulfillment snapshot. The published auction stays scheduled until its server-authoritative time window. A schedule expiring does not imply a winner: it remains Closing / result pending until the separate settlement worker commits. The worker command remains `npm run worker:auctions`; no deployment or external delivery is part of this runbook.

## Cancellation and financial evidence

Open an unsettled published auction and choose Review cancellation impact. The server locks the auction and lists every participant's held points and entry-fee refund, plus exact totals. It exposes no live amount-frequency distribution. Enter a reason and type the full auction code. Confirm a fresh authenticator code if needed, then submit cancellation. If bids changed the impact, refresh and review again.

Actor and OWNER permission are derived from the session. The browser supplies no trusted actor/role. The auction row is locked first; the unchanged Phase 4A command then takes wallet advisory locks in stable order. Cancellation, all hold releases and fee refunds, result/outbox intents and immutable admin audit commit in one transaction. A failed audit rolls everything back. Idempotency retries return the prior receipt; changed input with the same key fails. The screen shows success only after database confirmation.

Cancellation cannot overwrite a settled or illustrative result. Use Create replacement draft after cancellation to preserve the original history. Entry fees are retained on a valid settled/no-winner close, and refunded on cancellation. No fulfillment/shipment is implied.

After completion, Read decision proof & journals exposes private result proof, settlement movements, balanced journal postings and current participant account/hold projections to an assured Owner. Reconciliation is read-only. Investigate any drift; never manually edit account balances or winner data. Audit records reject UPDATE, DELETE and TRUNCATE. Database superuser capabilities are outside this application boundary and need production operational controls.

## Release work still required

Real production email delivery; real Telegram-client checks; Supabase runtime-role/RLS permission tests; production HTML cache/security-header verification; settlement load testing; independent security review of the custom staff plugin. Browser regression uses the development server and does not establish production HTML behavior. No deployment was performed.
# Phase 5B operations supplement

Home remains the Mini App landing page. The current visual direction is pure white, flat surfaces and selected green gradients. Payments are not active.

## Team and recovery

Use `/admin/team` with fresh MFA to invite a separate staff credential identity. Email ownership is verified through the one-time invitation. Catalog Manager can prepare inventory and propose publication; only Owner publishes/cancels. Support reads cases and proposes suspension/restoration; only Owner applies bidding restrictions. Fulfillment sees only assigned delivery contacts. Auditor reads evidence without mutations. Payments Operator has read-only wallet access; actual payment operations remain Phase 6. All grants are server-derived, and changing grants/revoking staff deletes existing sessions immediately. No staff identity can bid. You cannot alter your own grants or remove the last active Owner.

If the initial Owner invitation expired unclaimed, temporarily enable `ADMIN_BOOTSTRAP_ENABLED` and run `npm run admin:reissue -- "reason for recovery"`. This can be used exactly once before any staff account exists. It revokes the old token, emails a replacement to the original email and records immutable audit. It does not bypass enrollment. Disable bootstrap afterward. Production email currently reports unavailable; do not use local sink transport outside an isolated test environment. Password reset revokes all sessions but still requires MFA. A recovery code revokes sessions and requires authenticator re-enrollment.

## Daily operations

Review reconciliation before operating auctions; never edit a balance or journal to hide drift. `/admin/wallets` links real wallets to immutable operation/journal evidence. Top-ups have no active controls. Use the paginated auction/product queues and draft inventory search; published schedules and terms remain frozen. Correct published mistakes through existing reviewed cancellation/replacement.

Support cases require a reason and are audited. Support may propose a suspension in a case; Owner applies it from Users. A suspension stops new bids only. Accepted bids, fees, holds and deterministic outcomes remain valid. Players can continue viewing their wallet/history and contact support.

For settled winners, the player submits separate delivery contact in My Wins. Owner assigns a case to an active fulfillment staff user ID from Team. Assigned staff can move CLAIMED → PACKING → SHIPPED (shipment reference required) → DELIVERED, or open a dispute. Read access to contact is audited. Contact never changes Telegram/authentication identity. Delivery events cannot change settlement proof. DEMO cases remain tests and imply no real dispatch. Mark delivered only with actual evidence; resolve disputes with reasons rather than overriding a winner.

Delivery contact is encrypted server-side and scheduled for deletion 30 days after delivery; a dispute pauses that deletion. The notification worker performs the purge. Staff should minimize free-text personal information. Keep required ledger/audit records immutable; review jurisdiction-specific retention before release. No contact export is implemented.

## Alerts and delivery incidents

Run `npm run worker:notifications` as a separate supervised service alongside the webhook command worker (`npm run worker`) and settlement worker (`npm run worker:auctions`). This phase does not deploy services. Private inbox/outbox intents commit with source transactions. Telegram requires the player's opt-in preference and a private chat initiated by `/start`; no browser chat ID is accepted. Scheduled start/ending reminders apply to saved auctions, recheck eligibility and never invent historical DEMO events.

Review `/admin/jobs` and `/admin/notifications` for FAILED/PENDING delivery. 429 honors retry timing; bounded retries stop after eight attempts. A blocked user must restart the private bot chat before Owner retries. Record an investigation reason for every retry. Retry only notification delivery, never a financial command. After a crash between external send and database commit, Telegram may show a duplicate message; this does not duplicate an inbox entry, fee, hold or settlement.

`WALLET_TEST_PREVIEW=true` reveals only synthetic, explicitly non-payable Telebirr/CBE references on isolated local `_test` databases. Production shows accounts unconfigured. Do not request transfers; no conversion policy, screenshot intake, OCR or payment verification exists until Phase 6.

Production email, real Telegram clients/delivery, remote Supabase runtime roles/RLS, production HTML headers, independent auth security review, load testing, monitoring and backup/restore remain release checks. The remote `.env` database is unchanged.
