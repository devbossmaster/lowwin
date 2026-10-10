# Payment verification transaction failure

The reported production failure is Prisma `P2028` during Better Auth's user
lookup inside transaction-scoped session validation. The log establishes that
the transaction was already closed; it does not establish a provider rejection.
Earlier production measurements showed approximately 625 ms per warm database
read. Several payment setup transactions used Prisma's default five-second
timeout and performed multiple reads before reauthorization.

## Local change

- Payment service interactive transactions now use a 30-second execution limit
  and a 10-second connection acquisition limit, scoped to this service.
- Submission reuses its duplicate-transfer lookup instead of repeating it.
- Session reauthorization stays inside the transaction. Provider HTTP requests
  remain outside it. Ledger constraints and idempotency are unchanged.
- Unexpected wallet submission/list/scan errors log `payment_request_error`
  with a support trace, operation, elapsed time and allowlisted database codes.
  No exception messages, receipt text, credentials or user identifiers are added
  by this logger. Existing third-party logging is unchanged.

## Verification

Disposable PostgreSQL on loopback only; no real provider calls or funds:

- Reproduced `P2028` by delaying a query beyond the old five-second limit.
- Delayed authorization by 5.5 seconds in each verification transaction; the
  updated flow credited exactly once and passed ledger reconciliation.
- Revoked authorization at either phase prevented credit and notifications.
- Five focused suites passed: 90 tests covering funding, authorization isolation,
  error redaction, webhook recovery and M-Pesa provider contracts.
- Typecheck and an isolated Next.js production Webpack build passed.

## Rollout and limits

This patch requires rebuilding/redeploying the web service and payment-processing
worker from matching code. It requires no new migration or environment flags.
It does not alter the separate prerequisites for enabling live payments.

After deployment, check the existing deposit's current status before retrying
verification. Do not send another transfer. A continued error needs the new
`payment_request_error` log and correlated server logs. Database latency/pooler
health and live provider behavior remain unverified; increasing the bounded
transaction budget does not fix infrastructure latency.
