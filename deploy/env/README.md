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

The notifications worker also queues a bilingual upcoming-auction reminder once
per published auction when its start is less than 24 hours away. Existing players
receive it through the usual inbox/Telegram delivery flow; blocked chats are skipped.
The message includes the EAT start time, standard notification image, community
links and a View auction button. Sending rechecks the start time and auction status,
so expired or cancelled upcoming reminders are skipped. Deploy
`lowwin-notifications` for this behavior; no new environment variable or migration
is required.

The payment flow uses the inline Verify.et result when it finishes immediately,
the signed account webhook for queued completion, the notifications worker for
server-side status polling and reference replay, and the Mini App's local status
polling for visible updates. Keep `lowwin-notifications` running. Queued receipt
images require the webhook's full evidence to credit safely; if that evidence is
delayed, Lowwin keeps the request recoverable and moves it to review rather than
crediting from status alone.

New deposits support **Telebirr, CBE and M-Pesa**. Each channel keeps its own
receiving account, policies and verification references.
Deploy `lowwin-web` and `lowwin-notifications`, then run `npm run db:migrate`
using the migration database connection. The migration
`202610050001_mpesa_receiving_accounts` extends the database receiving-account
constraint to allow M-Pesa alongside Telebirr and CBE, preserving existing policies.
An Owner must then configure
the M-Pesa wallet number and account holder under **Payments → Receiving accounts**,
review the quote, and enable it. The application never copies a CBE account into
M-Pesa. Use an Ethiopian wallet number (`07…`, `09…`, or `251…`) for Telebirr
and M-Pesa; CBE continues to use a bank account number. No new environment
variable is needed for this channel change. Check a
small real M-Pesa transfer before considering that channel verified in production.

For incomplete deposits, an Owner or Payments Operator can use **Approve manually**
on the deposit details page. Check the actual receipt or receiving-account statement,
enter its exact amount and EAT transfer time, optionally add a note, confirm the checks,
and provide fresh MFA. Approval creates the usual balanced wallet journal, permanent
transaction claim, audit record and deposit notification in one transaction.
Already-used transaction IDs, credited deposits and active verification are blocked.
Receipt-derived deposits acquire the reviewed amount; legacy quoted deposits retain
their frozen amount. This approval feature requires no new migration or environment
variable. Redeploy the web app and notifications worker with the updated code.
Automatic M-Pesa and Telebirr deposits still require an amount in the provider evidence;
an HTTP 200 or a handled webhook without that amount does not credit a deposit.

Owners can remove a receiving account from **Money → Receiving accounts** after
confirming the selected account and fresh MFA. Removal creates a disabled policy
version and an immutable removal audit, so the channel disappears from new-deposit
options and the admin card returns to **Not added**. Historical deposit snapshots,
receipts and ledger records remain available. The account can be added again later.
No new migration is needed for receiving-account removal.

Receipt uploads send the original JPEG, PNG or WebP bytes to Verify.et after
validating the file, without cropping or resizing. The preview fits the whole image.
Customers should upload a full, readable payment screenshot, up to 5 MB.
