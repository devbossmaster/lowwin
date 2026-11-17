# Responsive Chapa confirmation — 17 November 2026

This release keeps Next.js, TanStack Query, Chapa v2 Inline, private verification and atomic settlement. New checkout offers Telebirr, M-Pesa and CBE Birr. Owned attempts retain their original protocol, reference, payload and idempotency key; internal-wallet bidding remains independent.

Fenced leases and durable signal generations retain webhooks received during provider HTTP. Bound pending Inline validation can skip a redundant private GET after a recent successful private check, with a 30-second private-check interval. Webhook/worker recovery remains active. Only matching private `data.status === "SUCCESS"` authorizes fulfillment.

SSE delivers committed owner-scoped snapshots across WEB/worker processes through existing Redis. PostgreSQL remains authoritative; reconnect/resume reads and bounded polling recover lost signals. See [broker and proxy configuration](chapa-committed-events.md).

English/Amharic messages separate provider outcome, verification availability and wallet/bid fulfillment. Exact-body-authenticated, fully bound webhooks retain allowlisted reasons and `cancelled_by: USER|SYSTEM`; only supported `USER` attribution says “You cancelled.” Unknown outcomes keep the attempt and show a support reference. Incorrect OTP retains the supported authorization form. Closing or a local deadline cannot cancel a payment or authorize another charge.

## Historical loopback comparison before final review

Baseline source was commit `e7d25f2c2a2376f65390a83b02dafbbc95366d4b`; temporary baseline modules were deleted after the run. The figures below are retained sanitized evidence from the implementation before this review, not a benchmark rerun of the final revision. The original local reports are `.local/chapa-confirmation-benchmark-20261117.json` and `.local/chapa-confirmation-benchmark-20261117.ts`.

Both variants used the same migrated, isolated loopback PostgreSQL database and a loopback HTTP fake provider with a fixed artificial 20 ms response delay. Each variant had ten 40.00 ETB top-up initiations with a warmed credential-scoped capabilities cache, ten explicitly due matching-pending cycles within 30 seconds, and one successful settlement. There was one capabilities HTTP request per variant. Authentication was excluded because the fixture user was already authenticated; no bid quote workload was measured.

| Measurement | Baseline | Updated | Samples per variant |
| --- | ---: | ---: | ---: |
| Initiation service median / p95 | 72.4 / 131.8 ms | 62.7 / 74.9 ms | 10 |
| Preparation transaction median / p95 | 19.0 / 43.2 ms | 19.8 / 24.8 ms | 10 |
| Time until provider dispatch, median | 24.4 ms | 24.1 ms | 10 |
| Fake initialization HTTP, median | 34.5 ms | 31.5 ms | 10 |
| Matching pending service cycle, median | 88.1 ms | 56.6 ms | 10 |
| Validation / private GET calls across pending cycles | 10 / 10 | 10 / 1 | 10 cycles |
| Successful verification HTTP | 27.0 ms | 32.6 ms | 1 |
| Settlement transaction including commit | 130.1 ms | 54.0 ms | 1 |

Each success committed exactly one receipt journal and exactly 40.00 ETB to its fixture wallet. The pending comparison exercises the private-request suppression rule without waiting through real polling cadence. Preparation medians do not demonstrate an initiation preparation improvement. Sequential execution, cache warming and a single settlement sample prevent a reliable settlement speed claim. These measurements exclude real Chapa, mobile authorization, physical Telegram, production Redis/proxy behavior and commit-to-screen latency; they establish no guaranteed USSD or confirmation time.

## Validation and limits

Coverage includes duplicate/lost responses, original recovery, concurrent signals, periodic private checks, exactly-once credit, mismatches, OTP correction, cancellation attribution, unknown reasons, outages, late success, independent wallet payments and SSE ownership/reconnect races. Final results are recorded in [the tracked review evidence](evidence/chapa-review-validation-2026-11-17.json):

- Focused suite: **821 passed, 190 skipped**, 58 passing and eight skipped files, 131.97 seconds. Database/Redis opt-in cases are validated separately; these are not 1,011 executed passing tests.
- Isolated PostgreSQL coordination, additive compatibility and settlement: **33 passed**, including a signal arriving during provider HTTP and exactly one committed credit. Separate transaction/account-isolation checks: **15 passed**. Readiness coverage includes **15 unit cases and four actual database metadata cases**. Counts overlap the focused suite and must not be added.
- Production-bundle mobile payment scenarios at 360px/430px: **29 passed**, 11 intentionally duplicated width cases skipped. Provider HTTP and EventSource delivery are fixtures, not Chapa or deployed streaming evidence. Compact retained-completion, retry and polling fallback states are covered.
- Admin regression harness: **3 passed** at 360px/430px/1440px against the production artifact, with no application writes. Pre-existing stale test selectors were corrected; admin product behavior was not changed.
- Standalone `tsc --noEmit`: **passed**. Final fresh production build on **Next.js 16.4.6**: **passed**, 222,683 ms. The 660-file application/source digest remained unchanged through that build.
- Actual Redis integration in GitHub CI: **passed**, three independent Node processes, real publish/subscribe, namespace isolation, socket interruption and reconnect. [CI evidence](evidence/chapa-redis-ci-2026-11-17.json) explicitly excludes database commit, Coolify TLS, browser rendering and physical Telegram.

Injected EventSource callback-to-DOM samples were 20.2 ms at 360px and 18.3 ms at 430px while the provider poll was held (one sample per width). These measure simulated browser rendering only, not real commit, Redis, network or proxy latency. Logs and traces are under `.local/chapa-signals-sse-rerun*` and `.local/chapa-signals-sse-events-rerun*`; screenshots were visually checked for readable, unclipped payment content.

After the user's configuration update, a read-only TEST payment-method GET returned HTTP 200 in 1,148.5 ms (one complete-response sample), superseding its earlier HTTP 403. The original TEST initialization returned HTTP 400 `INVALID_VALUE` (957.3 ms to headers); its private GET returned HTTP 404 `NOT_FOUND` (835.6 ms to headers). One bounded diagnostic replay of the **same body, reference and idempotency key** returned HTTP 400 `INVALID_VALUE`, safe message **`payable not found`**, in 1,662.8 ms complete. No request ID was available in the inspected body/header locations. These are two initialization HTTP calls for one retained operation, zero accepted TEST payments, zero new credits and zero webhooks.

The [sanitized diagnosis and support handoff](evidence/chapa-test-inline-diagnosis-2026-11-17.json) confirms the saved v2 Inline TEST bindings, original payload hash and current capabilities. The matching public/private fingerprints prove today's keys match the original intent; they do **not** prove Chapa assigned both keys to the same business. Private methods access and public HTTP 400 cannot establish that relationship; merchant-dashboard or Chapa-support confirmation is required. The payload matches both the published Inline page and API Playground collection, including amount, currency, method, top-level `mobile`, public-key header and reference limits. The exact cause of `payable not found` remains unconfirmed; Chapa must confirm key-pair business binding, Inline TEST availability and any undocumented payable prerequisite. Its general success simulator is demonstrated under Direct Charge, and its `09` prefix conflicts with Lowwin's M-Pesa `07` rule; no documented working M-Pesa substitute was found. No Direct control or fresh replacement operation was created.

The owned intent remains `NEEDS_REVIEW`/`UNAVAILABLE`, with its original key, payload and reference intact. Actual signed delivery, successful provider settlement, physical USSD and deployed TLS streaming remain unproven. Preserve the retained diagnosis database with no automatic payment worker. When an authenticated TEST dashboard session is available, manually remove only the obsolete temporary webhook `https://kiss-fees-ambient-transportation.trycloudflare.com/api/payments/chapa/webhook`; no dashboard cleanup or production webhook change was performed here.

Next.js and its matching lockfile dependencies are pinned to **16.4.6**, above the advisory's patched 16.4.5 floor. React and the authentication packages were not upgraded. The final full `npm audit --json` reported **zero vulnerabilities at every severity**. [Official advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h).

## Confirmed review fixes

Terminal completion hints remain durable scheduling evidence until a fresh, causally matching private terminal lookup resolves them. They never authorize fulfillment. A stale pending response cannot consume a newer generation or restart the 30-second suppression window indefinitely. Future timestamps do not count as a recent successful private lookup. A signal received during provider HTTP survives fenced cleanup and receives a bounded deferred check; provider HTTP stays outside financial transactions.

Verification and OTP leases require sufficient remaining time immediately before HTTP, with one fenced renewal and a second budget check. A delayed old response cannot release a successor's lease. `lastPrivateCheckAt` records the provider-response time, rather than a later transaction-lock release. Atomic signal registration returns its updated review status, preventing stale failed UI and unsafe retry actions. Authenticated webhook attribution stays immutable after credit; a bare cancellation code does not claim that the user cancelled.

SSE observer requests remain fenced across account changes, remounts and primary-observer handoff. Failed Redis subscriptions are replaced after backoff without accumulated listeners; an old publisher failure cannot dispose of a newer connection. Clients retain one original attempt while completion evidence is unresolved, even if an older private status was failed. Stream success still follows financial commit.

The additional guard migration preserves existing nullable metadata, balances and history. Tests apply both additive migrations over baseline data and verify immutability, runtime bookkeeping, signal retention and one financial effect. Readiness checks now validate both migrations, their columns, constraints, indexes and trigger bindings before activation.

## Deployment

Apply additive migrations **`202611170001_chapa_payment_signals` and `202611170002_chapa_signal_guards`** before starting this revision. They add coordination, safe attribution/event-feedback fields, an index and immutable-feedback guards; existing financial records remain unchanged. Run `npm run db:generate` when building and `npm run db:migrate` through the reviewed migration connection. Preserve earlier migrations and restricted runtime roles. Exact isolated staging commands, configuration, rollout gates and recovery-preserving rollback are in [the rollout runbook](chapa-staging-rollout-2026-11-17.md).

Deploy the same revision to **lowwin-web** and **lowwin-chapa** (`npm run worker:chapa`). Reuse protected `lowwin-redis` with matching `REDIS_URL`, `APP_ENV`, `CHAPA_EVENTS_NAMESPACE` and private publish/subscribe permissions. Follow [the SSE runbook](chapa-committed-events.md) to disable stream buffering/caching and verify immediate events plus 15-second heartbeats through Coolify TLS. Preserve merchant bindings and activation/recovery flags. No live activation, production migration, deployment or merge was performed here.

Webhook `configurationFingerprint` scopes delivery deduplication, so previously authenticated feedback survives secret rotation. Only the exact-body route writes richer feedback after full payment binding. Resolution requires matching checkout, references, mode, privately verified status, applicable method and resource revision. Feedback never authorizes funds.

Contracts: [Inline](https://docs.chapa.global/docs/v2/integrations/inline-js), [payment methods](https://docs.chapa.global/docs/v2/integrations/payment-methods), [private verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), [webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks), [payment events](https://docs.chapa.global/docs/v2/webhooks/payment), [error codes](https://docs.chapa.global/docs/v2/error-codes).
