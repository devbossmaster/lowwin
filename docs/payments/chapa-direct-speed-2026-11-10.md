# Chapa direct-payment preparation and timing

This change keeps the existing checkout and financial rules. New external bid payments use one authenticated command to validate server pricing, persist the owned batch and payment intent, acquire its initialization lease, then dispatch Chapa outside the database transaction. A changed authoritative total returns a quote without contacting the provider; another explicit Pay is required. Historical quoted/hosted payments retain their existing recovery paths.

## Measured service path

The same harness ran before and after on 2026-11-10 against loopback PostgreSQL 17, with a real Prisma client and 21 fresh synthetic accounts per run. Chapa was replaced with a network-blocking fixture: a 40 ms capability response and a 60 ms direct response. Each transactional authorization callback performed one real account read. Measurements exclude HTTP/session authentication, app startup, remote database latency, network transport to Chapa and physical USSD delivery.

The first sample had a cold capability cache; the other 20 used the warm bounded cache. These are local comparative samples, not a production SLA. SQL counts are statements reported by Prisma, including transaction commands; they are not packet or physical round-trip counts.

| Metric | Before: quote then direct | After: combined bid/direct |
| --- | ---: | ---: |
| Warm preparation to provider dispatch, p50 / p95 | 59.76 / 72.15 ms | 34.91 / 42.48 ms |
| Warm service completion, p50 / p95 | 139.80 / 149.83 ms | 110.80 / 122.48 ms |
| SQL statements before dispatch | 49 | 26 |
| Transactions before dispatch | 3 | 1 |
| Total SQL statements | 53 | 29 |
| Total transactions | 4 | 2 |
| First cold-capability preparation / total | 181.81 / 262.93 ms | 149.31 / 232.71 ms |
| Capability HTTP requests, cold / all 20 warm | 1 / 0 | 1 / 0 |

The provider response delay was held constant. The reduction is in application/database work. HTTP connection reuse remains Node's existing fetch behavior; this change adds no connection-pool dependency or infrastructure configuration.

## Runtime instrumentation

Inspect `Server-Timing` on the owned payment API response in browser developer tools. It separates `auth`, `lookup`, `capabilities`, `prepare`, `initialize`, `persist`, `validate`, `verify` and `total` when those phases execute. `dispatch` is elapsed request-start time until the provider request is sent; it overlaps preparation phases and must not be added to them. `initialize` measures the provider HTTP/response path, not USSD delivery. Authentication and database preparation are retained before dispatch, and provider HTTP remains outside database locks.

The browser records local Performance measures named `lowwin:payment:tap-to-feedback`, `lowwin:payment:tap-to-request`, `lowwin:payment:tap-to-authorization`, `lowwin:payment:tap-to-confirmed` and `lowwin:payment:code-submit-to-confirmed`. Each name retains at most 40 samples. They contain durations only, with no payment IDs, phone numbers, keys or OTPs. Feedback and authorization measures identify rendered DOM commits; code-submit time is not the physical USSD approval time. No browser timing sends telemetry or proves a payment outcome.

The owned original checkout durably retains sanitized `initializationErrorCode`, `initializationHttpStatus`, `verificationState` and `reason`, correlated by `merchantReference`. The existing `scripts/check-chapa-checkout.ts` diagnostic uses that record-based approach. Runtime diagnostics do not log full provider payloads, raw internal errors, keys, OTPs or payer phone numbers.

## Browser feedback

The browser harness uses installed Chrome at 360 px with synthetic accounts and intercepted application endpoints. Each sample uses a fresh account; warm describes reused browser assets/code, not private payment data shared between accounts. It records the first progress DOM commit and phone-authorization DOM commit after Pay, not screen paint or USSD receipt. The baseline simulated an 80 ms quote response followed by a 120 ms direct response; the combined path retains the 120 ms direct response and eliminates the separate quote call. This demonstrates the removed waterfall, not real merchant latency.

| Browser metric | Before | After |
| --- | ---: | ---: |
| First feedback DOM commit | 7.3 ms | 11.1 ms |
| First authorization DOM commit | 230.6 ms | 155.7 ms |
| Warm feedback DOM commit, p50 / p95 | 4.2 / 5.1 ms | 6.3 / 7.5 ms |
| Warm authorization DOM commit, p50 / p95 | 235.1 / 245.1 ms | 150.2 / 154.8 ms |
| Quote / direct HTTP commands per Pay | 1 / 1 | 0 / 1 |

Both 21-sample browser runs passed. Feedback remained immediate in these fixtures; no improvement in feedback latency is claimed. The roughly 85 ms lower warm authorization presentation is consistent with removing the simulated 80 ms quote waterfall. The fixed mocked responses cannot establish real Chapa or wallet delivery speed. Private accounts remained separate between samples.

## Reproduce safely

Run only with a disposable loopback database whose name ends in `_test`. The service harness refuses remote databases, installs its own test-only environment, applies migrations only to that guarded database, blocks unexpected fetches and emits no keys, OTPs or payer details.

```powershell
$env:CHAPA_SPEED_TEST_DATABASE_URL='postgresql://fixture@127.0.0.1:5432/lowwin_speed_test'
node node_modules/tsx/dist/cli.mjs scripts/measure-chapa-speed.ts after .local/chapa-speed-after.json
```

`before` mode retains the original two-service-call comparison for future profiling. It does not claim to restore historical code. The captured historical baseline predates the source changes; rerunning it now also benefits from any shared initializer optimizations.

The browser harness is `playwright.chapa-speed.config.ts`. It inherits the existing isolated HTTPS/TEST fixture protections. Set `CHAPA_SPEED_PHASE=before|after` to label the report and point it at the corresponding built artifact. Neither benchmark makes a real Chapa request or sends a USSD prompt.

## Outstanding external checks

Use merchant TEST configuration and a physical phone in a separate authorized acceptance run. Record Pay time, the response's sanitized Server-Timing phases, actual prompt arrival, approval time and the accepted-bid receipt. Compare cold and warm runs without logging full phone numbers, keys or OTPs. Prompt arrival cannot be inferred from initialization acceptance. Remote app-to-database latency, Chapa processing and the wallet/operator delivery path remain external factors; no production timing improvement or physical delivery guarantee is asserted by these local tests.

No deployment, merge or live payment is part of this validation.

## Official contracts reviewed

- [Initialize Direct Charge](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment)
- [Validate Direct Charge](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment)
- [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment)
- [Webhook authentication and durable delivery](https://docs.chapa.global/docs/v2/integrations/webhooks)
