# November 13 checkout and deposit bonus

This update follows the three supplied recordings: violet primary actions, pale lavender surfaces, white sheets, yellow bonus highlights and the existing DM Sans/Noto Sans Ethiopic fonts. It includes shared bid/top-up payment presentation, separate bonus funds, wallet activity details and an original illustrative Home banner. No production migration, deployment, merge or live payment was performed.

## Checkout and payment state

Bid entry prepares the numbers and server-calculated submission-fee quote, then opens the shared payment step. Continue never charges. Wallet is separate from external Telebirr, CBE Birr and M-Pesa; only enabled supported methods appear. Phone normalization and method-specific validation remain. Internal wallet settlement never initializes Chapa or waits for provider authorization.

Top-up starts with amount presets of 10, 50, 100, 200, 500 and 1,000 ETB. An enabled qualifying offer shows the exact bonus preview. Below-minimum deposits explain continuing without the offer inside the same sheet. External selection and the processing/result surface are shared with bid checkout.

Only explicit Pay sends a command. A temporary timeout keeps the original reference/idempotency key. Check payment never creates a charge; the existing narrowly gated original-request replay retains the same immutable operation. Terminal retry reconciles first, then restores amount/numbers, method and phone for another explicit Pay. Closing hides the UI; it does not cancel a provider payment.

Success requires matching private server verification and committed bid acceptance or wallet credit. Specific cancellation, PIN, funds and account explanations appear only with supported provider evidence. Lowwin never collects a wallet PIN. The integration remains Chapa v2 Inline REST, with historical payment recovery preserved. See [the protocol audit](payments/chapa-v2-nov13-audit.md) for official references.

## Administrator bonus controls

Open **Admin → Bonus → Deposit bonus**. Configure 10–100%, minimum qualifying deposit, optional per-deposit cap, validity from credit, optional offer end and an audited reason. Save with Enable deposit bonus checked to activate; uncheck and save to stop new offers. The initial draft is disabled, 10%, minimum 100 ETB, seven-day validity and no cap/end. None of those draft values is a live offer until enabled.

Each new deposit freezes the approved offer before dispatch. A changed displayed policy is rejected before payment creation. Existing attempts keep their original offer. Verified principal and bonus credit atomically, once. Bonus is separate from cash, consumed earliest-expiring first for eligible real v4 submission fees, and expires without changing cash. Coupons reduce fees first. External bid payments, old monetary holds and winner charges cannot spend the bonus. See [deposit-bonus accounting](payments/deposit-bonus.md).

## Rollout instructions

After reviewing/committing the change, apply migrations with the schema-owner deployment connection:

```sh
npm run db:migrate
npx --no-install prisma migrate status
```

The new additive migration is `202611130001_deposit_bonus`; do not generate a new migration or reset/seed production. Apply the normal runtime-role grants from `deploy/runtime-role.sql` with the schema owner if your deployment provisions those grants separately. Build generates Prisma normally via `npm run build`.

Redeploy **WEB and the existing Chapa payment worker** from the same reviewed revision. No extra service or bonus environment flag is required. Existing Chapa keys, method/readiness gates and webhook configuration still apply. Before enabling the bonus, check the deployed migration/readiness and read-only ledger reconciliation:

```sh
npx --no-install tsx scripts/check-chapa-inline.ts --schema
npm run wallet:reconcile
```

Then save the desired policy in Admin → Bonus. Before the migration, offers fail closed and admin displays a migration-required state. Worker expiry has bounded batches and skips busy wallets; balance reads exclude expired lots even while the worker is unavailable.

## Validation and measured changes

- 711 tests across 38 focused payment, bonus, wallet, runtime-role and recovery suites passed, with zero skipped. This includes real isolated PostgreSQL transaction tests and intercepted provider responses.
- Full TypeScript check and the final isolated production webpack build passed. An additional 13 proxy/access cases and six bonus-preview cases passed; the preview cases overlap the focused suite count above.
- Final production browser suites passed 53 cases at 320/360/430px, covering both languages, payment methods, phone validation, multiple/range bids, coupons, wallet independence, double taps, original-attempt recovery, requested OTP, cancellation, terminal retry and verified fulfillment. There were 46 intentional duplicate-width skips: non-layout safety scenarios run once at 360px. No failed cases remained.
- Actual-component isolated checks passed 12 bid/top-up viewport/language combinations and two restored-draft scenarios without charge commands. The independent brand review covered 28 Home/Wallet/Profile/Admin cases plus two 100% bonus stress cases. Its contrast, targets and narrow history-row findings were corrected; final compiled-style checks confirmed 44px targets, white-on-violet Save labels and no history-row overflow in both languages.
- The source design scan covered 58 root-owned UI/style files and the checkout agent's nine files. One flagged match was a pre-existing functional Help navigation underline, not a rounded-card border defect; it was retained. All 54 changed/new CSS files parsed successfully and no malformed token-alpha values remained.
- Server authorization refresh cooldown is five seconds during the first minute, previously fifteen, then returns to the existing fifteen-second cadence. Ownership, leases and rate-limit/error backoff remain. This is a scheduling improvement, not a measured physical-phone delivery guarantee.
- Status/OTP POST budget now accommodates sequential bounded validation and private verification. No payment is failed just to remove a spinner.
- The durable webhook worker now retains a queued success hint when fresh private verification is unavailable, even if an earlier verified terminal state exists. Recovery verifies and fulfills once.
- New Home image: 1840×800 WebP, 33,160 bytes. Direct media and the Next image optimizer both returned HTTP 200 on the final production test servers; the sampled 1080px optimized response was 18,798 bytes. It was generated using the built-in image-generation tool; the exact prompt and origin are in `public/images/lowwin-violet-hero-20261113.provenance.json`. Local media conversion retained the composition. No uploaded reference phone/PIN imagery is shipped.
- `npm run dev` now explicitly selects webpack. An isolated start was ready in approximately two seconds and `/api/health/live` returned 204; production latency and actual USSD delivery were not measured.

Physical Telegram, actual merchant-enabled methods, wrong-PIN/provider behavior and end-to-end phone prompt timing require a controlled device/provider check after deployment. Local fixtures cannot prove those outcomes or a five-second payment SLA.

Local evidence: `.local/nov13-focused-unit-summary.json`, `.local/nov13-inline-browser-results.json`, `.local/nov13-reference-browser-results.json`, `.local/nov13-brand-review/`, `.local/nov13-final-style-results.json`, `.local/nov13-hero-live-check.json` and `.local/nov13-static-results.json`. These contain isolated test evidence and are intentionally ignored by Git; reference-video raw frames remain private and are not product assets.
