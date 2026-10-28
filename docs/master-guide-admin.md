# Master Guide Admin

This is the reusable Lowwin admin contract requested on 28 October 2026. When a future project refers to **Master Guide Admin**, use this authentication flow and compact table layout, adapting its domain records. This document supersedes older admin guidance about invitation bootstrap, authenticators, remembered devices and seven-area navigation.

## Registration and access

1. Open `/admin/login` and choose **Create an account**. Register a separate staff email with a password of 12–128 characters. Registration creates `User.role = 'member'` and does not sign the account in.
2. Verify the email using the Resend link. Verification confirms the address; it does not grant admin access.
3. An authorized database operator promotes that exact verified email account to `admin` using the SQL below. The first admin follows the same process.
4. Sign in with email and password. No invitation, bootstrap secret, authenticator or 2FA enrollment is part of this flow.
5. **Forgot password?** sends a Resend reset link. Verification and reset links expire after 30 minutes. A successful password reset revokes existing sessions and preserves the account's current role.

Server configuration requires `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` and a verified `EMAIL_FROM` address. Keep credentials in server configuration. Use the application's trusted `BETTER_AUTH_URL` for email callbacks.

After the Master Guide Admin migrations are applied, inspect the new signup account by its exact email:

```sql
SELECT id, email, role, "emailVerified", "telegramId"
FROM public."user"
WHERE lower(email) = lower('your-staff-email@example.com');
```

Promote only that verified member account with no linked Telegram identity:

```sql
UPDATE public."user" AS u
SET role = 'admin', "updatedAt" = CURRENT_TIMESTAMP
WHERE u.email = lower('your-staff-email@example.com')
  AND u.role = 'member'
  AND u."emailVerified" IS TRUE
  AND u."telegramId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."StaffMember" AS s
    WHERE s."userId" = u.id AND s.active IS FALSE
  )
RETURNING u.id, u.email, u.role, u."emailVerified";
```

Expect exactly one returned row. If none is returned, check the email, verification and identity state; do not mark an unverified email as verified or unlink a player's Telegram identity to bypass the checks. Create a fresh staff account for this flow. Do not supply `role`, `emailVerified` or staff grants in signup requests.

Every admin page and API checks the current database role, verified email, active staff compatibility row and a password-issued session. Telegram player sessions do not grant admin access. Sessions have an absolute eight-hour cap; logout and password reset revoke sessions. Role or verified-email changes invalidate sessions. The old `StaffMember.role` values are compatibility data, not the source of new admin permission grants.

## Workspace

| Section | Route | Main view |
| --- | --- | --- |
| Overview | `/admin` | Small work summary and active auctions |
| Auctions and Catalog | `/admin/auctions` | Existing auction, product, category and validated media management |
| Players | `/admin/users` | One table with identity, verified contact availability, available/held balances, bids/wins, referral counts, status and joined date; details on demand |
| Payments | `/admin/payments` | Chapa payments: name, Telegram username, phone, amount, purpose, date and status; payment details on demand |
| Winners | `/admin/fulfillment` | Winner, phone, product, date won and delivery status; details and delivery completion |
| Broadcast | `/admin/notifications` | Message, optional image, Mini App button and delivery history |

Use Lowwin's existing logo, DM Sans/Ethiopic support, warm white canvas, white tables, near-black selection and restrained gold actions. Desktop uses a compact sidebar and shallow top bar with a wide workspace. On 360px/430px screens, the navigation becomes a drawer and dense tables scroll horizontally **inside their bordered containers**. Preserve column headers, search, pagination, refresh, keyboard focus and detail drawers.

Remove separate wallet/journal/referral tabs, refund/compensation/reconciliation views, finalized-results/delivery tabs, content editing, reports, settings and staff-onboarding controls from ordinary navigation. This is a scoped interface and access-flow replacement: financial records, immutable settlement rules and server-side validation remain intact. Chapa-only payment display does not activate a gateway or delete older provider evidence.

## Broadcast and correctness

Broadcasts go through the Telegram bot only and never create Mini App inbox notifications. Support a message of up to 700 characters, an optional validated PNG/JPEG/WebP image up to 2 MiB, a button label of up to 40 characters and an allowed Mini App destination. Show a preview and require a final send action. The worker reports pending/sent/failed/skipped delivery honestly; queuing is not delivery confirmation.

Keep server pagination and bounded queries. Cache private reads by user, session and role, invalidate only affected data after writes, and clear caches on logout or account changes. Load detail views on demand and avoid prefetching every admin section. Missing storage or failed reads must remain unavailable, never fabricated zero balances or successful payments. Amounts, payment credit, bids, winner selection and delivery changes require authoritative server results.

Retire old admin credentials and sessions without deleting referenced user, financial, delivery or audit identities. Historical account rows may need to remain as evidence. Do not clear users, journals, settlements or audit tables to achieve a fresh login.

## Implementation and verification boundary

The source migrations are `202610280001_master_guide_admin`, `202610280002_retire_admin_bootstrap_guard` and `202610280003_retire_legacy_admin_auth`. The last migration requires retiring legacy logins and privately backing up every row in its three obsolete auth tables before dropping them. Keep `StaffMember` and `StaffSession` compatibility storage for authorization and historical references. The optional historical contact-decryption key is separate from the password-only login flow.

See the [28 October cutover record](master-guide-admin-cutover-2026-10-28.md) for executed production changes and remaining deployment work.

The focused browser suite is `tests/redesign-browser/master-guide-admin.spec.ts`. It uses real email/password sessions in an explicitly owned loopback `_test` database and read-only table fixtures for responsive interaction checks. It does not send Resend emails, Telegram broadcasts or Chapa payments. Local checks, production deployment, actual email delivery, bot delivery and live provider verification are separate evidence. This guide makes no production or deployment completion claim.
