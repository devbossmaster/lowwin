# Direct payment latency and one persistent authorization panel

The user requested one compact payment panel that stays open from Pay through
phone authorization and the committed result. The reference video guides the
layout, not payment-status truth or a simulated percentage.

## Observed live contract

Two explicitly authorized provider-only 5 ETB Telebirr requests used the owner's
locally supplied live key. Initialization returned in **1,541 ms** and **1,437 ms**.
The user confirmed the second prompt appeared and cancelled it. Private lookups
confirmed both original references were `FAILED`, with matching merchant
reference, 500 cents, ETB and Telebirr. These were not Lowwin wallet top-ups;
no successful payment or wallet credit was observed. No live key, phone number,
merchant reference, authorization reference or request ID is recorded here.

The returned initialization envelope differed from the documentation:

```json
{
  "status": "success",
  "data": {
    "auth_type": "",
    "chapa_reference": "CH-local-accepted-fixture",
    "payment_status": "Accepted",
    "request_id": "req-local-accepted-fixture",
    "created_at": "2026-11-17T18:56:30.326927837Z",
    "expires_at": "2026-11-17T18:56:30.326927992Z"
  }
}
```

The old parser rejected the empty authorization type, losing the usable
authorization state and entering uncertainty/recovery. The two timestamps also
resolve to the same JavaScript millisecond; persisting that expiry would end the
local observation window immediately.

Current Direct5 now recognizes only the exact accepted shape for the supported
Telebirr/M-Pesa USSD methods, retaining reference/request-ID validation. Missing,
null or unfamiliar authorization types remain rejected. Invalid, past or
nonlater advisory expiries leave the existing saved observation window intact.
Acceptance and expiry never prove payment; private verification, amount,
reference, ownership, metadata and exactly-once financial guards remain.
Historical Direct and Inline parsing stays strict.

## Changes

- One centered panel keeps its DOM identity, spinner, short instruction and
  payment summary through dispatch, USSD/OTP and private confirmation. Errors
  and OTP stay inline. Only committed outcomes show success in the same panel.
- A retained terminal signal skips redundant USSD refresh and goes directly to
  fenced private verification. A private pending result still cannot credit.
- Fresh batch eligibility uses one joined SQL statement instead of four.
  [Controlled measurements](../measurements/batch-eligibility-2026-11-17.json)
  distinguish local/deferred-operation results from production timing.
- Auction tap timing preserves the quote interval instead of restarting when
  Direct dispatch begins. Top-up and new attempts retain fresh timing spans.
- Wallet projections include restored promotional value, matching the refund
  funding reader; expired promotion remains unavailable and never becomes cash.

## Measurement limits

The live samples isolate Chapa initialization and do not measure the deployed
Lowwin request's pre-dispatch work, physical prompt latency or completed-payment
receipt latency. They establish neither a universal four-second promise nor a
production p95. Existing response `Server-Timing` separates `dispatch` (entire
pre-provider interval), `initialize`, database/lock phases and `persist`.
Nested phases must not be added together.

The local key aliases `CHAPAREAL`, `CHAPAPUBLIC` and `CHAPAWEBHOOKSECRETHASH` were
used only by ignored diagnostic scripts. Runtime configuration remains on the
existing canonical environment names; live enablement is not changed by these
code updates.

## Focused validation

The optimized loopback build and normal TypeScript check passed. The current
presentation/timing/provider unit cohort passed 136 tests; the isolated
financial eligibility/refund/batch/wallet cohort passed 87 tests without skips.
The Direct5 compatibility cohort separately passed 55 unit cases and 20
database cases. These overlapping cohorts are not a whole-repository total.

Ten mobile browser executions at 360 and 430 pixels passed without retries or
skips: one persistent dialog/panel through a held quote and initialization,
USSD, OTP rejection/retry, provider-success-but-not-committed and the committed
receipt. Embedded top-up keeps its credited receipt until Done restores the
original two-number bid draft without paying it. The held quote test confirms
that at least 150 ms of quote waiting remains in the tap-to-request measurement.
Synthetic browser provider routes made no live requests or database payments.

Review [English authorization](../screenshots/simple-direct-payment-20261117/bid-authorization-en-360.png),
[Amharic code entry](../screenshots/simple-direct-payment-20261117/bid-code-am-360.png)
and [committed top-up](../screenshots/simple-direct-payment-20261117/topup-credited-en-360.png).

The final combined optimized build passed, and eight further actual-app hero
checks passed at 320 / 360 / 430 / 1280 pixels in English and Amharic. The new
80,780-byte artwork uses one continuous blue-black background, text on the left,
and PS5, boxed iPhone 17 Pro Max, BYD Seagull and juicer on the right. Review
[desktop](../screenshots/simple-direct-payment-20261117/hero-desktop-en.png),
[mobile](../screenshots/simple-direct-payment-20261117/hero-mobile-am.png) and
the [sanitized verification manifest](../measurements/simple-direct-ui-2026-11-17.json).

Hosted audit run 355 reported the newly updated
[Picomatch advisory GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The installed 4.0.7 appears in the Vitest development dependency chain; six
reported high-severity entries cascade from that issue. The official advisory
lists no patched version at review time. This release does not change those
dependencies, suppress the audit or claim that it passes. The finding remains
open for an upstream patch or a separately reviewed mitigation.
