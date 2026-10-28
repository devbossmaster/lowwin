# Chapa checkout recovery and verification follow-up

Started from clean, fetched `main` at `cfe49150122af9e3f50b2927356dd1bd5beaef8b`. Findings were checked against that source and the [v2 Quick Start](https://docs.chapa.global/docs/v2/getting-started), [environments](https://docs.chapa.global/docs/v2/integrations/test-live-mode), [hosted checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment), [verification](https://docs.chapa.global/docs/v2/integrations/verify-payment) and [webhooks](https://docs.chapa.global/docs/v2/integrations/webhooks) on 28–29 October 2026, Africa/Nairobi.

## Confirmed findings and fixes

- An interrupted bid initialization persisted an intent but no checkout ID. Reopening selected payment status while clearing the transient error, leaving no recovery control. The status now exposes **Resume checkout**, which retries the saved body and original key. This also covers a normal `202` containing an ID but no checkout URL, without depending on worker repair. Ambiguous `5xx` responses retain the key even when their generic error code is `PAYMENT_UNAVAILABLE`; only known pre-commit `4xx` rejections can clear a new intent. Closing, reopening, double-clicking and retrying do not generate a replacement payment. Top-ups retain the same frozen amount and key. Account/surface epochs guard errors, state updates, navigation and in-flight locks as well as successful responses.
- Verification previously required `lowwin_attempt` whenever any metadata object was returned, even though the minimal request sends no metadata. Expectations now come from the immutable initialization. Minimal requests accept omitted, null, empty or unrelated object metadata; explicit conflicting attempt IDs fail. Historical returned metadata must match its expected fields. Omission remains accepted as before because Chapa verification treats metadata as optional. Null is normalized for signed webhook hints too. Malformed nonobject metadata is rejected.
- Confirmation previously chose invalidation scopes from the hook's screen name. It now uses the authoritative order purpose and auction slug, including the return page and paid but unaccepted late bids. Wallet, payment history, My Bids, profile, auction and referral resources refresh as appropriate. Pending states and return parameters do not invalidate as financial success, seed balances or accept bids. Unrelated auction caches and other identities remain isolated.
- External return links now carry only `chapa_<checkout UUID>` through the existing Telegram bot `/start` flow. Its **Check payment** WebApp button opens the original payment status. The authentication handoff preserves that narrowly validated route; both status and verification APIs still enforce ownership. No Main Mini App registration assumption, payer phone, amount, result or user ID is added to the link.
- The provider request remains the working minimal integer-cent amount, ETB currency and immutable merchant reference with its original provider idempotency key. No optional callback/return fields or existing intents were changed. Telegram's external checkout still returns through the original open Mini App or the explicit payment-status link; automatic provider redirection has not been claimed.

## Measured work and timing

Request-scoped `Server-Timing` now separates `auth`, `database`, `initialize`, `verify`, aggregate `checkout` and `total`. Authentication and provider HTTP stay outside the ledger transaction; transactional reauthorization, leases, advisory/row locks, exact successful evidence and exactly-once accounting remain required. Financial responses retain private `no-store` headers.

The controlled loopback benchmark used three measured iterations after warm-up, PostgreSQL and a mocked provider with 40 ms initialization / 30 ms verification delay. It excludes HTTP authentication, remote database/network latency and physical Telegram. Query events include transaction statements. Before/after reports are private at `.local/chapa-fix/service-timing-{before,after}.json`; their summary is `.local/chapa-fix/timing-summary.json`.

| Operation | Query events before → after | Median database ms | Median provider ms | Median total ms |
| --- | --- | --- | --- | --- |
| New top-up | 18 → 18 | 26.3 → 25.3 | initialization 50.4 → 53.2 | 75.4 → 80.6 |
| Replay initialized intent | 9 → 8 | 10.9 → 10.0 | none | 11.6 → 10.8 |
| Confirm top-up | 32 → 30 | 39.3 → 42.7 | verification 33.2 → 33.0 | 76.3 → 75.9 |

The query reductions are reproducible. These small, noisy elapsed samples do not establish an end-to-end latency improvement. Remote authentication/database/provider delays require observing these phase headers in the reviewed TEST deployment. Cold local development compilation is a separate bottleneck.

## Completed local validation

- **292 distinct focused tests passed**: 97 Chapa provider/API/ledger/schema/readiness/timing tests, 89 authentication/security tests, and 106 client/cache/navigation/bot tests. Financial tests used disposable loopback PostgreSQL databases and mocked providers.
- **Six mobile browser checks passed in 30.3 seconds** against the final production bundle: English at 360 px and Amharic at 430 px. They cover existing checkout safety, ambiguous `503` and timeout recovery with the original key, double-click deduplication, `202` initialization recovery after reopening, frozen top-up amount, and authoritative return-page My Bids invalidation. The browser checks create no real payment checkout or bid. Both recovery screenshots were visually checked.
- Typecheck (`tsc --noEmit -p tsconfig.ui-tests.json`), the production webpack build, and `git diff --check` passed. The build completed compilation, TypeScript checking and route generation.
- The local pinned Semgrep attempt timed out without a result. The independent hosted [static/secrets job](https://github.com/devbossmaster/lowwin/actions/runs/40775286320/job/123122881644) subsequently passed: **66 rules, 728 files, zero findings**. It must rerun on the final auth-compatible commit; the earlier local timeout was never counted as a pass.
- An earlier development browser run encountered hot-reload module churn while edits were still being made. The first production-browser attempt then correctly rejected the local HTTP fixture under production environment rules. The final run used the existing local-runtime test option while serving the unchanged production bundle; no application authentication rule was relaxed.
- Low disk space interrupted an earlier build. Only verified, inactive/generated test compiler caches were moved reversibly to D:, and the corrected final build passed. No project data was deleted.

## Dependency security

The initial [CI security job](https://github.com/devbossmaster/lowwin/actions/runs/40765906290/job/123089863624) failed on the old Better Auth dependency chain. The coordinated upgrade pins patched **Better Auth 1.7.14** with a readable, license-preserving Mini App-only Telegram compatibility package. The full unsuppressed local audit now exits 0 with **zero vulnerabilities**; 112 focused authentication/security tests and strict lock/peer validation pass. There is no issuer migration: later official 1.7 releases restored the existing account schema. [The security follow-up](chapa-security-followup-2026-10-29.md) documents advisories, provenance, compatibility limits and validation. No peer coercion, downgrade, disabled limiter or advisory suppression was used. Final hosted audit/static checks remain required. Static/secrets scanning runs in its own independent CI job, so an audit failure cannot skip it.

## Merchant TEST acceptance and live gates

A new read-only audit checked the separately reviewed staging target, TEST key/mode, disabled live flags, verified TLS and a read-only database transaction. It created no intent, paid no charge, changed no balance and sent no bot message. Merchant GET verification of the existing completed 100 ETB TEST payment returned HTTP 200 / `SUCCESS` in 767 ms, matching the stored merchant reference, exact cents, currency and final reference. Its one receipt journal has two balanced postings.

Actual Chapa webhook delivery is **not demonstrated**: both stored TEST events are known synthetic probes and none matches a real TEST intent. The public webhook route is reachable and the TEST recovery worker is running. Physical Telegram return could not be exercised because no device/browser surface was available. Isolated browser fixtures are separate from those merchant/device acceptance requirements.

Before live activation:

1. Complete the final commit's unsuppressed hosted dependency audit, static/secrets scan, authentication, financial, typecheck, build and browser checks. The local audit is clean; do not substitute an earlier commit's hosted result for the final compatibility package.
2. Deploy the reviewed code and matching bot/worker to the separate TEST environment. Do not add provider return URL fields without a distinct successful merchant compatibility trial; existing attempts retain their original binding.
3. In the TEST dashboard, inspect and, if supported, retry the existing completed payment's PAYMENT webhook delivery. Correlate the durable event with the actual merchant reference and verify that duplicate delivery adds no receipt or credit. A synthetic HMAC request does not complete this step.
4. On a real Telegram device, complete the top-up and bid flows, close and reopen an interrupted attempt, return to the same owned status through the bot link, and verify that another account receives no payment details. Check success, failure/cancellation, delayed webhook and late bid outcomes. Use TEST funds only.
5. Only after these gates pass, separately review production configuration, existing required migrations, verified merchant account, live key/methods, webhook URL/secret, deployment and matching recovery workers. This change does not activate live payments or authorize production balance changes or migrations.
