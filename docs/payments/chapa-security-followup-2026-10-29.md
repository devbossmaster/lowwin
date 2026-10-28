# Authentication dependency audit follow-up

Reviewed from `main` at `cfe49150122af9e3f50b2927356dd1bd5beaef8b` on 29 October 2026 (Africa/Nairobi), then updated against patched Better Auth 1.7.14. No production or shared TEST database, account, balance, migration or live-payment setting was changed.

## Resolution

The full unsuppressed `npm audit --audit-level=low --json` now exits **0**, reporting **zero vulnerabilities**. Better Auth and every installed Better Auth core/adapter package resolve to **1.7.14**. The unsupported upstream Telegram peer was replaced by a small, readable, MIT-licensed Mini App compatibility port, `@lowwin/better-auth-telegram@2.0.1-lowwin.1`, with an exact `better-auth: 1.7.14` peer. There is no vulnerable older authentication copy, npm peer override, unrelated downgrade or advisory suppression.

```text
Lowwin
├─ @lowwin/better-auth-telegram@2.0.1-lowwin.1 (file:vendor/better-auth-telegram)
│  └─ better-auth@1.7.14 (deduped exact peer)
└─ better-auth@1.7.14
   ├─ @better-auth/core@1.7.14
   ├─ @better-auth/drizzle-adapter@1.7.14
   ├─ @better-auth/kysely-adapter@1.7.14
   └─ @better-auth/prisma-adapter@1.7.14 (selected runtime adapter)
```

`npm ci --dry-run --ignore-scripts --strict-peer-deps --prefer-offline` also exits 0, validating the package-lock and peer graph without replacing the shared installation. Initial installation emitted an old-peer warning while pruning the removed upstream Telegram package; the final `npm ls` tree is valid and the strict clean-install dry run has no peer warning.

## Initial CI failure and advisory chains

[Checks run 40765906290](https://github.com/devbossmaster/lowwin/actions/runs/40765906290), [security job 123089863624](https://github.com/devbossmaster/lowwin/actions/runs/40765906290/job/123089863624), failed at `npm audit --audit-level=low`. Installation succeeded. Four vulnerable package nodes were reported: two low, one high and one critical. The old chain was `better-auth-telegram@2.0.1 -> better-auth@1.6.33`, plus the affected transitive Drizzle and Kysely adapters. The Telegram node inherited the Better Auth peer findings; it did not have a separate Telegram-specific advisory.

| Advisory | Affected path and original applicability | Resolution |
| --- | --- | --- |
| [GHSA-44jh-23m7-hpcf](https://github.com/advisories/GHSA-44jh-23m7-hpcf), low | Concurrent PostgreSQL database rate limits in Drizzle/Kysely. Lowwin uses Prisma, whose installed conditional atomic increment was separately checked. | All adapters now 1.7.14. The real PostgreSQL regression still admits exactly 5 requests and rejects 19 of 24 concurrent password requests. |
| [GHSA-965c-763c-88jm](https://github.com/advisories/GHSA-965c-763c-88jm), critical | Magic Link plus social/Generic OAuth verification identifier confusion. Those optional flows were not enabled. | Core upgraded past the 1.7.7 patch; optional vulnerable routes remain unavailable. |
| [GHSA-r4xp-prcw-77qf](https://github.com/advisories/GHSA-r4xp-prcw-77qf), high | OAuth Proxy with the documented state/cookie/secret/linking conditions. Proxy was not enabled; implicit linking was disabled. | Core upgraded past the 1.7.7 patch; proxy route remains unavailable and linking remains disabled. |
| [GHSA-q84f-53jg-9ppm](https://github.com/advisories/GHSA-q84f-53jg-9ppm), high | Device Authorization approval lacked adequate client/permission confirmation. The plugin was not enabled. | Patched 1.7.14 installed; code and approval routes remain unavailable. |

The configuration applicability checks were additional evidence, not a reason to suppress the original audit. The resulting package audit itself is now clean.

## Compatibility and unchanged schema

Registry and [upstream package](https://github.com/vcode-sh/better-auth-telegram/blob/main/package.json) checks still show Telegram 2.0.1 declaring `>=1.6.22 <1.7.0`. Instead of coercing that peer, the local port includes only the used Mini App endpoint, schema, configuration and HMAC functions, with focused types and the complete original MIT license. Its README records upstream provenance and the reviewed published artifact SHA256. Generated bundles, source maps, widget/client code, OIDC and bundled JOSE code are excluded. Only `telegram` is exported.

The compatibility contract rejects enabling Login Widget, OIDC or Mini App signature-validation bypass, and limits authentication age to the existing 300 seconds. Existing raw-signature and freshness validation, origin/body limits, session binding, contact enrollment, server token redaction, role approval, database rate limiting and financial transaction safeguards remain in place. The local-development provisioner supplies the new 1.7 `createUser` provisioning-source argument; its existing local-only gate remains unchanged.

**Correction to the initial review:** [the current official 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) and [maintainer account-schema notice](https://better-auth.com/blog/1-7-account-schema) explain that **1.7.3 reverted the required issuer field** introduced by 1.7.0–1.7.2. Upgrading Lowwin directly from 1.6 to 1.7.14 preserves `(providerId, accountId)` and requires no issuer column or identity backfill. Treating the initial 1.7.0 migration requirement as applying to all 1.7 releases was incorrect. No auth schema or migration was added.

The port is deliberately maintained for the current Mini App surface and exact patched version. Future auth upgrades or new Telegram modes require renewed compatibility review and these regressions. Replace it with a maintained compatible upstream release when one becomes available.

## Validation

- Full unsuppressed dependency audit: **0 vulnerabilities**, exit 0.
- Strict clean-install dry run: exit 0; valid lockfile and peer graph.
- TypeScript typecheck: passed.
- Focused auth/security run: **112/112 tests across nine suites passed** on fresh disposable loopback PostgreSQL databases. This includes a password hash and signed cookie generated by the pre-upgrade 1.6.33 library, existing Telegram account identity reuse, new signed member creation, forged signature rejection, exact concurrent database rate limiting, signed launch/contact enrollment, payment-session reauthorization, admin email verification, role approval, reset-token replay protection, session revocation and logout.
- Complete isolated unit/financial suite: **1363/1363 tests across 128 files passed, zero skipped**, exit 0, in **364.36 seconds**. It ran from an env-file-free detached `31bef56` checkout on D with explicit disposable loopback PostgreSQL URLs. This application tree is identical to `d26a871` (the later change only improves CI scan coverage). It exercises all financial/authentication checks through the release harness's no-skip gate.

The initial developer-checkout run exposed two fixture-environment constraints: the contact cooldown suite deliberately refuses a checkout containing `.env`, and the launch helper forced a new referral-schema flag into the legacy cent-migration test. Both passed in an env-file-free checkout with normal feature defaults; the subsequent complete run passed every test without weakening either guard or modifying application code. The clean full-run log and JSON report are retained under `D:\lowwin-auth-isolated-20261029\.local\auth-1714-clean.log` and `D:\lowwin-auth-isolated-20261029\test-results\release\unit.json`.

The workflow now runs dependency audit and pinned static/secrets scanning as independent jobs. A reviewed `.semgrepignore` includes the maintained auth port, which Semgrep's default `vendor/` exclusion would otherwise skip; CI explicitly requires `vendor/better-auth-telegram/index.js` in the scanner's `paths.scanned` report. The first hosted [Semgrep run 40775286320, job 123122881644](https://github.com/devbossmaster/lowwin/actions/runs/40775286320/job/123122881644) completed with **66 rules, 728 files and 0 findings** (artifact 12855015947). That predates the compatibility port and must rerun for the final commit. A previous local scanner attempt timed out at 4 minutes 1 second without a report; it was not counted as passing and was superseded by the hosted result. Do not claim the final hosted security gate passed until the final commit's independent audit and static/secrets jobs complete.

Private local audit and test evidence is retained under `.local/chapa-security-followup/` and `.local/launch-fast/`. No merchant TEST acceptance, physical Telegram behavior, deployment or production verification is implied by these isolated checks.
