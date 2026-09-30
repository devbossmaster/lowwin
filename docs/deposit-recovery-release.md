# Deposit recovery release review

Branch: `fix/deposit-recovery-20260930`, based on `3a73400`. No merge, deployment, live activation or real communication is included.

## Causes and resulting behavior

The server and customer form treated every NEEDS_REVIEW result as terminal. Ordinary success left the investigation OPEN/assigned, and provider duplicate recovery required a prior outage even when another local verification had started. OCR could return a very low-confidence misread.

Ordinary review deposits can now be checked again, reusing their original intent. The UI shows the server retry time, keeps the reference bound, preserves input on failure, and offers an explicit correction path. A correction starts a separate request under the currently published policy, retaining the earlier history; an existing corrected reference reopens its original request. No amount input or quote-acceptance step was added. New copy is bilingual.

A committed verification atomically records the unique claim, balanced journal, credited status, resolved ordinary case, cleared assignment and one credited notification. The customer wallet and history refresh. Escalated/reversal cases, explicit rejections, other-user claims, contact restrictions, funding gates and immutable quotes remain protected. Post-credit disputes still enter the existing dispute queue.

Each outbound verification now has an immutable `Operation` start record before the network call. Completed `PaymentAttempt` evidence stores a redacted outcome snapshot for attempt-key replay. An interrupted start can be sealed as uncertain; a new attempt key performs recovery. Leases prevent overlapping checks for the same transfer across customers, and final transfer/wallet locks and unique claims prevent double credit. Historical attempts without outcome snapshots retain their legacy read behavior; no historical evidence is rewritten.

Customers have six total attempts; authorized staff have twelve, with existing cooldowns and a seven-day recovery opportunity after original expiry. Retrying does not change the original qualifying transfer dates, receiving account, amount or limits. The Owner recovery/escalation path is documented in [the admin guide](admin-guide.md#wallet-funding-and-incidents). Exhausted/expired requests retain evidence and require support; there is no arbitrary credit or automatic external refund.

## Official contract checked

Read on 2026-09-30: [overview](https://docs.check.et/api-reference/overview), [verify](https://docs.check.et/api-reference/verify), [receipt URLs](https://docs.check.et/api-reference/verify-by-receipt-url), [file verification](https://docs.check.et/api-reference/verify-by-file), [original verification](https://docs.check.et/api-reference/get-verification), [errors](https://docs.check.et/guides/error-handling), and [documentation index](https://docs.check.et/llms.txt). Official Markdown variants were used where browser retrieval failed.

The adapter retains server-side Bearer POST `/api/v1/verify`; CBE includes the receiving account. Supported official receipt links and SMS are locally parsed to a reference. Screenshots remain local OCR inputs; they are not uploaded to Check.et. The documented image-upload contract requires `receipt_text`, unlike PDF parsing; this change does not add PDF uploads or send unnecessary image data.

Duplicate recovery uses the documented `existing_verification_id`, `verified_at`, and GET `/verifications/{id}` record (`source.type=api`, creation time, reference, bank, status/type, amount, currency/date). New starts use bounded local timing windows; ordinary completed attempts narrow the window to their completion. Another local deposit's overlapping attempt prevents correlation. Pre-upgrade outages retain the bounded legacy correlation path. Original records do not document complete receiver proof, so a matching authoritative receipt with the full receiving account is still required. A duplicate flag or missing local claim never grants credit. The original ID, provider time and correlated attempt key are retained in redacted evidence when available.

The 45-second provider timeout and 80-second lease are preserved. Auth/configuration, quota, rate limiting, unconfirmed payments, wrong receiver and insufficient evidence have distinct feedback. Runtime logs contain outcome codes/timing, not keys, complete OCR text, receipts or complete account numbers.

## OCR boundaries

Tall-image width preservation and bounded small-text enlargement remain. Two bounded local passes (sparse layout and normalized-contrast automatic layout) compare literal references. Disagreements, multiple plausible references and very low code confidence require manual entry. Moderate confidence remains visibly uncertain and requires customer confirmation; no O/0, I/1, B/8 substitution is made. A low-contrast DIU89YSKT8 fixture exposed a real misread and now fails safely. Known Telebirr/CBE fixture references are read by the real packaged Tesseract engine.

Static format signatures, 5 MB input, 12-million-pixel decoding, animation checks, orientation and metadata stripping remain. One scan runs per app process; the child is limited to 20 seconds, bounded input/output, a 256 MiB V8 heap and one OCR thread. This heap cap is not a total process/WASM memory measurement. Images are memory-only, buffers are cleared and the worker is terminated; no language data downloads occur at runtime. Perfect OCR or production latency is not claimed.

## Verification

All mutable tests use disposable loopback `_test` databases and local email/provider fixtures. No real transfer, production write or real notification was performed.

| Check | Result |
| --- | --- |
| Full database/unit regression, `node scripts/run-db-tests.mjs unit` | 370 passed in 41 files, zero skipped; 260.69 seconds |
| Payment browser matrix, `node scripts/run-db-tests.mjs payments` | 18 passed; 2.6 minutes; all three servers exited cleanly |
| General browser matrix, `node scripts/run-db-tests.mjs browser` | 19 passed; one intentional duplicate carousel skip; 4.9 minutes; all servers exited cleanly |
| Provider contract/diagnostic follow-up | 12 passed, including slow valid response and correlated/unrelated duplicates |
| Final OCR/extraction fixtures | 7 passed, including actual Telebirr/CBE OCR, ambiguous image rejection and low-contrast fallback |
| Typecheck | Passed |
| Production build, `npm run build` | Passed, including Prisma generation and Next TypeScript checks |
| `git diff --check` | Passed |

The first regression run exposed the low-contrast reference misread. The final scanner rejects that very low-confidence candidate; the full rerun above passed. The legacy crash test was updated to assert an interrupted outcome for its original key and a new key for explicit recovery. A provider metadata-only follow-up additionally records correlation identifiers; its focused tests passed. Mobile captures show real local server/provider-fixture results, not mocked success UI. OCR fixtures are generated test images, not customers' private receipts.

## Review captures

- Review and cooldown: [360 px](screenshots/deposit-recovery-review-mobile-360.png), [430 px](screenshots/deposit-recovery-review-mobile-430.png).
- Credited and refreshed balance: [360 px](screenshots/deposit-recovery-credited-mobile-360.png), [430 px](screenshots/deposit-recovery-credited-mobile-430.png).
- Scan fallback: [360 px](screenshots/deposit-recovery-fallback-mobile-360.png), [430 px](screenshots/deposit-recovery-fallback-mobile-430.png).

## Deployment and rollback

Review the application commit, apply `202609300005_payment_attempt_lookup` through the normal migration process, then redeploy `lowwin-web`. The migration adds only an index on immutable Operation correlation fields; no balance or receipt data changes. Existing workers do not require a change for this feature. Roll back to the previous web application revision if required; the additive index and new immutable start/outcome evidence can remain. Preserve claims, operations and journals.

Production connectivity remains unverified: after an explicitly authorized deployment, check the web runtime's Check.et response timing and run a separately approved real funding test. Fixtures prove application behavior, not Check.et availability, live receipt coverage or actual Telegram delivery. Existing production review cases have not been modified.

Delivery is a local review commit on the separate branch. No push or PR was issued, so remote CI was not run. This also avoids triggering deployment webhooks. The earlier main branch and other worktree were preserved.
