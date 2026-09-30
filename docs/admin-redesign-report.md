# Admin workspace redesign — review packet

Branch: `review/admin-workspace-20260930`, based on `0d82f9b`. Review branch and PR only. No deploy, merge, production migration, payment activation or real communication is included.

## Delivered behavior

- Five role-aware business areas, contextual task tabs, breadcrumbs, accessible compact drawer and server-provided permission context.
- Overview and auction queues use database time, bounded SQL participant aggregates and explicit partial failure states. Pending closing is distinct from a committed outcome. Dashboard balance checks are explicitly not run.
- Deposit review shares one union predicate with Overview; overlapping incidents count once. ETB inputs convert exactly to cents; evidence is redacted, failures preserve input and retries preserve idempotency.
- Draft preparation has three groups, saved preview and invalidated publication review after edits. Frozen rules, Owner-only publication, exact cancellation impact, fresh MFA and refund/settlement commands remain authoritative.
- Deliveries include settled winners without a case, distinguish awaiting details from ready to pack, and offer a bounded eligible-staff selector. Private contact reads remain assigned-only and audited.
- Support, players, messages, reports, balance evidence and staff access use the shared workspace. Reports separate date-filtered activity from current account balances and do not call either profit.
- User follow-up: surface text is black on white and white on forest green, including nested white controls inside green headers. Existing backgrounds and layouts remain intact except the approved admin redesign.
- User follow-up: removed the extra bottom gap after the Home footer; navigation clearance is inside its green surface, keeping the last link reachable.
- User follow-up: exact `?v=forest-1` logo/banner URLs are allowed by Next image configuration. Other query strings remain rejected. The same image and text-color fixes were applied to the owner's primary local checkout; production was not changed.

## Final follow-up

- Settings reads `paymentHealth().reason`, replacing the obsolete Phase 6 placeholder. Browser assertions cover the actual disabled message and the isolated-test message; neither can be mistaken for verified production funding. A configured live deployment reports that only exact provider-verified transfers can credit wallets. These checks do not activate payments or verify a real provider.
- The general and payment browser suites now own direct server children with IPC shutdown, native Next cleanup, a 15-second teardown deadline, exit-code checks and released-port checks. This removes reliance on Windows shell-tree termination. Cleanup failure fails the command. Three process-level tests cover clean exit, ignored shutdown and unexpected early exit.
- The harness uses the installed Next server startup API and its development flag. Recheck this test-only adapter on a Next upgrade. Production startup is unchanged.

## Changes and rollout

Main areas: `src/components/admin-*`, `src/app/admin`, `src/modules/admin/{navigation,workspace-read,operations,ops}.ts`, `src/modules/payments/{review-filter,admin}.ts`, `src/lib/admin-money.ts`, admin/browser tests and the two Owner guides. Shared/player CSS changes implement the later contrast request. `next.config.ts` fixes the versioned asset allowlist; the Home gradient has a white fallback for its previously undefined background token.

No schema migrations, dependency changes, auction rules, ledger/hold commands, payment verifier or Telegram identity changes. Deploy the reviewed application commit through the normal release process only after review. Existing production activation gates still apply. Rollback is the previous application revision; there is no database rollback for this redesign.

## Verification

| Check | Recorded result |
|---|---|
| Full disposable database/unit regression | 340 passed, 37 files, zero skipped, 245.59 seconds |
| Typecheck | Passed (`npm run typecheck`) |
| Production build | Passed (`next build`, after successful Prisma generation) |
| Dependency audit | 0 vulnerabilities |
| Design detector | No findings (`[]`) |
| General browser matrix | 19 passed in one fresh matrix, 1 intentional duplicate carousel skip; exit 0 in 4.0 minutes; all server ports released |
| Payment browser matrix | 16 passed in one fresh matrix; exit 0 in 1.6 minutes; all server ports released |
| Visual finish review | Ship: compact table readability and 44px language targets resolved; reference navigation caption retained |

The final mobile admin run includes 360px/430px navigation, lists, support, reports and staff screens with document-overflow assertions. The hidden table-header label that escaped its scroll container was contained with a positioned scroll wrapper. Payment tests assert the current 100.00 ETB quote, verify local OCR/provider receipts, preserve failed-write input, retry with the same idempotency key, and invalidate edited policy previews.

The first browser pass exposed the unconfigured logo/banner query, a missing Home background fallback, an outdated Pending label assertion and a duplicate Settings heading. These were fixed before the final rerun. An initial concurrent build hit the Windows Prisma engine DLL lock; after browser processes exited, Prisma generation and the build succeeded. The isolated local PostgreSQL instance required crash recovery after an interrupted session; it was recovered without resetting data.

All mutable verification uses explicit loopback `_test` databases and local email/provider fixtures. Historical screenshot files overwritten by runners are not presented as fresh production evidence. Current admin captures are prefixed `admin-redesign-`.

## External limits

No real Telegram Android/iOS device test, production check, real email, Check.et transfer, load measurement against Supabase, or VPS verification is claimed. No real broadcast or invitation was sent. The native-language review remains the Owner's check. This redesign preserves the existing language switch and existing bilingual controls; it does not claim complete admin translation.

Decision: GO for local review of this redesign. Production deployment and activation are outside this packet.

## Review captures

- [Overview, laptop](screenshots/admin-redesign-overview-admin-laptop.png), [tablet](screenshots/admin-redesign-overview-admin-tablet.png), [360px](screenshots/admin-redesign-overview-360-admin-laptop.png), [430px](screenshots/admin-redesign-overview-430-admin-laptop.png).
- [Draft editor](screenshots/admin-redesign-editor-admin-laptop.png), [unsaved changes](screenshots/admin-redesign-editor-dirty-admin-laptop.png), [cancellation impact](screenshots/admin-redesign-cancellation-admin-laptop.png).
- [Settings with funding disabled](screenshots/admin-redesign-settings-admin-laptop.png), [Settings with isolated test funding](screenshots/admin-redesign-settings-test-payments-admin-laptop.png).
- [Deposit investigation](screenshots/admin-redesign-payment-detail-admin-laptop.png), [payment configuration review](screenshots/admin-redesign-payment-settings-admin-laptop.png).
- [Deliveries](screenshots/admin-redesign-fulfillment-admin-laptop.png), [support](screenshots/admin-redesign-support-admin-laptop.png), [reports](screenshots/admin-redesign-analytics-admin-laptop.png), [staff access](screenshots/admin-redesign-team-admin-laptop.png).

Reproduction: use `node scripts/run-db-tests.mjs unit`, `browser`, and `payments` with an explicitly supplied disposable loopback `_test` database and `LOWWIN_PLAYWRIGHT_CHANNEL=chrome` where the bundled browser is absent. Run `npm run typecheck`, `npm run build`, `npm audit --audit-level=low`, and `git diff --check`. Do not point the fixtures at production.

The independent visual review scored both material corrections resolved (compact tables and language touch targets), withdrawing the caption finding because it matches the user reference. Its `ship` verdict applies to those scored findings; it is not a production validation. Final typecheck and production build passed after the Home-footer and visual corrections. The reviewed changes are committed with this packet on the review branch for a reviewable PR. No merge or deployment is included.

The earlier interrupted recapture is superseded by the managed-server verification recorded above. The targeted laptop run returned exit 0 (`1 passed (1.1m)`) with all three owned server ports released. A cleanup timeout is explicitly a failure, never a passing recapture.

## Application rollback

Before deployment, record the deployed application SHA and retain its image. Deploy the reviewed application revision to the existing web resource through the normal process; verify staff sign-in/MFA, Overview, Settings, deposit review and mobile navigation. If any regress, redeploy that recorded prior application image/SHA. This change adds no migrations and requires no database reset, reversal or restoration. Existing journals, bids, holds and payment activation configuration stay intact. The review base is `0d82f9b`; it is not claimed to be the current production revision.
