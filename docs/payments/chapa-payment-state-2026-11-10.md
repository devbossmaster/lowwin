# Payment state and shared deposit progress

## Precise cause

The progress classifier previously evaluated verification errors, `UNAVAILABLE`, paused polling and the 90-second display deadline before recognizing an accepted USSD authorization. That allowed connection health to replace an outstanding authorization with an uncertain-payment screen. The native phone PIN entry itself is not visible to Lowwin.

There were two related persistence problems. A successful replay of the original initialization could save `AUTH_NEEDED` and an authorization reference while leaving its earlier `UNAVAILABLE` marker and transport reason. A failed verification HTTP request could also overwrite verified evidence or a mismatch that arrived concurrently.

## Changes

- Accepted USSD authorization keeps “Waiting for authorization…” and “Approve the payment request on your phone.” Temporary checking trouble appears as secondary connection text. Verified fulfillment, terminal provider outcomes and security mismatches retain priority.
- The existing 90-second display hint and five-minute foreground polling budget remain bounded health controls. Neither declares failure or changes provider validity. Foreground/online recovery and Check payment query the same owned attempt. No additional polling loop was introduced.
- Valid recovered initialization clears transport-only markers through the existing narrow predicate: uncredited, no authorization reference, no provider outcome, pending initialization, and unverified/unavailable evidence. It cannot reset verified evidence or a mismatch. Verification HTTP failures preserve concurrent authoritative evidence and report temporary checking health separately.
- Bids and wallet deposits render one shared compact payment surface. Deposits have no old Connect/Approve/Confirm rail. Only a committed accepted bid or wallet credit shows success; provider `SUCCESS` awaiting fulfillment stays confirming. OTP input appears only when requested by the provider; Lowwin never requests a wallet PIN.
- Close hides the sheet and retains the original unresolved or failed attempt. A terminal Try again checks that original attempt before returning to an editable draft. It preserves amount/bids, provider and available payer-phone draft; a fresh key is created only by the next explicit Pay. If reconciliation discovers late credit instead, the success remains visible and no new form or charge is started.
- Deposits continue to offer only enabled telebirr, M-Pesa and CBE Birr methods, with the existing phone and amount validation. Wallet credit invalidates the existing account-scoped balance and transaction queries.
- Historical hosted checkout recovery, ownership, stale-response guards, signed webhooks, exact financial verification and ledger idempotency remain in place.

## Amount discrepancy

The user confirmed the extra 2.5% is Chapa's charge. Lowwin continues to send 3500 cents for a 35.00 ETB principal and verifies that exact principal. The separately reported service fee never becomes additional wallet credit. See [fee evidence and isolated regressions](chapa-fee-evidence-2026-11-10.md). No production fee setting or real charge was queried to reproduce the screenshot.

## Validation

- 79 focused unit/render/polling/original-attempt tests passed across eight test files.
- 67 direct-payment, recovery and speed tests passed against a fresh isolated PostgreSQL database with mocked providers. These include recovered initialization, transient verification after authorization, concurrent terminal/mismatch/success evidence, late bid handling and repeated webhook processing with one credit.
- Four fee regressions passed against a separate isolated PostgreSQL database: exact principal on the wire, separate fee reporting, one principal credit and rejection of a mismatched principal.
- Full TypeScript checking and the optimized production build passed.
- Production-mode browser checks: nine bid-checkout cases passed at 320/360/430px in English/Amharic. Six redundant width-only lifecycle repetitions were deliberately skipped. A Transactions-to-top-up preserved-draft retry case also passed.

- Eight production-mode deposit browser cases passed at 360/430px in English/Amharic. They cover over 90 seconds of background time without hidden checking, foreground recovery after a simulated 503, original-attempt restoration, provider success before credit, confirmed credit/balance refresh, cancellation, preserved retry, fresh-key timing, invalid M-Pesa phone input and provider-requested OTP. A ninth deposit case passed at 360px: credit arriving during Try again reconciliation stays successful and cannot open another deposit form or initialize another charge.

No dependencies, schema migrations or environment variables were added. No production migration, live payment, merge or deployment was performed. Local provider simulations do not prove physical phone-prompt delivery or production webhook configuration.

## Checkout polish and v2 contract review

The bid sheet retains its two short steps, and deposits retain amount, enabled provider and payer phone. Both now use consistent compact typography, neutral borders, gold selection, readable provider logos, clear totals and a charcoal final payment action. The shared status modal has a simpler summary, masked phone and small provider logo; English and Amharic labels wrap at narrow widths. No payment controller or additional polling loop was added.

Active authorization and fulfillment remain automatic. The 90-second presentation hint no longer adds a manual Check payment button while the existing poller is running. Only paused or uncertain outcomes expose original-attempt recovery. Provider-requested OTP input remains available; Lowwin never collects a wallet PIN. Existing background/resume, backoff, server leases and final verification continue to govern checks.

The review confirmed server-side v2 [direct initiation](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment), [direct validation](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment) and [payment verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), with integer cents, owned immutable intents, stable initialization keys and exact financial matching. Provider HTTP remains outside financial database locks. A newly received webhook now schedules reconciliation without overwriting a prior mismatch or verified cancellation reason.

The published [v2 webhook contract](https://docs.chapa.global/docs/v2/integrations/webhooks) signs exact raw body bytes. That remains the default. The merchant's explicitly configured `legacy_secret` compatibility profile remains separate because Chapa support confirmed HMAC(secret, secret) for this merchant's dashboard. It is not a silent fallback and does not change payment APIs to v1. Server-side verification remains mandatory under either profile.

Validation for this follow-up: 146 focused payment-state/provider/polling/render tests and 79 additional webhook API/event tests passed. Production-mode Chrome checks passed in 22 cases at 320, 360 and 430px, covering both languages, multiple bids, provider switching, invalid phone, duplicate taps, cancellation, original-request recovery, late credit and OTP. Eight redundant width-only lifecycle cases are intentionally skipped. Screenshots of both form steps, deposit forms and waiting/success states were inspected. Typecheck and the optimized build passed. The browser fixtures make no real provider requests, so these results do not measure physical USSD arrival or production Chapa latency; the existing speed report retains those distinctions.

After the final automatic-status adjustment, a fresh optimized build and typecheck passed, and all ten 360px lifecycle checks passed again. The browser regression specifically confirms that provider success awaiting wallet credit after 90 seconds has no manual Check payment button while automatic checks are active. Local test servers and PostgreSQL were stopped after verification.
