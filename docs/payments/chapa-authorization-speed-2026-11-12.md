# V2 authorization speed and original-attempt recovery

This follow-up keeps the existing Lowwin checkout and Chapa v2 Inline protocol. The user reports adding `CHAPA_PUBLIC_KEY` to the deployment. That supersedes the earlier missing-key report, but effective WEB/worker configuration and physical-phone authorization timing have not been independently verified here.

## Changes

- Initial Inline preparation acquires the maintenance barrier, auction lock and account wallet lock once, in the same order as the other financial writers. Bid validation reuses those held locks. Contact/session eligibility, restrictions, rate limits, amount limits, immutable quotes, coupons, deadlines and competing-payment checks remain authoritative.
- An interrupted Inline initialization reply now automatically discovers the **original** owned intent through a read-only key lookup. A briefly missing row can still be committing; a 404 does not become a failed payment. Discovery hands the owned ID to the existing verification observer, then stops. It cannot initialize or charge another payment.
- Discovery uses bounded backoff, at most eight reads and a 30-second visible observation budget. It pauses while hidden, resumes on foreground/online events and discards obsolete account responses. Once its budget is exhausted, the original operation remains available for safe checking/recovery; no new key is generated automatically.
- Confirmed initialization responses no longer repeat the cache invalidation already performed by the shared completion handler.
- Removed red input-border overrides and outer input focus rings in bid checkout, top-up, provider phone and OTP fields. Error text and `aria-invalid` remain; focused fields use a subtle neutral border and payment selection remains gold. The user's manual `payment-progress.tsx` edit was preserved.
- Removed the checkout's top social-links block, including the Telegram/TikTok icons, heading and unused styles.

Initialization still persists its intent before provider HTTP, with a stable idempotency key, integer cents and a merchant reference within 20 characters. Provider HTTP stays outside financial transactions. USSD polling uses the original reference; OTP is requested only when required by Chapa, and Lowwin never requests a wallet PIN. Fulfillment still requires private verification with matching owner, reference, amount, currency and environment, followed by committed bid acceptance or wallet credit.

The complete official [v2 Inline](https://docs.chapa.global/docs/v2/integrations/inline-js) and [Verify Payments](https://docs.chapa.global/docs/v2/integrations/verify-payment) pages were re-read for this follow-up. Inline initialization and validation use the documented public-key API; fulfillment uses private-key verification. This update does not change the previously reviewed merchant webhook signature profile.

## Measured local comparison

The ignored `.local/measure-inline-preparation.ts` harness compares the captured pre-change Inline service with the updated service against the same isolated local PostgreSQL instance. Seven paired samples alternate execution order; discard the first pair and report the median of six warm samples. Provider calls are deterministic fixtures; no Chapa network request or live payment is made.

| Metric | Before | After |
| --- | ---: | ---: |
| SQL statements per initial bid Inline command | 28 | 24 |
| Auction lock acquisitions | 2 | 1 |
| Wallet lock acquisitions | 2 | 1 |
| Warm service preparation until provider dispatch | 43.72 ms | 36.69 ms |
| Warm service total with fixture provider response | 50.50 ms | 43.32 ms |

Preparation improved **16.1%** in this local sample; four database statements were removed. These numbers exclude the separate quote request, HTTP/session authentication and optional session-reauthorization callback SQL, real capability/network latency, Chapa processing and physical USSD arrival. The separate quote remains necessary for a new bid selection in the current flow; top-up already initializes through one payment command. This is not a production p95 or a guarantee about phone prompts.

Durations and SQL counts are recorded in `.local/inline-authorization-speed.jsonl`. The existing `Server-Timing` header now also separates lock acquisition and bid pricing inside Inline preparation, alongside authentication, capabilities, dispatch, initialization and durable persistence. It contains no keys, phone numbers or OTPs.

## Validation

- **123 focused unit/service tests passed** across 12 suites, including original-key discovery, expiry/terminal precedence, polling, provider contracts, wallet recovery and timing. The new discovery helper covers pre-commit 404s, transient errors, access denial, bounded reads, hidden/resume, one-flight operation and account cleanup.
- **16 isolated real-PostgreSQL Inline cases passed**, including concurrent same-key creation, private evidence mismatches, duplicate settlement, OTP, late success and wallet/external exclusion. Database log: `.local/chapa-inline-database.log`.
- The standalone full typecheck passed. The final isolated production webpack build, including TypeScript, **completed with exit code zero** in `.local/reference-bid-build.log`.
- **19 production-mode browser checks passed**, with 14 intentional duplicate-project skips, across 320px, 360px and 430px in English/Amharic. There were zero unexpected failures or flaky cases. The run exercised method selection, validation, duplicate taps, outstanding authorization past 90 seconds, hidden/resume, cancellation, OTP, top-up credit and wallet independence. Final cases also checked social-link removal and computed neutral field focus/invalid styles.
- With an interrupted initialization reply and one synthetic pre-commit 404, automatic bid authorization recovery measured **2,017 ms**, and top-up recovery **1,988 ms**. Each used one initialization and two read-only original-key lookups, with no manual Check or fresh charge. These are simulated browser-recovery measurements; physical USSD arrival was not measured.

The first browser attempt used stale `.next-ui-chapa` output while the new code had been built into `.next`; its two new recovery assertions failed against that older bundle. Rebuilding the correct isolated output and repeating all 33 enumerated cases produced the final 19-pass/14-skip result above. An earlier ordinary build completed compilation, TypeScript and output generation but its PowerShell wrapper reported exit one after treating Prisma's informational stderr as a native error. The final isolated build used direct process exit-code capture and returned zero. These earlier runs are not counted as successful validation.

The browser report is `.local/authorization-browser-results.json`; it contains the synthetic recovery attachments and final statistics. The local test servers and PostgreSQL instance were stopped after validation. No production mutation, live payment, deployment, merge, migration or environment-setting change was performed.
