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

The Verify.et receiver is available at `https://lowwin.shop/webhooks/verify`
after deploying this version of `lowwin-web`. The existing
`/api/payments/verify-et/webhook` URL remains supported by the same handler.
Register only the URL you intend to use. If switching to a new endpoint, save
its matching `whsec_` value in `VERIFY_ET_WEBHOOK_SECRET` and redeploy before
sending a dashboard test; the API key can stay the same. During the switch,
`VERIFY_ET_WEBHOOK_SECRET_PREVIOUS` can hold the old secret until the old
endpoint is retired. Confirm a successful provider test and `active` status.
Changing the path does not resolve provider deliveries stuck at zero attempts.
