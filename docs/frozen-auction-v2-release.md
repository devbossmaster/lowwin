# Frozen auction v2 release packet

Based on PR #1 at `fd9a0f4`; review branch `release/frozen-auction-v2-20260929`. This packet is a working record, not approval to switch production traffic. Existing remote databases have not received the v2 migration.

## Financial behavior

New admin publications explicitly freeze `lowest-unique-v2` and `minParticipants=2`. Published v1 auctions retain their original terms and no-unique/no-winner behavior, including zero-bid and one-person closes. No historical term, bid, journal, hold, result or proof is rewritten. Eligibility is checked when a bid is accepted; subsequent suspension prevents new bids and does not discard already accepted bids.

For v2, count distinct users with accepted bids before the immutable deadline. Fewer than two cancels automatically, refunds every entry fee and releases all holds. Otherwise choose the lowest amount with frequency one. Only if there is no unique amount, choose the lowest submitted amount and its earliest PostgreSQL acceptance order. Equal timestamps cannot change the decision. A higher unique amount beats any duplicated lower amount.

PostgreSQL assigns a contiguous per-auction sequence while holding the auction row lock. Caller-provided order is overwritten, rollback does not consume an order, and deferred database guards require the counter to match immutable bids. The original database-clock deadline guard remains authoritative after lock waits.

Settlement records the version, minimum, participant count, deadline, accepted-bid sequence cutoff, amount frequencies, decision, selected bid/order and charge/release/refund/fee journal references. Database guards recalculate the choice and proof, validate financial references against balanced postings, and reject contradictory SQL inserts. Neither staff UI nor retry commands can choose a winner. Private proof, identities, individual live amounts and journal IDs remain outside public catalog DTOs.

## Migration and rollout order

1. Pin the reviewed commit and verify its CI, browser and security artifacts. Obtain Owner approval of this packet, exact receiver policies and the small-transfer plan before activation.
2. Rehearse on a separate staging copy. Back up the target with the migration/backup role, encrypt it, and restore it to an isolated database. Record row counts, migration history and zero reconciliation drift. Never reset production or run seed scripts there.
3. Drain bidding traffic and stop only Lowwin web/auction/bot/notification services during migration; leave Gojo services intact. Ensure no in-flight financial transaction remains. Back up again and record the cutoff.
4. With the schema-owner migration URL only, run `prisma migrate deploy`. The sole new migration is `202609290001_frozen_auction_v2`. It adds columns/indexes/guards without updating historical financial records. Do not edit already-applied migrations.
5. Generate Prisma and deploy the new web and all three worker binaries together. Use only the restricted runtime login in normal services. Start with `PAYMENTS_LIVE_ENABLED=false`; confirm role/RLS, app headers, worker supervision and reconciliations.
6. Publish a DEMO v2 auction only in isolated staging and rehearse two users, first-accepted fallback and one-person refund. Real auctions remain an Owner publication action after preflight.
7. Before publishing the first production v2 auction, rollback can use the prior v1 application because the migration is additive. **After any v2 publication, do not run a v1-only worker.** Pause publication and use a v2-capable rollback build. Never delete results/journals or reverse the migration to repair a live problem.

## Evidence currently recorded

- [PR #2](https://github.com/devbossmaster/lowwin/pull/2), stacked on PR #1, contains the reviewable implementation. No merge or production switch has occurred.
- Fresh PostgreSQL 17: **293 tests in 28 files passed**, zero skips, including **16 v2 cases**, v1 preservation, contact/auth, funding evidence/idempotency and the restricted-runtime role check. Typecheck, production build, four core browser checks, dependency audit and security scan passed at `9bb3419`. [CI evidence](https://github.com/devbossmaster/lowwin/actions/runs/36530766762).
- The full payment browser suite passed at `25b1183`: **16 tests**, covering mobile 360/430, real local OCR extraction, test-provider credit, admin payment review, contact gating and retry/loading. No real provider payment or production credit occurred. [CI evidence](https://github.com/devbossmaster/lowwin/actions/runs/36531362693).
- General browser selectors were updated for the existing redesigned navigation, wallet, winners and carousel. Earlier failures remain in CI history; final head results are recorded below rather than treated as green by assumption.
- Latest local production build and strict typecheck passed. An added v2 browser case verifies English/Amharic disclosure and fallback labels at both widths; its final CI result is pending.

### Measured performance and restore

Committed raw measurements are in [evidence/frozen-v2](evidence/frozen-v2). These are local measurements, not real Telegram or VPS results. The production-build HTTP test uses loopback HTTP with simulated HTTPS proxy headers, signed synthetic Telegram launch and verified DEMO contact; it does not measure TLS or mobile network overhead.

| Query/service | PR #1 / v1 | v2 | Conditions |
|---|---:|---:|---|
| Home catalog p50 / p95 | 23.61 / 29.07 ms | 25.31 / 29.75 ms | same local data, 20 warm samples |
| Results p50 / p95 | 12.03 / 13.58 ms | 11.91 / 13.68 ms | same local data, 20 warm samples |
| Accepted bid p50 / p95 | 285.23 / 520.62 ms | 258.78 / 494.62 ms | 100 participants, concurrency 5, pool 5 |
| Settlement | 3,822 ms | 5,956 ms | 100 participants, one run per version |
| Idempotent close retry | 15 ms | 18 ms | same completed settlement |

No significant catalog speedup is claimed. Additional v2 proof verification increases closing cost; both runs completed within the existing 120-second transaction bound with zero reconciliation drift. Larger populations and remote database latency still need target-environment measurement.

Production-build HTTP, 30 warm requests per route at concurrency 5: Home **126/226 ms**, catalog API **37/152 ms**, results API **56/66 ms**, winner detail **75/101 ms** (p50/p95). One signed launch measured **428 ms**. Decoded responses were 50,835 / 7,697 / 7,474 / 21,085 bytes respectively; these are response sizes, not total page assets or transferred compressed bytes.

Local PostgreSQL custom-format dump/restore passed: hashes matched for 200 bids, 16 frozen terms, 2 settlements, 800 journals, 1,600 postings, holds, accounts, operations and all 18 migration records. Balance/posting drift was zero. `scripts/rehearse-restore.mjs` creates a fresh database and never drops/resets retained data. This does **not** certify encrypted off-host backups, Supabase restore or scheduled VPS backups.

### External findings and remaining work

Read-only audit of the connected staging environment found runtime login `postgres` with `BYPASSRLS` and ownership of private tables; RLS being enabled does not constrain that login. `deploy/runtime-role.sql` and a local positive/negative permission test are provided, but the remote login has **not** been changed. The remote connection took 3,489 ms; the snapshot showed 8 idle connections. The v2 migration has not been applied remotely.

The configured Telegram test bot responded to read-only API checks; webhook backlog was zero. Actual `/start`, contact and Mini App behavior on Android/iOS remain Owner checks. No live Telegram messages were sent during this verification.

The connected environment reports email transport unavailable, provider mode disabled and no live Check.et key. Required Owner values: separate production restricted runtime/migration URLs; HTTPS hostname and deployment access location; verified email sender/API credential; Check.et live credential; exact approved Telebirr/CBE account holders/numbers and policy; backup recipient/off-host destination; monitoring recipient. Supply secrets through protected environment configuration, never a PR or chat.

EN/AM rule, wallet, bid and result copy has been extended; Owner FAQ editing now includes Amharic fields. Existing English-only custom FAQ entries are retained and omitted from the Amharic view until translated. Native review is **not yet approved**. A complete translation audit of profile/support, all bot messages and operational admin labels is still outstanding. Uploaded receipt images are currently memory-only OCR inputs, not a retained reviewer image store; only a candidate reference is extracted, and a screenshot never credits money. Reviewable private receipt retention remains a separate unfinished requirement.

Hostinger isolation, real TLS/proxy limits, email delivery, worker supervision, off-host encrypted restore, alerts and real production transfer verification remain unperformed. Deployment files are templates, not proof of a running deployment.

## Native Amharic review — Owner

The Owner has offered to review the copy; approval is still pending. Review the same rendered pages at 360px and 430px, in English and Amharic. The full matching disclosure lives in `src/components/auction-rule.tsx`; shared wallet/bid/alert copy lives in `src/components/wallet-copy.ts`.

Confirm these meanings, without changing existing v1 promises:

| Meaning | Amharic review phrase |
|---|---|
| At least two distinct eligible people, not two bids | ቢያንስ ሁለት መስፈርቱን የሚያሟሉ ሰዎች፤ አንድ ሰው ብዙ መጠኖችን ቢያቀርብም እንደ አንድ ተሳታፊ ብቻ ይቆጠራል። |
| Minimum unmet: cancel and refund every fee/hold | ተሳታፊዎች ከሁለት ያነሱ ከሆኑ ጨረታው ይሰረዛል፤ የመግቢያ ክፍያዎች ሁሉ ይመለሳሉ፣ የተያዘ ገንዘብም ሁሉ ይለቀቃል። |
| Primary lowest unique amount | አንድ ጊዜ ብቻ ከተቀበሉት መጠኖች ዝቅተኛው ያሸንፋል። |
| Fallback only when there is no unique amount | ልዩ መጠን ከሌለ ብቻ፣ ዝቅተኛውን መጠን ያቀረቡት መካከል ጨረታው በመረጃ ቋቱ መጀመሪያ የተቀበለለት ሰው ያሸንፋል። |

Record reviewer name, date, commit, corrections and final approval. Also test `/start`, own-contact verification, launch, background/reopen and payment errors in real Telegram Android/iOS. Browser emulation cannot certify those clients.

## Controlled funding activation

Check.et's [official verify schema](https://docs.check.et/api-reference/verify) includes reference, receiver account, amount, currency, timestamp and official verification method. Its [developer documentation](https://check.et/developers) defines a duplicate as already verified in the branch. The app therefore investigates duplicates and retains a separate globally unique claim; screenshots/OCR alone never credit.

The new server switch makes production activation possible without removing financial checks. It requires `PAYMENTS_LIVE_ENABLED=true`, `APP_ENV=production`, `NODE_ENV=production`, `CHECK_ET_MODE=live`, a configured live key, HTTPS origins and no development/test/DEMO switches or test endpoint. The checked-in example and all current environments remain disabled. Exact receiver policies must be approved and enabled separately. Missing provider evidence still produces zero credit even with the switch enabled.

Owner approval packet must name: release SHA, bank, exact receiver and holder, frozen policy/version, approved small amount within policy bounds, test account, transfer window, operator and evidence capture location. After one approved transfer: verify one claim/credit, replay the request, verify no extra credit, compare the bank statement and run both reconciliations. Stop on any mismatch. Disable the switch to stop new credits; never delete claims or journals. Any reversal must use the audited compensating-journal procedure and cannot overdraw spent funds.

**Current decision: NO-GO for production traffic or real funds until the final branch checks, native review, real-device tests and target infrastructure/evidence checks are recorded.** This is an evidence gap, not permission to bypass controls.
