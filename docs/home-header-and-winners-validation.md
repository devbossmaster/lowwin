# Home header and Winners update — 10 November 2026

Follow-up compact cards, My Bids, Wallet/top-up, footer and guest Profile changes are recorded in [compact customer surfaces](compact-bids-wallet-and-home.md). The Home balance now opens the Wallet sheet; its separate + still opens Top up.

The existing DM Sans and Noto Sans Ethiopic families remain unchanged. The new surfaces use Lowwin's warm white, black and gold palette with compact headings and tabular financial values. No global font, dependency, environment, authentication or auction-economic change was made for the header.

## Home header

Registered: logo/name → confirmed available balance and separate + control → auction Hammer → notification bell → language. Guests see Login in the balance position. The bell reuses the existing account-scoped notification summary and lazy inbox, including its unread badge and read behavior. Other Profile, tutorial and notification entry points remain available.

The existing Telegram provider confirms registration on the server and restores known accounts. The header does not fetch a second account record or trust a contact-sharing callback. Wallet reads are explicitly disabled until that confirmation. Account restoration and balance loading use neutral placeholders; missing balances are never displayed as zero. The main bar remains Home-only.

The 320px layout retains 44px touch targets. Long balances use a compact two-line currency treatment inside the same wallet pill; the header itself remains one row. The whole displayed balance is checked for clipping in the responsive regression. Extremely long numbers retain their exact accessible amount and can be horizontally scrolled within the amount field.

## Winners

Cards and result sheets use the actual publication time, server-approved public identity and masked contact. The result sheet opens its cached product and immutable result immediately; number breakdown and private participant pages load separately. Distinct submitted numbers and numbers picked exactly once are separate counts. Sorting, winning-number jump, participant pagination, direct links and native Back/focus restoration remain available.

Complete Winners banners render at 1840 × 800 without being reinterpreted as portraits. Existing historical photograph records retain their old composition. Banner uploads/replacements/removal require administrator authorization, consent and version checks and cannot change result, publication, product media or financial records.

See [automatic publication operations](automatic-result-publication.md) for the additive migration, immutable historical cutover, restart recovery and worker setup. The migration must be applied before deploying the matching WEB, auction-worker and notification-worker revisions. No new notification worker or environment flag is introduced.

## Reproducing local verification

Use only a disposable loopback PostgreSQL database ending in `_test`, the guarded `playwright.nov10-winners.config.ts`, and an isolated optimized application server. The config disables live payment integrations. The fixtures use synthetic customers, product media and administrator credentials; Telegram/provider delivery tests use mocked HTTP.

```sh
npm run typecheck
npx playwright test -c playwright.nov10-winners.config.ts
```

Build verification uses the installed Next.js production webpack build with test-only runtime configuration. Header checks cover both account states and languages at 320/360/430px, long balances, loading, private-request counts, Login, Hammer, bell, top-up, language, route visibility and focus. Winners checks cover 360/430px, both languages, image rendering, sorting, correct totals, private participant pagination, direct links, reopening and full-banner administration.

No production migration, live financial operation, real Telegram broadcast, deployment or merge is part of this verification. No real historical fallback rate is asserted from synthetic fixtures. Telegram has no send idempotency token: normal retries/concurrent dispatch are deduplicated, but a crash after Telegram accepts a send and before its acknowledgement is stored can repeat a message; financial settlement remains idempotent.

## Recorded checks

- Final optimized browser run: **17 passed**, no failures or retries. The duplicate administrator scenario is deliberately skipped under the 360px project and runs once with its desktop administrator viewport under the 430px project.
- Header: 12 scenarios, including bell opening/unread badge/focus, full long-balance rendering, both languages and all three requested widths.
- Winners: five scenarios across the two mobile widths, including actual synthetic media upload and database invariants.
- Automatic publication/proof/privacy and existing settlement rules: 74 focused checks passed.
- Notification regressions: 115 unit checks and five isolated database delivery checks passed.
- Banner/admin/media: 46 focused checks and three isolated database checks passed. Component banner tests were also rerun after the complete-banner renderer change.
- Typecheck, installed Next.js optimized production build, Prisma schema validation and whitespace checks passed.

Suite counts are per group and are not presented as a deduplicated whole-project total. Generated screenshots, traces, logs and local fixture data stay outside the intended application/documentation change set.
