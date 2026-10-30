# Compact bids and payment clarity

The full bid sheet opens synchronously from cards and auction details. Its entry frame reserves the same height while private details load; submission remains disabled until the authenticated server data is ready. The old photo/fee-only Suspense fallback is not used. Live sits beside the sheet heading. The product photo has more height on normal phones and adapts on short screens.

The entry form uses **Your bid amount**, a compact owned wallet balance, remaining submissions, a bold bid count, and a larger **Coupons** control with the exact available count. Unknown configuration remains unavailable rather than becoming zero. Chapa and Wallet are independent selectors; the adjacent 44px plus control opens top-up without selecting Wallet or clearing the bid. Repeated balance/top-up instructions are removed. Normal collapsed entry fits without sheet scrolling at the tested mobile sizes. Expanded product descriptions have their own bounded scroll; keyboard and accessibility recovery retain access to the input and submit action.

Typing and pasting cannot add a third decimal place, signs, exponent notation or letters to the bid amount. Rejected edits preserve the previous amount instead of silently rounding a financial instruction. Empty and partial decimal input remain editable; the existing server validation remains authoritative.

Applying a coupon only requests the existing owned discount quote. A coupon is consumed atomically after an accepted bid, not by Apply, failed payment, a retry or viewing checkout. Counts exclude expired and redeemed coupons and remain valid for previously earned coupons when new referral awards are paused. The current rules already allow 1.01, 1.02 and 1.03, reject 1.04 completing a four-cent run, and allow 1.05 when 1.04 is absent. Both server and database protections remain in force.

Wallet submission shows a spinner beside **Submitting**, disables repeated submission and keeps its original idempotency key. Existing complete wallets avoid two account-initialization upserts; the route's redundant auction read is replaced by the same restriction on the locked auction row. Missing/incomplete wallets retain the initialization fallback. Authorization, auction/wallet/hold locks, frozen fee checks, duplicate checks and balanced ledger commit remain authoritative. The route exposes authentication and checkout durations in `Server-Timing`; no production latency or throughput improvement is claimed from local tests.

## Chapa outcomes

Chapa v2 remains the payment integration. Authenticated webhooks trigger server verification; the exact verified payment, amount, currency, environment and reference must match before credit or bid acceptance. Closing hosted checkout is not proof of failure, and a redirect is not proof of success.

Known reasons returned by the authenticated verification API are converted through an exact bilingual allowlist, including insufficient funds, invalid PIN/OTP, unavailable provider account, cancellation, expiry and blocked/authorization states. Arbitrary bank strings, personal details, HTML and internal errors are not relayed. A reason never replaces the API's payment status: SUCCESS/PENDING ignore failure reasons, and unavailable verification preserves the last established outcome. Lowwin cannot inspect errors displayed only inside Chapa's cross-origin hosted page or infer wallet registration from a phone number.

See [Payment events](https://docs.chapa.global/docs/v2/webhooks/payment), [server verification](https://docs.chapa.global/docs/v2/integrations/verify-payment), and [webhook handling](https://docs.chapa.global/docs/v2/integrations/webhooks).

## Admin operations

Payments opens on **Completed**, requiring a committed credit receipt. Separate Unfinished, Needs review, Failed and All views and a payment-type filter are applied before pagination. Unconfirmed rows say Deposit attempt or Bid payment attempt. Session ended is a presentation of the customer window, not a fabricated provider failure. All records and balances are retained.

Players includes a direct **Referral rewards setup** link to `/admin/users/referrals`. Apply existing pending migrations/grants, align `REFERRAL_REWARDS_SCHEMA_READY=true` across web/bot/payment workers, set the correct `TELEGRAM_BOT_USERNAME`, and deploy matching services. Check **Allow new referral rewards**, enter the percentage, expiry and review reason, then save. New verified referral attribution and the invitee's first accepted bid trigger the existing coupon award. This change does not automatically enable the policy.

Admin sign-in, registration and reset retain the shared Show/Hide password eye control. Browser checks exercise masking, reveal, re-masking, focus/value preservation and 44px targets without authentication writes.

Bot welcome and successful contact-verification messages include the existing Amharic Home artwork as a compact JPEG, with their original text and buttons. Missing artwork or a definitive Telegram photo rejection falls back to text. Permission and transport failures retain the durable update retry behavior.

Broadcasts reuse the largest successful Telegram photo file ID for the same bot and image, avoiding repeated binary uploads while preserving personalized captions and buttons. The cache is bounded and a rejected cached ID is refreshed once; rate limits and existing retry/stop rules are unchanged. History distinguishes prepared recipients from pending fan-out batches and shows safe aggregated delivery reasons. Queued expansion does not masquerade as zero intended recipients. Repeat retains the original button and destination. Deploy the notification worker from the matching commit; no real broadcast was sent during validation.

New winner-photo uploads use a compressed **1840 × 800 PNG** within the existing managed-media contract; images are cropped without stretching. The admin preview mirrors the public text/photo crop before publishing. Existing photos, consent checks, product assets and immutable results are retained. No MIME schema change or migration is needed.

## Release

This update adds no environment variables or migrations. Deploy web and the relevant workers from the same reviewed commit; do not change payment activation flags as part of this UI deployment. Existing result-publication rollout requirements still apply if that earlier migration has not yet been deployed: see [reviewed result publication](../result-publication.md).

Validation uses isolated PostgreSQL databases, synthetic browser accounts and mocked providers. Real merchant payment delivery, hosted bank-specific errors, physical Telegram navigation and production capacity remain separate acceptance checks. Keep monitoring webhook delivery, worker failures, payment review reasons and route timings after deployment.
