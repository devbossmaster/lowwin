# Chapa v2 hosted payments

The current customer flow and worker contract are described in
[Checkout and Transactions](chapa-transactions-2026-10-29.md). That update replaces
saved-checkout restoration and periodic verification for new attempts.

Lowwin uses Chapa's v2 hosted checkout: the server creates a payment attempt, the customer pays on Chapa's returned checkout page, and the server verifies that same attempt before recording funds or accepting a bid. Lowwin does not collect card numbers, PINs or OTPs. The existing Lowwin wallet, Telegram/contact gate, frozen auction terms, referral discounts and balanced ledger remain the authority for participation.

Merchant-account verification does not configure or enable this integration. It defaults to disabled until protected credentials and the reviewed environment are ready. Source implementation, local synthetic checks and provider-sandbox acceptance are different milestones: no merchant charge, production migration, funding activation or live transaction is established by this work.

## Payment flows

For a wallet top-up, the authenticated customer chooses an amount between 1.00 and 43,200.00 ETB. The server validates that amount and freezes its integer-cent value and attempt identity. A verified successful payment credits the original customer's AVAILABLE wallet once. Displayed balances update from the committed server result; opening a checkout page, returning to Lowwin or receiving a webhook does not credit a wallet.

For a direct bid-fee payment, the server freezes the supported auction, bid number, applicable submission fee/version and any eligible referral discount. Chapa charges the actual required fee, not the chosen bid number. On verified payment the existing bid command still decides the deadline, eligibility, frozen fee, coupon and acceptance outcome. V4 numbers are neither charged nor reserved, and the winner is not charged their number. Older published terms are not rewritten by this integration.

If money is verified after an auction deadline, maintenance halt or another acceptance race, retain the legitimate payment as AVAILABLE funds once and show the recorded unaccepted/review outcome. Do not force an invalid bid, charge a higher changed fee, redeem a failed coupon or refund/credit the same receipt a second time. A hold release for a historical auction remains a transfer of existing funds, not another deposit.

Wallet-funded bids use the same existing server command and actual required fee. `WALLET_BIDS_ENABLED` controls this path independently from Chapa and does not create funds. The wallet balance shown in the browser is informational; current eligibility and available money are checked inside the financial transaction.

## Configuration

Use the tracked `.env.example` as an inventory only. Put real values in the protected deployment configuration or untracked local `.env`; never send them in chat, commit them, prefix them with `NEXT_PUBLIC_`, put them in callback URLs or return them through status APIs.

| Variable | Default / purpose |
| --- | --- |
| `PAYMENT_GATEWAY` | `CHAPA` selects the new transport; selection alone enables nothing |
| `CHAPA_ENABLED` | `false`; permits new hosted attempts only after all configuration guards pass |
| `CHAPA_SCHEMA_READY` | `false`; set only after the reviewed additive migration and reconciliation |
| `CHAPA_MODE` | `test`; must match the private key and each persisted attempt |
| `CHAPA_PRIVATE_KEY` | Empty; server-only `CHAPA_TEST_…` or `CHAPA_LIVE_…` private key |
| `CHAPA_WEBHOOK_SECRET` | Empty; separate random secret of at least 32 characters matching dashboard Signature authentication |
| `CHAPA_BASE_URL` | `https://api.chapa.global`; other origins are rejected |
| `CHAPA_CURRENCY` | `ETB`; no implicit conversion |
| `CHAPA_TEST_ENVIRONMENT_REVIEWED` | `false`; explicit target review for a remote staging database |
| `CHAPA_LIVE_ENABLED` | `false`; additional live-creation approval |
| `CHAPA_MERCHANT_REVIEWED` | `false`; merchant and live-environment acceptance review |
| `CHAPA_RECOVERY_ENABLED` | `false`; reviewed recovery while new creation is paused |
| `WALLET_BIDS_ENABLED` | `false`; enable the existing wallet submission command separately |
| `WALLET_BIDS_LIVE_ENABLED` | `false`; additional production approval for wallet-funded submissions |
| `CHAPA_TEST_DATABASE_URL` | Empty; integration-runner-only disposable loopback database ending in `_test` |

App/auth origins must be the same HTTPS origin. A local HTTP development page cannot be given real provider callbacks; use a reviewed HTTPS staging/tunnel origin. Test mode is rejected for `APP_ENV=production` and Vercel production. Local/test databases must be loopback; a remote staging target additionally needs `CHAPA_TEST_ENVIRONMENT_REVIEWED=true`. Use separate staging and production databases, bots, contact-encryption configuration and credentials. That flag is not permission to point staging at the live database.

Live mode also requires `APP_ENV=production`, `NODE_ENV=production`, a matching `CHAPA_LIVE_…` key, `CHAPA_LIVE_ENABLED=true`, `CHAPA_MERCHANT_REVIEWED=true` and development/demo features disabled. Do not turn on legacy `PAYMENTS_LIVE_ENABLED`, Verify.et, OCR, manual-transfer funding or ArifPay to activate Chapa. Existing ArifPay code and its recovery records are preserved; they are not silently migrated or replayed through Chapa.

Adding a private key alone does not switch on financial operations. Complete the reviewed schema and test configuration first. Merchant-secret values remain on the server. Credential fingerprints bind existing attempts to their original key and mode; a key rotation cannot silently verify old attempts using a different merchant identity. Plan recovery for unresolved attempts before rotating keys, and never edit their stored binding merely to bypass a mismatch.

## Test-mode setup and non-charging readiness

Follow Chapa's [v2 Quick Start](https://docs.chapa.global/docs/v2/getting-started). Keep the merchant dashboard in **TEST** mode. Under **Settings → API Keys**, obtain the server-only v2 private key beginning `CHAPA_TEST_`; store it as `CHAPA_PRIVATE_KEY` in the protected test environment. Public keys and legacy v1 keys are not interchangeable with this v2 private key. Set `CHAPA_MODE=test`, `PAYMENT_GATEWAY=CHAPA`, `CHAPA_CURRENCY=ETB` and `CHAPA_BASE_URL=https://api.chapa.global`. Keep `CHAPA_LIVE_ENABLED=false`, `CHAPA_MERCHANT_REVIEWED=false` and the wallet-spending flags disabled during this setup.

In the granular key dialog, use the name **Lowwin Test**, a **30-day** expiry, and only **Payments Create**, **Payments Hosted Write**, **Payments Read**, and **Payment Methods Read**. Leave **All**, payouts, refunds and banks permissions off. Copy the generated private key directly into the protected server configuration or untracked local `.env`; do not paste it into chat or documentation. This key permits the hosted initialization, verification and read-only method-discovery calls used here.

Use a separate test database and bot. Set `APP_ENV=local` or `test` only with a loopback database; a remote test deployment uses `APP_ENV=staging` and requires the explicit target review `CHAPA_TEST_ENVIRONMENT_REVIEWED=true`. Set both `MINI_APP_URL` and `BETTER_AUTH_URL` to the same reviewed HTTPS staging/tunnel origin. Keep `CHAPA_ENABLED=false` and `CHAPA_RECOVERY_ENABLED=false` while preparing the database. Review and apply the additive Chapa migration to that test target through the migration role, then assert `CHAPA_SCHEMA_READY=true` after the schema review.

Configure a **Signature** webhook in the merchant's TEST dashboard using `https://<test-origin>/api/payments/chapa/webhook`. Set its separate random secret (32–256 characters) as `CHAPA_WEBHOOK_SECRET` on the server. The signed webhook URL has no checkout query parameter. New hosted requests freeze an HTTPS return URL containing only the opaque checkout ID; historical retries preserve their original minimal wire body. Per-attempt callback URLs remain omitted. Return navigation never establishes payment success. See [Checkout and Transactions](chapa-transactions-2026-10-29.md) for the automatic status and Telegram handoff behavior.

Run the offline diagnostic from the repository root:

```powershell
npx.cmd tsx scripts/check-chapa.ts
```

It uses Next.js `.env*` precedence and prints only configuration booleans, mode and names of missing/invalid prerequisites. It does not connect to a database or Chapa by default. A passing configuration report does not establish merchant acceptance, webhook delivery or checkout/return behavior.

After the test schema and credentials are reviewed, explicitly set `CHAPA_ENABLED=true` in that test environment to permit test checkout and signed-webhook recovery. Then the optional read-only checks are:

```powershell
npx.cmd tsx scripts/check-chapa.ts --schema --methods
```

`--schema` runs the existing receipt reconciliation query and reports only its drift count; it requires configured TEST mode and `CHAPA_SCHEMA_READY=true`. `--methods` makes only `GET /v2/payments/methods` through the bounded server adapter, requires the existing enabled TEST gate, and reports enabled ETB/Ethiopia slugs and integer-cent limits. Neither option overrides flags, accepts LIVE credentials, creates a checkout, verifies a payment, credits funds or starts a worker. A nonzero exit means configuration is incomplete, a requested check is blocked/unavailable, or receipt drift was found. An empty method list is reported as empty; it is not evidence that a payment method is usable.

Complete the actual merchant TEST checkout/webhook/duplicate-delivery and Android/iOS Telegram return tests separately before live review. Start the recovery worker only with the same reviewed test configuration when exercising those test attempts. Do not change live flags merely because the dashboard account has been verified.

## Lowwin API and worker

All customer reads and commands require the original authenticated Telegram/contact-bound account. Mutation endpoints also retain the existing origin, body-size and request-rate protections. Customer responses are private/no-store and expose only the signed-in customer's attempts. References, states or amounts from a different account are not authority to access or verify its payment.

| Lowwin route | Behavior |
| --- | --- |
| `GET /api/payments/chapa` | Private availability/mode/configuration status and the wallet-bid capability; no keys |
| `GET /api/payments/chapa/checkouts` | Recent owned payment attempts |
| `POST /api/payments/chapa/checkouts` | Create or safely resume the original owned attempt |
| `GET /api/payments/chapa/checkouts/:id` | Read one owned attempt and its committed outcome |
| `POST /api/payments/chapa/checkouts/:id` | Request merchant-server verification of that owned attempt |
| `/api/payments/chapa/callback?checkout=:id` | Nonfinancial callback/redirect; query parameters cannot credit funds |
| `POST /api/payments/chapa/webhook` | Signature-authenticated durable notification receipt |

A top-up create request uses the ETB amount as a decimal string:

Each request key stays permanently bound to its original payment and payload. When a new key resumes an already-pending checkout, an immutable account-scoped alias preserves that binding after payment becomes terminal, including recovery from a lost response. It cannot create a replacement charge or accept different input on retry.

```json
{"key":"<new UUID for this operation>","purpose":"TOP_UP","amount":"100.00"}
```

A direct bid create request uses the chosen number in `amount`; the server calculates what Chapa charges:

```json
{"key":"<new UUID for this operation>","purpose":"BID","auctionSlug":"<live auction slug>","amount":"3.60","feeVersion":1}
```

Use the actual current `feeVersion` supplied by the auction service, and include `couponId` only for an owned, eligible unspent reward. Retry the same frozen operation with the same key; generate another key only for an intentionally new operation. Direct checkout and wallet-funded submissions support the existing real v4 submission-fee rules. There is no client-provided cash bid price or unverified fee override. If a discounted submission fee falls below Chapa's 1.00 ETB minimum, use the wallet path; do not round the charge upward or silently alter the auction fee.

The dedicated recovery process is:

```powershell
npm.cmd run worker:chapa
```

It runs `tsx scripts/chapa-worker.ts` with the same reviewed database, mode, credential and schema configuration as the web service. It reconciles bounded batches of due attempts through merchant verification, not a browser callback. Preserve this worker during checkout pauses or UI rollback when unresolved incoming payments exist. Starting it is an operational action to perform only after the matching reviewed migration/configuration; do not start a real merchant recovery process while testing synthetic fixtures.

The additive migration is `prisma/migrations/202610260002_chapa_hosted_checkout/migration.sql`. It has been prepared for isolated local validation, not applied to production by this integration task. Review its dependencies and restricted runtime grants against the actual target database before applying it. Schema readiness is an explicit operator assertion, not an automatic migration triggered by web startup.

## Provider contract

### Simple hosted flow — 28 October 2026

The wallet sheet starts at 100 ETB, offers four amount presets, shows Chapa selected and keeps one visible Pay action in the sheet footer. Pay initializes checkout and opens the exact returned URL automatically. Telegram opens it externally while keeping the Mini App alive; a normal browser reserves a tab during the click to avoid asynchronous popup blocking. Returning to the app triggers verification and refreshes the wallet after confirmed credit. Pending payment details are collapsed; reopening a saved attempt does not create or reopen checkout automatically.

The hosted body contains only `amount` (integer cents), `currency` and the immutable `merchant_reference`, with the stable `Idempotency-Key` header. Customer data, preferred methods, customization and optional per-request callback/return URLs are omitted. Payers enter their own details on Chapa. The dashboard PAYMENT webhook, recovery worker and foreground verification confirm the result. Close Chapa or return to Telegram after payment; automatic merchant-page redirection is not required for crediting.

The TEST URL route `/test/payment/hosted/TEST…` ends in a checkout session token. It is retained in the URL, while the final payment reference comes from merchant verification. Empty optional TEST processor references are accepted; a successful payment still requires a nonempty final reference and exact merchant, amount, currency and configuration matching. A pending response without a final reference stays pending and never creates credit.

Migration `202610280004_chapa_test_session_reference` supports historical TEST rows which stored that session token in the payment-reference field. It permits a one-time correction only while attaching the matching receipt journal in the same transaction. It does not permit replacement of live references, credited outcomes, amounts, identities or checkout URLs.

The only API origin is `https://api.chapa.global`. The server uses these v2 paths:

| Operation | Endpoint | Authentication |
| --- | --- | --- |
| Initialize hosted checkout | `POST /v2/payments/hosted` | Private Bearer key and stable `Idempotency-Key` |
| Verify one attempt | `GET /v2/payments/{paymentReference}/verify` | Private Bearer key |
| Discover enabled methods | `GET /v2/payments/methods` | Private Bearer key |

Amounts are integer cents: 100.00 ETB is sent as `10000`, not `100` or a floating-point decimal. Payment creation requires at least 100 cents. The server supplies a unique merchant reference of at most 20 characters and reuses the same provider idempotency key and frozen request when retrying an ambiguous initialization. A timeout must not create a replacement reference that could charge twice.

Chapa's top-level verification `status: "success"` means the API operation succeeded. Financial fulfillment requires `data.status === "SUCCESS"` plus exact stored merchant reference, Chapa reference, amount, currency, environment and credential identity. Missing or contradictory evidence stays pending/review. Processing fees, when supplied, are distinct provider costs; do not reduce the customer's recorded paid amount or present wallet deposits as profit.

Use the exact returned checkout URL. The adapter accepts only the documented HTTPS `checkout.chapa.global` host and rejects credentials, nonstandard ports and ambiguous references. The final path segment is retained as the checkout reference; recognized TEST hosted-session tokens are not treated as final payment references. Merchant verification supplies the final payment reference for those sessions. The adapter never constructs a checkout URL from a guessed host/reference. Initialization timestamps are optional metadata: validate them when supplied, but do not discard a valid URL-only response or invent a provider expiry.

The optional TEST readiness diagnostic discovers enabled ETB methods with enabled Ethiopia support and applicable cent limits from the merchant API. The customer UI offers Chapa as a provider; it does not fetch or hardcode individual merchant methods. Chapa's hosted checkout presents the final available choices and collects payment credentials, including the payer's phone number when required. Do not assume that M-Pesa, Telebirr, CBE or a specific bank is enabled for the merchant merely because a reference screenshot shows it. Lowwin does not automatically prefill its verified Telegram contact into the optional Chapa customer object. The verified contact remains required for Lowwin access, and the signed-in user and immutable checkout determine wallet ownership; entering a phone on Chapa never changes that identity. A business requiring phone data at initialization needs a supported merchant configuration before activation.

HTTP calls use bounded timeouts, response-size limits, `no-store`, no automatic redirects and sanitized failures. They do not log private keys, full contact details, raw provider bodies or OTPs. Provider HTTP stays outside long-running wallet/auction transactions. Signed webhook hints schedule verification without overwriting a status established by merchant verification; queued terminal attempts remain eligible for a bounded recovery check.

## Signed webhooks and the separate callback

Configure the merchant dashboard's **Signature-authenticated webhook** at:

`https://<lowwin-origin>/api/payments/chapa/webhook`

Its `x-chapa-signature` is the hexadecimal HMAC-SHA256 of the exact raw HTTP body, keyed by `CHAPA_WEBHOOK_SECRET`. Verify the raw bytes with a constant-time comparison before parsing or using event fields. Do not substitute a legacy header, hash the private API key, reserialize parsed JSON or treat an IP allowlist as authentication.

Authenticate, match the environment and references, durably record the delivery, then acknowledge it. An identical authenticated delivery is deduplicated using its raw-body hash scoped to configuration/environment, and an already-recorded delivery receives `200`. This is separate from unique business-level payment/credit idempotency. Out-of-order notifications cannot reverse a committed credit or accepted bid. A payment webhook is a recovery signal; the merchant-authenticated verification API remains the authority for funds. Refund/payout notifications do not create another deposit or automatically erase financial history.

Hosted `callback_url` is a separate optional HTTPS callback. The public v2 docs do not promise its HTTP method or the same signature header. Lowwin's nonfinancial callback URL uses `/api/payments/chapa/callback?checkout=<attempt-id>` and can return the customer to their existing owned recovery flow. It is not the signed webhook endpoint, does not mark payment success and does not itself create funds. Unknown callback parameters and browser success claims are not evidence.

If checkout opens outside Telegram and the returning browser lacks Telegram/session proof, reopen Lowwin from its Telegram bot. Recovery must retain the existing Telegram/contact gate and recover the original owned attempt; it must not introduce a website-authentication bypass or manufacture a replacement checkout.

## Recovery and release

Keep new creation disabled until test keys are available. With the same reviewed mode/key configuration, `CHAPA_RECOVERY_ENABLED=true` allows unresolved existing attempts to be reconciled while `CHAPA_ENABLED=false` pauses new ones. Live creation can remain off during recovery. A provider outage or missing evidence is not a failed payment that may safely be recreated: retain its ID, lease/backoff state and eventual reconciliation path.

The staff transaction drawer reads `GET /api/admin/chapa/<attempt-id>` using the existing staff password/MFA session. Owner, Payments Operator, Auditor and Support can review the strict detail projection; Support receives no merchant/provider references. No staff role receives checkout URLs, encrypted contact, keys, fingerprints, or raw provider evidence. Owner and Payments Operator can submit `POST /api/admin/chapa` with `{action:"check",input:{id,key,reason}}`, where both IDs are UUIDs and the reason is 12–300 characters. The reason and result are audited; an identical retry returns its recorded receipt, while a deliberate later check uses a fresh key. Provider verification reauthorizes the original staff identity/session after HTTP. There is no manual paid, credit, amount override, or fresh-MFA prompt on this check.

The staff transaction list includes Chapa only after discovering its table, retaining compatibility with production before migration. Test receipts are labeled and show their actual purpose. Financial-report wallet deposits add only committed live `TOP_UP` receipts linked to matching `CHAPA_RECEIPT` journal/operation evidence. Test receipts and direct `BID` payments do not inflate that deposit subtotal; accepted fee revenue and wallet liabilities remain separate.

Before live activation, verify the merchant's v2 access, accepted key format, enabled methods and limits, authenticated webhook delivery, duplicate/out-of-order events, missing/ambiguous initialization, ownership rejection, exact amounts/currency/references, deadline/coupon/maintenance races and late incoming funds in isolated staging. Test physical Android/iOS Telegram checkout/return behavior and retry/resume after closing the WebView. Provider-sandbox, merchant receiver/settlement behavior and live-device delivery remain unverified until credentials and actual merchant tests exist.

Apply only the reviewed additive migration through the privileged migration job; the web/worker keep the restricted runtime role. Do not run a blanket schema reset, delete old wallets/users/receipts or activate disabled legacy flags. The previous private auction reset packet is bound to its audited schema/migrations, users and balances. **After applying new Chapa DDL, re-audit and regenerate that packet before any Owner-reviewed SQL execution.** Its existing stale-snapshot checks must stay intact; do not edit hashes or bypass them to use the older packet.

During a rollback, pause new Chapa creation first. Preserve the Chapa tables, verification/recovery path, original mode/key binding, existing financial journals and maintenance-aware workers until pending incoming funds are reconciled. Do not roll back by dropping the new tables, replaying receipts, deleting credits or changing a settled auction's terms. Payment-provider selection and production activation remain separately reviewable actions.

## Reproduce the isolated browser checks

Use a local PostgreSQL 17 role that can create disposable databases. The URL must use loopback and name a database ending in `_test`. These are synthetic local fixture credentials, not deployment credentials:

```powershell
$env:TEST_DATABASE_URL='postgresql://lowin_test:fixture_only@127.0.0.1:5432/lowin_test'
npm.cmd ci
npm.cmd run db:generate
npx.cmd playwright install chromium
node.exe scripts/run-db-tests.mjs chapa
```

The harness creates a fresh uniquely named database, runs `prisma migrate deploy`, and starts `playwright.chapa.config.ts`. It does not reset or drop another database and does not seed the catalog: the spec creates its own contact-bound user/product/auction fixtures. Merchant keys and all real provider creation/recovery switches are cleared or disabled for this mode. The browser spec mocks same-origin checkout/wallet mutation responses; it never sends payment or bot messages to a real provider. The separate `unit` harness still allocates `CHAPA_TEST_DATABASE_URL` along with its other isolated suite databases and rejects any pending/todo tests.

The pinned-actions `browser-chapa` CI job runs the same command on a fresh PostgreSQL service and uploads `test-results/chapa-ui/` as `chapa-checkout-ui`. It requires no deployment, Telegram, Chapa or other merchant secrets. CI execution is a separate result from the existing local recording.

Recorded local Chromium evidence on 2026-10-26: **2 viewport cases passed, 0 skipped, 0 unexpected failures, 0 flaky cases, 116.9 seconds**. Each case covers English and Amharic at 360×800 and 430×932. The evidence asserts disabled controls, no optimistic credit, pending-sheet reopen without a replacement creation, same-frame double-click deduplication, confirmed balance refresh, zero public-return private reads and zero ledger drift. It records 4 mocked hosted commands and 2 mocked wallet commands per viewport, with **no real accepted bids or provider requests**. These are UI/fixture checks; merchant settlement, live activation and physical Telegram return behavior remain release gates.

Only these six selected screenshots and the two sanitized evidence files are committed; the full Playwright result metadata and fixture configuration are not copied into documentation:

| State | Language / width | Screenshot |
| --- | --- | --- |
| Bid controls disabled | English / 360px | [Bid disabled](chapa-v2/screenshots/bid-disabled-en-360.png) |
| Top-up disabled | Amharic / 430px | [Top-up disabled](chapa-v2/screenshots/topup-disabled-am-430.png) |
| Bid payment pending | Amharic / 360px | [Bid pending](chapa-v2/screenshots/bid-pending-am-360.png) |
| Top-up pending | English / 430px | [Top-up pending](chapa-v2/screenshots/topup-pending-en-430.png) |
| Confirmed bid receipt | English / 360px | [Bid receipt](chapa-v2/screenshots/chapa-bid-receipt-en-360.png) |
| Confirmed top-up | Amharic / 430px | [Top-up credited](chapa-v2/screenshots/topup-credited-am-430.png) |

Machine-readable fixture assertions: [360px evidence](chapa-v2/screenshots/evidence-360.json), [430px evidence](chapa-v2/screenshots/evidence-430.json). No full telephone numbers, real customer identity, keys, tokens, database URLs or fixture credentials are included in these published evidence files.

## Telegram payment confirmations

The hosted return page attempts to open the configured Telegram bot automatically when reached outside the Mini App. It carries only the validated opaque checkout ID. The explicit **Open Lowwin in Telegram** link remains available when a browser requires a user gesture or Telegram asks the user to open/start the bot. Inside the authenticated Mini App, the owned checkout restores the original top-up or auction payment modal and starts automatic server verification. Navigation and return parameters never establish payment success. Existing initialization snapshots and their provider return URLs remain immutable.

A newly verified receipt queues one `CHAPA_PAYMENT_CONFIRMED` outbox job under `chapa:<checkout-id>:telegram-confirmed` in the same database transaction as its balanced credit and final checkout update. Duplicate verification or webhook processing cannot enqueue another job. Returning to a historical paid checkout does not backfill or send a new notification.

Run the existing `npm run worker:notifications` service to deliver the short bilingual amount confirmation and **Open Lowwin** Mini App button. Deploy that worker with the matching web release, bot token, `CHAPA_MODE`, and `MINI_APP_URL`. Delivery rechecks the committed receipt, checkout owner, verified Telegram contact, payment bot binding, and mode. TEST receipts are explicitly marked. If verified bid money is retained in the wallet because the bid could not be accepted, the message says so. This is a plain Telegram receipt without a promotional image or community footer, and it adds no second Mini App inbox item. No schema migration or new environment variable is required.

The existing dispatcher sends only after the payment transaction commits and uses durable retry/blocked-chat handling. Its unique outbox key prevents duplicate enqueue, but Telegram delivery remains at least once: a crash or ambiguous network failure after Telegram accepted a message but before the delivery transaction commits can repeat that message. Such a retry cannot repeat a financial credit or bid.

## Official references

- [Quick Start](https://docs.chapa.global/docs/v2/getting-started)
- [Hosted Checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment)
- [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment)
- [Payment Methods](https://docs.chapa.global/docs/v2/integrations/payment-methods)
- [Webhook authentication and delivery handling](https://docs.chapa.global/docs/v2/integrations/webhooks)
- [Payment event payloads](https://docs.chapa.global/docs/v2/webhooks/payment)
- [Test and live keys](https://docs.chapa.global/docs/v2/integrations/test-live-mode)
- [Security Guide](https://docs.chapa.global/docs/v2/security/security-guide)
