# Controlled catalog reset

Implementation and rehearsal only. The agent has performed **no production write, refund, migration, deployment, deletion or gateway activation**. Production execution belongs to the Owner after review.

## Reviewed baseline

The verified-TLS, explicitly read-only audit at `2026-10-26T07:09:28.871Z` found 1,364 identities, one active enrolled Owner, 1,236 wallets, four unsettled v4 auctions and 24 accepted bids from ten players. Actual accepted submission fees total 1,005.00 ETB. Existing AVAILABLE balances total 198.00 ETB; HELD balances and settlements are zero. Expected aggregate AVAILABLE after the proposed compensation is 1,203.00 ETB, before any later verified funding or other legitimate activity.

There are 21 verified payment claims totaling 1,178.00 ETB and two historical staff recovery credits totaling 25.00 ETB. Their credited funds already belong to their wallets. The reset never credits these receipts again. Five payments still carry NEEDS_REVIEW: four open cases and one already-resolved case. Keep their evidence and review them individually; none is automatically credited by the reset.

All account projections, balanced journals and hold projections reconcile. Production has 31 applied migrations, with matching local checksums, 60 tables, 510 columns, 82 application triggers, 35 functions and 258 constraints. ArifPay and referral storage are absent. No migration or inferred schema rebuild is required by this package. The original Owner's identity, credential and MFA/recovery fingerprints are guarded without exposing their values.

The expanded grant audit also records 174 routine grants and no anonymous/authenticated/PUBLIC table grants. A pre-existing `SECURITY DEFINER cleanup_test_run(text)` function has PUBLIC execution privileges. Its current body requires eligible finished demo runs and matching demo identities, but can disable replication triggers inside that cleanup. This package never calls it. Review and narrow that execution grant separately before release; no production grant, function or RLS policy was changed. Supabase's `rls_auto_enable` event-trigger function also has default execution grants and is inventoried separately.

The repository already contains the unapplied `202610220002_cleanup_test_run_acl` migration for the browser-role grant restriction. Review that migration independently; do not run a blanket migration deploy merely to apply it, because other pending migrations introduce provider/referral storage. This task does not apply it to production.

These are snapshot facts, not a promise that a live database has stopped changing. Exact IDs, source journal references, protected fingerprints and per-customer amounts are **private** in the ignored `.local/admin-production-reset-20261026/` folder. Do not attach that folder to a public PR or commit it.

## Files and order

1. `01_inventory.sql`: read-only baseline queries. Review auction versions, fee sources, wallet reconciliation, payment cases, settlement exclusions, outbox and migration history.
2. `review-config.json`, `refund-manifest.csv`, `wallet-summary.csv`: review every source and amount. The per-auction manifest repeats a customer's final whole-run balance when they joined multiple auctions; use the one-row-per-wallet summary for totals. Never sum repeated before/after balances.
3. `02_guarded_reset.sql`: only after the deployment, backup and execution gates below. It commits maintenance first, then cancellation/compensation/catalog archival in one separate atomic transaction.
4. `03_verify.sql`: read-only post-run checks. Retain the results with the run manifest and audit records. Leave maintenance active until a separate catalog/release review.

The prepared packet has all three acknowledgements set to `REVIEW_REQUIRED`, so accidental execution cannot halt or credit anything. It contains explicit target IDs, cutoff, run ID, source bids, terms, account baselines and the manifest hash. Use Supabase SQL Editor only after the Owner reviews the regenerated packet.

## Deployment and backup gates

- Identify the **actual deployed web and every auction/command/payment worker revision**. A main-branch SHA or a healthy web endpoint is insufficient. The audited live site does not expose its deployed SHA; matching deployment therefore remains unverified. This change optionally emits `X-App-Revision` from an injected commit SHA on `/api/health/live`, for future release evidence.
- Deploy the maintenance-aware web and workers together in staging first. Do not run the reset against old workers. Both new bids and natural settlement take the shared maintenance lock; the SQL takes its exclusive counterpart. Stop or drain any unverified old instances and cron jobs.
- Obtain a restorable production backup/PITR checkpoint and verify restoration into an isolated database, including identities, encrypted contacts, MFA key compatibility, ledger, payments and outbox. Retain protected deployment secrets independently; SQL backups do not recover missing encryption keys.
- Keep all provider activation flags unchanged. The gateway remains undecided. Incoming verified cash evidence and already-due recoveries must remain recoverable while new auction entries pause.
- Record the Owner's approval of the exact target IDs, compensation totals, snapshot and hash. Only then create a private acknowledgement JSON with `rolloutAcknowledgement: MATCHING_WEB_AND_WORKERS_DEPLOYED`, `backupAcknowledgement: RESTORABLE_BACKUP_VERIFIED`, and `executionAcknowledgement: EXECUTE_REVIEWED_RESET`. Regenerate with `--review <private-file>`; do not hand-edit money or base64 SQL payloads.

## Fresh read-only audit and offline generation

Run from the repository using the existing protected environment file. Connection values stay out of terminals, chat and source control. The audit accepts a variable name, requires verified TLS for a remote database, asserts a READ ONLY transaction and rolls it back. A known session-pooler hostname can replace an unreachable project host without changing the project or credentials.

```powershell
npx.cmd tsx scripts/audit-auction-reset.ts --env <protected-env-file> --variable produrl --root-cert <root-certificate> --pooler <known-session-pooler-host> --output .local/admin-production-audit-final
npx.cmd tsx scripts/prepare-auction-reset.ts --inventory .local/admin-production-audit-final/domain-inventory.json --schema .local/admin-production-audit-final/schema-inventory.json --recovery .local/admin-production-audit-final/recovery-inventory.json --output .local/admin-production-reset-20261026 --run lowwin-catalog-reset-20261026
```

The generator has no database connection or write capability. It refuses inconsistent projections, unsupported frozen rules, unattributed historical staff credits and ambiguous fee adjustments. It derives compensation from balanced actual fee journals, less referral contra-fees and attributable previous refunds. Bid numbers never enter the refund calculation.

The SQL also rejects changed users, payments, balances, bids, terms, controls, migration checksums, guard functions, triggers and constraints, and snapshots over 24 hours old. If any baseline changes, leave maintenance active, repeat the read-only audit, regenerate **the same uncompleted run**, and review the new hash and amounts. Never relax a guard to make a stale packet pass. If another reset run is active or a run ID has already completed with a different manifest, stop for explicit review.

## Accounting and concurrency

The exclusive `lowwin:auction-maintenance` advisory lock precedes auction and wallet locks. The durable halt remains committed if a subsequent stale-snapshot check, financial trigger or audit insertion fails. The financial transaction takes target auctions in stable order, participant wallet locks in stable user order, and hold/projection locks before posting.

For v1–v3, cancellation produces the canonical settlement proof, fee-refund journals and HELD-to-AVAILABLE releases. A hold release moves existing funds; it is never another refund. Discounted or previously-compensated legacy cases stop for specific review because their canonical gross-refund proof cannot be silently rewritten.

For v4, the committed cancellation retains `NON_REFUNDABLE_SUBMISSION_FEES` and zero fee refunds in its original settlement movement. A separate `AUCTION_RESET_COMPENSATION` operation compensates actual net submission fees, with source bids/journals, request hash and stable run/auction/user idempotency keys. It does not charge, reserve or refund the chosen number, or introduce a new tie-break rule.

Every journal is balanced and every deferred financial/settlement trigger fires before commit. A completion audit makes an exact rerun a no-op, including after a later legitimate verified deposit. The package never replays a receipt just because a checkout failed to accept a bid.

Finalized settlements and illustrative results are excluded from cancellation. Their products/categories retain visibility. A targeted auction sharing a protected product becomes a blocking archival exception. The actual audited targets have no such exception. Unused historical inventory is hidden, not deleted. Published slugs remain because production's `published_auction_complete` guard requires them; product/category visibility removes retired listings from public discovery while staff retain evidence.

## Late payments and exceptions

Before execution, inspect all pending/submitting/verifying/review/provider-outage/duplicate-conflict cases, including any new provider-specific storage. An already-credited payment rejected for bid deadline or eligibility retains its AVAILABLE funds and is not credited again. Missing or contradictory evidence remains pending/review.

Maintenance-aware ArifPay verification can retain proven incoming funds while recording `AUCTIONS_PAUSED`, without accepting a bid. Legacy verification likewise retains its ledger and duplicate guards. Browser returns, receipt images and staff notes are not sufficient authority to create funds. Manual mark-paid/add-funds HTTP commands are retired; restricted historical/recovery records remain available.

Do not retry a provider transfer, cancel a pending provider payment or send notifications as part of SQL cleanup. Outbox retirement is limited to pending promotions for the exact cancelled auctions; financial notification and audit records are preserved. Reconcile provider callbacks and worker leases independently before enabling any future funding integration.

## Verification, restart and rollback

The post-run queries must show one completion audit for the exact hash, all four target auctions CANCELLED with original versions/fee policies, 1,005.00 ETB total compensation for the audited baseline, zero active public auctions, no ledger/journal/hold drift, and the original users and Owner. Compare each private wallet's before/after result, not just aggregate totals. Investigate any new legitimate late credit separately.

The rehearsal report in this directory covers both the 31-migration production shape and the current schema, including legacy holds, v4 compensation, referral discounts, a pre-existing winner, forced audit failure, stale snapshots, exact reruns and a late verified deposit. Fixtures are synthetic local databases, not production transactions.

Rehearse from a fresh checkout with `APP_ENV=local`, `NODE_ENV=test`, and `RESET_TEST_BASE_URL` pointing to an operator-created disposable loopback database whose name ends in `_test`, then run `npx.cmd tsx scripts/rehearse-auction-reset.ts`. It creates two new databases, supplies synthetic bot/contact keys and sends no external messages or payments. The committed `schema-baseline.json` contains only the audited migration names/checksums, so no private customer inventory or production credential is required. An explicitly reviewed replacement can be supplied with `--baseline <schema-inventory.json>`. Never use this runner to initialize or migrate a remote database.

Application rollback before execution can restore the previous build. **After maintenance begins, keep the barrier-aware web and workers deployed**; rolling them back to barrier-unaware code could restart bidding or settlement. A UI rollback must retain the maintenance guard. Cancellation and committed compensation are not undone by changing auction status or deleting journals. Recover financial mistakes through reviewed compensating entries. A full database/PITR restore requires a service pause and reconciliation of all external payments and customer activity after the restore point; it can otherwise lose new legitimate funds or registrations.

After the Owner verifies the reset, create fresh IDs for new inventory and review it in staging/canary. A separate audited `AUCTIONS_MAINTENANCE_RESUMED` event is required to reopen bidding, publication and workers. This task has not created that event, enabled a gateway or performed production deployment.
