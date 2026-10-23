# Lowin mobile redesign review

Working branch: `redesign/lowin-arifpay-mobile`.

Customer UI: warm-white canvas, muted-gold ordinary actions, near-black payment actions, supplied Lowin logo, self-hosted DM Sans and variable Noto Sans Ethiopic. Home uses an original illustrative family photograph, HTML copy, on-demand Learn More, genuine recent-result scrolling, chips, search and a single auction list. Five-item navigation replaces Deposit with centered Auctions. Private receipts, profile editing, filtered notifications and payment history use native bottom sheets. The latest [header, loading and color refinement](polish.md) includes eight fresh mobile captures and the banner-serving correction.

The latest instruction supersedes the initial deposit brief: new manual deposit creation returns 410; direct Telebirr/M-PESA bid-fee checkout is implemented and disabled by default. Historical balances, transfers, bids, terms, settlement and staff operations remain intact. The migration only adds ArifPay checkout records with restrictive foreign keys, immutable intent/evidence and replay constraints.

## References and implemented counterparts

The attached reference set supplies structure, not Onebid identity, copy, claim, rules or photographs. The following covers all 18 ordered reference slots, including repeated crops/states.

| Reference group | Lowin counterpart |
| --- | --- |
| Home overview / first screenshot | Existing logo, original family photo, HTML introduction, chips, compact product cards, real-result section |
| Loading screen | White background, small conventional spinner, concise bilingual text; bounded auth/retry |
| Introduction crop | Original Lowin heading, Learn More action and winner-section scroll |
| Explanation sheet / two detail crops | Three steps, example, frozen-rule distinction; optional real configured video only, click-to-load |
| Auction list / card crops | Actual product image, truthful phase, real submission fee, countdown, one black bid action |
| Bid sheet / expanded terms crops | Product summary, server-quoted fee, private number, existing balance, frozen terms and legal links |
| Past Draws | Genuine finalized settlement results, masked identity; no invented winner portraits |
| Upcoming Draws | Actual closing schedules and disclosed fees; live/upcoming labels |
| My Bids list | Real private status counts and compact entries |
| Bid receipt sheet | Actual accepted time, charged fee, receipt ID, rule version and refund facts |
| Profile overview / basic-info crop | Verified account, existing balance, editable basic fields and essential links |
| Notification sheet | Actual All/Draws/Payments; Promotions appears only when the user has that category |
| Header crop | Existing logo, hammer shortcut, bell, English/Amharic control |

The reference payment-method picker is superseded by the latest direct-payment requirement: Telebirr/M-PESA appear only in the direct checkout step. There is no new deposit journey. V4 numbers are never treated as a monetary charge or reserve, and the existing no-unique fallback is unchanged.

## Evidence and limits

See the before/after screenshot folders, measured JSON files, and `release.md`. Screens show synthetic users and DEMO inventory in disposable local databases, never real customer PII or invented production results. The [retained database review](retained-data-review.md) records a later read-only baseline with zero ledger/payment drift and the remaining configuration and permission findings. Physical Android/iOS Telegram, real merchant USSD, provider p95 latency and a fresh pre-release reconciliation remain release gates. The published Terms/Privacy discrepancy is listed in `release.md`.

The original mobile evidence below was captured at `da9625aa` with Next.js 16.3.8. Framework security revalidation is recorded in `measurements.md`; the current pin is 16.4.2. Impeccable mechanical detector: one warning for the existing active legal-navigation underline; native active navigation remains intentional.

## Final verification

- Full opt-in PostgreSQL safety suite at `cea2aba`: **757 passed, 0 failed, 0 skipped** in 72 files. Later contact changes have the focused validation below.
- Final optimized browser suite: **6 passed, 0 skipped, 0 flaky**, at both requested mobile widths.
- Production build and typecheck passed. The dependency audit was refreshed after the framework security update; see `measurements.md` for version and date.
- Read-only wallet/payment reconciliation on the final disposable database: **zero drift**.
- Captured **30 before / 76 after** PNGs. [Open the visual review](review.html) and [exact measured results](measurements.md).

Home render observations: 1529 → 1141ms at 360px; 1298 → 1074ms at 430px. Simulated slow Home: 5937 → 2911ms and 6084 → 2841ms. Navigation and API measurements are mixed; launch warm-up differs. These are local observations, not production or physical Telegram benchmarks. No real ArifPay verification latency is claimed.

[Hero asset and final generation prompt](../../public/images/SOURCES.md) records the built-in ImageGen workflow. [Font provenance](../../public/fonts/REDESIGN-SOURCES.md) records the self-hosted sources. No production deployment or irreversible data change was performed.

CI now runs the current redesign browser scenarios. The historical customer/deposit visual suites remain in the repository as prior UI references; legacy financial, payment, authentication and staff invariants remain covered by the full opt-in PostgreSQL suite. They were not removed or disabled to manufacture the safety result.

Framework validation at `cea2aba`: Next.js is pinned to **16.4.2**. Prisma generation, typecheck, both optimized builds, all **757 safety tests** and all **six mobile regressions** passed again. The refreshed dependency audit reported **zero vulnerabilities**, and the fresh disposable database had **zero reconciliation drift**. Original screenshots/timings above remain unchanged; patch-validation provenance is in `measurements.md`.

Contact follow-up: **145 auth/contact/recovery tests**, **five native-approval watchdog tests** and **four cleanup-permission tests** passed. The final optimized build and both checkout typechecks passed. A fresh runtime dependency audit reports zero vulnerabilities. **Six additional browser checks** passed at 360px/430px in development fixture mode, including a missing native callback, Retry, cancellation, stale callbacks and continued server contact gating. They are separate from the original optimized design benchmarks; no live sign-in recovery or remote p95 improvement is claimed.

Four additional recovery captures are in `screenshots/contact-recovery/`: [360px timeout](screenshots/contact-recovery/contact-native-timeout-360.png), [430px timeout](screenshots/contact-recovery/contact-native-timeout-430.png), [360px cancelled retry](screenshots/contact-recovery/contact-canceled-retry-360.png), and [430px cancelled retry](screenshots/contact-recovery/contact-canceled-retry-430.png). These use an explicitly mocked Telegram SDK and intercepted API responses, with no real customer or bot calls.

Fresh-database provisioning follow-up: five additional real PostgreSQL tests passed for both runtime-role/migration orders, exact grants/RLS, idempotency, forbidden mutations, unsafe role attributes and atomic rollback on inherited browser cleanup access. `deploy/runtime-role.sql` now covers tables added after its original inventory and restores the intended server-only cleanup permission when the runtime group is created after migrations. Historical migrations remain unchanged. This setup change was not applied to production.

Runtime-login follow-up: ten additional tests passed for actual CLI creation/rotation under a non-superuser connection, unsafe-role rejection and redacted fixed-stage diagnostics. Existing safe logins rotate only their login/inheritance/password settings; initial creation retains all explicit privilege restrictions. [Dedicated staging readiness](staging-readiness.md) records initialization, restricted-role verification, reconciliation and the remaining genuine Telegram/device checks.
