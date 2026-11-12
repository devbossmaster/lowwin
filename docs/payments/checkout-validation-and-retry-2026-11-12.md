# Checkout validation, authorization errors and fresh presentation

This scoped update keeps the Chapa v2 Inline and internal-wallet integrations and their existing accounting rules.

## Visible validation

Pay remains clickable for correctable input problems. Tapping it explains missing/invalid provider phone numbers, duplicate/previously accepted bid amounts, bounds/consecutive/submission limits, missing methods, unavailable coupons and insufficient Lowwin Wallet funds through Sonner. Known-invalid input never initializes a provider charge or wallet debit. The normal in-flight lock still blocks duplicate taps.

Native modal dialogs place ordinary page toasts behind their top layer. Lowwin now routes each notice to the current native sheet, with a readable neutral notice below its header. Sheet notices remain dismissible with pointer or keyboard, preserve focus and do not duplicate in the page toaster. Closing a sheet dismisses its own notices. Existing notice callers retain their API.

## Authorization feedback versus payment evidence

The previous USSD reconciliation discarded `/v2/payments/inline/validate` responses and swallowed validation failures before asking private `/verify`. A rejected authorization could therefore continue showing authorization while private payment state remained pending.

The updated adapter retains an allowlisted `authorizationReasonCode` separately from financial evidence. Full validation responses must match the original authorization reference, merchant reference, amount, currency, method, environment when supplied and expected metadata; a supplied payer number must also match. Structured 400/422 errors may contribute only recognized codes/reasons. Free-form messages, network failures and timers do not establish a payment outcome.

Recognized insufficient-funds, account, PIN and cancellation errors stop the authorization spinner and show useful feedback in the existing modal. If private verification remains pending, the actions are Check payment and Close; this feedback does not authorize a new charge. Incorrect provider OTP retains its same-attempt correction form. Private verified success, terminal state and security mismatches take precedence. A valid new waiting response clears obsolete authorization feedback; connection loss preserves the last known feedback.

Payment success still requires private verification and committed bid acceptance or wallet credit. No PIN is collected by Lowwin. The same protocol and handling apply to telebirr, M-PESA and CBE Birr; physical provider behavior has not been tested in this update.

The contract follows the official [v2 Inline](https://docs.chapa.global/docs/v2/integrations/inline-js), [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment) and [v2 error-code](https://docs.chapa.global/docs/v2/error-codes) pages.

## Close and Try again

- Close dismisses the complete owning sheet, including progress from an embedded top-up. Reopening an ordinary bid/top-up sheet starts an editable form instead of restoring an old spinner or silently selecting the old provider.
- Safe, settled original attempts are released only after checking the latest owned snapshot. Unknown attempts retain their original key/reference and remain available through the pending notice and View payment status. Dismissing the UI never cancels a provider payment or makes a fresh charge safe.
- Try again reconciles the previous terminal attempt and returns to checkout. It preserves the relevant draft for correction, clears its old quote and requires another explicit Pay. Neither bid nor top-up retry automatically initializes a payment.
- Lowwin Wallet remains independent from Chapa. Insufficient wallet funds leave bids and the balance unchanged; the notice shows available funds, required funds and the shortfall. This also covers a server rejection after the balance changed since the form loaded.

## Validation

- 276 focused unit/service tests passed across 14 suites, including polling, authorization feedback, safe retry and original-attempt retention.
- 25 Inline database integration cases passed against a disposable local PostgreSQL database. These cover bound authorization errors, late success, duplicate verification and mismatch/credit protection.
- 44 production-mode mobile checks passed across the v2 checkout and reference bid/top-up suites at 320px, 360px and 430px, including English/Amharic cases. The suites skipped 40 duplicate cross-viewport lifecycle cases; no failures or flaky cases occurred.
- Three additional 360px checks passed after the final notice styling change. Visual inspection confirmed 14px notice copy, a 40px dismiss target, neutral borders, native-dialog placement and an unobstructed sheet Close control. Invalid input triggered zero provider initializations or unexpected provider requests.
- The final stale-balance regression also passed: a sufficient displayed balance followed by a server-side insufficient-funds rejection produced the native notice, preserved the bid draft and method, and created no debit, accepted bid, recovery request or Chapa initialization. This makes 45 distinct executed mobile cases, plus the three repeated styling checks.
- Full TypeScript checking (`tsc --noEmit --incremental false`), the final isolated production build and `git diff --check` passed. Webpack emitted nonfatal cache-snapshot warnings; compilation, type validation and build completion succeeded.

Browser responses were intercepted and provider credentials disabled for these checks. They establish local behavior, not physical USSD delivery or live provider latency. Reports are in `.local/checkout-validation-browser-results.json`, `.local/checkout-validation-reference-results.json`, `.local/checkout-toast-final-results.json` and `.local/checkout-wallet-rejection-final-results.json`.

No live payments, deployment, merge, migration or environment changes are part of this update. The shared reconciliation change belongs in both WEB and the Chapa worker when this code is eventually released.
