# Chapa V1 hosted checkout

New Lowwin payments use Chapa V1 hosted checkout. The Mini App collects a top-up amount or bid selection and its submission fee, then opens the server-returned Chapa URL. Payment method, phone entry and payment authorization belong to Chapa. Wallet-funded bidding remains available through its existing independent gate.

All creation and live flags default to disabled. This release does not activate a merchant account or establish merchant TEST acceptance. The older V2 runbooks describe historical payments and are not instructions for new checkout creation.

## Migration and release order

1. Pause new creation (`CHAPA_V1_ENABLED=false`, `CHAPA_ENABLED=false`) and keep live activation off. Keep reviewed recovery for existing payments available using its original version's credentials. Back up the target and record the release/schema versions.
2. Review and apply additive migration `202611110001_chapa_v1_hosted` using the separate migration connection, **before deploying a web/worker binary with the new generated Prisma client**. Use `npm run db:migrate`; never replace these migrations with `db push`. Migration access does not belong in normal web or worker resources.
3. Existing checkout and webhook rows acquire `apiVersion=2`. Their mode, keys, references, wallet journals, bids, receipts and ledger history are retained. New rows explicitly use `apiVersion=1`; triggers prevent changing a row's API version and require version-matched credit proof.
4. Build the new release (`npm ci`, `npm run build`) and deploy web and Chapa worker against the migrated schema. Set `CHAPA_V1_SCHEMA_READY=true` only after the target/schema review. Leave new creation/live flags off while checking deployment.
5. Configure the separate merchant TEST environment below, exercise its actual hosted checkout/webhook/return flow, and review the results before any live activation decision. The normal worker command remains `npm run worker:chapa`.

Do not delete payment/ledger rows, relabel old attempts as V1, or replay old V2 references through V1. A migration rollback must not remove financial history. To pause or roll back the UI, disable new creation and retain the schema plus reviewed recovery for payments already in flight.

## Configuration

Use `.env.example` as the name inventory. Put actual values in protected server configuration. No secret is `NEXT_PUBLIC_*`, sent to the browser, included in callback URLs or committed to git.

| Variable | Default and purpose |
| --- | --- |
| `PAYMENT_GATEWAY` | `CHAPA`; selects the provider without enabling creation |
| `CHAPA_V1_ENABLED` | `false`; new V1 hosted creation gate |
| `CHAPA_V1_RECOVERY_ENABLED` | `false`; verify existing V1 attempts and process V1 webhooks while creation is paused |
| `CHAPA_V1_SCHEMA_READY` | `false`; only after the migration above is applied and reviewed |
| `CHAPA_V1_MODE` | `test`; must match the secret key and saved payment |
| `CHAPA_V1_SECRET_KEY` | V1 server secret: `CHASECK_TEST-…` in TEST, `CHASECK-…` in live |
| `CHAPA_V1_BASE_URL` | `https://api.chapa.co`; exact official V1 API origin |
| `CHAPA_V1_WEBHOOK_SECRET` | Independent random 32–256 character secret matching the merchant dashboard |
| `CHAPA_V1_WEBHOOK_SIGNATURE_PROFILE` | `json_body`; explicitly select the merchant-verified signing contract below |
| `CHAPA_V1_TEST_ENVIRONMENT_REVIEWED` | `false`; required for a reviewed remote staging TEST database |
| `CHAPA_V1_LIVE_ENABLED` | `false`; separate live-creation gate |
| `CHAPA_V1_MERCHANT_REVIEWED` | `false`; merchant/live-environment review |
| `WALLET_BIDS_ENABLED` | `false`; existing-wallet spending, independent of Chapa creation |
| `WALLET_BIDS_LIVE_ENABLED` | `false`; additional production wallet-spending gate |

V1 uses ETB and converts decimal ETB to integer cents internally. The supported hosted charge range is 1.00–43,200.00 ETB. A bid's charge is the server-calculated submission-fee total, not its chosen bid number. Smaller or zero submission fees use the existing wallet path.

`https://api.chapa.global` is the only permitted alternative V1 origin. Select it only after merchant TEST verification of that exact V1 endpoint and its returned `checkout.chapa.global` URL. The default `.co` API requires `checkout.chapa.co`. The server enforces the host matching its configured API origin, and the browser accepts only those exact official HTTPS checkout hosts. There is no automatic origin fallback, environment fallback or API-version fallback.

## TEST and live guards

For TEST, use a separate database, bot and merchant TEST key. `APP_ENV` must be `local`, `test` or `staging`, and `VERCEL_ENV` cannot be `production`. A remote TEST database requires `APP_ENV=staging` plus `CHAPA_V1_TEST_ENVIRONMENT_REVIEWED=true`. This review flag does not permit staging to target the production database.

`MINI_APP_URL` and `BETTER_AUTH_URL` must use the same HTTPS origin. Keep real credentials out of browser fixture environments. Configure the actual V1 webhook URL/secret and one signature profile on both web and worker. After schema and target review, explicitly enable V1 creation in the TEST environment to run merchant TEST acceptance; keep all live flags off.

Live configuration additionally requires `APP_ENV=production`, `NODE_ENV=production`, no Vercel preview/development environment, a matching live V1 secret and `CHAPA_V1_MERCHANT_REVIEWED=true`. New live creation also requires `CHAPA_V1_LIVE_ENABLED=true`. Development identity, development points and staging demo flags must all be disabled. A private key alone enables nothing. Do not activate Verify.et, ArifPay or `PAYMENTS_LIVE_ENABLED` to enable Chapa V1.

## Webhook signing and endpoints

Configure the merchant dashboard's V1 webhook as:

`https://<reviewed-app-origin>/api/payments/chapa/v1/webhook`

It has no checkout query parameter. The secret is the original dashboard value, not a precomputed hash. Select exactly one profile based on actual merchant TEST deliveries; the server never tries several algorithms until one succeeds.

| Profile | Signature header | HMAC-SHA256 message |
| --- | --- | --- |
| `json_body` | `x-chapa-signature` | `JSON.stringify(JSON.parse(rawBody))` |
| `raw_body` | `x-chapa-signature` | Exact raw request bytes |
| `custom_json_body` | `chapa-signature` | `JSON.stringify(JSON.parse(rawBody))` |
| `legacy_secret` | `chapa-signature` | The webhook secret itself |

`legacy_secret` authenticates only a bounded lookup hint because it does not protect the payload. Every profile still requires authenticated V1 verification of the stored reference, matching mode, ETB amount/currency and payment identity before credit. A signed webhook or HTTP 200 is not payment proof.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/payments/chapa/checkouts` | Authenticated V1 hosted creation or exact-intent recovery |
| `GET /api/payments/chapa/checkouts/:id` | Owned saved status |
| `POST /api/payments/chapa/checkouts/:id` | Server verification of the owned stored payment reference |
| `/api/payments/chapa/v1/callback?checkout=:id` | Unsigned navigation hint; cannot credit a wallet or accept a bid |
| `/payments/chapa/return?checkout=:id` | Return to the original owned bid/top-up flow; Telegram handoff when needed |
| `POST /api/payments/chapa/v1/webhook` | Version-isolated signed V1 notification receipt |
| `POST /api/payments/chapa/webhook` | Existing V2 notification receipt, retained for V2 recovery |

New direct-charge and payment-method discovery routes return `HOSTED_CHECKOUT_REQUIRED`. Existing V2 direct authorization/history remain available only for original owned payments; no new customer direct charge is created.

## Recovery and financial behavior

The server freezes an account-owned intent and reference before contacting Chapa. New requests use V1 `POST /v1/transaction/initialize`; verification uses `GET /v1/transaction/verify/:tx_ref`. There is no V2 transport call for a new V1 payment. A changed payload cannot reuse its idempotency key. New keys alias an identical unresolved payment; differently priced top-ups or a different unresolved bid batch for the same auction are blocked until the original is resolved.

Closing/reopening a sheet keeps the original command in the account's private query cache. A lost response, timeout or failed status read shows recovery/check actions rather than inventing success or authorizing another payment. The server also prevents a reload/new tab from creating a second unresolved hosted payment for the same owned purpose/auction.

V1 initialization has no assumed replay guarantee. Once dispatch is recorded, a missing checkout URL is recovered by verifying the original stored `tx_ref`, not blindly repeating initialization. A verification 404 can mean an unpaid transaction and does not prove cancellation. Ambiguous attempts remain pending or `NEEDS_REVIEW`, with Check payment, Transactions and support available; a replacement payment is not offered from that state.

Only server-verified success commits one balanced receipt. Top-ups credit the original wallet once. Bids still pass the authoritative deadline, eligibility, fee, coupon and acceptance checks. If a legitimate paid bid cannot be accepted, its payment is retained in the customer's wallet once. Redirects, browser query parameters, webhook hints and optimistic UI never credit funds or create accepted bids. Terminal retry requires an owned verified unsuccessful outcome.

## Worker and historical V2 recovery

Keep `npm run worker:chapa` in the existing Chapa service. It processes durable version-tagged notifications, verifies due V1 payments and delivers committed receipts. It can also recover existing V2 direct payments using the original V2 configuration. It exits when neither V1 nor V2 recovery is configured; do not restart-loop an intentionally paused worker.

Web and worker need the same target database, origins, bot identity, contact encryption keys and each enabled version's matching key/mode. Use the restricted runtime database role; workers use `connection_limit=1` and `pool_timeout=20`. The migration role is never a web/worker credential. Keep the receipt notification worker's relevant bot settings aligned.

Historical V2 settings remain `CHAPA_PRIVATE_KEY`, `CHAPA_MODE`, `CHAPA_BASE_URL`, `CHAPA_WEBHOOK_SECRET`, `CHAPA_WEBHOOK_SIGNATURE_PROFILE`, `CHAPA_SCHEMA_READY` and `CHAPA_RECOVERY_ENABLED`. Keep `CHAPA_ENABLED=false`. Only enable `CHAPA_LEGACY_SWEEP_ENABLED` for explicitly reviewed older V2 hosted sweep recovery. Do not copy V1 secrets into these variables or rotate away credentials needed by unresolved records. Saved credential fingerprints prevent silently verifying another merchant's payment.

The earlier `scripts/check-chapa.ts` readiness command describes the V2 contract; it is not V1 merchant acceptance evidence. The worker's safe startup report identifies `apiVersion:1` when V1 recovery is ready. Never log keys, raw webhook bodies or customer payment data to diagnose configuration.

## Acceptance before live review

Run typecheck, unit/security tests, the isolated financial database suite, production build and hosted-checkout browser tests. Synthetic tests establish implementation behavior, not merchant compatibility.

In the reviewed merchant TEST environment verify an actual top-up and multi-bid fee, successful and unsuccessful payments, duplicate/reordered webhooks, temporary verification failure, lost initialization response, close/reopen and Telegram Android/iOS return. Confirm that pending/redirect-only states do not change balances or bids, another account cannot inspect a payment, late successful bid payments are preserved, repeated verification cannot credit twice, and wallet-funded bidding still charges the quoted fee once. Keep new live creation disabled until those results and the production configuration are reviewed.
