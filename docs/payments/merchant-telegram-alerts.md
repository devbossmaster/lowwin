# Merchant payment alerts

Set the optional runtime variable `CHAPA_PAYMENT_ALERT_TELEGRAM_ID` to your numeric private Telegram ID on WEB, the Chapa worker and the notification worker. The recipient must have started the same Lowwin bot. Find the ID in Admin → Players → Details, or run this read-only command in the deployed WEB terminal:

```sh
npx --no-install tsx scripts/check-chapa-payment-alert.ts --username cryptonbozz
```

Use its `telegramId` value, not the username or phone number. Redeploy matching services. Empty or invalid configuration disables merchant alerts; groups are not supported. No schema migration is required.

Each newly committed verified Chapa receipt queues a separate merchant alert in the existing transaction and durable receipt queue. The message identifies the amount, deposit/bid outcome, merchant reference and Chapa reference. It excludes the customer's phone, email and private bid amount. TEST payments carry an explicit TEST label. The admin link still requires normal admin authentication.

Pending, failed and mismatched payments do not trigger alerts. Wallet-funded bids do not create an incoming Chapa payment. Replayed verification deduplicates the outbox key; Telegram retries cannot credit money. As with existing customer receipts, a crash between Telegram accepting a message and recording delivery can repeat a message. Removed/changed recipients are rechecked before sending. Configuration is prospective: old payments are not backfilled.

The payment selector shows telebirr, M-Pesa and CBE Birr together as one Chapa hosted-checkout choice. Selecting the combined button opens the existing checkout; Chapa still determines method availability and limits.
