# Chapa Signature webhook

Lowwin uses an explicitly selected signature profile for Chapa deliveries.
Strict v2 raw-body verification is the default. The optional legacy profile
adapts the confirmed secret-on-secret delivery without changing hosted checkout
or payment verification to v1. Basic Auth is not implemented and there is no
automatic fallback between profiles.

| Profile | Accepted proof | Guarantee |
| --- | --- | --- |
| `raw_body` (default) | `x-chapa-signature` = HMAC-SHA256(secret, exact raw body) | Authenticates the original body bytes |
| `legacy_secret` (explicit opt-in) | `chapa-signature` = HMAC-SHA256(secret, secret); observed `x-chapa-signature` placement only when the primary header is absent | Reusable secret proof; does **not** authenticate body contents |

The v1 guide assigns the constant proof to `chapa-signature` and the body proof
to `x-chapa-signature`. The observed delivery used the constant in the latter
header. Supporting that observed placement is a compatibility adapter, not a
claim that the delivery follows the v2 raw-body contract. In the legacy profile,
Lowwin verifies `chapa-signature` whenever it is present. It checks the observed
constant proof in `x-chapa-signature` only when `chapa-signature` is absent. The
v1 headers can legitimately differ because they describe different formulas;
an invalid primary header cannot be bypassed by a matching secondary header.

## Coolify configuration

Deploy matching reviewed code to the web and Chapa worker resources. Configure
these protected runtime variables on both resources:

```ini
CHAPA_WEBHOOK_SECRET=REPLACE_WITH_SEPARATE_RANDOM_SECRET
CHAPA_WEBHOOK_SIGNATURE_PROFILE=raw_body
```

Use an independent random secret of 32-256 characters. Keep its exact value
private and use that same value in the dashboard. Do not reuse the merchant API
key. Save and restart/redeploy both resources after changing configuration.

For the confirmed legacy delivery calculation, deliberately select this profile
on **both** the web and Chapa worker resources:

```ini
CHAPA_WEBHOOK_SIGNATURE_PROFILE=legacy_secret
```

Use a fresh signing secret for this cutover: the previous secret/proof was
exposed during troubleshooting. Set the new value in both resources and the
dashboard's Secret Hash. Never log or share the complete proof; in legacy mode
it behaves like a reusable bearer credential. Rotating the webhook secret does
not require changing the private payment API key or immutable payment intents.

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
proxy must preserve the selected signature headers and the request body bytes. Refund and
payout reconciliation are not implemented by this payment subscription.

## Authentication and payment handling

For `raw_body`, the expected header is a 64-character hexadecimal digest calculated as:

```text
HMAC_SHA256(key = CHAPA_WEBHOOK_SECRET, message = exact raw HTTP body)
```

Lowwin compares fixed-length digest bytes in constant time. It rejects missing,
invalid or nonmatching signatures with HTTP 401. Reformatting dashboard JSON,
using a legacy header or signing the secret itself cannot authenticate a
`raw_body` delivery. An IP allowlist does not replace this check.

For `legacy_secret`, Lowwin verifies the constant proof in constant time and
treats every body field as an untrusted lookup hint. Only a previously stored
merchant payment attempt in the matching environment and currency can be
scheduled. Unknown, mismatched or already credited hints do not create new
event jobs. An atomic per-attempt lock keeps one canonical job per attempt and
signature profile. Hints reuse an existing queued job; a later hint rearms a
completed job with a deferred lookup and a 60-second cooldown. A hint received
during an active lookup retains one deferred follow-up. Changing body bytes
cannot grow an unbounded verification queue for that attempt. This profile
does not initialize payments, change frozen amounts, mark a payment paid, or
trust a hinted result.

After authentication, Lowwin matches the environment and payment references.
The raw-body profile durably records and deduplicates the delivery's raw-body
hash within the configuration/environment. The legacy profile uses the
canonical attempt/profile job described above. Matched new work is recorded
before acknowledgment; coalesced or discarded legacy hints have no additional
financial effect.
HTTP 200 `{"accepted":true}` does not establish that a wallet was credited. The shared merchant
verification API must independently report `SUCCESS` with the exact stored
amount, currency, references and credential binding before the existing locked,
balanced and idempotent financial transaction runs. Checkout remains
`POST /v2/payments/hosted`, verification remains
`GET /v2/payments/{reference}/verify`, and amounts remain integer cents.

A hosted webhook may report the principal plus its declared service fee, such
as 1029 with fee 29 for an expected 1000 cents. This is only a routing hint:
the verification API must still report the exact principal. Fees are never
credited, and no webhook amount is used as authoritative credit evidence.

## Confirm an actual delivery

Resend an existing paid transaction through the current Signature configuration;
do not pay again. An old retry can retain its original webhook configuration.
Refresh the transaction and inspect the newest delivery's HTTP status and
response. The dashboard's retry-scheduled toast is not a delivery result.

Confirm the header and calculation selected by the profile, actual HTTP 200
`{"accepted":true}`, the owned
payment's verified result and one canonical receipt/journal. Resend the same
delivery and confirm there is no second credit. Opening the endpoint in a
browser sends GET and normally returns 405; that does not test a signed POST.

Local mocked tests and synthetic probes do not establish that the actual
merchant delivery was accepted. For `raw_body`, only the exact received bytes
can prove a matching body signature. For `legacy_secret`, a matching constant
proof still says nothing about the body's integrity or payment state. A
continuing 401 needs the selected profile, matching secret and actual headers
checked; never bypass the selected authenticator to force HTTP 200.
Keep secrets, raw customer payloads and full authentication headers out of chat
and shared logs.

## Offline diagnostic

In the deployed web container, run:

```sh
npx --no-install tsx scripts/check-chapa-webhook-signature.ts
```

The default command reads runtime configuration only and reports the selected
profile and safe status without showing the secret. A delivery comparison also
reports `bodyIntegrityVerified`: only an accepted `raw_body` comparison can set
this to true. The diagnostic does not load environment files or make network,
database, payment or bot calls.

If exact raw delivery bytes and the selected profile's signature value are
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

References: [v1 webhook formulas](https://docs.chapa.global/docs/v1/integrations/webhooks#verify-webhook-origin),
[v2 webhook authentication](https://docs.chapa.global/docs/v2/integrations/webhooks),
[payment events](https://docs.chapa.global/docs/v2/webhooks/payment),
[payment verification](https://docs.chapa.global/docs/v2/integrations/verify-payment).
