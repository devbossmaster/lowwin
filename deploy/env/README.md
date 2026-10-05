# LowWin Coolify environment templates

Create one Coolify resource per template and paste the matching variables into
its Environment Variables screen. Replace every `<...>` placeholder privately.
Never commit real values.

- For this fresh database, generate independent new auth, webhook, phone,
  delivery, MFA, and runtime-login secrets. Save them in a password manager and
  keep an encrypted off-server backup from day one.
- Use the restricted Supabase transaction-pool URL for `DATABASE_URL` and
  `DIRECT_URL` in normal application resources.
- Use the separate migration/owner URL only in a controlled migration terminal;
  never save it in an application resource.
- Keep payments disabled until migrations, reconciliation, the receiving
  account, and a small real verification are checked.

Register exactly
`https://lowwin.shop/api/payments/verify-et/webhook` in Verify.et. Do not use
`www.lowwin.shop`: the application redirects that host, and webhook deliveries
must receive a direct 2xx response. Save the endpoint's matching `whsec_` value
as `VERIFY_ET_WEBHOOK_SECRET` in both `lowwin-web` and
`lowwin-notifications`, then redeploy both resources. The API key stays the
same. During secret rotation, `VERIFY_ET_WEBHOOK_SECRET_PREVIOUS` may hold the
old secret for the documented 24-hour overlap. Confirm the endpoint is
`active` and its latest test delivery is HTTP 204.

The payment flow uses the inline Verify.et result when it finishes immediately,
the signed account webhook for queued completion, the notifications worker for
server-side status polling and reference replay, and the Mini App's local status
polling for visible updates. Keep `lowwin-notifications` running. Queued receipt
images require the webhook's full evidence to credit safely; if that evidence is
delayed, Lowwin keeps the request recoverable and moves it to review rather than
crediting from status alone.

New deposits support **Telebirr, CBE and M-Pesa**. Each channel keeps its own
receiving account, policies and verification references.
After deploying `lowwin-web` and `lowwin-notifications`, an Owner must configure
the M-Pesa wallet number and account holder under **Payments → Receiving accounts**,
review the quote, and enable it. The application never copies a CBE account into
M-Pesa. Use an Ethiopian wallet number (`07…`, `09…`, or `251…`) for Telebirr
and M-Pesa; CBE continues to use a bank account number. No database
migration or new environment variable is needed for this channel change. Check a
small real M-Pesa transfer before considering that channel verified in production.
