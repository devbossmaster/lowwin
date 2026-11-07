# Lowwin public entry, bid orders and direct checkout

New bid payments and standalone top-ups use Lowwin's own checkout: payment phone and eligible provider, followed by the authorization method returned by Chapa and server-confirmed fulfillment. OTP is shown only for `auth_type: OTP`; USSD methods use the provider's phone prompt. Historical hosted orders retain their original verification and return paths.

The checkout uses one phone-and-provider panel with a fixed `+251` prefix, visible provider logos and an amount-specific Pay button. A USSD response replaces that panel with a spinner and phone-approval instructions in the same sheet; there is no code/PIN input or hosted navigation on that path. The native provider/SIM prompt is controlled by the wallet and device, not imitated by Lowwin. Completion is still based on server verification.

The bid sheet keeps one dialog through entry, review, payment and receipt. Selected numbers are normalized with exact decimal helpers; the review includes a valid uncommitted field. Quotes and per-line coupon allocations are immutable server records. A batch uses one external payment and accepts every entry atomically, or preserves the entire verified principal in the wallet when acceptance is impossible. Financial responses arriving out of order cannot replace a confirmed state with an older pending/OTP state.

Public catalog/results/rules/tutorial content renders independently of Telegram account bootstrap. Registration is dismissible and explicitly requests native contact consent; only committed bot own-contact evidence registers an account. Public query snapshots survive login while private reads and financial drafts clear on logout/account changes. Home keeps its wallet/help toolbar; Profile contains Notifications. Intro video code/media loads on demand. Recorded views and isolated split-flap timers reuse the existing activity and server-clock rules.

## Setup after review

1. Apply the additive `202611070001_direct_charge_batches` migration with the migration-owner connection: `npm run db:migrate`. Existing payment/ledger rows are retained. The normal `npm run build` generates the updated Prisma client.
2. Verify the existing protected Chapa TEST configuration on WEB and the Chapa worker. The merchant methods response must explicitly support direct charges for the intended ETB/Ethiopia rails. No browser key or payment widget is introduced. The only optional new deployment variable is `CHAPA_DIRECT_EBIRR_ENABLED=false`; leave it disabled unless merchant support is confirmed.
3. Redeploy the same reviewed source to WEB, the bot command worker (`npm run worker`), notification worker (`npm run worker:notifications`) and payment worker (`npm run worker:chapa`). Keep new/live payments disabled until merchant TEST acceptance is complete. Native contact confirmations use the existing durable notification outbox.
4. Run merchant TEST acceptance for actual USSD/OTP where supported, signed webhook delivery and duplicate/out-of-order events, app closure/restart, original-payment recovery and account isolation. Confirm one credit and the correct complete bid batch. Automated tests in this change do not initiate live charges or change production balances.

See [direct-charge setup and safeguards](payments/chapa-v2/direct-charge-batches.md), [public registration](public-entry-registration.md) and [measured UI results](nov7-public-ui-validation.md).

## Validation scope

The complete foundation invocation initially executed 2,005 cases: 1,993 passed, five old assertions failed and seven contact-limiter cases could not start because their old fixture rejected a developer `.env`. The public-reader mocks/authorization assertions and unified-workspace expectation were updated. The limiter now migrates an owned env-free temporary schema copy while retaining explicit loopback/database guards. The affected five-file rerun passed all 60 cases, including every previously failed/skipped case and the new response-order regressions.

The latest isolated direct/batch suite passed 24 cases, including 100 entries, coupon/referral concurrency, late payments, account/method/phone/reference matching, OTP and unknown outcomes. The historical hosted suite passed 68 cases. Focused API/provider/admin/receipt checks, TypeScript and production builds passed. Optimized mobile suites cover direct checkout, interrupted initialization, public browsing/contact consent, historical returns, English/Amharic, keyboard/Back, countdown resume, lazy media and cache/account isolation. Generated evidence remains under ignored `test-results/`.

The final phone-approval checkout run passed all eight Chrome cases at 360/430 px, including visible provider assets, one dialog with no OTP/PIN field for USSD, automatic confirmation, duplicate-click protection, original-intent retry and stale-response rejection. Both language layouts were visually inspected. A separate six-case browser rerun and seven QueryObserver unit checks confirm that the quick-auction browser no longer enters a render feedback loop that prevents navigation from committing.

The initial 100-entry batch implementation used 3,022 Prisma queries and a 1.70 MB public response; the bulk implementation used 60 queries and 34.8 KB. Local timing samples improved from 5.77 s to 2.18 s under differing machine load, so the query/byte comparison is stronger evidence than a production latency claim. Normal cached sheets appeared in 49–59 ms; warm routes remained around 330 ms, and the throttled first sheet remained over 400 ms. Cold bytes increased with added functionality. Actual provider/Telegram device latency and all broader speed targets remain unverified or unmet as detailed in the measurement report.

The `nov7` isolated release-harness mode adds these optimized browser checks to CI. No production deployment, production migration, hosted CI run or live payment was performed during local implementation.
