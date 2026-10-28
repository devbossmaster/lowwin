# Chapa TEST release and production preparation

This runbook prepares the reviewed Chapa code, bot return flow and dedicated recovery worker. TEST acceptance and production activation are separate gates. No production migration, balance change or payment activation is performed by this document. Deployment environment files, credentials, local audit helpers and merchant evidence stay outside the release commit.

Use the release commit and hosted CI results recorded below. The application fixes add no migration. The authentication compatibility review for this release must be completed alongside the security report; do not invent an issuer backfill or edit an old migration to resolve a dependency issue.

## Managed recovery worker

The existing systemd template now supports `lowwin@chapa.service`. It executes `node deploy/service.mjs chapa`, which selects only `node --import tsx scripts/chapa-worker.ts`. Bot and notification workers do not run this Chapa recovery loop.

For Coolify, prepare a separate `lowwin-chapa` resource with build command `npm run db:generate` and start command `npm run worker:chapa`. It has no public domain or listening port. Use the same reviewed commit as web and bot. Keep the resource stopped while configuration is paused or incomplete.

For systemd, install the existing `deploy/lowwin@.service` template and `deploy/service.mjs`, and prepare `/etc/lowwin/chapa.env` privately, owned by root and readable only by the `lowwin` group (0640). The generic template already reads `/etc/lowwin/runtime.env` and the instance file. Existing unrelated services must not be restarted. On a reviewed TEST host only, after enabling the TEST recovery gate:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now lowwin@chapa.service
sudo systemctl status --no-pager lowwin@chapa.service
```

Keep one restricted runtime database connection for Chapa (`connection_limit=1`, `pool_timeout=20`), separate from migration/backup headroom. Do not install the owner `DIRECT_URL` in a web or worker resource. Give the worker the same original Chapa key/mode, bot identity, phone-contact encryption configuration and applicable referral-schema flag as web. Its existing attempts are bound to that merchant credential fingerprint. Do not rotate or replace that binding to make a pending payment appear recoverable.

## Prepare the separate TEST deployment

1. Confirm the immutable release commit, Node 24, lockfile installation, typecheck, financial/authentication regressions and production build. Record actual hosted audit/static-scan conclusions; an unsuccessful check must remain visible. TEST QA does not make production ready.
2. Verify the TEST database/project and bot are distinct from production. Use the restricted runtime login. In a separate owner-controlled session, inspect migration status and compare the schema with the committed artifact. This patch has no new migration; any pending historical migration needs its own reviewed target, backup, applicability and approval. Never run `migrate reset`, `migrate dev`, `db push`, seeds, cleanup routines or migration-history rewrites against an existing deployment.
3. Prepare web, bot and `lowwin-chapa` resources from the same commit. Keep `MINI_APP_URL` and `BETTER_AUTH_URL` on the same reviewed HTTPS TEST origin. Keep the existing minimal hosted request: amount in cents, ETB currency and immutable merchant reference/key. Do not restore optional callback/return fields without a separate successful merchant compatibility trial; never change a persisted initialization.
4. Store TEST secrets privately. Web and worker must agree on `CHAPA_PRIVATE_KEY`, Signature webhook secret, bot token/username, contact key ID/map/hash key, auth origin and referral schema readiness. Keep the following paused baseline while preparing them:

```ini
NODE_ENV=production
APP_ENV=staging
PAYMENT_GATEWAY=CHAPA
CHAPA_MODE=test
CHAPA_BASE_URL=https://api.chapa.global
CHAPA_CURRENCY=ETB
CHAPA_TEST_ENVIRONMENT_REVIEWED=false
CHAPA_SCHEMA_READY=false
CHAPA_ENABLED=false
CHAPA_RECOVERY_ENABLED=false
CHAPA_LIVE_ENABLED=false
CHAPA_MERCHANT_REVIEWED=false
WALLET_BIDS_ENABLED=false
WALLET_BIDS_LIVE_ENABLED=false
PAYMENTS_LIVE_ENABLED=false
ARIFPAY_ENABLED=false
ARIFPAY_RECOVERY_ENABLED=false
VERIFY_ET_SCHEMA_READY=false
DEV_IDENTITY_ENABLED=false
DEV_POINTS_ENABLED=false
STAGING_DEMO_ENABLED=false
```

5. After separately reviewing the TEST target and actual schema, set only its `CHAPA_TEST_ENVIRONMENT_REVIEWED=true` and `CHAPA_SCHEMA_READY=true`. For the authorized merchant TEST trial, set `CHAPA_ENABLED=true` and `CHAPA_RECOVERY_ENABLED=true` on the TEST web/worker resources. Enable `WALLET_BIDS_ENABLED` only when exercising that already-reviewed TEST wallet path. All live flags remain false. Keep referral readiness equal to the web app's reviewed schema setting; this worker does not add a referral policy.
6. In the merchant TEST dashboard, configure **Signature / PAYMENT** at the TEST origin's `/api/payments/chapa/webhook`, using the matching protected secret. The endpoint must receive a direct HTTPS response without a hostname redirect. Run the non-charging readiness checks from the TEST resource's protected environment:

```sh
npm run db:generate
npm exec tsx scripts/check-chapa.ts --schema --methods
npm run wallet:reconcile
```

The Chapa readiness script uses only static configuration, read-only schema/reconciliation and GET method discovery; it does not create or pay a checkout. Preserve any nonzero reconciliation result as a blocker. Start the reviewed TEST web, bot and dedicated recovery worker only after their gates and database role are confirmed.

## Merchant and Telegram TEST acceptance

- Complete an authorized TEST top-up and bid. Record opaque checkout IDs privately and the authoritative terminal state; initialization, return parameters and signed webhook hints alone do not prove payment. Confirm one receipt journal, balanced postings and exactly one wallet credit or valid bid acceptance. A late or otherwise unaccepted paid bid must retain the verified money in AVAILABLE funds once.
- Exercise interruption before receiving an ID, an ambiguous `503`, and `202` initialization with an ID but no URL. Close/reopen and Resume; the exact original body/key/reference must be reused. Duplicate clicks and verification must not add a second payment or credit. Check cancellation, failure, pending and delayed confirmation too.
- Inspect an actual merchant PAYMENT webhook delivery, not a synthetic HMAC probe. If supported, retry the same existing TEST delivery from the dashboard; correlate it with the matching durable event and verify duplicate delivery adds no receipt/credit. Keep raw bodies, signatures and payer details private.
- On a physical Telegram device, return to the original Mini App and exercise the opaque bot link `start=chapa_<checkout UUID>`. Its Check payment button must reopen the same owned status through normal authentication. Another account must receive no payment details. The link carries no payer, amount, result or user ID. Check My Bids, wallet, history, profile/referral and auction refresh after confirmed server outcomes; pending screens retain authoritative cached content.
- Capture only safe `Server-Timing` phase values for authentication, database, initialization, verification and total. Compare real TEST timings with the service-only mocked benchmark; its local query reductions do not prove an end-to-end speed improvement.

Record actual webhook delivery and physical Telegram evidence separately from isolated browser fixtures. If either is unavailable, leave that acceptance gate incomplete and state the exact operator/device action still needed.

## Production schema snapshot and applicability

A metadata-only production audit succeeded on **29 October 2026 at 00:53 EAT** (`2026-10-28T21:53:40.971Z`) through the previously verified production session descriptor, with verified TLS and `REPEATABLE READ READ ONLY`. It queried migration/schema metadata only: no financial rows, provider request, bot message, data mutation or schema mutation. The sanitized local report is `.local/chapa-fix/production-schema-readonly.json` and is excluded from the commit.

Production had **36 of 40** repository migrations applied, no unfinished migration and no applied migration absent from the repository. Chapa storage, `user.role` and all three Master Guide Admin migrations were already present. The actual pending files were:

| Pending committed file | Applicability before a clean production release |
| --- | --- |
| `prisma/migrations/202610220001_arifpay_bid_checkout/migration.sql` | Historical additive ArifPay checkout storage; `ArifPayCheckout` was absent. This is schema parity, not permission to enable the retired gateway. Keep ArifPay flags false. |
| `prisma/migrations/202610220002_cleanup_test_run_acl/migration.sql` | Revokes browser-role execution of the existing test cleanup routine and checks inherited access atomically. Review grants first; do not invoke cleanup or use CASCADE to force the migration past its guard. |
| `prisma/migrations/202610260001_referral_rewards/migration.sql` | Adds profile fields, referral storage and financial integrity rules; `ReferralPolicy` was absent. Rehearse against an isolated restored snapshot, preserve existing balances, and enable no referral policy merely by applying it. |
| `prisma/migrations/202610280004_chapa_test_session_reference/migration.sql` | Replaces the existing Chapa immutability guard with the constrained historical TEST-session receipt compatibility rule. It does not change intents, balances, live references or already credited outcomes. |

Fourteen migration checksums differed from the Windows working-copy bytes; **all 36 applied checksums matched the LF-normalized committed content**. Preserve that distinction and the original history. Do not replace migration checksums or edit historical SQL to silence a diagnostic. Use the reviewed artifact's LF SQL files and recheck the target immediately before any later migration approval.

The audit establishes that snapshot only. Current production runtime payment flags and hosting configuration were not inspected by the metadata audit. They must not be inferred from the local staging `.env`. No production migration is authorized or executed here.

## Prepare production without activating payments

1. Prepare a compatible release artifact and rollback artifact from exact reviewed commits. Resolve the hosted security gate, including the compatible patched authentication/Telegram adapter combination, and retain the authentication and database rate-limit safeguards. Record the completed hosted checks below.
2. Rehearse the four pending historical migrations on an isolated restored snapshot. Review the SQL, trigger/ACL effects, runtime grants, migration checksums, backup/restore evidence and zero reconciliation drift. The owner-only migration job may later use `npm run db:migrate` only after a separate explicit production approval for that exact target and pending list. This runbook is not that approval.
3. Prepare private production-specific web/bot/worker configuration with `APP_ENV=production`, `NODE_ENV=production`, `CHAPA_MODE=live`, and the fixed Chapa API origin. Keep `CHAPA_ENABLED=false`, `CHAPA_RECOVERY_ENABLED=false`, `CHAPA_LIVE_ENABLED=false`, `CHAPA_MERCHANT_REVIEWED=false`, `WALLET_BIDS_ENABLED=false`, `WALLET_BIDS_LIVE_ENABLED=false` and all legacy funding flags false. Keep `CHAPA_SCHEMA_READY=false` until the separately reviewed schema is actually ready. Do not copy a TEST key into production or install owner credentials in runtime resources.
4. Stage those paused values outside active resources. First inventory unresolved existing attempts and preserve their original mode/key/merchant binding and a compatible recovery worker. Do not overwrite an already-reviewed recovery deployment or rotate a key simply to match a prepared release.
5. Review the live merchant key/methods, HTTPS webhook secret/URL, least-privileged runtime grants, matching web/bot/recovery workers, observability and acceptance evidence. Leave the prepared Chapa resource stopped until a separate explicit activation decision. No production key flag, ledger row, migration or payment is changed by this preparation.

## Rollback and recovery

Pause new Chapa initialization with `CHAPA_ENABLED=false`. Existing legitimate payments must retain their original configuration and reviewed recovery path (`CHAPA_RECOVERY_ENABLED=true` where that recovery was already authorized). The legacy `PAYMENTS_LIVE_ENABLED` flag does not pause Chapa. Do not delete pending intents, issue replacement keys, rewrite credential fingerprints, alter balances or run cleanup to simulate rollback.

Use only a known compatible prior artifact: preserve Chapa storage/guards and the existing auction settlement rule versions. If rolling back the application, restart only the named Lowwin units after switching its atomic release symlink. Never downgrade a settlement worker past published auction rules or roll back additive database history. Retain the same merchant credential/mode and contact-encryption keys for unresolved attempts; reconciliation and any already committed credits remain authoritative.

## Release evidence

The release owner records the exact commit/PR, hosted CI, deployed TEST resources, migration-plan review, actual merchant delivery and physical Telegram acceptance here. A prepared runbook or a mocked test is not a completed deployment or acceptance record.

[PR #12](https://github.com/devbossmaster/lowwin/pull/12) contains the reviewed fixes. TEST web, bot and Chapa recovery worker were deployed together at `5d158eaf49596135d550dda53d41944022494e6b`; both local and public health endpoints reported that exact revision. All TEST live flags remained false. Only the previous verified TEST recovery process was retired; production and unrelated services were untouched.

That candidate's [hosted run](https://github.com/devbossmaster/lowwin/actions/runs/40779292951) passed the independent dependency audit (zero vulnerabilities), static/secrets scan (66 rules, 921 files, zero findings, maintained Telegram runtime coverage verified), foundation (1370 tests in 128 files, typecheck and production build), admin browser and Chapa browser jobs. The full redesign browser job was still running when this evidence was recorded; final changes require their own hosted results.

Merchant TEST top-up, bid acceptance and operator-confirmed Telegram return passed, with zero ledger/receipt reconciliation drift. Authenticated webhook delivery and duplicate handling remain blocked by the actual provider signing-contract discrepancy documented in the [checkout follow-up](chapa-checkout-fixes-2026-10-29.md). Do not activate live payments or call the TEST acceptance complete while that discrepancy remains. The exact production candidate and committed migration hashes are prepared privately in `.local/chapa-fix/production-release-manifest.json`; the actual deployed rollback revision still needs to be inventoried from the production host before release.
