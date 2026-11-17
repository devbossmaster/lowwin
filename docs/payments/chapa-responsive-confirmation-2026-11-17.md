# Responsive Chapa confirmation — 17 November 2026

This release keeps Next.js, TanStack Query, Chapa v2 Inline, private verification and atomic settlement. New checkout offers Telebirr, M-Pesa and CBE Birr. Owned attempts retain their original protocol, reference, payload and idempotency key; internal-wallet bidding remains independent.

Fenced leases and durable signal generations retain webhooks received during provider HTTP. Bound pending Inline validation can skip a redundant private GET after a recent successful private check, with a 30-second private-check interval. Webhook/worker recovery remains active. Only matching private `data.status === "SUCCESS"` authorizes fulfillment.

SSE delivers committed owner-scoped snapshots across WEB/worker processes through existing Redis. PostgreSQL remains authoritative; reconnect/resume reads and bounded polling recover lost signals. See [broker and proxy configuration](chapa-committed-events.md).

English/Amharic messages separate provider outcome, verification availability and wallet/bid fulfillment. Exact-body-authenticated, fully bound webhooks retain allowlisted reasons and `cancelled_by: USER|SYSTEM`; only supported `USER` attribution says “You cancelled.” Unknown outcomes keep the attempt and show a support reference. Incorrect OTP retains the supported authorization form. Closing or a local deadline cannot cancel a payment or authorize another charge.

## Measured loopback comparison

The sanitized report is `.local/chapa-confirmation-benchmark-20261117.json`; its reproducible harness is `.local/chapa-confirmation-benchmark-20261117.ts`. Baseline source was commit `e7d25f2c2a2376f65390a83b02dafbbc95366d4b`; temporary baseline modules were deleted after the run.

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

Coverage includes duplicate/lost responses, original recovery, concurrent signals, periodic private checks, exactly-once credit, mismatches, OTP correction, cancellation attribution, unknown reasons, outages, late success, independent wallet payments and SSE ownership/reconnect races. The final broad focused run passed 710 tests with 169 skipped across 48 passing and five skipped suites (100.12 seconds). The latest isolated PostgreSQL rerun passed all 29 cases on a newly created disposable database, then dropped only that database; reports are `.local/chapa-signals-final-db.log` and `.local/chapa-signals-final-db-report.json`. The final standalone TypeScript check and production build passed; the build took 210,592 ms. Overlapping suite counts must not be added.

Production-bundle browser checks at 360px and 430px initially passed 26 cases, skipped 11 intentional duplicate scenarios and caught one fixture-counter failure. Trace inspection showed two requests aborted by the browser's fake-clock timeout were still counted until the Node handler's delay finished. The fixture now releases aborted requests; the one-active-request assertion remains unchanged. That lifecycle passed three consecutive reruns against the unchanged production bundle. Both SSE and polling-fallback cases then passed again at both widths (four checks). The distinct browser scenarios are therefore covered without counting repeat runs as new cases. Final TypeScript also passed after the fixture correction.

Injected EventSource callback-to-DOM samples were 20.2 ms at 360px and 18.3 ms at 430px while the provider poll was held (one sample per width). These measure simulated browser rendering only, not real commit, Redis, network or proxy latency. Logs and traces are under `.local/chapa-signals-sse-rerun*` and `.local/chapa-signals-sse-events-rerun*`; screenshots were visually checked for readable, unclipped payment content.

After the user's configuration update, a read-only TEST payment-method GET returned HTTP 200 in 1,148.5 ms (one complete-response sample), superseding its earlier HTTP 403. The actual TEST attempt then made one initialization request: HTTP 400 `INVALID_VALUE` (957.3 ms to headers). One private GET for the saved original reference returned HTTP 404 `NOT_FOUND` (835.6 ms to headers). The owned intent remains `NEEDS_REVIEW`/`UNAVAILABLE`, with zero credits and zero webhooks; its original key, payload and reference were retained. See `.local/chapa-test-e2e-20261117-report.json`. Authenticated provider delivery, successful provider settlement, physical USSD and deployed TLS streaming remain unproven. No replacement charge was created. The temporary receiver/tunnel is stopped after this session; remove its temporary TEST dashboard webhook. The disposable database containing the unresolved simulator attempt is retained for diagnosis, with no automatic payment worker running.

The read-only dependency audit still reports installed Next.js 16.4.2 under the moderate [GHSA-mfr8-8qww-v76h advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h). The advisory lists 16.4.5 as patched; npm's offered update target was 16.4.6. That framework patch upgrade remains outstanding.

## Deployment

Apply additive migration `202611170001_chapa_payment_signals` before starting this revision. It adds coordination, safe attribution/event-feedback fields and an index; existing financial records remain unchanged. Run `npm run db:generate` when building and `npm run db:migrate` through the reviewed migration connection. Preserve earlier migrations and restricted runtime roles.

Deploy the same revision to **lowwin-web** and **lowwin-chapa** (`npm run worker:chapa`). Reuse protected `lowwin-redis` with matching `REDIS_URL`, `APP_ENV`, `CHAPA_EVENTS_NAMESPACE` and private publish/subscribe permissions. Follow [the SSE runbook](chapa-committed-events.md) to disable stream buffering/caching and verify immediate events plus 15-second heartbeats through Coolify TLS. Preserve merchant bindings and activation/recovery flags. No live activation, production migration, deployment or merge was performed here.

Webhook `configurationFingerprint` scopes delivery deduplication, so previously authenticated feedback survives secret rotation. Only the exact-body route writes richer feedback after full payment binding. Resolution requires matching checkout, references, mode, privately verified status, applicable method and resource revision. Feedback never authorizes funds.

Contracts: [Inline](https://docs.chapa.global/docs/v2/integrations/inline-js), [payment methods](https://docs.chapa.global/docs/v2/integrations/payment-methods), [private verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), [webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks), [payment events](https://docs.chapa.global/docs/v2/webhooks/payment), [error codes](https://docs.chapa.global/docs/v2/error-codes).
