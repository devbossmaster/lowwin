# Compact customer surfaces — 10 November 2026

This follow-up preserves DM Sans, Noto Sans Ethiopic, Lowwin’s warm white/black/gold branding, authentication, auction economics and server-authoritative financial state. It adds no dependency, environment variable, index or migration.

## My Bids

Only accepted bids appear, in Live and Finished tabs. Expired auctions enter Finished even before the closing worker runs. Unpublished or unfinished outcomes say **Finalizing result**; only a published settlement identifies the exact winning bid. Stable bid IDs keep separate accepted numbers separate. Payment attempts remain in Transactions.

The owner-only list returns at most 20 rows plus `hasNext`. A single database statement includes the frozen title, thumbnail, chosen number and relevant outcome. It does not read account statistics, payment providers or receipt metadata. Keys include account, view, language and page. Obsolete requests are cancelled and private cache data is removed on account change/logout. Finalized rows do not poll; only visible Live/finalizing rows use the existing shared activity batch.

Rows open the existing bidding/result content directly in one stable sheet. Partial list projections are never stored as complete public detail responses. A publication refresh targets the affected private list and public auction/result queries, including an already-open result sheet.

## Wallet and top-up

The Home balance and Profile wallet arrow open Wallet; the separate + controls open Top up. Wallet shows the confirmed available balance, Top up and paginated history. There are no bonus panels, bonus presets or invented cash balances.

History is an authenticated, `private, no-store` projection of the owner’s confirmed ledger postings. It includes wallet deposits, wallet-funded bid fees, refunds and genuine available-funds changes. External accepted bid payments’ credit/fee transit postings are excluded because they never increased the spendable wallet balance. A paid bid that instead preserved funds in the wallet is labelled **Payment credited to wallet**. Coupon credits are folded into their linked wallet fee. Unpaid/failed provider attempts are not wallet movements.

Top up combines amount, bounded presets, enabled supported providers, explicitly entered payment phone and Pay. Selection alone never initiates payment. Phone normalization and method-specific validation are reused. The existing Chapa direct request, provider-requested OTP, authoritative verification, bounded polling and historical hosted recovery remain in use. No PIN field is introduced.

Confirmed terminal failure returns to the preserved draft; the next explicit Pay starts the new attempt. An interrupted initialization retains its frozen command and original idempotency key across sheet dismissal in the same browser tab. The account-scoped in-memory holder is removed on logout/account change, confirmation, definitive terminal outcome or safe explicit restart. Reopening restores an owned checkout with a read, never a new charge. Failed restoration exposes Check payment. No command is persisted in browser storage and no cached status fulfills a payment.

## Home and guest Profile

- Auction cards have tighter body spacing, a shared fee/timer row, a 44px Bid action and compact footer copy. Images retain their 1840:800 ratio. Titles wrap naturally without clipping, including long Amharic copy. View counts, status, countdown animation and actions remain.
- Recent Winners advances slowly and loops horizontally. It pauses offscreen, when hidden, on hover/touch/keyboard focus and while a result is open. A Pause control is available. Reduced motion keeps a manually scrollable original card set. Visual loop copies are excluded from keyboard/screen-reader navigation and open the same original result.
- The footer uses the supplied TikTok **@lowwinet** and Telegram **@lowwin23** links, responsibility/copyright copy, Terms and Privacy. Other bot/channel settings are unchanged.
- The signed-out account prompt is a readable vertical composition with one Login action and Browse auctions. Restoration does not flash the guest prompt.

## Measurements

These are local isolated measurements, not production/device or merchant-provider timings.

| My Bids read | Previous rich projection | Minimal projection |
| --- | ---: | ---: |
| Warm median, 7 runs / 62 fixture bids | 21.06ms | 6.97ms |
| SQL statements per list request | 7 | 1 |
| Serialized response | 9,920 bytes | 7,364 bytes |

The new query’s `EXPLAIN (ANALYZE, BUFFERS)` reported 1.063ms execution, 155 shared-buffer hits and no disk reads. Wallet history used one statement: 16.20ms warm median over seven runs with 45 fixture journals; its execution plan reported 2.482ms execution, 304 shared-buffer hits and no disk reads. These small fixtures do not establish large-production capacity; no speculative index was added.

For the same short-title LIVE card at 320/360/430px, measured height decreased **8.1–10.0%** across English/Amharic (approximately 32–34px). Image ratio and readable text remain unchanged; the Bid button is 44px. Stress titles intentionally grow instead of clipping. Different-title fixtures are not used for before/after percentages.

The 360px synthetic browser sample recorded 2,397ms first content / 84ms cached tab / 350ms navigation round trip before, and 798ms / 87ms / 274ms in the final isolated sample. Initial private reads fell from two (list plus unnecessary Profile) to one list request; cached tab switching and repeat navigation performed zero extra reads. These are individual local observations with mocked list responses and real isolated authentication; server warmth and scheduling may differ. They are not a production latency guarantee or evidence that Chapa authorization became faster.

## Verification and limits

Run browser checks against an isolated optimized build with fake integrations and a disposable loopback PostgreSQL database ending in `_test`:

```sh
npx playwright test -c playwright.my-bids-compact.config.ts
npx playwright test -c playwright.wallet-sheet.config.ts
npx playwright test -c playwright.home-polish.config.ts
npx playwright test -c playwright.auction-card-density.config.ts
```

Recorded backend checks: My Bids **6 passed**, Wallet history **7 passed**, and the clean personal-data regression **13 passed**. Frontend/cache/navigation checks passed **61 tests**. The retention/payment-client/progress/private-cache group passed **52 tests**. Counts overlap between groups and are not a deduplicated whole-repository total.

Final browser confirmation:

- My Bids: **15 distinct scenarios passed**, including English/Amharic at 320/360/430px, cached navigation, preserved rows after refresh errors, account clearing, one stable sheet through a cold detail load, Back behavior, and an open finalizing result updating on the existing activity batch.
- Wallet/top-up: **9 passed**, covering all three widths/languages, confirmed history, provider/phone validation, close/reopen with the same interrupted command, explicit fresh-key terminal retry, OTP, restored-status failure recovery and authoritative credit.
- Home: **7 passed**, including automatic scrolling, pause/loop/reduced motion, exact supplied social destinations, guest prompts and guest-private-request exclusion.
- Header/Winners regression: **17 passed**, with one intentional duplicate administrator scenario skipped at the narrower project and executed at the desktop administrator viewport in the other project.
- Auction cards: **6 passed** for the unchanged final card source, covering both languages at all requested widths, rendered media, natural title wrapping, aligned fee/timer, countdown updates, actions and focus.
- Installed Next.js optimized production build and its TypeScript check passed. The later bot-only change also passed the full no-emit typecheck. Whitespace checks passed.

## Telegram welcome banner follow-up

The current `/start` welcome now uses the existing Home banner in the recipient’s English/Amharic language, with the same caption and single Open Lowwin button. Referral and payment-return destinations are unchanged. The existing helper uploads a cached public JPEG as `InputFile`, avoiding a protected/relative URL or unsupported image format. It falls back to text on missing artwork or a definitive rejected photo; an uncertain transport failure does not trigger a duplicate welcome.

Both real local banner assets were converted and checked at 1400×760, approximately 155–162KiB. **18 mocked Telegram tests passed**, along with the full no-emit typecheck. This code is consumed by the bot worker scripts, not the Next.js route graph. The running production bot has not been changed; its worker must use the reviewed source for the welcome image to appear.

Provider responses are mocked for UI/payment-state tests. No live payment, real Telegram delivery, production database access, migration, deployment or merge was performed. Actual Chapa/USSD authorization and network latency require separate merchant/device checks; no provider-speed improvement is claimed from local mocks.
