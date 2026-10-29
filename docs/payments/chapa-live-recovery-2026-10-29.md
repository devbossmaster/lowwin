# LIVE hosted-session and replaced-key recovery

The production v2 hosted checkout route returned `/payment/hosted/APW…`, which
identifies a session. Merchant-authenticated verification supplies a different
final payment reference. New intents now keep that final reference unset until
verification. Existing APW session values can change only while the same
transaction attaches the exact canonical, balanced receipt. Checkout URLs,
initialization bodies, original key fingerprints and credited outcomes remain
immutable. Migration `202610290001_chapa_live_hosted_session` updates only this
guard; it changes no financial rows.

A second, independent production failure was HTTP 403 `FORBIDDEN` with
`Access denied: Insufficient permissions` from merchant verification. Replacing
the merchant key fixes neither an old intent's binding nor its session reference
automatically. Preserve old keys and investigate read permissions before rotating
them. Screenshots, redirects and unauthenticated webhooks never authorize money.

## Operator recovery after an already-replaced key

Keep `CHAPA_ENABLED=false` and `CHAPA_RECOVERY_ENABLED=true`. Deploy matching web
and recovery-worker code. Review and apply the guard-only migration through the
separate migration connection. Keep the restricted runtime login in applications.

Run from the protected application terminal, using the replacement key and the
original checkout's reviewed identifiers and integer-cent amount:

```sh
npx --no-install tsx scripts/authorize-chapa-recovery.ts \
  --checkout <original-checkout-uuid> \
  --merchant <original-merchant-reference> \
  --amount-cents <original-integer-cents> \
  --final-reference <verified-final-chapa-reference>
```

This default is read-only with respect to the database. It authenticates a GET
verification through the replacement key, requires terminal SUCCESS and exact
merchant reference, amount, currency, mode when supplied, final reference and
historical metadata. Review the result before repeating with `--confirm`.

Confirmation appends one immutable `CHAPA_CREDENTIAL_RECOVERY_AUTHORIZED` audit.
It creates no checkout and credits no money. It emits `CHAPA_RECOVERY_BINDINGS`
JSON containing only identifiers, hashes and an expiry. Preserve that exact JSON
in the protected web and Chapa-worker runtime configuration and redeploy them.
The authorization is restricted to one original checkout, original frozen request
and credential fingerprint, replacement fingerprint, final reference and amount;
it expires after 23 hours. The matching audit is required too. Invalid, expired,
cross-account or unapproved bindings fail closed. Original-key requests cannot be
reinitialized under the replacement key.

The existing worker then performs fresh merchant verification and the canonical
locked, idempotent receipt transaction. Confirm exactly one credit/journal and
zero reconciliation drift before removing the temporary configuration. A paid
checkout returns its committed receipt without needing the temporary binding.
Do not replace fingerprints, initialization data, balances or final references
manually. Concurrent or repeated verification must retain one receipt.

## Webhook status remains separate

This change does not accept a constant `HMAC(secret, secret)` signature or disable
raw-body authentication. A 401 webhook remains rejected and is not a durable
event, even when authenticated recovery independently proves payment success.
Resolve actual merchant signing separately before claiming webhook acceptance.

Official contracts: [hosted checkout](https://docs.chapa.global/docs/v2/integrations/accept-payment),
[merchant verification](https://docs.chapa.global/docs/v2/integrations/verify-payment),
[webhook signatures](https://docs.chapa.global/docs/v2/integrations/webhooks).

## Validation

The focused suite passed 55 tests without skips against disposable PostgreSQL 17
databases and mocked providers. It covers LIVE hosted-session references, receipt
immutability, exact recovery approvals, changed keys, account isolation and
concurrent verification without duplicate credits. Typecheck and an isolated
Next.js production build passed. The dependency audit reported zero findings.
These checks do not demonstrate actual production recovery or webhook delivery;
the operator steps above and production reconciliation remain necessary.
