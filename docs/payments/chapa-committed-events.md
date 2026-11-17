# Committed Chapa updates over SSE

Deploy the reviewed application revision to **lowwin-web** and the existing
**lowwin-chapa** recovery worker. Keep the current activation/recovery flags and
merchant bindings. The SSE transport adds no additional database tables or
service. Apply the release's reviewed additive migrations first, including
payment signal coordination and the subsequent signal-guard migration.
It does not change internal-wallet bidding.

## Shared private broker

Reuse the existing private `lowwin-redis` resource. Put its protected `REDIS_URL`
on both WEB and the Chapa worker, and use a matching deployment namespace:

```ini
CHAPA_EVENTS_NAMESPACE=lowwin-production
```

Use a different namespace for TEST/staging deployments and the same `APP_ENV`
for cooperating WEB/worker processes. The explicit namespace accommodates
different database pooler hostnames or restricted PostgreSQL usernames. Without
it, the fallback scope hashes `APP_ENV`, `REDIS_CACHE_NAMESPACE`, database host
and database name; those values must match across processes.

Redis needs `PUBLISH` and `SUBSCRIBE` permission for the private
`lowwin:payments:committed:v1:*` channel in addition to its existing public-cache
commands. It remains private and password-protected. The payment channel is
separate from the public-cache namespace and stores no values: each message is
only a version and an opaque checkout ID. It contains no payment outcome,
balance, receipt, account/session data, phone, PIN, OTP or credential.

`publishChapaCommitted(id)` must be called **after** the corresponding database
write or transaction commits. The publisher and subscriber use separate sockets;
one subscriber connection per WEB process fans hints out only to streams already
authenticated as owners. A hint always causes a fresh owned PostgreSQL DTO read.
Redis failures are bounded and cannot undo a commit. Pub/sub is lossy by design;
the database snapshot and existing worker queue remain durable recovery.

## Proxy behavior and bounded recovery

`GET /api/payments/chapa/checkouts/{id}/events` uses the existing signed,
Telegram-bound owner session. It rejects a different owner with the existing
not-found response. It sends an initial owned snapshot, subscribes, and rereads
after subscription to close the connection race. Every pushed DTO and 15-second
heartbeat rechecks that same session. Streams close at session expiry or after
55 seconds, and cancellation removes the subscription immediately.

The response is `text/event-stream`, `private, no-store, no-transform`, varies
on Cookie and sends `X-Accel-Buffering: no`. Keep this path out of cache and
response-buffering middleware at every proxy/CDN. For an existing nginx proxy,
merge the narrow SSE location in `deploy/nginx-lowwin.conf.example`; it disables
buffering, response caching and gzip only for this endpoint. Keep proxy idle/read
timeouts above the 15-second heartbeat interval; the example uses 75 seconds.

Coolify normally uses Traefik. Retain the current proxy/router configuration and
check any custom middleware: response buffering must not collect this stream
until it closes. Do not add a second public proxy or copy unrelated resource
labels. Verify the actual deployed TLS path with an authorized TEST account:
the first event must arrive immediately, heartbeats separately every 15 seconds,
and committed worker updates before the next browser poll. Inspect the Network
event-stream panel without copying cookies or full payment DTOs into logs.

The browser shares one account-scoped observer per original attempt across
mounted surfaces; refcounts transfer observation when one surface closes. It closes streams
while hidden, reads the owned snapshot immediately on open/reconnect, browser
resume and Telegram `activated`, and keeps bounded verification polling as
fallback. Active Inline validation retains the server's `pollAfterMs` cadence
even with a healthy SSE connection, since a working broker does not prove a
provider webhook arrived. At most one observer snapshot/verification request is
in flight; existing server leases still coordinate private provider HTTP.
Failed SSE connections use exponential backoff, stop after six unsuccessful
connections, and can resume on foreground/online/Telegram activation. Missing
EventSource support uses polling. Duplicate frames pass through the existing
monotonic snapshot guard; accepted DTOs seed TanStack Query and refresh the
existing committed receipt, wallet and history resources.

## Validation scope

The focused suites `chapa-committed`, `chapa-event-stream`, `chapa-event-route`
and `chapa-observer` test broker routing, subscription races, duplicates,
ownership, account changes, expiry/revocation, cleanup, reconnect/resume and
polling fallback with deterministic fixtures. They do not establish production
proxy streaming, actual Redis ACLs, physical Telegram behavior or provider
completion time. Measure commit-to-render latency separately on the deployed
TEST path; a local in-memory broker fixture is not a production latency sample.
The `checkout-v2-inline-browser/committed-events` fixture additionally holds the
provider-check response, injects an owned SSE callback and records its duration
to the confirmed DOM update. Its `simulated-sse-timing.json` samples measure
callback/render work only, excluding Redis, proxy, network and real commit time.

Contracts: [Redis pub/sub delivery](https://redis.io/docs/latest/develop/pubsub/),
[node-redis subscriber connections](https://github.com/redis/node-redis/blob/master/docs/pub-sub.md),
[Coolify networking](https://coolify.io/docs/core/networking-in-coolify),
[Traefik response buffering](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/buffering/).
