# Master Guide Admin cutover — 28 October 2026

Production database changes completed using the explicitly authorized production project and verified TLS session connection. Private schema and exact authentication-row backups are stored under ignored `.local/master-guide-admin/`; credentials and tokens are excluded from this document.

- Applied additive Chapa v2 audit storage and admin migrations `202610280001`, `202610280002`, and `202610280003`. Unrelated pending ArifPay/referral migrations were not applied by this cutover.
- Retired the old administrator's credential, 45 sessions, 45 session grants, two trusted devices and matching invitation token. Cleared its email, verification and MFA material and deactivated its staff row. The email is available for a fresh signup; no replacement admin was created automatically.
- Retained the historical user ID because two admin-credit records and existing audits reference it.
- Backed up all remaining obsolete auth rows, then removed `StaffToken`, `StaffTrustedDevice`, `OwnerBootstrap`, their device FK and dead device-revocation trigger/function.
- Verified protected financial records before/after migrations using row hashes. Retirement preserved 1,246 wallets, 93 journals, 186 postings and the 2,103 ETB wallet total. One explicit retirement audit record was added.

The first cleanup attempt lost its database connection and rolled back. A fresh read-only audit confirmed that state before the successful retry; schema and row backups remain available for both attempts.

Source validation passed: Prisma generation, TypeScript, optimized webpack build, eight real Better Auth/database/email-sink integration cases, focused financial/workspace tests, four responsive browser cases at 360/430px plus 1440px captures, and the scoped UI detector. Browser table records were explicit fixtures; credentials, sessions, role checks and logout used real owned PostgreSQL. Real Resend email delivery and Telegram broadcast delivery were not exercised.

**The updated web application has not been deployed.** Deploy the matching source and generated Prisma client before using the new signup UI. Then register at `/admin/login`, verify the Resend email, assign the exact verified account `role='admin'` using the [canonical guide](master-guide-admin.md), and sign in. Old credentials intentionally no longer work.

Chapa TEST-key authentication succeeded with a read-only payment-methods GET returning HTTP 200. A separate webhook secret and local setup file were prepared. The TEST webhook dashboard setup and isolated staging schema review remain separate; creation, recovery and live-payment switches stay disabled. No real payment was created or credited.
