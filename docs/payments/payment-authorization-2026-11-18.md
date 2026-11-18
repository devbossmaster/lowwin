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
The result description includes a verified provider reason when available.
The Transactions page shows its loading skeleton until the interactive view
is ready so that an early Top up tap cannot land on a view about to unmount.

## Measurements and limits

An approved provider-only 5 ETB Telebirr diagnostic returned HTTP 200 Accepted
in 1,380 ms. The customer confirmed the prompt appeared and was cancelled.
Private verification returned FAILED, 500 cents, ETB and the matching reference.
No Lowwin credit was created. The customer's initial four-second estimate was
explicitly withdrawn as a guess: physical prompt latency is unmeasured.

An authenticated 5 ETB Telebirr top-up on the customer's Telegram Mini App
returned HTTP 202 after 7,738 ms. Handler timing showed 5,567 ms before the
provider call, 720 ms for Chapa, and 637 ms to persist the authorization.
The attempt ended in verified failure. The baseline window probe missed the
native prompt, so the recording does not give a Pay-to-USSD duration. See the
[sanitized baseline](../measurements/payment-phone-baseline-2026-11-18.json).

The Direct path now checks bonus schema readiness alongside the owned-key
lookup and keeps successful schema checks warm for five minutes. The bonus
policy still reads fresh. Top-up preparation takes the maintenance barrier
first, then reads fresh maintenance state and locks the wallet in one query.
The two creation limits update atomically in one database statement. With
local PostgreSQL and mocked Chapa, warm pre-dispatch statements fell from
13 to 11 for top-up and from 32 to 31 for bid quote plus creation. The
production timing still needs a repeat on the deployed revision.

A read-only probe from this PC to the configured remote database measured
1,669 ms for cold connection and 188–406 ms for five SELECT 1 round trips.
These are not hosting-server-to-database measurements. Before the Proxy fix,
handler Server-Timing did not include the duplicate lookup in Proxy.

## Release

Deploy the updated web service from main. This change adds no migration,
provider activation or environment variable. Existing payment recovery workers
must continue running. The customer reports automatic deployment from main;
that deployment and physical-phone acceptance must be verified separately.
