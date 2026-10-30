# Winner announcements

When a genuine auction is settled with a winner, Recent Winners and the result sheet automatically show a Lowwin banner. The product image sits on the right; the title and authoritative winning number/amount appear on the left. The banner uses the existing masked identity policy and never selects a winner from a countdown.

After collecting a real winner photograph:

1. Open **Admin → Winners → Details → Winner photo**.
2. Choose a JPEG, PNG or WebP file up to 2 MiB. A portrait or prize-handover photo fits the right side; leave space around the person.
3. Confirm the winner agreed to public use, then select **Publish winner photo**.
4. Use the same form to replace it later, or choose **Use product image again**.

Photo edits are stored separately from the auction and immutable settlement. They require current staff authorization, consent, a matching record version and an audit record. Dedicated winner-photo assets cannot be reused as catalog or broadcast images. Winner-only media is checked on every read and is not placed in the immutable public product-image cache.

The banner is a responsive Mini App composition, not an automatically generated downloadable poster. Existing Telegram auction alerts still send the product image and their concise caption.

## Deployment

Apply the additive `202610300003_winner_presentation` migration with the existing owner migration connection before starting the updated WEB application. Generate Prisma client during the build. This change adds no environment variable and does not modify any payment, balance or settled result. It has only been applied to isolated local test databases during implementation.

Chapa remains on v2. To request Telebirr first for **new** checkouts, set this runtime variable on WEB after deploying the reviewed code:

```ini
CHAPA_PREFERRED_PAYMENT_METHODS=telebirr,cbebirr,mpesa,awashbirr
```

These are the four enabled methods reported by the merchant's live catalog. CBE Bank transfer was not returned. Method limits still apply: Telebirr/CBE Birr start at 1 ETB, M-Pesa at 5 ETB and Awashbirr at 10 ETB in that snapshot. A short-lived merchant catalog validates capabilities before preferences are saved on a new attempt. Cold/unavailable catalogs keep the working minimal request. Existing payment attempts preserve their original request and order. Chapa controls the final hosted layout; optional-field acceptance and visual ordering still need merchant checkout confirmation.
