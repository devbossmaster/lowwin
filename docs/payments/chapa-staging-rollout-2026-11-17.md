# Isolated Chapa staging rollout — 17 November 2026

**Prepared; not deployed.** The staging target is not identified. The user has
chosen to continue without physical-device evidence for now. These instructions
do not authorize using the production resources or Gojo infrastructure.

## Verified access and evidence

Read-only discovery at 06:33 UTC found a local `APP_ENV=staging`, Chapa TEST
configuration with live flags off and a separate reviewed TEST database. Its
configured historical ngrok hostname returned HTTP 404 with no application
revision. No inspector on ports 4040–4042, staged web listener on 3216/3217 or
Redis listener on 6379 was running. `REDIS_URL`, deployment API configuration and
SSH host configuration were absent. The only SSH key filename identifies Gojo;
it was not used. The connected UI inventory had zero apps and zero browsers.
Docker Desktop's local daemon and both listed WSL distributions were stopped;
no infrastructure was started or installed to manufacture deployment evidence.

Sanitized observations are under `.local/chapa-staging-review-20261117/`.
Keep the existing actual TEST attempt and its records under
`.local/chapa-test-e2e-20261117*`; an unavailable provider reference is not grounds
to initialize another charge.

At 07:38 UTC, the user-supplied Coolify host
`https://coolify.gojoplay.online` passed a validated HTTPS request:
`GET /api/v1/health` returned `200` with `OK`, and unauthenticated
`GET /api/v1/projects` returned `401`. The linked project, environment and
application remain unverified; the host name does not authorize any other Gojo
resources. No authenticated inventory, configuration change or deployment has
occurred. This API health check is not evidence of a running Lowwin staging app.
The sanitized record is committed at
[Coolify access evidence](evidence/chapa-coolify-access-2026-11-17.json).

| Required evidence | Result | Measured samples |
| --- | --- | ---: |
| Deployed Coolify TLS WEB + separate worker + private Redis | NOT RUN — target/access unavailable | 0 |
| Commit-to-render over that deployed path | NOT RUN | 0 |
| Real provider settlement and authenticated webhook on that target | NOT RUN | 0 |
| Physical Telegram resume, USSD/OTP and account switch | NOT RUN — deferred by user | 0 |

Injected EventSource browser timings and disposable local PostgreSQL tests in
[the implementation report](chapa-responsive-confirmation-2026-11-17.md) remain
separate evidence. They do not fill any row above.

## Information needed before a deployment

Start with the Coolify dashboard URL and existing approved authenticated access;
the operator does not need to find resource UUIDs first. Read-only inventory can
identify the project/environment and candidate WEB/Chapa-worker/Redis resources.
Before deployment, record their verified names and UUIDs, HTTPS staging hostname,
exact reviewed 40-character Git SHA and both previous image tags. Confirm that the database project, bot,
merchant TEST account and Redis resource differ from production. Do not infer
the target from an old tunnel or a similarly named resource. No new token is
needed when an existing approved dashboard/API session is available.

### Read-only API access when the dashboard session is not connected

Use the origin of the actual dashboard, retaining its HTTPS port if present,
and append `/api/v1`. Remove the entire `/project/.../terminal` path, query and
fragment. The supplied dashboard therefore uses
`https://coolify.gojoplay.online/api/v1`. Do not use a Lowwin application domain
as the API host. See [Coolify API base URLs](https://coolify.io/docs/api/overview).

In the team owning the linked project, open **Keys & Tokens > API Tokens > New
token**. The authenticated token page on this host is
`https://coolify.gojoplay.online/security/api-tokens`; the path is defined in
[Coolify's official route source](https://github.com/coollabsio/coolify/blob/main/routes/web.php#L566).
Use description `lowwin-staging-discovery`, expiry **7 days**, permission
**read** only, and **Selected projects, environments, or resources** access to the
linked project only. If an approved existing token already has this access, use
it instead. On self-hosted instances, API access must already be enabled under
Settings > Advanced; preserve any existing IP allowlist. Copy the complete token
once and save it privately in the ignored local `.env` or a secret manager:

```ini
LOWWIN_STAGING_COOLIFY_API=https://coolify.gojoplay.online/api/v1
LOWWIN_STAGING_COOLIFY_TOKEN=<COMPLETE_TOKEN_SAVED_PRIVATELY>
```

Do not paste the token into chat, a command argument or tracked files. The local
discovery helper only sends bounded GET requests to the supplied host and linked
IDs; it does not request environment values, logs, terminal access or deployment.
A limited token can test `GET /projects`; `/team` is outside its scope. See
[API token creation](https://coolify.io/docs/core/security/credentials/api-tokens)
and [authorization](https://coolify.io/docs/api/authorization). If the installed
Coolify version offers different controls, stop and inspect its version and
available access settings before widening permissions.

### Permissions for later isolated provisioning

After identity and isolation are verified, creating/configuring staging resources
needs `write`, starting them needs `deploy`, and inventory still needs `read`.
Use a separate short-lived token with those permissions limited to a dedicated
Lowwin staging project/environment. No `root`, `delete` or `read:sensitive` is
needed for this preparation. Resource logs, if later required, need separately
approved `read:sensitive` access; secrets must stay redacted in evidence.

A scoped token cannot introduce unused team Git/SSH credentials or place a
resource on a server with no resource already inside its scope. When staging is
absent, an operator must first create the dedicated staging project/environment
and approve its separate server/destination and Git source in the dashboard,
then bootstrap a staging resource there before scoped provisioning. Do not widen
the token to all team resources to work around this restriction. A project
containing production resources is not a staging-only scope. In particular,
Coolify warns that a scoped **write** token can reach the host through Compose
mounts; separate environment names on one server do not provide server isolation.
See [Coolify API permissions](https://coolify.io/docs/api/permissions) and
[environment creation](https://coolify.io/docs/api/endpoints/projects/create-environment).

If no staging resources exist, create a separate staging environment containing
`lowwin-web-staging`, `lowwin-chapa-staging` and private
`lowwin-redis-staging`. Use the approved repository and reviewed commit. Keep
auto-deploy off. Do not clone production secret values or point staging workers
at production queues. The existing [Coolify resource guide](../coolify-setup.md)
contains the Node 24/build settings and resource limits. Set the install command
on both applications to `npm ci --include=dev`, then use these commands:

| Resource | Build command | Start command |
| --- | --- | --- |
| WEB | `npm run build` | `npm start -- --hostname 0.0.0.0 --port 3000` |
| Chapa worker | `npm run db:generate` | `npm run worker:chapa` |

Expose only WEB through the confirmed staging HTTPS hostname. Worker and Redis
have no public domain/host-port mapping. Use one replica initially.

## Runtime configuration and migration

Enter the following non-secret values on WEB and Chapa worker. `APP_REVISION`
must be the reviewed commit. Replace placeholders only with the verified
staging values. Both resources must use the same private Redis and namespace.

```ini
NODE_ENV=production
APP_ENV=staging
APP_REVISION=<REVIEWED_40_CHARACTER_SHA>
BETTER_AUTH_URL=https://<STAGING_HOST>
MINI_APP_URL=https://<STAGING_HOST>
CHAPA_MODE=test
CHAPA_BASE_URL=https://api.chapa.global
CHAPA_CURRENCY=ETB
PAYMENT_GATEWAY=CHAPA
CHAPA_EVENTS_NAMESPACE=lowwin-staging-payment-20261117
CHAPA_ENABLED=false
CHAPA_RECOVERY_ENABLED=false
CHAPA_SCHEMA_READY=false
CHAPA_INLINE_ENABLED=false
CHAPA_INLINE_METHODS=telebirr,cbebirr,mpesa
CHAPA_WEBHOOK_SIGNATURE_PROFILE=raw_body
CHAPA_TEST_ENVIRONMENT_REVIEWED=false
CHAPA_MERCHANT_REVIEWED=false
CHAPA_LIVE_ENABLED=false
PAYMENTS_LIVE_ENABLED=false
WALLET_BIDS_ENABLED=false
WALLET_BIDS_LIVE_ENABLED=false
DEV_IDENTITY_ENABLED=false
DEV_POINTS_ENABLED=false
STAGING_DEMO_ENABLED=false
ARIFPAY_ENABLED=false
CHAPA_LEGACY_SWEEP_ENABLED=false
```

Supply protected staging-only `DATABASE_URL`, restricted runtime `DIRECT_URL`,
`REDIS_URL`, existing authentication/contact keys, TEST bot bindings and Chapa
TEST credentials separately through Coolify. Inline needs both the matching
`CHAPA_PRIVATE_KEY` and `CHAPA_PUBLIC_KEY` from the same TEST merchant environment,
plus the corresponding existing `CHAPA_WEBHOOK_SECRET` and signature profile.
Do not substitute a public key for the private key or copy live keys. Keep the migration-owner connection
in the migration job only. Do not paste secret values into this document, a
terminal command line or deployment logs. Retain the original credential and
signature-profile bindings of unresolved attempts; key replacement can make
them unverifiable.

Before either application starts, back up the confirmed staging database and
run **all additive migrations at the reviewed commit** through the isolated
migration job:

```sh
npm ci --include=dev
npm run db:generate
npm run db:migrate
```

This includes `202611170001_chapa_payment_signals` and
`202611170002_chapa_signal_guards`. Do not use `db push`, reset, seed, or delete payment history.
Set `CHAPA_SCHEMA_READY=true` only after migration/grants validation. Preserve
all existing provider activation/recovery flags until the operator verifies the
TEST merchant configuration and actual readiness. A healthy WEB is useful for
read-only recovery even while payment initialization is disabled.

### Gated TEST acceptance switch

After the target, migrations/grants, TEST key pair, webhook binding, public
HTTPS origins, private Redis and existing-attempt credential bindings are
verified, set these exact values on WEB and Chapa worker, then redeploy them:

```ini
APP_ENV=staging
CHAPA_MODE=test
PAYMENT_GATEWAY=CHAPA
CHAPA_SCHEMA_READY=true
CHAPA_TEST_ENVIRONMENT_REVIEWED=true
CHAPA_INLINE_ENABLED=true
CHAPA_INLINE_METHODS=telebirr,cbebirr,mpesa
CHAPA_ENABLED=true
CHAPA_RECOVERY_ENABLED=true
CHAPA_LIVE_ENABLED=false
PAYMENTS_LIVE_ENABLED=false
WALLET_BIDS_LIVE_ENABLED=false
```

`CHAPA_TEST_ENVIRONMENT_REVIEWED=true` is required for a remote staging database;
it records the operator's checks rather than bypassing them. `CHAPA_ENABLED`
and `CHAPA_INLINE_ENABLED` permit creation; `CHAPA_RECOVERY_ENABLED` keeps
original-attempt verification available after creation is paused again.
Leave the live flags false throughout. If testing internal-wallet bidding,
also set **`WALLET_BIDS_ENABLED=true` on staging WEB** after preparing its
isolated TEST wallet/auction fixture; that path stays independent of Chapa.
Do not seed or fund a production wallet. Keep `STAGING_DEMO_ENABLED=false` and
do not inherit `VERCEL_ENV=production`. Reconfirm readiness on both containers:

```sh
npx --no-install tsx scripts/check-chapa-inline.ts --schema
npx --no-install tsx scripts/check-chapa-inline.ts --methods
```

The first reads configuration/schema metadata, requiring the existing Inline
migration plus both confirmation migrations, their columns and active guard
definitions. Require `schema.status=ok`; a migration row alone is insufficient.
The second adds a read-only provider method lookup in reviewed TEST mode.
Neither initializes a payment. Also verify the candidate release's complete
migration list so any future additive migration is included.
Check `configured/enabled` through the owned configuration API before acceptance.
If the provider still rejects the documented TEST simulator, record that
blocker, pause new creation again and preserve the original attempt.

Redis must permit the existing public-cache commands and private
`PUBLISH`/`SUBSCRIBE` on `lowwin:payments:committed:v1:*`. WEB's subscriber uses
a different socket from publishers; only opaque hints cross this channel.
Inside each configured container, run:

```sh
npm run redis:check
```

This command proves connectivity/PING only. It does not prove pub/sub ACLs,
cross-process delivery, SSE, ownership or fulfillment.

## Exact application operations after UUIDs are identified

The following PowerShell block is a **template, not an executed deployment**.
Load the named variables from the approved private operator environment. Token
and URL must identify the same verified staging Coolify installation. The UUID
allowlist must contain only the previously reviewed staging applications.

```powershell
$taskApi = $env:LOWWIN_STAGING_COOLIFY_API.TrimEnd('/') # https://host/api/v1
$taskWeb = $env:LOWWIN_STAGING_WEB_UUID
$taskWorker = $env:LOWWIN_STAGING_CHAPA_UUID
$taskSha = $env:LOWWIN_STAGING_REVIEWED_SHA
$taskHeaders = @{Authorization="Bearer $env:LOWWIN_STAGING_COOLIFY_TOKEN"}
$taskAllowed = @($taskWeb, $taskWorker)
if (!$taskApi.StartsWith('https://') -or !$taskWeb -or !$taskWorker -or
    $taskWeb -eq $taskWorker -or $taskSha -notmatch '^[a-f0-9]{40}$' -or
    !$env:LOWWIN_STAGING_COOLIFY_TOKEN) { throw 'Verified staging inputs required' }

function Invoke-StagingApp($taskUuid, $taskSuffix, $taskMethod='GET', $taskBody=$null) {
    if ($taskUuid -notin $taskAllowed) { throw 'Outside staging UUID allowlist' }
    $taskArguments = @{Uri="$taskApi/applications/$taskUuid$taskSuffix";
        Method=$taskMethod; Headers=$taskHeaders; TimeoutSec=30}
    if ($null -ne $taskBody) {
        $taskArguments.ContentType='application/json'
        $taskArguments.Body=ConvertTo-Json -InputObject $taskBody -Compress
    }
    Invoke-RestMethod @taskArguments
}

# Read first; inspect only these non-secret application fields.
foreach ($taskUuid in $taskAllowed) {
    $taskApp=Invoke-StagingApp $taskUuid ''
    $taskApp | Select-Object uuid,name,fqdn,environment_id,git_commit_sha,status
    Invoke-StagingApp $taskUuid '/rollback-images' |
        Select-Object current,images
}

# After the operator matches these records to the separate staging environment:
# pin both apps to the reviewed SHA. This does not change their secret bindings.
foreach ($taskUuid in $taskAllowed) {
    $null=Invoke-StagingApp $taskUuid '' 'PATCH' @{
        git_commit_sha=$taskSha; is_auto_deploy_enabled=$false
    }
}

# Deploy WEB first, wait for its successful deployment/health/revision, then worker.
$taskWebDeployment=Invoke-StagingApp $taskWeb '/start' 'POST'
$taskWebDeployment | Select-Object deployment_uuid,message
# Inspect returned deployment UUID in the dashboard until complete; verify TLS health.
# Only then start the reviewed Chapa worker with its approved TEST recovery settings.
$taskWorkerDeployment=Invoke-StagingApp $taskWorker '/start' 'POST'
$taskWorkerDeployment | Select-Object deployment_uuid,message
```

Do not run the mutation lines until the returned resource identity has been
matched to staging. Do not print complete application/env API responses:
application responses can contain private configuration. The dashboard can
perform the same pin/deploy operations without API credentials. Check
`GET https://<STAGING_HOST>/api/health/live` for HTTP 204 and the exact
`X-App-Revision`; liveness alone does not prove database/provider readiness.

## TLS, Redis and owner acceptance

Keep `/api/payments/chapa/checkouts/{id}/events` outside response-buffering,
compression and caching middleware. The application supplies private/no-store,
`no-transform`, SSE MIME type and `X-Accel-Buffering: no`. Keep proxy read/idle
timeouts above 15 seconds. For nginx, apply only the narrow location in
`deploy/nginx-lowwin.conf.example`; for Coolify's existing Traefik proxy, inspect
the actual router middleware. Do not add a second proxy or assume local HTTP
behavior establishes the public TLS path.

Use a signed staging Telegram account and its existing owned payment. Through
the real TLS hostname, verify the first snapshot, separate 15-second
heartbeats, and snapshot recovery on reconnect. From the separate worker
container, an opaque `publishChapaCommitted(existingOwnedCheckoutId)` hint can
exercise Redis→WEB→SSE without altering funds; classify that as a **transport
probe**, not a payment settlement or commit-latency sample. Do not print the
returned payment DTO or session cookie in the report.

The full acceptance run, once Chapa resolves the recorded TEST initialization
and verification blockers, must observe an ordinary actual TEST payment:

1. Record owned attempt/reference and read-only pre-run ledger/receipt counts
   privately. Confirm exact WEB/worker revision, TEST mode and matching namespace.
2. Complete one authorized TEST provider flow. Wait for private matching evidence
   and its committed receipt. Do not create a replacement for an unknown outcome.
3. Record post-transaction commit-return time, publish dispatch, browser event and
   confirmed DOM time using a sanitized TEST correlation marker. Measure the
   commit-return-to-DOM interval only when clock offset is bounded; otherwise
   report separate same-clock server and browser intervals. State sample counts.
4. Verify the receipt appears before the next polling tick, exactly one journal
   and fulfillment exist, and duplicate hints/delivery do not add credit/bids.
5. Disconnect SSE across a commit, reconnect and resume: the immediate owned
   snapshot must recover it. Disable only the staging broker to test bounded
   polling fallback, then restore it; do not touch production Redis.
6. Switch to another signed TEST account. The former connection must close;
   its late frames cannot populate the new account's receipt or TanStack cache.
   The other owner's HTTP snapshot/events requests must return not found.
7. Check original-attempt recovery, incorrect OTP correction, insufficient funds,
   expiry/late success, preserved wallet funds and internal-wallet independence.

Physical Telegram checks remain deferred: resume/deactivate, real prompt/OTP
behavior and a device account switch have **zero measured samples**. Automated
desktop callbacks do not establish these outcomes. Record deferred items as
NOT RUN rather than treating their absence as a pass.

## Optional real Redis CI/local integration

`tests/chapa-committed-redis.test.ts` uses the actual Redis protocol and actual
helpers in three separate Node processes. It publishes only random TEST checkout
IDs under random namespaces, checks namespace isolation, drops its own subscriber
socket, waits the bounded reconnect backoff and checks that delivery resumes once.
It never connects to PostgreSQL/Chapa, kills another client's connection or flushes
Redis. Use an isolated loopback Redis service; no application dependency is added:

```sh
CHAPA_EVENTS_TEST_REDIS_URL=redis://127.0.0.1:6379 npx vitest run tests/chapa-committed-redis.test.ts
```

Without that variable the test explicitly skips; non-loopback or non-Redis URLs
are rejected. This is CI/local broker integration, not deployed Coolify TLS,
payment settlement or device evidence. Its subprocess import smoke passed locally;
actual broker execution was unavailable here because no Redis service was running.
The subsequent GitHub Actions run **44033962707**, job **133872377109**, passed
the real broker test at head `327186a` using Node 24.22.2 and Redis 7.4.12:
one test in 5,976 ms (suite 6.27 seconds, including the deliberate 5.1-second
reconnect wait). This is a successful real CI integration sample, not a payment
latency sample. See [sanitized CI evidence](evidence/chapa-redis-ci-2026-11-17.json).
The deployed TLS/device rows at the top remain NOT RUN with zero samples.

## Rollback without deleting financial state

Record the prior WEB/worker image tags from `/rollback-images` before rollout.
If acceptance fails, pause **new** TEST initialization with
`CHAPA_ENABLED=false`, preserving original merchant/session/contact bindings.
Use only prior images that retain patched **Next.js 16.4.6** and preserve this release's fenced verification,
retained durable signals and signal-guard migration contract. A baseline worker
that loses deferred signals is not a valid recovery rollback. If no such prior
worker exists, keep the fixed recovery worker while disabling new initialization
and prepare a forward fix. Keep additive migrations and all payment, ledger,
receipt, event and unresolved-attempt rows. Do not roll back to the vulnerable
16.4.2 framework image. Verify the restored container's version with
`node -p "require('next/package.json').version"` as well as revision/health.

With the same verified staging API function above, stop only the new staging
worker if needed. Suppress unrelated Docker cleanup, then roll back to the
previously recorded compatible image tags:

```powershell
$null=Invoke-StagingApp $taskWorker '/stop?docker_cleanup=false' 'POST'
# Obtain both tags from the saved rollback-images output, not a guessed branch.
$taskPreviousWeb=$env:LOWWIN_STAGING_PREVIOUS_WEB_IMAGE
$taskPreviousWorker=$env:LOWWIN_STAGING_PREVIOUS_CHAPA_IMAGE
if (!$taskPreviousWeb -or !$taskPreviousWorker) { throw 'Recorded rollback images required' }
$null=Invoke-StagingApp $taskWeb '/rollback' 'POST' @{commit=$taskPreviousWeb}
# Wait for prior WEB revision/health before restoring the compatible worker.
$null=Invoke-StagingApp $taskWorker '/rollback' 'POST' @{commit=$taskPreviousWorker}
```

Restore only inventoried staging environment values changed by this rollout;
do not rotate unresolved-attempt credentials or remove database columns. Keep
authorized recovery running on a compatible revision for unknown payments, or
document its paused status explicitly. Recheck reconciliation and owned receipts.
If there was no prior staging deployment, leave the new staging worker stopped
and WEB initialization disabled instead of inventing a rollback image.

Official operations: [environment variables](https://coolify.io/docs/applications/configuration/environment-variables),
[application identity](https://coolify.io/docs/api/endpoints/applications/get-application-by-uuid),
[pin a commit](https://coolify.io/docs/api/endpoints/applications/update-application-by-uuid),
[start/deploy](https://coolify.io/docs/api/endpoints/applications/start-application-by-uuid),
[retained images](https://coolify.io/docs/api/endpoints/applications/list-application-rollback-images),
[rollback](https://coolify.io/docs/api/endpoints/applications/rollback-application-by-uuid),
[stop without cleanup](https://coolify.io/docs/api/endpoints/applications/stop-application-by-uuid),
[proxy selection](https://coolify.io/docs/core/networking/proxy/overview),
[Traefik buffering](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/buffering/).
