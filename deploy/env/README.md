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
