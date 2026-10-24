# Direct bid payments and the staff workspace

This update supersedes the original Deposit navigation and customer wallet brief. Registered customers keep their existing Telegram identity and verified-contact relationship. No hosted database has been reset, cleaned or migrated by this follow-up.

## Customer workflow

Choose a number → review the frozen auction terms and actual submission fee → choose Telebirr or M-PESA → confirm on the provider → wait for server verification. A browser return, USSD initiation, screenshot or pending status never confirms payment or entry.

Profile no longer displays balances. `/payments` contains only the signed-in customer's ArifPay orders. The old `/wallet` link redirects there; old wallet credit alerts are hidden without deleting their records. The account bootstrap, profile and bid-state responses no longer query or expose customer wallets. New wallet-funded bid submissions and wallet/receiving-detail reads return 410. The direct checkout is offered regardless of an old balance. Earlier rules remain frozen and new entries into those auctions are read-only.

The customer bid and payment receipts omit wallet projections. The append-only ledger, immutable historical receipts and verified-transfer recovery remain internal so staff can investigate unresolved payments and reconcile existing records. ArifPay still uses the existing verified credit-plus-fee-debit transaction internally; an accepted payment leaves no new spendable balance. An unsuccessful bid after confirmed payment remains a restricted review case. This screen does not promise a refund or a later wallet-funded entry.

ArifPay remains disabled. Do not release wallet retirement to general customer traffic until the merchant contract, provider verification and canary have passed. With direct checkout disabled, new entries are unavailable.

## Admin workflow

- **Payments → Bid payments** is the primary workspace. It has bounded search/pagination, truthful pending/review/accepted counts, Telebirr/M-PESA and status filters, and individual payment details. The stored fee and chosen number are shown separately.
- **Overview** reports verified fees associated with accepted bids, including EAT daily totals. Pending/review payments, old wallet deposits, staff, demos and enrolled test identities are excluded from fee totals. An unavailable schema or query is not reported as a zero total.
- Owners, payment operators, auditors and support can inspect direct payments. Support receives no provider session/reference identifiers. The DTO never exposes encrypted payer contact, nonces, request/evidence hashes, raw provider payloads or stored wallet receipts.
- Only Owners and payment operators can request a provider check. It requires same-origin submission, fresh MFA, an identity rate limit, an audited idempotent request and reauthorization inside the existing verification transactions. Access is checked again after provider HTTP and before financial writes. Existing amount, ownership, reference, duplicate, lease, bid deadline and ledger checks remain authoritative.
- There is no manual “mark paid”, credit or refund action in direct payments. The payment and accepted-bid outcome must come from the existing server command. Needs-review cases explicitly require investigation.
- **Players** focuses on verified identity, activity and bidding access. It no longer queries or displays balances. Existing accounts and suspension permissions are preserved.
- **Legacy transfers / Legacy receiving accounts** retain historical investigation and recovery. **Ledger checks** remains an authorized, read-only reconciliation report. Legacy data is not removed to simplify navigation.

Staff surfaces use the Lowin logo, warm neutral canvas, readable near-black text and gold ordinary actions. The staff workspace's operational copy remains English; customer flows are bilingual. Existing staff authentication, MFA, role boundaries and audit access remain in force.

## Verification

The [complete final test run](screenshots/walletless/verification.json) passed **865/865 cases across 84 files**, with no skips. Coverage includes real credential-plus-MFA staff sessions, role denial, CSRF rejection, accepted-fee reporting, merchant-evidence validation, revoked access during provider HTTP, all frozen auction versions, server authorization, legacy recovery and ledger invariants.

Typecheck passes in the reviewed source checkout and the user's running checkout. The optimized Next.js 16.4.2 webpack build passes. The [dependency audit](screenshots/walletless/security-audit.json) reports zero vulnerabilities. [Read-only reconciliation](screenshots/walletless/reconciliation.json) reports zero ledger or payment discrepancies in all 11 fresh disposable local databases from the final safety run.

The [16 passing mobile browser scenarios](screenshots/walletless/browser-results.json) exercise 360px/430px English/Amharic screens, contact-gated sign-in, retries, safe disabled checkout with both old funded and empty accounts, real historical bid receipts, profile editing, notifications, deep links and wallet retirement. Channel/pending/review rendering uses explicit transport fixtures; it is not a real provider payment. The [passing admin browser check](screenshots/admin-direct/browser-results.json) uses real local staff login and TOTP, plus synthetic pending/review records, at 360px, 430px and 1440px.

### Screens

| Customer screen | 360px | 430px |
| --- | --- | --- |
| Profile | [English](screenshots/walletless/profile-360-en-viewport.png), [Amharic](screenshots/walletless/profile-360-am-viewport.png) | [English](screenshots/walletless/profile-430-en-viewport.png), [Amharic](screenshots/walletless/profile-430-am-viewport.png) |
| Bid payment history | [Capture](screenshots/walletless/bid-payments-360-en-viewport.png) | [Capture](screenshots/walletless/bid-payments-430-en-viewport.png) |
| Number and fee sheet | [Capture](screenshots/walletless/bid-sheet-360-en.png) | [Capture](screenshots/walletless/bid-sheet-430-en.png) |
| Telebirr / M-PESA | [Transport fixture](screenshots/walletless/checkout-options-fixture-360.png) | [Transport fixture](screenshots/walletless/checkout-options-fixture-430.png) |
| Pending payment | [Transport fixture](screenshots/walletless/checkout-pending-fixture-360.png) | [Transport fixture](screenshots/walletless/checkout-pending-fixture-430.png) |
| Needs review | [Transport fixture](screenshots/walletless/checkout-review-fixture-360.png) | [Transport fixture](screenshots/walletless/checkout-review-fixture-430.png) |

Admin captures and browser results are in [screenshots/admin-direct](screenshots/admin-direct). Earlier before/after captures remain unchanged for comparison. Their wallet-funded confirmations describe the earlier implementation and are superseded by this update.

### Speed evidence

[360px observations](screenshots/walletless/timings-360.json) and [430px observations](screenshots/walletless/timings-430.json) are optimized Chromium measurements on loopback. They include launch, Home/navigation and 20-request p95 samples. Slow-network samples simulate 150ms latency and 1.28Mbps down/600kbps up with browser cache disabled. Final samples were collected while the local safety suite was also running. They are not physical Telegram or production measurements. Direct provider confirmation/verification latency and production API p95 remain unmeasured; no fabricated success timing is substituted.

| Final local observation | 360px | 430px |
| --- | ---: | ---: |
| Authenticated launch | 2,181ms | 1,582ms |
| Home render | 1,487ms | 1,225ms |
| Simulated slow-network Home | 2,701ms | 2,828ms |
| Client navigation to My Bids | 625ms | 641ms |
| Account API p95, 20 samples | 29ms | 31ms |
| Alerts API p95, 20 samples | 29ms | 30ms |
| Auction API p95, 20 samples | 35ms | 37ms |

Follow the [staging, canary and rollback procedure](release.md). Real ArifPay merchant acceptance, physical Android/iOS Telegram keyboards/safe areas, production latency and the published Terms/Privacy review remain release gates. Deployment and irreversible changes remain separately reviewable.
