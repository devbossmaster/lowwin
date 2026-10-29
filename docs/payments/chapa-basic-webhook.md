# Chapa Basic Auth webhook

The dashboard offers Basic Auth with URL, Secret Hash, PAYMENT type, username
and password. This explicit alternative avoids the observed signature delivery
that matches HMAC(secret, secret) instead of the documented raw-body HMAC.
It does not accept that constant signature or bypass merchant verification.

## Configure

Deploy the updated web handler first, with the same compatible Chapa worker.
Set these protected runtime variables on both resources:

```ini
CHAPA_WEBHOOK_AUTH=basic
CHAPA_WEBHOOK_BASIC_USERNAME=lowwin-webhook
CHAPA_WEBHOOK_BASIC_PASSWORD=REPLACE_WITH_SEPARATE_RANDOM_PASSWORD
```

Lowwin accepts a separate random Basic password of 16-256 printable ASCII
characters. The merchant confirmed that a 16-character password saved in Chapa;
longer values produced a generic dashboard 500, which does not establish Chapa's
maximum length. Use 16 random letters/numbers for this deployment and keep the
exact value in Chapa, web and worker. A saved webhook still needs actual delivery
and duplicate-handling acceptance. Keep it server-only. `CHAPA_WEBHOOK_SECRET` is
required only in Signature mode. Basic mode requires its exact username/password;
the dashboard may still require a Secret Hash field when creating the webhook.
Keep the merchant API key, payment mode and recovery bindings.
Changing webhook authentication does not require changing payment credentials.
Do not enable new payment/live flags to test webhook authentication.

In the matching Chapa business and environment, create a **Basic Auth** webhook:

| Field | Value |
| --- | --- |
| Webhook URL | `https://lowwin.shop/api/payments/chapa/webhook` |
| Secret Hash | Existing protected `CHAPA_WEBHOOK_SECRET` |
| Webhook Type | `PAYMENT` |
| Username | Exact `CHAPA_WEBHOOK_BASIC_USERNAME` |
| Password | Exact `CHAPA_WEBHOOK_BASIC_PASSWORD` |

Redeploy/restart resources after changing runtime configuration. The reverse
proxy must preserve the Authorization header and the endpoint must use HTTPS.
Basic mode accepts only matching HTTP Basic credentials; a signature alone does
not authenticate. Default/unset mode remains raw-body HMAC signature validation.
There is no automatic fallback. Unknown modes and incomplete credentials fail closed.

## Existing payment acceptance

Retry an existing paid payment's delivery to the new Basic Auth configuration if
the dashboard supports selecting it. Retrying an old configuration can retain its
old authentication; do not assume editing another webhook changes past delivery.
Otherwise use the owned transaction's **Verify status** action; do not pay again.
Check for HTTP 200 `{"accepted":true}`, a queued/processed owned event, and the
verified payment result. HTTP 200 acknowledges receipt, not fulfillment.
Resend the same delivery and confirm there remains one canonical receipt/journal.
After Basic Auth delivery is confirmed, disable the previous Signature webhook.
Physical merchant delivery remains unverified until this check is performed.

A hosted webhook may report the principal plus its declared service fee (for
example, 1029 with fee 29 for an expected 1000). The routing check permits only
the exact principal or exact principal plus that fee. Currency, environment and
reference checks remain. No webhook amount is used to credit a wallet: the
server verification API must still report SUCCESS with the exact stored 1000
cents, merchant reference, currency and credential binding. The fee is never
credited or silently subtracted from API evidence.

No new schema migration is introduced here. The preceding Transactions release
still requires `202610290002_chapa_event_transactions` if it is not yet applied.
Rollback authentication by restoring `CHAPA_WEBHOOK_AUTH=signature` and the
corresponding dashboard configuration; do not delete attempts or receipts.

References: [webhook security](https://docs.chapa.global/docs/v2/integrations/webhooks),
[payment verification](https://docs.chapa.global/docs/v2/integrations/verify-payment).

## Diagnose an actual 401 without exposing credentials

The Chapa dashboard's “retry initiated” toast confirms scheduling, not delivery.
Refresh the transaction and inspect the delivery HTTP status and response. Opening
the webhook URL in a browser sends GET and normally returns 405; it does not test
Chapa's authenticated POST.

In the deployed **web** container, run:

```sh
npx --no-install tsx scripts/check-chapa-webhook-auth.ts
```

Copy the actual delivery's Authorization value or one-line Headers JSON from
Chapa into the hidden terminal prompt and press Enter. Do not put it in command
arguments or paste it into chat. The diagnostic reads only runtime environment
variables and prints booleans and diagnosis codes; it makes no HTTP, database,
payment or bot calls and does not load environment files.

`MATCHES_DEPLOYED_BASIC_AUTH` means that copied header matches this container's
current Basic configuration. A username/password mismatch must be corrected in
the matching Chapa webhook or web runtime configuration; an old delivery can
retain old authentication. `RECEIVED_PASSWORD_ENVELOPE_MISMATCH` means the received
password resembles encoded encrypted metadata and differs from the configured
password. It is evidence to investigate the delivery configuration/provider,
not permission to accept that envelope or bypass authentication. Signature mode
reports that exact raw body bytes and the signature are required; this command
does not guess a signature from pretty-printed dashboard JSON.
