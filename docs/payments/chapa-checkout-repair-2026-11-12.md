# Checkout configuration and modal repair — 12 November 2026

> Superseded for new payments by [the current-key v2 Inline update](chapa-v2-inline-2026-11-12.md). The v1 setup below applies only to the earlier v1 adapter or its historical recovery. The merchant's current `CHAPA_LIVE_PUB_…` key was accepted by Chapa's read-only v2 service check; it belongs in `CHAPA_PUBLIC_KEY` for the new v2 flow.

## Confirmed production configuration gap

The supplied WEB diagnostic reported `configured: false`, `enabled: false`, `recoveryEnabled: false` and an empty methods list. All four settings below were absent: `CHAPA_V1_SECRET_KEY`, `CHAPA_V1_PUBLIC_KEY`, `CHAPA_V1_WEBHOOK_SECRET` and `CHAPA_V1_METHODS`. Both v1 activation flags were false. The common schema/live/review flags were true.

This explains the missing external payment cards. Applying a migration does not supply merchant credentials or enable methods. The payment worker's deployed revision, configuration and schema were not confirmed by that WEB output.

On WEB and the Chapa payment worker, configure matching v1 secret/public keys and the webhook secret privately, then set:

```dotenv
CHAPA_V1_ENABLED=true
CHAPA_V1_RECOVERY_ENABLED=true
CHAPA_V1_METHODS=telebirr,cbebirr,mpesa
```

The method list is an example: include only methods enabled for the merchant's v1 account. eBirr and CBE Bank remain optional explicit branches. Keep historical v2 settings for unresolved v2 payments. Configure Chapa's v1 webhook URL as `https://lowwin.shop/api/payments/chapa/v1/webhook` using the matching secret.

The existing required migration is `202611110001_chapa_v1_checkout`; this repair adds no migration. On the updated revision, run the read-only diagnostic on each resource:

```sh
npx --no-install tsx scripts/check-chapa-v1.ts --schema
```

It reports missing setting names, gates and migration/constraint metadata without printing keys, customer records or provider payloads. A superseded hosted-only migration is reported as conflicting for inspection. See [the migration guide](chapa-v1-migration-2026-11-11.md) for the complete setup.

## Modal changes

The shared bid/top-up payment form now has one heading, a compact three-column provider grid with real logos, an inset phone/provider panel, and a visibly separate Lowwin Wallet row. Selection keeps the gold outline/checkmark. The gold Pay action uses the existing shadcn Button, with readable disabled styling and 44px Back/Top up targets.

Impeccable and UI/UX Pro Max informed the compact layout and accessibility review. The requested [Taste skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) informed consistent edges, real assets, concise copy and restrained interaction. Its marketing-page kit was not substituted for the existing authenticated checkout.

## Restoration defect

A production-mode browser trace exposed an initial restore GET returning 503 after the sheet reopened. With no loaded order snapshot, the polling effect never started, so subsequent foreground/online events could not recover it automatically.

The existing observer now also accepts a validated retained order ID after an interrupted restore. It uses the original owned status endpoint, preserves the single in-flight request, and stops on authorization/ownership errors. It cannot initialize another payment or replay the SDK. The browser regression deliberately interrupts restoration and checks that the same attempt reaches its authoritative cancellation state.

## Latency observations

A small read-only public sample measured Home response-start times of 291, 283 and 270 ms, with full HTML completion in 1806, 1602 and 907 ms. These observations include client/network/TLS and streamed response time; they do not establish backend p50/p95, physical USSD arrival or authenticated-route latency.

Existing account-scoped deduplication, resume-event coalescing and bounded payment-method caching remain in use. No package dependency was added. Home waits for several catalog/content reads, including recent winners; phase-level server measurements are needed before attributing latency or changing that data path.

## Verification

142 focused unit/contract tests passed across form, phone, wallet cache/draft, readiness, Inline SDK, status client and restore/polling suites. Typecheck and the final optimized production webpack build passed.

The final production-mode browser run passed **36 cases in 3.1 minutes**, with 36 intentional repeated width/lifecycle combinations skipped. It covered 320px, 360px and 430px in English/Amharic, logo loading and horizontal fit, single/multiple bids, provider phone errors, wallet independence/shortfall, duplicate taps, SDK interruptions, same-attempt restoration, cancellation, changed-quote retry, background/resume, hosted guide and committed top-up credit. The restore regression that failed in the initial run passed after the narrow fix. Screenshots of the final bid and top-up forms were inspected; small screens retain body scrolling and a visible footer rather than shrinking controls.

No Taste-kit checker or physical-phone USSD timing was run. Visual verification used the existing production Playwright harness and actual rendered screenshots. Diff checks passed. The owned browser server required explicit cleanup after completed cases on Windows; its teardown did not change test assertions or outcomes.

The new diagnostic also ran against the migrated disposable PostgreSQL database: schema status was `ok`, both constraints and the reconciliation index were present, and creation remained disabled with blank credentials as intended. Its exit code was 1 because the test configuration deliberately kept payment creation paused.

All payment-browser fixtures use an isolated loopback test database and intercepted provider HTTP. Local checks do not prove live merchant activation, real-phone authorization delivery or production deployment. No live payment, broadcast, production migration, merge or deployment was performed for this repair.
