# Authentication dependency audit follow-up

Reviewed from `main` at `cfe49150122af9e3f50b2927356dd1bd5beaef8b` on 29 October 2026 (Africa/Nairobi). No production database, account, balance, migration or live-payment setting was changed.

## Current CI failure

[Checks run 40765906290](https://github.com/devbossmaster/lowwin/actions/runs/40765906290), [security job 123089863624](https://github.com/devbossmaster/lowwin/actions/runs/40765906290/job/123089863624), failed at `npm audit --audit-level=low`. Installation succeeded. The audit reported four vulnerable package nodes: two low, one high and one critical. Semgrep was skipped after the audit failure, so the original job provides no static-analysis result.

The local full JSON audit reproduced the same four package nodes. Its complete dependency chain is:

```text
Lowwin
├─ better-auth-telegram@2.0.1
│  └─ peer better-auth@1.6.33 (>=1.6.22 <1.7.0)
└─ better-auth@1.6.33
   ├─ @better-auth/drizzle-adapter@1.6.33
   ├─ @better-auth/kysely-adapter@1.6.33
   └─ @better-auth/prisma-adapter@1.6.33 (the selected runtime adapter)
```

`better-auth-telegram` is reported through its Better Auth peer, not a separate Telegram-specific advisory. The JSON report additionally identifies the conditional core advisories that the abbreviated CI text does not expand.

## Applicability to this application

| Advisory | Affected path | Current Lowwin configuration |
| --- | --- | --- |
| [GHSA-44jh-23m7-hpcf](https://github.com/advisories/GHSA-44jh-23m7-hpcf), low | Concurrent PostgreSQL database-backed rate limits through affected Drizzle/Kysely adapters; patched Drizzle 1.7.7 / Kysely 1.7.0 | Rate limiting is enabled and database-backed, but `createAuth` selects Prisma. Installed Prisma `incrementOne` uses a conditional update and an atomic increment, rather than the affected adapter path. The isolated PostgreSQL regression sends 24 concurrent password requests against max=5 and requires exactly 5 admissions and 19 rejections. |
| [GHSA-965c-763c-88jm](https://github.com/advisories/GHSA-965c-763c-88jm), critical | Magic Link plus social/Generic OAuth can share verification storage identifiers; patched 1.7.7 | Magic Link and social/Generic OAuth are not configured. The Magic Link endpoint remains unregistered. Email verification and password reset are different enabled flows and remain covered by their existing tests. |
| [GHSA-r4xp-prcw-77qf](https://github.com/advisories/GHSA-r4xp-prcw-77qf), high | OAuth Proxy with the documented cookie-state/secret/linking conditions; patched 1.7.7 | OAuth Proxy is not registered and implicit account linking is explicitly disabled. The proxy callback remains unregistered. |
| [GHSA-q84f-53jg-9ppm](https://github.com/advisories/GHSA-q84f-53jg-9ppm), high | Device Authorization approval without adequate client/permission confirmation; patched 1.7.0-rc.3 | Device Authorization is not enabled. Code and approval endpoints remain unregistered. |

These runtime applicability findings do **not** make the package audit pass or remove the advisories from the dependency tree. They describe why the named exploit paths are not exposed by this configuration. New plugins or adapter changes require a fresh assessment.

## Dependency upgrade follow-up

Registry checks found `better-auth@1.6.33` is the latest published 1.6 maintenance release. The [patched 1.7.7 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.7) exists, but the current [Telegram plugin](https://github.com/vcode-sh/better-auth-telegram/blob/main/package.json) is still 2.0.1 with the explicit peer range `>=1.6.22 <1.7.0` (also confirmed from npm). No compatible maintained Telegram release was available at review time.

[The current official 1.7 upgrade guide](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/guides/1-7-upgrade-guide.mdx) corrects the initial 1.7.0 release guidance: **1.7.3 reverted the required issuer field**, restoring account identity to `(providerId, accountId)`. A direct upgrade from Lowwin's 1.6 schema to patched 1.7.14 does not require an issuer migration or backfill. The earlier review incorrectly treated the initial 1.7.0 requirement as applying to all 1.7 releases; that conclusion is superseded here.

The remaining compatibility issue is Telegram 2.0.1's declared `<1.7.0` peer. The follow-up evaluates a license-preserving local compatibility package against exact Better Auth 1.7.14 and the existing signed Telegram Mini App, credential, session, origin and database rate-limit regressions. No blind peer override, unrelated downgrade or advisory suppression is authorized. Until those checks and the full unsuppressed audit pass, dependency security remains unresolved.

## Checks and CI behavior

`tests/auth-dependency-security.test.ts` exercises the installed library and Prisma adapter against a disposable loopback PostgreSQL database. It checks concurrent password rate limits and confirms that optional vulnerable flows cannot issue a session. Existing tests cover member registration, manual admin approval, email verification, reset-token replay, session revocation, role/origin rejection, signed Telegram authentication, account isolation and payment-session reauthorization.

The pinned Semgrep setup and scan now run in the separate `static-secrets` CI job, independent of the dependency audit job. An audit failure continues to fail its own job and cannot skip static/secrets scanning. The rule packs, scanner version, `--error`, `--metrics=off` and low audit threshold remain unchanged.

The focused authentication/security run passed **89 tests across eight suites**, including the concurrent Prisma/database rate-limit regression and all eight Master Guide Admin registration/reset/revocation tests. A final `npm audit --audit-level=low --json` still exits **1** with the same four package nodes; dependency security is **not green**. Private local audit and test reports are retained under `.local/chapa-security-followup/` and `.local/launch-fast/speedchecks-chapa-auth-security-final.log`.

The final two-test installed-dependency suite was rerun successfully after making its session assertion independent of unrelated fixture sessions.

### Local static-scan limitation

The exact pinned scanner was installed in an isolated WSL Ubuntu environment (Python 3.12.3, Linux x86_64). `pip check` returned `No broken requirements found`, the CLI reported `1.178.0`, and its native core reported `1.178.0`. The local equivalent of the CI command was:

```sh
semgrep scan --config p/ci --config p/secrets --metrics=off --error \
  --json-output=.local/chapa-security-followup/semgrep.json
```

The scan produced no output or JSON artifact after **4 minutes 1 second** and was terminated at that bound. Its two native core RPC child processes had started; one repeatedly waited on disk I/O, while the Python parent waited on its pipe. A TLS connection was established, but there is no evidence proving that both remote rule packs finished resolving or that source analysis completed. Therefore this is an **incomplete local static scan**, not a passing scan, a finding-free report, or proof that the remote rule registry alone caused the delay. No source matches or secret values were printed.

The required Semgrep check still needs to complete on the hosted CI runner after this workflow change. Do not mark the security gate green until both the unsuppressed dependency audit and the pinned code/secrets scan pass. The scanner installation and diagnostic artifacts are isolated under `D:\lowwin-chapa-security-validation-20261029` and ignored `.local/chapa-security-followup/`; they do not change application dependencies or authentication behavior.
