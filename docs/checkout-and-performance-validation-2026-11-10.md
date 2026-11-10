# Checkout and performance validation — 10 November 2026

This change covers notification delivery, managed image renditions, the My Bids inline countdown, Transactions, and the requested two-step bid checkout/status presentation. No production database, payment, broadcast, migration, merge or deployment was performed. Existing auction economics, authentication, provider verification and ledger commit rules remain authoritative.

## Transactions: actual repeat-loading cause

The previous production build made one initial history GET and zero additional history GETs on immediate repeat navigation. Simultaneous same-key deduplication was already working. Three foreground events spaced 180 ms apart (visibility, focus, online) each forced another GET after the previous 60 ms mocked response completed. History inherited the five-second wallet policy. The trace also captured the route skeleton before the first populated list; it did not establish a duplicate initial GET or a production Strict Mode issue.

History now has finite 30-second freshness and ten-minute retention. Foreground event bursts are coalesced; financial mutations and manual refresh still invalidate immediately. Wallet keeps its five-second freshness and foreground refresh behavior. Cached rows remain visible during a stale refresh. The header owns the single refresh control, with in-place busy feedback; there is no separate refresh row or updating banner that shifts the list.

| Optimized production browser scenario | Before | After |
| --- | ---: | ---: |
| First history GETs | 1 | 1 |
| Immediate repeat-navigation history GETs | 0 | 0 |
| Three spaced resume events while history is fresh | 3 | 0 |
| Manual refresh history GETs | 1 | 1 |
| Resume after 31 seconds, with cached rows retained | not sampled | 1 |
| First populated list, local sample | 908 ms | 821 ms |
| Cached repeat navigation, local sample | 477 ms | 481 ms |

These are individual local Chromium samples, with an isolated PostgreSQL authentication fixture and history responses mocked to the same 60 ms latency. Request-count reductions are demonstrated; the timings do not establish faster production navigation. Browser traces, screenshots and JSON are under `test-results/transactions-performance/` and `test-results/transactions-traces/`.

The new owner-only `/api/transactions` projection combines Chapa attempts and committed wallet bid fees. A single globally paginated SQL query applies type/search filters before selecting 20 rows. External batch child bid fees are excluded from wallet rows, preventing duplicates. The list omits contact data, full receipts and technical references. Wallet details have a separate owner-only read; Chapa details reuse the existing owned checkout/status hook. Both APIs retain private/no-store response headers and server authorization.

The isolated 22-row mixed-source fixture returned its first page in 70.4 ms and warm pages in 6.5–7.2 ms. Its actual `EXPLAIN (ANALYZE, BUFFERS)` reported 1.265 ms execution, 37 shared hits and zero reads. These small local fixtures do not predict production scale; no speculative index or schema change was added.

Done/Failed require committed or verified terminal evidence. A transport timeout, closed checkout or provider success awaiting bid acceptance remains unconfirmed. Amount signs reflect committed movement. Test payments retain a visible Test label. Sanitized provider reasons, masked phone, copyable reference and timestamps stay in the details sheet. No bonus or unimplemented transaction-type controls were introduced.

Retry first reconciles the original owned attempt. Only a safe terminal response opens an editable checkout, without charging. The same native sheet stays mounted through that transition, avoiding the previous sheet-history cleanup dismissing the replacement. Current-tab retry drafts preserve amount, method and phone in bounded, account-scoped memory for ten minutes; logout/account changes clear them. For historical payments without a retained draft, a masked phone cannot reconstruct the original full payer number, so it must be entered again. Bid retry refreshes its quote before explicit Pay. Unresolved outcomes retain their original operation and recovery behavior.

## Other measured changes

- **Notifications:** one authoritative gate per actual HTTP attempt, compact current-state checks, bounded preparation/media caches, unchanged concurrency/rates and personal priority. Identical simulated 60-second windows reduced SQL statements/send from 34.71 to 19.94 (42.6%). Throughput was 13.70 versus 13.65 sends/second: no throughput increase was demonstrated. Personal tail latency worsened in this sample. See [notification measurements](notification-delivery-validation.md).
- **Images:** preserved original references and bytes, added finite versioned WebP renditions and responsive thumbnail sources. The two tested banners used 93–97% fewer bytes; thumbnails used 99.7–99.8% fewer. Conditional responses returned real 304s. Private access and winner consent/revocation remained checked. Browser disk-cache hits were not observed on local self-signed HTTPS, and cold generation has a cost. See [image measurements](media-rendition-validation.md).
- **My Bids:** one inline text timer replaces 32 nested timer elements; 5.2-second tick samples fell from 35 DOM mutations to 10, with zero timer network requests. Server-relative timing, visibility recovery, nonnegative expiry and deduplicated refresh remain. See [countdown and checkout evidence](redesign/compact-bids-checkout-2026-11-10.md).
- **Bid checkout:** two short steps in one sheet; Continue validates only, including a still-typed valid amount. Final Pay alone uses the existing wallet/Chapa command. One centered progress surface follows backend state, preserves provider-requested OTP and never collects a wallet PIN. Confirmed terminal retry preserves the draft; interrupted responses retry the original key or wallet quote. An authoritative changed quote was checked at 2 × ETB 12.00 = ETB 24.00 before Pay.

## Checks actually completed

- Final optimized Next.js production build passed, including its TypeScript check; standalone full typecheck also passed.
- 24 distinct production-mode browser cases passed: eight Transactions cases, seven countdown cases and nine checkout cases. Widths 320/360/430 and English/Amharic were covered; repeated viewport copies of shared lifecycle cases were intentionally skipped.
- Transactions browser checks covered search/type controls, details, focus restoration, narrow layouts, preserved-draft top-up retry, no automatic second charge, cached navigation, manual refresh and stale foreground refresh. Checkout checks covered duplicate taps, provider switching/phone validation, Back, changed quotes, confirmed failure, success and uncertain original-request recovery.
- Focused groups passed: 167 notification tests; 39 media tests plus follow-up proxy/privacy checks; 78 countdown/checkout/recovery unit tests; and a final 51-test cache/retry/Transactions group including seven isolated database cases. These groups overlap and must not be added as a unique total.
- Real optimized-server media requests verified private 404/no-store responses and public ETag/304 behavior; desktop/mobile image composition was inspected.
- Scoped whitespace check passed; the user's pre-existing README changes were preserved.

## Live boundary

The supplied worker log confirms concurrency 4, personal lanes 1, bot/bulk rates 20/16, maximum configured database connections 7 and paid broadcasts disabled. Deployed revision, replica count, applied migration status and a real 60-second runtime window remain unverified because no Coolify/SSH session is connected. New sanitized worker logs expose the revision when provided by deployment metadata and phase/SQL/queue-age observations for that later check. No campaign was restarted or repeated.

There is no new migration or dependency in this diff. The pre-existing notification lease migration must already be applied before running the updated worker. Production cache configuration, actual Telegram device arrival, real provider latency and production deployment remain separate acceptance checks.
