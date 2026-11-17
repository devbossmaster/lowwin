# Unique-only auctions, Direct payments and delivery history

This release starts from main `b8aa5079f5656160c29b843955a4876391778da1`, after
confirming PR #16 was merged. Its committed-payment SSE, provider error handling
and Next.js security changes remain. The later instruction to use v2 Direct
supersedes the original request to keep creating Inline payments.

New top-ups and auction payments use the same compact Direct form. Unknown
results retain the original operation; only privately verified, committed
financial outcomes show success. Historical Inline and Direct recovery remains.
See the [full API review](../payments/direct-charge-contract-2026-11-17.md) and
[payment/broadcast rollout](../payments/current-direct-rollout-2026-11-17.md).

## Auction and refund behavior

`lowest-unique-v5` requires two eligible participants and selects the lowest
number used once. No unique number means `NO_UNIQUE_BID` cancellation. Actual
paid cash returns to the wallet; promotional value keeps its original expiry,
expired promotion never becomes cash, and coupon discounts create no refund.
The audited migration adopts unsettled auctions while preserving completed
results, accepted bids and original financial receipts.

Consecutive numbers are allowed in individual submissions and ranges. The
100-distinct-number cap, two-decimal precision, duplicate rejection and financial
guards remain. The v5 proof does not declare a consecutive-number restriction;
historical completed proofs retain their original policy facts.

Settlement commits bounded durable refund intents. Workers commit each refund
once, independently of notification delivery. Pending UI amounts never appear
as paid refunds. See [financial guards and recovery](../payments/unique-only-refunds-2026-11-17.md).

## Login and security

The installed Telegram OIDC flow already cached the provider/JWKS and coalesced
pending requests. Measurement identified avoidable database round trips instead:
three ordered advisory-lock queries became one ordered statement, and five
identity/contact/account reads became one joined snapshot. Required checks remain
inside the original transaction. `/api/me` reuses its authoritative joined player
display name and records private timing phases without loading wallet, bids or
notifications.

The signed Mini App session lookup now rechecks the current database `user.role`
on every request, including a role change without a staff row. Existing signature,
issuer, audience, expiry, nonce, state, PKCE, canonical callback, contact ownership,
account conflict and account-switch protections remain. No UserInfo call was
introduced. The user clarified that the current password-only admin login must
be preserved, with no new 2FA enrollment.

Mini App presentation is separate from website login. A Telegram launch uses
server-verified signed launch data, then first-time contact registration. The
Mini App never offers the website OIDC login button. First-time players see a
short guide (the admin-managed video when available), an optional native
home-screen shortcut on supported Telegram clients, then native contact consent.
Dismissal permits browsing; native approval alone never verifies the account.
Returning registered players restore their account and wallet without repeating
contact consent. The website retains its existing Better Auth Telegram OIDC flow.
The tutorial video is not ready yet, so the short guide remains the fallback.
The bot welcome places the optional Telegram channel link beside Launch LowWin.

Public Home navigation now reads the same public visit memory used to save its
filters and scroll position, retaining extra loaded auction pages on return.
Private route memory remains scoped to the current account/session.

The review covered server-side staff permissions, fresh revocation, owner-scoped
payment/refund/history reads, mutation origin checks, bounded inputs and rate
limits, private/no-store responses, media validation, safe text rendering and
redacted errors. New resend/delete commands require the existing server-side
broadcast permission and transactional reauthorization. Existing upload and
winner-photo consent checks remain. The local dependency audit reported zero
vulnerabilities. This is focused review/test evidence, not a penetration-test or
universal security guarantee.

## Measured latency

The [login benchmark](../measurements/telegram-login-2026-11-17.json) uses the
installed provider callback, signed synthetic JWT/JWKS, database identity/contact
binding, signed session and owned account bootstrap. It replaces only provider
HTTP with synthetic responses. Cold samples use a fresh auth/JWKS instance and
reconnected Prisma pool; warm samples reuse the instance, cache and pool.

| Login sample | n | p50 | p95 |
| --- | ---: | ---: | ---: |
| Warm new player | 20 | 52.7 ms | 68.1 ms |
| Warm returning player | 20 | 36.2 ms | 43.9 ms |
| Cold new player | 5 | 185.3 ms | 294.0 ms |
| Cold returning player | 5 | 149.6 ms | 181.6 ms |

These exclude real Telegram HTTP, approval, redirect transport, hydration and
production database/proxy latency. They do not establish a production p95 or
prove the 1–2 second end-to-end target. The timing headers support a controlled
deployed measurement without logging identity or credentials.

The [separated financial benchmark](../payments/evidence/unique-refund-timings-2026-11-17.json)
uses real synthetic purchases and three local samples per size. Refund time
includes publication and serial one-wallet processing for two or ten recipients.

| Accepted bids | Decision p50 / p95 | All refunds p50 / p95 |
| ---: | ---: | ---: |
| 10 | 70.7 / 117.0 ms | 95.1 / 106.8 ms |
| 100 | 382.5 / 846.4 ms | 87.7 / 96.0 ms |
| 1,000 | 645.2 / 848.0 ms | 405.6 / 406.4 ms |

An earlier combined probe had a 59-second outlier. Its
[baseline evidence](../payments/evidence/unique-refund-timings-baseline-2026-11-17.json)
is retained; its cause remains unresolved. The separated samples did not repeat
it. Three samples per size cannot establish production tail latency.

The [browser refund measurement](../measurements/refund-ui-2026-11-17.json)
uses actual database commits, signed Telegram sessions, real owned My Bids HTTP
reads and the optimized HTTPS application. Across three samples, committed
refund to completed UI was p50 2,950 ms / p95 2,959 ms, matching its pending-only
three-second poll. Decision commit to pending UI, including initial navigation,
was 779–1,489 ms. The shared fixture stubs wallet summary/provider availability;
it does not stub the cancellation, refund or My Bids responses.

## Presentation and validation

The final 1840 × 800 WebP is 153,106 bytes, with concise EN/AM HTML copy beside
rich royal-blue and navy artwork showing a PS5, MacBook, refrigerator, iPhone Pro Max,
headset and bicycle. It replaces the earlier light-blue composition following
the user's final correction from gold to blue. Text and products share one hero section;
mobile stacks the readable copy with the artwork. The asset and exact built-in
generation prompt are recorded in its
[provenance manifest](../../public/images/lowwin-blue-prizes-hero-20261117.provenance.json).
Retired managed banner defaults
cannot silently replace it. Countdown updates remain local to the timer and
preserve server anchoring, large digits, reduced motion, expiry and resume.
Broadcast history keeps the original media and has one direct Yes/No resend or
deletion confirmation; its worker and authorization behavior is documented in
the linked rollout guide.

Focused validation runs overlap and must not be added into a repository-wide
test count:

| Check | Result |
| --- | --- |
| Telegram login/session/security | 134 passed, no skips |
| Broader financial/payment/profile regression | 204 passed; 12 submission-fee cases initially skipped due to a missing harness variable |
| V5 transition/refund + historical submission-fee cohort | 22 passed, no skips; includes all 12 cases missing above |
| Direct protocol/recovery and broadcast unit cohort | 107 passed, no skips |
| Real PostgreSQL Direct5 / delivery durability | 9 / 14 passed, no skips |
| Frontend, bot, countdown, webhook examples and copy | 107 passed, no skips |
| Refund projections and money rendering | Fresh database projection passed; four rendering cases passed; mixed bonus funding verified against actual padded PostgreSQL numeric values |
| Hero/countdown responsive matrix | 10 passed, 2 intentional duplicate lifecycle skips |
| Payment/public browser matrix | Initial 101 configured: 84 passed, 5 failed, 12 intentional width skips; all five failures resolved and targeted rerun passed 9 cases with 1 duplicate width skip |
| Committed refund UI and cached-null recovery | Real DB/HTTP UI measurement passed; standalone actual-component cached-null → pending → completed → changed-auction regression passed |
| Broadcast browser controls | 360px / 1280px passed with decoded original media and direct confirmation actions |
| Native Mini App registration and SDK recovery | 9 passed, no skips; signed launch, bounded server contact confirmation, cancellation and late SDK recovery |
| Combined prize hero, guide and native shortcut | 8 passed, no skips at 320 / 430 / 1280px; final blue palette replaces the gold artwork used by this first geometry run |

The pre-range-update production source (`a3fc1eb`) passed an optimized build (203.8 seconds),
normal-project TypeScript checking and a fresh-database production refund smoke
check after the money-normalization fix. The
[validation manifest](../measurements/release-validation-2026-11-17.json) records
these scopes. Hosted CI status belongs to the PR and is not inferred from local
results.

The later optimized onboarding build (`9e6b7f6`) compiled in 102 seconds, passed
its TypeScript phase and generated 41 static pages. Normal-project TypeScript
also passed. Follow-up checks found and corrected a saved Home registration
intent replay: `login` and `next` are commands and are removed from remembered
Home visits, while ordinary filters, scroll and account isolation remain.
The bot update claim also compares its UTC timestamp lease with a UTC clock;
a deterministic non-UTC concurrent-worker regression prevents duplicate welcome
delivery. Final hosted revision status is reported on PR #17.

The payment browser failures exposed an actual historical Inline OTP continuation
gate and cross-run pollution of a fixture's exact view count. The gate now uses
the shared authorization predicate. Fixture isolation was repaired while keeping
the exact counter assertions; all four normal/throttled launch cases then passed.
Timer tests wait for the authoritative hydrated target before scrolling, retaining
all geometry/expiry assertions. The initial failures remain part of the evidence;
this is not a claim of one uninterrupted green 101-case run or hosted CI success.

The final PostgreSQL numeric probe also demonstrated why DTO normalization is
required: a restored bonus serialized as `50.0000000000000000`; the owner-scoped
projection now returns `50`, which the strict money renderer accepts. Cached
absence is kept briefly fresh and watched, so an earlier transaction read cannot
hide a subsequent cancellation refund for five minutes.

Review screenshots:

- [Desktop EN hero](../screenshots/release-2026-11-17/hero-1280-en.png),
  [320px EN hero](../screenshots/release-2026-11-17/hero-320-en.png),
  [430px AM hero](../screenshots/release-2026-11-17/hero-430-am.png).
- [320px AM detail/countdown](../screenshots/release-2026-11-17/detail-320-am.png),
  [large reduced-motion timer](../screenshots/release-2026-11-17/countdown-large-320-am.png),
  [committed refund](../screenshots/release-2026-11-17/refund-430-en.png).
- [Broadcast history](../screenshots/broadcast-history/history-1280.png) and
  [direct mobile resend confirmation](../screenshots/broadcast-history/resend-360.png).

## Deployment

Use the same reviewed revision for `lowwin-web`, `lowwin-bot`, `lowwin-auctions`,
`lowwin-notifications` and `lowwin-chapa`. Preserve canonical origins, authentication,
contact encryption, database runtime, original payment credentials and Redis
settings. New Direct uses the private key and existing creation/recovery gates;
keep the original public key available while unresolved Inline attempts exist.
Do not enable live charges as part of this code rollout.

Apply the additive migrations using the separate migration credential:

1. `202611180001_unique_refunds_v5` — audited unsettled-policy transition,
   refund intents/funding view, ledger and bonus guards.
2. `202611180002_broadcast_history_deletion_indexes` — durable deletion indexes.
3. `202611180003_current_direct_v2` — Direct5 identity/authorization/bonus guards.

Rehearse against an isolated restored target first. Pause bid/payment creation
and the old auction closer during the controlled migration/revision cutover so
old code cannot encounter adopted v5 terms. Inventory unresolved payments and
preserve their authorized recovery. Deploy matching auction, notification and
Chapa workers before reopening web creation/admin enqueue operations. Verify the
restricted grants using updated `deploy/runtime-role.sql` if roles are managed
separately. Never reset, seed or use `db push` against production.

After cutover, check worker health, reconciliation, pending refund drain,
publication and owned receipt/SSE refresh. An application rollback must preserve
the migrated data and use v5-compatible recovery; restoring an old worker does
not undo the policy transition. Actual phone USSD/OTP, Chapa merchant TEST
acceptance/webhooks, Telegram delivery and production proxy latency remain
external acceptance checks. No production migration/deployment, live charge or
customer broadcast was performed during this implementation.
