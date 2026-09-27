## Scope and changed files

Implemented a separate desktop-first `/admin` layout with invite-only Owner credentials, TOTP/recovery and exact-session assurance, inventory/content/draft management, immutable publication, cancellation impact and transactional refunds, private post-close evidence and reconciliation. Phase 5B delegation, fulfillment, support and delivery remain absent. No deployment or top-ups.

Primary changes in this phase:

- `prisma/schema.prisma`, `prisma/migrations/202609270007_admin_foundation/migration.sql`: staff assurance/token/bootstrap/audit/media/content/draft tables and inventory edit versions. No old migration was rewritten.
- `src/modules/admin/{bootstrap,boundary,crypto,email,errors,operations,public-content,rate-limit}.ts`: staff authorization, invitation delivery, safe mutations and read-only projections.
- `src/modules/auth/{server,handler,staff-plugin}.ts`: deliberate narrow staff route allowlist, pinned Better Auth credentials/session integration, atomic authentication flows and reset/recovery revocation.
- `src/app/admin/**`, `src/app/api/admin/[...path]/route.ts`, `src/app/api/media/[id]/route.ts`, `src/components/{admin-shell,admin-workspace,staff-login}.tsx`: separate admin shell, login/enrollment and operational forms.
- Player routes moved under `src/app/(mini)/` with their existing URLs preserved. `src/app/layout.tsx` is shared HTML/font setup; Telegram provider/safe-area shell moved into `(mini)/layout.tsx`. Home and FAQ read validated managed plain text; permanent auction rules remain.
- `scripts/{admin-bootstrap,email-sink}.ts`, `.env.example`, `package.json`, `package-lock.json`: Owner CLI, real local HTTP email sink, server-only configuration, direct pinned Sharp dependency. Better Auth 1.6.33 and Telegram plugin 2.0.1 were not upgraded.
- `tests/{admin,admin-crypto}.test.ts`, `tests/browser/admin.spec.ts`, `playwright.config.ts`, `tsconfig.json`: authentication/finance/security coverage and laptop/tablet projects. Typecheck uses the current generated production route manifest and excludes stale development/test output directories.
- `next.config.ts`: private admin headers and the specifically requested `unpurged-nickolas-unlevelly.ngrok-free.dev` development-origin entry.
- `docs/owner-runbook.md`, this report and `docs/screenshots/phase5a-*.png`: operational instructions and evidence.

The checkout already contained uncommitted earlier-phase work. This list separates Phase 5A additions from that prior work; no commit/push was performed.

## Database isolation and migrations actually applied

The `.env` host was inspected without printing credentials: remote Supabase `aws-1-eu-west-1.pooler.supabase.com:5432/postgres`. The `.env` file and remote database were left untouched.

All migrated databases were newly created with `lowin_test` on `127.0.0.1:55439`, ending `_test`. The final combined run used:

| Environment variable | Database |
| --- | --- |
| TEST_DATABASE_URL | lowin_5a_final_core_test |
| BID_TEST_DATABASE_URL | lowin_5a_final_bid_test |
| SETTLEMENT_TEST_DATABASE_URL | lowin_5a_final_settlement_test |
| PERSONAL_TEST_DATABASE_URL | lowin_5a_final_personal_test |
| ADMIN_TEST_DATABASE_URL | lowin_5a_final_admin_test |
| Browser TEST_DATABASE_URL | lowin_5a_final_ui_test |

All nine migrations were applied to these databases: foundation, ledger invariants, hold integrity, catalog, accepted bids, auction settlement, settlement lock guard, personal pages and the new admin foundation. Earlier diagnostic disposable databases used `lowin_5a_{core,bid,settlement,personal,admin,admin_full,ui}_test`; those also received the same nine migrations. No published Phase 2 schedule was reset. The browser databases ran the repeatable catalog seed and fresh bid/settlement fixtures.

## Commands and results

With all five database variables above set, `npm test` passed **132 tests in 9 files, zero skipped**, in 60.39 seconds. This includes the unchanged catalog, bid, hold, settlement and personal suites and 19 Phase 5A database cases. Two subsequently added standalone RFC6238 compatibility/replay tests passed with `npx vitest run tests/admin-crypto.test.ts` (2/2, zero skipped).

Admin coverage includes actual HTTP sink delivery, bootstrap/invite replay, forbidden signup/admin endpoints, incomplete MFA/player isolation, TOTP enrollment/challenge/expiry/recovery, generic reset and session revocation, safe media, publication retries/immutability, exact refund previews, stale-impact/fresh-MFA denial, cancellation audit-failure rollback, concurrent cancellations, publish/cancel races, content idempotency, immutable audit, cross-origin rejection and cookie-independent account MFA throttling. Standard RFC6238 SHA-1 vectors establish authenticator compatibility independently of the verifier implementation.

`npm run typecheck` passed. `npm run build` passed (Prisma generate, optimized Next production compilation, TypeScript and route generation). An earlier attempt during browser execution encountered a Windows Prisma DLL lock; after test servers stopped, the command succeeded. Build validation does not prove production HTML headers or runtime Supabase permissions.

Subsequent UI corrections were compiled with `npx next build` using the unchanged generated Prisma client: a running Windows development process can keep its engine DLL locked and prevent redundant `prisma generate`. No running user server was terminated just to replace an unchanged DLL.

The clean full `npx playwright test` run on `lowin_5a_final_ui_test` passed **17 tests, zero failed, one intentional skip**, in 2.6 minutes. Mobile checks cover 360×800 and 430×932; admin checks cover laptop 1366×900 and tablet 834×1112. The carousel reduced-motion/manual/auto test is intentionally skipped in the 360px project because it runs in the 430px project. No database-dependent browser test was skipped. The run includes fresh Owner invitation/enrollment, subsequent credential/TOTP sign-in, server denial, saved draft preview, publication and cancellation with actual fee/hold refunds. Final browser reconciliation was empty.

The first full run found two admin form-selector failures (15 passed, 1 intentional skip, 2 failed). The password label and same-page invitation hash handling were fixed, and the product selector test uses its accessible combobox role. A focused laptop/tablet rerun passed 2/2 before the clean full run. Screenshot inspection additionally corrected a saved-product select remount, active sidebar state and prospective cancellation wording.

Screenshots: `docs/screenshots/phase5a-{login,overview,editor,cancellation,completed}-admin-{laptop,tablet}.png` (ten captures). The full run also refreshed the existing mobile catalog, bidding, settlement and Phase 4B screenshots. Private financial captures contain only disposable synthetic test data. Impeccable's detector reported advisory admin color/type documentation differences, not a security or accessibility certification.

| Screen | Laptop | Tablet |
| --- | --- | --- |
| Login | [capture](screenshots/phase5a-login-admin-laptop.png) | [capture](screenshots/phase5a-login-admin-tablet.png) |
| Overview | [capture](screenshots/phase5a-overview-admin-laptop.png) | [capture](screenshots/phase5a-overview-admin-tablet.png) |
| Saved editor | [capture](screenshots/phase5a-editor-admin-laptop.png) | [capture](screenshots/phase5a-editor-admin-tablet.png) |
| Unsaved editor | [capture](screenshots/phase5a-editor-dirty-admin-laptop.png) | [capture](screenshots/phase5a-editor-dirty-admin-tablet.png) |
| Cancellation | [capture](screenshots/phase5a-cancellation-admin-laptop.png) | [capture](screenshots/phase5a-cancellation-admin-tablet.png) |
| Completed evidence | [capture](screenshots/phase5a-completed-admin-laptop.png) | [capture](screenshots/phase5a-completed-admin-tablet.png) |

The finish reviewer requested one publication UX correction: unsaved visible draft edits must block preflight/publication. This was implemented and both admin browser projects passed again (2/2, zero skips, 30.1 seconds), including edit → disabled preflight → save → fresh preflight → publication. Added `phase5a-editor-dirty-admin-{laptop,tablet}.png`. The reviewer scored that correction resolved, disposition **ship**, limited to the listed fix.

## Follow-up runtime fixes

The user's running `.env` database lacks both the optional new `SiteContent` table and the core `Auction` table. Optional Home/FAQ content now falls back only on a precise missing-SiteContent error; connection failures and unrelated missing tables are not concealed by that helper. Home shows a truthful catalog-preparation state for absent catalog tables. HTTP checks confirmed Home and FAQ render without a Prisma error payload. This is graceful compatibility, not a claim that the remote database was initialized. Admin operations still require the migrations. Three focused fallback/validation/error-propagation tests passed.

The Telegram SDK was moved from an invalid nested `beforeInteractive` use to `afterInteractive` with `onReady`. Authentication also has a bounded browser fallback, per-launch deduplication and stale-response protection, so late SDK loading cannot replace newer authentication state. The follow-up complete mobile run passed **15 tests, zero failures, one intentional carousel skip** in 1.4 minutes. Signed authentication/bids/wallet/profile flows remain covered. One development streaming cancellation message appeared during navigation, without a browser assertion failure; no real Telegram-client claim follows from these tests.

A separate headless Chromium check against the user's running dev server loaded Home and navigated to FAQ: FAQ visible, **zero “Encountered a script tag” console warnings**. Final typecheck and production compilation passed after these follow-up fixes. The visual documenter added a scoped admin supplement to `DESIGN.md` and `.impeccable/design.json`, preserving the mobile design.

## Reconciliation evidence

An independent post-suite call to the existing `reconcile()` returned `[]` on all final databases. It compares posting/projection balance, HELD versus auction holds, accepted-bid fees, cancellation refunds and settlement charges in one snapshot.

| Final database suffix | Wallets | Holds | Journals | Bids | Settlements | Admin audits | Drift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| core | 15 | 10 | 36 | 0 | 0 | 0 | none |
| bid | 17 | 11 | 134 | 114 | 0 | 0 | none |
| settlement | 24 | 25 | 114 | 34 | 21 | 0 | none |
| personal | 2 | 7 | 27 | 8 | 3 | 0 | none |
| admin | 2 | 2 | 10 | 2 | 2 | 22 | none |

The admin cancellation test releases 13 held points and refunds 6 fee points across two bidders exactly once, including concurrent retries. Forced audit failure leaves no settlement and preserves the full hold for retry. Existing settlement tests retain immutable proof and cover winner/no-winner/zero-bid cases, deadline races, crash boundaries and ledger guards.

## Development tunnel correction

`allowedDevOrigins` now contains only the requested additional hostname. The existing dev server on port 3000 automatically restarted after the config change (listener process changed). A cross-origin probe to a deliberately nonexistent Next dev asset returned **404** for the allowed ngrok origin (origin check passed) and **403** for `not-allowed.example`. No auth allowlist or local-identity policy was relaxed. This follows the hostname-only form in the [Next.js documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

## Remaining release work

Production email has no configured provider and explicitly returns unavailable; only real local HTTP sink delivery was tested. Real Telegram clients, production Supabase runtime-role/RLS permissions, production HTML cache/security headers and settlement load testing remain unverified. Admin views currently cap product/work-queue reads at 200 records. An expired first-Owner invitation fails closed; an audited reissue/recovery workflow is not part of this phase. The custom staff plugin warrants independent security review before release. No production migration or deployment was attempted.
