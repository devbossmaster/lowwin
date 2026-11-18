# Payment readiness and authorization, 18 November 2026

The customer recording showed Pay changing into a loading state on method
selection, followed by a roughly 14-second authorization-card-to-USSD gap.
The reference showed one authorization card with an amber moving segment on a
gray track. Its roughly four-second phone prompt used M-Pesa; the Lowwin
recording used Telebirr, so the clips do not establish equal provider latency.

## Change

Payment configuration warms when the bid sheet opens. Continue joins the same
configuration read before revealing methods. A failed external configuration
read still permits the independent internal-wallet path. The immutable bid
quote starts on validated Continue, before a method is selected. Provider and
wallet switches retain the same quote request. Final Pay can immediately show
authorization and joins a still-running quote before any provider dispatch.
It cannot start a charge before valid pricing or before the explicit Pay.

The current Direct creation/configuration and atomic bid/wallet endpoints now
delegate authentication directly to their existing authenticated handlers.
Proxy previously repeated the session database lookup before those handlers.
Only exact paths delegate; neighboring paths retain Proxy authentication and
the handlers still require a fresh owned session and transaction reauthorization.

An atomic wallet command keeps its own stable key because its approved-total
request hash differs from a background quote's hash. Price-change approval and
original-attempt recovery retain their existing paths.

Top-ups and direct auction payments share the authorization view, animated
amber line and fixed pending copy. Temporary networking, private verification,
display expiry and review hints do not insert extra cards, reference text or
manual checking/retry buttons. OTP methods retain their code input in the same
view; no wallet PIN is requested by Lowwin.

A committed result replaces authorization. Confirmed failure provides Try
again and Close. Success provides Close. Retry restores the original editable
draft and requires another explicit Pay. Embedded top-up Close restores the
bid draft without submitting it. Financial settlement, leases, private
verification, webhook accounting and historical recovery are unchanged.

## Measurements and limits

An approved provider-only 5 ETB Telebirr diagnostic returned HTTP 200 Accepted
in 1,380 ms. The customer confirmed the prompt appeared and was cancelled.
Private verification returned FAILED, 500 cents, ETB and the matching reference.
No Lowwin credit was created. The customer's initial four-second estimate was
explicitly withdrawn as a guess: physical prompt latency is unmeasured.

Current initialization measured against isolated local PostgreSQL with provider
HTTP mocked took 21–32 ms before top-up dispatch and 56–116 ms for bid quote
plus initialization. Warm public production requests took approximately
200–280 ms from the development PC. These figures do not prove production
authenticated payment or carrier latency. No fixed 15-second application delay
was found; production create Server-Timing and a jointly timed phone recording
are required to attribute the remaining gap.

A read-only probe from this PC to the configured remote database measured
1,669 ms for cold connection and 188–406 ms for five SELECT 1 round trips.
These are not hosting-server-to-database measurements. Before the Proxy fix,
handler Server-Timing did not include the duplicate lookup in Proxy.

## Release

Deploy the updated web service from main. This change adds no migration,
provider activation or environment variable. Existing payment recovery workers
must continue running. The customer reports automatic deployment from main;
that deployment and physical-phone acceptance must be verified separately.
