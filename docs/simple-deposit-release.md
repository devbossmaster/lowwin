# Simple deposits and remembered admin devices

Review branch: `review/simple-secure-deposit-20260930`, based on merged PR #3 (`bf370b4`). No production migration, deployment, payment, or notification send is part of this change.

## Behavior

- Telebirr/CBE: choose the account, paste SMS/reference or upload a compressed screenshot, then submit once. No amount field, quote acceptance, review checkbox, or expanded policy text in the player flow. English and Amharic copy cover the new states.
- Official evidence supplies the exact cent amount. Receiver, currency, completed transfer, reference, frozen policy limits and bounded transfer date still control crediting. The amount is initially unset and can be filled only once with the committed claim and balanced journal. Existing intents retain their frozen amounts and terms.
- New receipt-derived requests allow transfers within the preceding 24 hours, never before the selected policy publication. The submission expires after 30 minutes. This is a new policy for new intents only.
- OCR accepts a clearly read reference even if surrounding artwork/text lowers overall confidence; ambiguous references still require manual entry. Images remain memory-only. The screenshot does not authorize credit.
- Successful credits immediately refresh the wallet and in-app alert badge. The Telegram outbox is already created in the credit transaction and dispatched by the notification worker; actual delivery still depends on that worker, Telegram and the recipient's bot chat.
- Admin MFA offers a 30-day device checkbox. Persistent HTTP-only, Secure-on-HTTPS, SameSite=Strict host-only cookies contain random tokens; only hashes are stored. Password is still required, tokens rotate at login, expiry is absolute, and remembered login does not create fresh TOTP assurance. Logout, password reset, recovery, authenticator changes, and role/active changes revoke trust.

## Verification

All mutable tests used newly created, explicitly disposable loopback databases and local provider/email fixtures.

| Check | Result |
|---|---|
| Full database/unit regression | 346 tests passed, 38 files, zero skipped; 224.80 seconds; exit 0 |
| Payment browser matrix | 16 passed at 360px/430px and admin laptop/tablet; 1.7 minutes; exit 0 with managed servers stopped and ports released |
| Typecheck | Passed (`tsc --noEmit`) |
| Production build | Passed after successful Prisma generation (`next build`) |
| Dependency audit | 0 vulnerabilities (`npm audit --audit-level=low`) |
| Whitespace check | `git diff --check` passed |
| Visual inspection | Deposit at 360px, credited receipt at 430px, and masked admin device checkbox reviewed |

Regression coverage includes provider-derived cent amounts for both channels, unique claims, immutable amounts, ledger integrity, rejection of incorrect evidence, trusted-device rotation/expiry/replay/forgery, password-reset revocation, and fresh-MFA enforcement. The design detector reported token/style advisories against the older design reference; it is not recorded as a zero-finding pass. General browser CI and security scanning have not been rerun for this revision locally and remain PR checks. Native-language and live-provider/device checks are not included in these results.

Decision: GO for application review. NO-GO for declaring the real funding pilot validated: the existing duplicate-review incident remains unresolved. Production rollout requires the migrations and separate smoke checks below.

## Rollout

1. Review the application diff and verify the production backup using the established release procedure. Do not seed production.
2. Apply additive migrations with the migration role, in order: `202609300002_staff_trusted_devices`, then `202609300003_receipt_amount_funding`. Historical financial records are not rewritten. The first migration grants the new table to an existing `lowwin_runtime`; fresh installations use the updated `deploy/runtime-role.sql`.
3. Generate Prisma and deploy the reviewed application revision. No new environment key is required. Existing MFA encryption and payment activation configuration remain required.
4. Verify sign-in without trust, sign-in with trust, a fresh-code payment-settings action, logout/revocation, both deposit channels, and wallet/payment reconciliation. Use Owner-approved transfers only; do not send another transfer to work around an unresolved receipt.
5. Production smoke checks and real provider behavior must be recorded separately. Local fixture success is not production activation evidence.

## Rollback

Keep the additive schema and all records. Before any receipt-derived intent is created, the previous application revision can be restored normally. After new intents exist, older wallet code cannot safely display their unset amounts: disable live crediting and roll forward with a correction on this schema instead of blindly rolling back to PR #3. Do not set guessed amounts, remove claims, drop migrations, reset balances, or rewrite journals. For an MFA incident, revoke the affected staff member's remembered devices through reviewed operational recovery and require fresh login; never disable MFA globally.

## Unresolved production incident

The Owner's ETB 30 pilot remains under `DUPLICATE_REVIEW` with no local credit receipt. A provider duplicate plus a receiver suffix does not establish the complete receiver/date/reference match or authorize credit. The displayed provider timestamp also needs timezone investigation. This patch does not clear that case or automatically credit provider duplicates. The earlier proposal to automatically distinguish a same-attempt duplicate requires stronger provider correlation evidence than is currently available.

Native Amharic review, real Telegram devices, production migration/rollout, Check.et duplicate recovery, and secure retained-receipt review remain unverified or unfinished. This packet is an application review, not a claim that real funding is fully validated.

## Review images

- [360px deposit](screenshots/simple-deposit-quote-mobile-360.png), [430px deposit](screenshots/simple-deposit-quote-mobile-430.png).
- [Scanned reference](screenshots/simple-deposit-scan-mobile-360.png), [credited receipt](screenshots/simple-deposit-receipt-mobile-430.png), [OCR fallback](screenshots/simple-deposit-fallback-mobile-360.png).
- [Remember device, desktop](screenshots/trusted-device-admin-laptop.png), [tablet](screenshots/trusted-device-admin-tablet.png). Authenticator secrets and codes are masked in review captures.
