# Chapa Signature webhook

Lowwin accepts Chapa v2 payment webhooks only through `x-chapa-signature`.
The server authenticates the original request bytes with HMAC-SHA256 before
parsing JSON or accessing a payment. There is no alternative authentication
scheme or automatic fallback.

## Coolify configuration

Deploy matching reviewed code to the web and Chapa worker resources. Configure
this protected runtime variable on both resources:

```ini
CHAPA_WEBHOOK_SECRET=REPLACE_WITH_SEPARATE_RANDOM_SECRET
```

Use an independent random secret of 32-256 characters. Keep its exact value
private and use that same value in the dashboard. Do not reuse the merchant API
key. Save and restart/redeploy both resources after changing configuration.

When upgrading an existing deployment, remove the obsolete `CHAPA_WEBHOOK_AUTH`,
`CHAPA_WEBHOOK_BASIC_USERNAME` and `CHAPA_WEBHOOK_BASIC_PASSWORD` variables from
Coolify. These variables no longer select or configure authentication. Disable
the old Basic Auth webhook subscription when cutting over to Signature.
Preserve the current merchant API key, payment mode, schema and reviewed
verification/recovery configuration; changing webhook authentication does not
require rotating payment credentials or enabling new payments.

## Chapa dashboard

Use the matching merchant business and environment. For production, configure
the **Live** environment's **Chapa Signature** webhook with:

| Field | Value |
| --- | --- |
| Webhook URL | `https://lowwin.shop/api/payments/chapa/webhook` |
| Secret Hash | Exact protected `CHAPA_WEBHOOK_SECRET` value |
| Webhook Type | `PAYMENT` |

For TEST, use its own business environment, secret and reviewed test origin.
Keep the canonical HTTPS URL without a checkout query parameter. The reverse
proxy must preserve `x-chapa-signature` and the request body bytes. Refund and
payout reconciliation are not implemented by this payment subscription.

## Authentication and payment handling

The expected header is a 64-character hexadecimal digest calculated as:

```text
HMAC_SHA256(key = CHAPA_WEBHOOK_SECRET, message = exact raw HTTP body)
```

Lowwin compares fixed-length digest bytes in constant time. It rejects missing,
invalid or nonmatching signatures with HTTP 401. Reformatting dashboard JSON,
using a legacy header or signing the secret itself cannot authenticate the
delivery. An IP allowlist does not replace this check.

After authentication, Lowwin matches the environment and payment references,
durably records the delivery and deduplicates its raw-body hash within the
configuration/environment. HTTP 200 `{"accepted":true}` acknowledges durable
receipt; it does not establish that a wallet was credited. The shared merchant
verification API must independently report `SUCCESS` with the exact stored
amount, currency, references and credential binding before the existing locked,
balanced and idempotent financial transaction runs.

A hosted webhook may report the principal plus its declared service fee, such
as 1029 with fee 29 for an expected 1000 cents. This is only a routing hint:
the verification API must still report the exact principal. Fees are never
credited, and no webhook amount is used as authoritative credit evidence.

## Confirm an actual delivery

Resend an existing paid transaction through the current Signature configuration;
do not pay again. An old retry can retain its original webhook configuration.
Refresh the transaction and inspect the newest delivery's HTTP status and
response. The dashboard's retry-scheduled toast is not a delivery result.

Confirm `x-chapa-signature`, actual HTTP 200 `{"accepted":true}`, the owned
payment's verified result and one canonical receipt/journal. Resend the same
delivery and confirm there is no second credit. Opening the endpoint in a
browser sends GET and normally returns 405; that does not test a signed POST.

Local mocked tests and synthetic probes do not establish that Chapa used the
matching secret or signed the actual delivered bytes. A continuing 401 needs
those delivery details checked; never bypass authentication to force HTTP 200.
Keep secrets, raw customer payloads and full authentication headers out of chat
and shared logs.

## Offline diagnostic

In the deployed web container, run:

```sh
npx --no-install tsx scripts/check-chapa-webhook-signature.ts
```

The default command reads runtime configuration only and reports safe status
without showing the secret. It does not load environment files or make network,
database, payment or bot calls.

If exact raw delivery bytes and the corresponding `x-chapa-signature` value are
already available in private files, check them without copying their contents
into shell arguments:

```sh
npx --no-install tsx scripts/check-chapa-webhook-signature.ts --body-file /private/webhook-body.bin --signature-file /private/x-chapa-signature.txt
```

Use `--help` for usage. Pretty-printed dashboard JSON is not an exact raw-body
capture and cannot establish signature compatibility. The offline result also
does not establish public endpoint reachability, durable receipt or financial
fulfillment; confirm those through the actual delivery and owned payment result.

This authentication cleanup adds no database migration. Preserve all existing
attempts, receipts, delivery records and journals. The earlier Transactions
release still requires `202610290002_chapa_event_transactions` if unapplied.

References: [v2 webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks),
[payment events](https://docs.chapa.global/docs/v2/webhooks/payment),
[payment verification](https://docs.chapa.global/docs/v2/integrations/verify-payment).
