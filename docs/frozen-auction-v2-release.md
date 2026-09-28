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

- Fresh PostgreSQL 17: all 290 tests in 27 files passed, no skipped tests, including 15 v2 tests and the original v1 settlement suite. Log: `.local/v2-unit-final.log`.
- Additional funding activation/evidence unit checks: 5 passed. No provider network call or real credit occurred.
- Typecheck passed; production build passed. Logs: `.local/v2-typecheck.log`, `.local/v2-build.log`.
- Full browser matrix, performance load, final security scan and external audit are being recorded separately. An earlier PR #1 result is not a pass for this branch.

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
