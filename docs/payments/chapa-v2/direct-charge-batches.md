# Direct charges and batch bidding

New bid orders snapshot ordered numbers, auction/rule/fee version, per-entry fees and a coupon allocation in `BidBatchOrder`. One coupon discounts the first eligible entry. The quote does not consume it. Editing a selection requires a new quote/key; the server rechecks price, coupon, own bids, limits and consecutive amounts before payment and again before acceptance. Numbers are never included in the charged amount.

The full wallet path accepts every line in one transaction, including a zero-total order without a provider call. A paid direct order credits the verified principal once, then accepts all lines in one savepoint with deterministic child operation keys. The first entry uses the existing bid command, including coupon redemption and first-bid referral proof. The remaining entries use bulk inserts under the same locks and per-row database auction/deadline/fee guards. If any entry fails, the savepoint rolls back every batch bid and fee; the verified principal remains in the payer's Lowwin wallet. Existing hosted and single-bid orders keep their original settlement path.

## Setup

1. Apply `202611070001_direct_charge_batches` using the migration-owner connection: `npm run db:migrate`. Generate the Prisma client during the normal build. If provisioning a new runtime login, use the updated `deploy/runtime-role.sql` inventory.
2. Retain the existing protected Chapa key/mode/webhook/contact encryption configuration. The private key needs direct-charge creation/validation, payment reads and payment-method reads. Keep live payments disabled while merchant TEST acceptance is pending.
3. Confirm the merchant's `/v2/payments/methods` response explicitly enables both payment and direct-charge processing, ETB/ET and valid amount limits. The server offers only Telebirr, M-Pesa and CBE Birr in that order. `CHAPA_DIRECT_EBIRR_ENABLED=true` permits eBirr only when the merchant also supports it. Missing or unavailable capabilities fail closed. The five-minute capability cache is scoped to key fingerprint and mode and is not part of public Home bootstrap.
4. Redeploy WEB and the Chapa worker. Run the existing `worker:chapa` command. The worker now also reconciles new direct intents even when there was no webhook or the app was closed; the legacy-sweep switch is unrelated.

## Provider boundary

Use the official [initialize direct charge](https://docs.chapa.global/docs/v2/direct-charge/initiate-payment), [validate direct charge](https://docs.chapa.global/docs/v2/direct-charge/authorize-payment), [methods](https://docs.chapa.global/docs/v2/integrations/payment-methods) and [verification](https://docs.chapa.global/docs/v2/integrations/verify-payment) endpoints. There is no invented authorize endpoint, browser payment script or wallet PIN collection.

Initialization persists its immutable intent before HTTP: original merchant reference/key, method, encrypted normalized payer phone, exact cents and batch quote. A lost response resumes that same attempt. Initialization replay is locally bounded to five attempts and 24 hours; this is an additional conservative application limit, not a claim about Chapa's retention guarantee. Afterward the server only reconciles the original merchant reference. Merchant TEST acceptance must confirm provider idempotency retention before live activation.

USSD validation and merchant verification run automatically through the owned check endpoint and durable worker. OTP is sent only on an explicit owned, rate-limited request when `auth_type` is OTP. OTP values are never stored, logged or retried automatically. Provider HTTP runs outside financial transactions; a timeout remains unknown, never "not charged".

All payment settlement paths (webhook, owned polling, worker and audited admin Check payment) call `verifyChapaCheckout`. Only verified `SUCCESS` with matching merchant reference, cents, currency, environment/credential, original authorization reference, method and payer phone evidence can create funds. New direct reconciliation is bounded to seven days and 500 checks with backoff; terminal provider failures stop scheduled polling but a later authenticated event can still reconcile a success. Timers never invent a failed payment state.

Existing signature profiles remain explicit: raw-body HMAC is the v2 default; the separately configured support-confirmed legacy-secret profile remains a lookup hint. Neither profile bypasses merchant verification or ledger idempotency.

## API surface

- `POST /api/payments/chapa/batches/quote` — `{key,auctionSlug,numbers,feeVersion,couponId?}`.
- `POST /api/payments/chapa/batches/:id/wallet` — `{quoteHash}`.
- `GET /api/payments/chapa/methods?amountCents=...` — eligible methods and the authenticated account's prefill phone. Always private/no-store.
- `POST /api/payments/chapa/direct` — `{key,purpose:"BID",batchId,quoteHash,paymentMethod,phone}` or `{key,purpose:"TOP_UP",amount,paymentMethod,phone}`.
- `POST /api/payments/chapa/checkouts/:id/authorize` — `{otp?}`; existing check/read endpoints retain ownership checks.

Owned DTOs include safe authorization state, masked payer phone, immutable batch numbers and a separate financial/fulfillment outcome. No provider payload, OTP, encryption key or credential fingerprint is returned. Admin Check payment uses the same verified settlement; reconciliation audits every batch child receipt.

Public batch responses project only each entry's bid and charge plus one final wallet snapshot. Full immutable per-entry receipts remain in storage; they are not repeated in the browser payload.

## Isolated implementation benchmark

A synthetic 100-entry wallet batch on the disposable loopback database used 3,022 Prisma queries and a 1,701,570-byte response in the initial per-entry implementation. The batch-only bulk path used 60 queries and a 34,775-byte response. Measured transaction/request durations were 5,765 ms initially and 2,181 ms in a loaded post-change run (an earlier bulk run was 1,171 ms). These are local implementation measurements, not production/provider latency or a pre-existing 100-entry feature baseline. Remote database and merchant-device acceptance still need separate measurements.

## Acceptance remaining

CI runs `node scripts/run-db-tests.mjs nov7` after the historical Chapa browser project. It creates and migrates a fresh loopback `_test` database without catalog seeding, builds production bundles with protected local fixture configuration, then runs every November public/direct/wrapper scenario at both viewport widths. Temporary localhost certificates are supplied through `NOV7_TLS_KEY` and `NOV7_TLS_CERT`; generated traces, screenshots and measurements are uploaded with the checkout artifacts. The foundation unit run retains its all-tests/no-skips gate.

The isolated tests mock Chapa and do not prove merchant rail availability, actual USSD/OTP, Telegram contact/return or live delivery. In merchant TEST mode use the documented mobile scenarios (success `251900000000`, insufficient funds `251911111111`, cancellation `251922222222`, timeout `251933333333`). Confirm actual signed webhook delivery, duplicate/out-of-order safety, app-close recovery, OTP when applicable, account isolation and one ledger credit before enabling live configuration. Do not create live charges as part of automated tests.
