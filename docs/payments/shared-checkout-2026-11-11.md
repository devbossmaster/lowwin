# Shared bid and deposit checkout — 11 November 2026

> Archived revision evidence. Current checkout uses [native Chapa v2 Inline](chapa-v2-inline-2026-11-12.md); active v1 routes, SDK, worker handling and settings are removed. Do not use this note for current activation or migration instructions.

The latest shared-flow specification replaces the earlier conflicting checkout presentations. Bids and wallet top-ups now use the same controlled payment form and payment-status surface, inside one existing dialog. No payment accounting or provider endpoint was changed in this update.

## Interaction

- Bid entry keeps the product, expandable description, auction count/countdown, two-decimal input, Add, editable/removable numbers, Clear all, coupons and fee-based total. Continue includes a valid unadded number and only prepares the draft/quote.
- Top-up entry contains the amount and supported suggestions. Continue does not initialize a payment.
- The shared payment form offers enabled telebirr, CBE Birr and M-Pesa methods; Wallet is available only for bidding. Registered contact prefills the editable payer phone. Wallet disables that phone field. Format validation never claims provider verification.
- Only final Pay debits/initializes. The existing financial guards and submission locks remain in place. Fully discounted bids retain the existing free-submission path without a provider minimum blocking them or starting an external charge.
- Provider authorization, OTP when requested, confirming, committed success and confirmed errors update one shared status surface. The summary says Total payable until committed fulfillment.
- Confirmed-error Try again reconciles the previous attempt and returns to bid/amount entry with the draft, method and phone preserved. A fresh key is created only by the next Pay. Uncertain initialization retains the original intent/key.
- Native/Telegram Back edits the draft within checkout. X, Escape and Close dismiss; they do not cancel payment. Reopening restores the original attempt. Historical direct payments reuse the status component, without the former duplicate initialization form.

## Cause of premature status changes

The UI previously combined transport health, a 90-second display threshold, and a five-minute foreground checking window with payment presentation. Those clocks do not establish a provider outcome. An outstanding direct authorization now retains its authorization state through temporary errors and app backgrounding; transport delays are secondary copy.

For direct payments, the observer uses the returned `expiresAt`, checks the owned attempt at expiry, and continues slower checks if the backend still reports an unresolved state. After expiry the interval is at least 30 seconds; server `pollAfterMs`, error backoff and the existing verification lease continue to limit provider traffic. Hidden pages stop scheduling checks and foreground/online events resume the same attempt. Confirmed fulfillment, nonrecoverable states and authorization/access failures stop the observer. Hosted-payment recovery keeps its existing behavior.

Manual status recovery and automatic observation now share one in-flight status request. Account changes invalidate that request lifetime. A local clock, missed webhook or interrupted response cannot authorize another charge. Server reconciliation continues independently of an open sheet.

Recovered initialization already clears obsolete transport markers without overwriting authoritative evidence; the database regression suite verifies that behavior. Success still requires server-side payment evidence plus committed bid acceptance or wallet credit. Duplicate/out-of-order protection, webhook signing profiles and amount/reference/environment checks are unchanged.

## Validation

- TypeScript typecheck: passed.
- Production webpack build: passed with isolated loopback fixture configuration and live payments disabled.
- 276 unit/contract tests across 20 suites passed. This includes phone/provider rules, free coupon submissions, progress classification, stale-response protection, original-attempt retention, polling backoff/expiry, provider contracts and webhook event handling.
- 60 PostgreSQL tests across two isolated suites passed: transactional bid batches, same-key initialization recovery, verified cancellation, late success, concurrent/duplicate fulfillment, duplicate deposit webhook jobs, ownership isolation and security mismatches.
- The six directly affected UI/state suites were rerun after final presentation edits: 59 tests passed.
- 24 distinct production-mode mobile browser cases passed across 320px, 360px and 430px, covering English and Amharic. The full run passed 22 cases and had two local runtime timeouts; both timed-out cases passed on targeted rerun. Twelve redundant width combinations are intentionally skipped. This was not an uninterrupted all-green run.

The browser cases cover single/multiple bids, changed quotes, insufficient wallet balance, provider/phone validation, duplicate Pay clicks, terminal retry with preserved details, OTP handling, late wallet credit, background/resume, close/reopen and native Back. A final 320px bid-flow check confirms the restored description and auction statistics/countdown layout.

The initial browser run exposed a test synchronization race: a status request dispatched before backgrounding arrived after the test sampled zero requests. The test now waits for the first actual status check before simulating six minutes hidden; it still requires no further hidden requests. The production observer was not changed to conceal that assertion.

Browser checks assert zero initialization calls before Pay, one initialization after duplicate Pay clicks, no additional checkout-data GETs on Back/Continue, at most one simultaneous status verification, and original-reference recovery. These are local fixture measurements, not live Chapa latency measurements. Physical USSD arrival, live provider responses and production infrastructure latency remain unmeasured; no live payments or broadcasts were sent.

## Chapa contract

The existing service uses the official v2 [direct initialization](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment), [authorization](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment), [verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), and [webhook](https://docs.chapa.global/docs/v2/integrations/webhooks) contracts. Native wallet PIN entry remains entirely outside Lowwin. Provider-requested OTP stays in the existing transient authorization flow.

No schema or environment change is required for this update. Nothing was merged, deployed or committed by this task.
