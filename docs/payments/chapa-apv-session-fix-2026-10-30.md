# Chapa hosted sessions and final payment references

This follow-up supersedes the earlier APV/APW-only compatibility fix. That fix
addressed one observed prefix but did not establish the correct boundary between
a checkout session and a final payment reference.

## Confirmed cause and follow-up

The original read-only production diagnostic showed a stored `APV…` token from
`/payment/hosted/APV…` being compared with the final reference returned by
merchant-authenticated v2 verification. Merchant reference, principal amount and
currency matched, but that reference comparison failed. The response omitted
mode; the checkout remained bound to its stored live credential configuration.
Metadata was absent, and the minimal initialization required no supplementary
metadata.

The user subsequently confirmed that this original APV payment became
`CREDITED`. Three further reviewed payments exposed the same issue with
`APQ…`, `APU…` and `APt…` session tokens. In each diagnostic, the stored token
exactly matched the official checkout URL's tail, and Chapa returned `SUCCESS`.
All other verification predicates passed; only the session-versus-final-reference
comparison failed. These examples are shortened here rather than publishing
complete checkout tokens.

The error was treating a checkout URL tail as final payment evidence. Enumerating
another third character would repeat that mistake.

## Durable correction

For every **new initialization**, preserve Chapa's validated checkout URL but
leave the final Chapa payment reference unbound. This applies even if a future
checkout URL uses an unfamiliar token prefix. Neither initialization nor a
pending or otherwise non-`SUCCESS` verification response binds the final
reference. Only a successfully matched v2 `/verify` response can supply it through
the existing controlled completion transaction.

For **historical rows** that already stored a live session token, recognize the
observed official session family rather than a third-letter enumeration:

```text
HTTPS host: checkout.chapa.global
Path family: /payment/hosted/AP[A-Za-z0-9_-]+
Prefix: case-sensitive AP; the following token characters may vary
```

The historical exception still requires the stored token to equal the validated
URL's final path segment exactly. The payment must remain bound to its live
credential configuration. The database guard permits the controlled transition
only with a matching canonical verified `CHAPA_RECEIPT` journal; arbitrary
reference replacement is not allowed.

The correction preserves:

- Exact frozen merchant reference, principal amount, currency, credential/mode
  binding and applicable historical initialization metadata.
- Final verified reference and `SUCCESS` before credit.
- Final-reference uniqueness, transaction locks, balanced journals, owned access
  and idempotent fulfillment.
- Existing initialization snapshots, finalized references and financial history.
  There is no manual paid-state override or balance cleanup.

Chapa v2 accepts a merchant reference or Chapa reference for server verification
and requires matching transaction data before fulfillment.
[Official verification documentation](https://docs.chapa.global/docs/v2/integrations/verify-payment).
Receipts should be produced from verified server-side payment data and applied
idempotently.
[Official receipt documentation](https://docs.chapa.global/docs/v2/integrations/payment-receipt).
The checkout URL itself must be used as returned.
[Official hosted checkout documentation](https://docs.chapa.global/docs/v2/integrations/accept-payment).

## Deployment and rechecking the three existing payments

1. Apply the additive Prisma migration
   `202610300002_chapa_hosted_session_family` from the reviewed commit, using the
   migration connection (`DIRECT_URL`):

   ```sh
   npm run db:migrate
   ```

   Preserve all earlier migration files, including the already-applied
   `202610300001_chapa_apv_hosted_session`, unchanged. The session-family
   correction is a new migration, not a rewrite of applied history.

2. Redeploy **both the Lowwin web service and Chapa worker** from that same
   commit. Keep their existing matching production configuration. This change
   introduces no new payment key, webhook secret or environment variable.
3. Reopen each of the three existing owned transactions in Lowwin so its
   automatic check verifies the same merchant reference again. Alternatively,
   resend each existing payment's webhook once.
   **Do not create or pay another checkout to test this correction.**
4. Confirm each top-up becomes `CREDITED`, or each eligible bid becomes
   `BID_ACCEPTED` with its receipt. If a paid bid can no longer be accepted, its
   funds must remain in the wallet under the existing late-payment rules.
5. Confirm one credit journal per checkout. Rechecking or duplicate delivery must
   return the applied result without a second credit.

After normal verification has processed an existing owned payment, inspect its
saved outcome without applying funds:

```sh
npx --no-install tsx scripts/check-chapa-checkout.ts --checkout <original-checkout-id> --provider
```

This diagnostic reads the saved checkout and Chapa response; it does not credit
the payment.

## Validation boundary

Current local checks:

- 117 provider, API/webhook, metadata, event and recovery-binding tests passed.
- 52 financial checkout and schema tests passed against disposable loopback
  PostgreSQL databases with mocked Chapa. Cases include APQ/APU/APt, new opaque
  URLs, changing provisional references, historical session recovery, concurrent
  verification, late bids, account isolation and exactly one balanced receipt.
- 84 return-link, navigation, client-cache, polling, status and authentication
  return-path unit tests passed. These do not exercise Chapa's hosted receipt UI.
- The production webpack build and standalone TypeScript check passed. The initial disk-space failure was
  resolved by stopping and removing generated disposable database fixtures.
- The new SQL function differs from the previous migration only in the observed
  AP-family matcher; all canonical-receipt and immutability clauses remain.

The first APV payment's `CREDITED` outcome was confirmed by the user. The three
later payments' completion after deploying this session-family correction remains
unverified. Results from the earlier APV/APW-only fix are separate from the
current validation above.

Other evidence or configuration failures remain blocked. A webhook HTTP 200,
provider receipt screen or local test result alone does not establish Lowwin
fulfillment. No production migration, payment or balance change was performed as
part of this documentation update.

## Receipt-page return boundary

New snapshots already send the documented individual HTTPS `return_url` with
`returnUrlVersion: 1`. It carries only the checkout ID. Once Chapa navigates to
that URL, the existing handler launches the configured Telegram Main Mini App,
checks ownership and restores the original bid or top-up modal. The modal then
verifies automatically and refreshes the affected private queries.

The user reports remaining on Chapa's receipt page. Lowwin cannot execute its
return handler while the browser stays on that provider page. Confirm the saved
Chapa LIVE redirect-delay setting and that the actual initialization included its
individual return URL. A webhook is a server notification and cannot navigate the
customer's browser. Actual provider receipt-to-Mini-App navigation remains an
acceptance check; passing unit tests does not certify it.
