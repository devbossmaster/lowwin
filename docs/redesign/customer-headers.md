# Customer headers and auction entry

Home owns its full Lowwin toolbar, including during route loading. Other customer destinations share one compact Back/title/language header. Existing authentication and query providers stay mounted. Page-specific duplicate headings were removed from Winners, My Bids, Profile, auction browsing and legal pages. Wallet and legacy links retain their existing redirects.

Back navigation uses account-scoped in-app history metadata, never browser history length or an external referrer. Direct entry falls back to Home. Home entry refreshes the authenticated wallet through the existing deduplicated private query layer; a return to an already-visited Home also refreshes server content in place. The existing loaded batches, filters and scroll memory are retained. Home toolbar polling ends when its page leaves.

The auction details layout uses the existing generated product artwork at **1840 × 800 px (2.3:1)**, with a reserved landscape image area and compact thumbnails. The four-part countdown still uses the existing server clock anchor and local ticks. Its fixed Bid action opens the existing sheet and shows the real submission fee. Rules come from the existing version-aware disclosure; no reference-site price, fake activity, deadline extension or winner-payment claim was added.

The payment sheet offers Chapa and Wallet in the [latest compact reference layout](bid-entry-polish.md). Wallet retains its real balance note, radio control and plus top-up action. Chapa uses the official self-hosted wordmark; its checkout handles merchant-enabled payment methods. Chapa variables and activation notes are in `.env.example`; real credentials and financial activation remain separate from this UI change.

## Verification

- Full typecheck passed.
- 78 focused checks passed across navigation, private cache, route loading, wallet formatting, exact public asset access, countdown anchors and payment client state.
- Browser flows passed at 360px and 430px in English and Amharic: direct-entry fallback; Home → Winners → My Bids → Profile → Home; Back; one header per page; centered titles; scroll restoration; no horizontal overflow; bid modal and top-up opening.
- While away from Home, advancing browser time 61 seconds produced no Home wallet polling. Returning produced one wallet refresh and retained the real 250.00 ETB fixture balance during a delayed response, without a false zero.
- Development auth bootstrap calls remained two before and after navigation; providers were not remounted. No bid or payment mutation was submitted, and the isolated fixture ledger reconciled without drift.

These are local Chromium checks with disposable PostgreSQL and synthetic account data. Physical Telegram WebViews and production latency are separate checks. No production deployment, payment activation, schema migration or customer cleanup was performed.

Reproduce with a migrated disposable loopback `TEST_DATABASE_URL` ending in `_test`:

```powershell
npx.cmd playwright test --config playwright.customer-headers.config.ts
```

The configuration keeps real payment switches disabled. Screenshots and sanitized assertion evidence are stored alongside this report; full browser reports and private staging setup files remain ignored.

- [Home, 360px](customer-headers/home-en-360.png)
- [Winners, Amharic, 430px](customer-headers/winners-am-430.png)
- [My Bids, 430px](customer-headers/my-bids-en-430.png)
- [Auction details, 430px](customer-headers/auction-en-430.png)
- [Payment choices, Amharic, 360px](bid-entry-polish/chapa-am-360.png)
- [Payment choices, English, 430px](bid-entry-polish/chapa-en-430.png)
- [360px assertions](customer-headers/evidence-360.json), [430px assertions](customer-headers/evidence-430.json)
