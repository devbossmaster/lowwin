# Chapa APV hosted-session compatibility

## Confirmed cause

A read-only production diagnostic showed that an older checkout stored an
`APV…` token from the exact `/payment/hosted/APV…` checkout URL as its Chapa
reference. The merchant-authenticated v2 verification response returned the final
payment reference instead. Its merchant reference, amount and currency matched
the persisted payment, but the reference comparison failed. The response omitted
mode; the checkout remained bound to its stored live credential configuration.
Metadata was absent, and the minimal initialization required no supplementary
metadata. Lowwin therefore left the payment in `NEEDS_REVIEW` without applying
credit.

The existing live hosted-session compatibility recognized `APW…`, but omitted
the observed `APV…` form. Changing the modal or receiving webhook HTTP 200 could
not resolve that server-side mismatch.

## Focused correction

Recognize both observed live hosted-session prefixes, `APV` and `APW`, in the
provider adapter and the matching database immutability guard. New APV checkout
URLs identify a session until verification supplies the final payment reference.
Historical APV rows can complete through the existing controlled verification
path without editing their initialization snapshots.

This exception remains narrow:

- The URL must pass the existing HTTPS and exact `checkout.chapa.global` host
  checks, and use the recognized live hosted-session path.
- The stored token must exactly equal that URL's final path segment, with the
  checkout bound to live mode. Arbitrary reference differences are rejected.
- Verification must still match the frozen merchant reference, exact principal
  amount, currency, credential/mode binding and applicable initialization metadata.
- Credit requires the final verified payment reference and `SUCCESS`. Existing
  reference uniqueness, transaction locks, balanced journals, ownership checks
  and idempotent fulfillment remain in force.
- Finalized payment references, customer balances and existing audit records are
  not rewritten by a data cleanup or manual paid-state override.

Chapa v2 accepts a merchant reference or Chapa reference for server verification;
fulfillment still requires a successful payment and matching transaction data.
[Official verification documentation](https://docs.chapa.global/docs/v2/integrations/verify-payment).
The hosted checkout guide requires using the returned checkout URL directly.
[Official hosted checkout documentation](https://docs.chapa.global/docs/v2/integrations/accept-payment).

## Deployment and same-payment check

1. Deploy the reviewed commit and apply the additive Prisma migration
   `202610300001_chapa_apv_hosted_session` using the migration connection
   (`DIRECT_URL`):

   ```sh
   npm run db:migrate
   ```

2. Redeploy the Lowwin web service and Chapa worker from that same commit. Keep
   their existing matching production configuration; this fix introduces no new
   payment key, webhook secret or environment variable.
3. Reopen the original owned transaction in Lowwin so its automatic check verifies
   the existing merchant reference again. Alternatively, resend that existing
   payment's webhook once. **Do not create or pay another checkout.**
4. Confirm the original top-up becomes `CREDITED`, or the original bid becomes
   `BID_ACCEPTED` with its receipt. If a paid bid can no longer be accepted, its
   funds must remain in the wallet under the existing late-payment rules.
5. Confirm only one credit journal exists for that checkout. A second check or
   duplicate delivery must return the same applied result without another credit.

The correction does not establish that every review state has the same cause.
Other failed evidence or configuration checks remain blocked. Actual production
completion and Telegram return after deployment still require confirmation;
webhook acceptance and local test results alone do not prove fulfillment.

## Local validation

- 110 provider, HTTP/webhook, metadata, event and credential-recovery tests passed.
- 45 checkout and schema tests passed against freshly created loopback PostgreSQL
  databases with mocked Chapa. These include new and historical APV/APW sessions,
  exact-money and immutable-intent rejection, concurrent confirmation, duplicate
  delivery, late bid payments, account isolation and balanced-receipt checks.
- The new migration preserves the prior function body except for permitting
  `APV` alongside `APW`; earlier migrations and existing rows remain unchanged.
- The production webpack build and standalone TypeScript check passed.

After normal verification processes the existing owned payment, inspect its saved
outcome without creating or crediting another payment:

```sh
npx --no-install tsx scripts/check-chapa-checkout.ts --checkout 18f72278-8fab-4aff-9507-0943b955a6c2 --provider
```

This diagnostic only reads the saved checkout and Chapa response; running it does
not apply funds. No production migration, payment or balance change was performed
as part of local validation.
