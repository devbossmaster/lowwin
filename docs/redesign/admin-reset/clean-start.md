# Clean catalog and compatible schema

This extends the original archival reset. The Owner requested a fresh operational database while retaining registered users and their wallet balances after fee compensation. No production refund, deletion, migration or deployment has been executed by the agent.

## Result

First run the reviewed refund packet and its verification. Then a separately reviewed owner SQL procedure physically deletes the old auctions, bids, products, categories, images, favorites, results, settlement rows, delivery rows, notification/message history, retired support cases and uploaded-media database records. It leaves the catalog empty for fresh inventory. Existing public-code sequences are not reset, so old links cannot silently identify a new product.

Identity and authentication records, staff permissions/MFA, verified contacts, wallets, balanced ledger operations/journals/postings, funding claims, duplicate-payment protection, pending payment recovery, restrictions, preferences and bot contact/update protection remain. Keeping wallet balances requires their accounting foundation. Before deleting operational auction rows, the procedure seals their original bidding/settlement proof in an immutable internal AdminAudit record. Customers' old My Bids and Winners records are removed; money and refund evidence remain available for reconciliation.

Legacy tables `VerifiedPhoneIdentity`, `ExternalEvent` and `SupportCase` are retired from Prisma and application references. Staff phone search/display uses the existing verified Telegram contact records. The new migration refuses to drop any nonempty legacy table. Production's obsolete support cases must be removed through the reviewed cleanup first. Current catalog, authentication, wallet, Chapa, referral, delivery and notification tables are still required by the redesign and remain available empty or with their protected data.

The SQL uses an explicit deletion allowlist and table fingerprints. It rejects uncompleted refunds, changed users or balances, changed schema/content, active auctions, nonzero holds, linked provider payments, earned referral dependencies and published CMS content that might reference uploaded media. Exact reruns do nothing. Ledger triggers and foreign keys remain enabled. Named immutability triggers on the deleted catalog/bid/settlement/history tables are temporarily suspended under exclusive locks within the atomic owner transaction; rollback restores the original data and guards. There is no HTTP purge endpoint, TRUNCATE CASCADE, replication-role bypass or permanent weakening of money/authentication rules.

Updated notification scheduling and dispatch take the shared maintenance barrier. Once the halt commits, they stop creating/claiming jobs and making deliveries; current bounded delivery transactions finish before the halt acquires its exclusive lock. Cash verification/recovery remains separate, so maintenance does not discard proven customer funds. Deployment of every worker still needs verification before production cleanup; changing source code does not stop an old deployed process.

## Execution order

1. Verify a restorable production backup with compatible protected keys. Deploy the matching maintenance-aware web and worker code. Review and regenerate the exact refund packet as described in [the reset procedure](README.md).
2. Run `02_guarded_reset.sql`, then `03_verify.sql`. This returns actual net submission fees to wallets and commits cancellations. Keep maintenance active.
3. Stop/drain every auction and notification worker before the destructive catalog phase. Existing production notification history was still growing during read-only checks; a successful inventory query is not evidence of a stopped service.
4. Capture fresh post-refund inventory using the existing read-only command, with `--catalog-purge --run lowwin-catalog-reset-20261026`. It requires the protected env path, `--variable produrl`, verified root certificate, known session pooler, and ignored output folder exactly as in the reset procedure. It will report blockers rather than preparing deletion before refunds.
5. Prepare the private preview offline:

   ```powershell
   npx.cmd tsx scripts/prepare-catalog-purge.ts --inventory .local/admin-production-reset-current/catalog-purge-inventory.json --output .local/admin-production-reset-current
   ```

6. Review `catalog-purge-review.json`, including the exact auction IDs, source counts/fingerprints and protected balances. Copy the generated owner-review template to a private `catalog-purge-owner-review.json`. Only after verifying the corresponding facts, set `backupAcknowledgement` to `RESTORABLE_BACKUP_VERIFIED`, `workersAcknowledgement` to `ALL_AUCTION_AND_NOTIFICATION_WORKERS_DRAINED`, and `executionAcknowledgement` to `EXECUTE_REVIEWED_CATALOG_PURGE`. Retain the exact reviewed hash.
7. Regenerate with the same command plus `--review .local/admin-production-reset-current/catalog-purge-owner-review.json`. Run its whole `04_catalog_purge.sql`, followed by `05_verify_catalog_purge.sql` **before** the table-retirement migration. Catalog counts must be zero, wallet reconciliation drift zero, and one purge receipt and sealed proof present. User and wallet counts/balances must match the reviewed snapshot.
8. Apply the separately reviewed `202610270001_retire_legacy_customer_tables` migration through normal migration tracking, once its tables are empty. Do not blindly deploy every pending migration merely to remove three tables. Earlier provider/referral migrations and their activation flags remain separate release decisions.
9. Create new inventory through the admin. A separate audited maintenance resume is required before new bidding/notifications. Refresh customer clients after maintenance so old cached pages are refreshed. The procedure changes database history; it does not delete messages already delivered to Telegram or unrelated files in external storage.

Any failure leaves maintenance active. Re-audit and re-review rather than editing money, fingerprint checks or immutable guards. A UI rollback after maintenance must retain the barrier. After schema retirement, the older code's legacy-contact fallback is no longer compatible; use a compatible forward fix or the reviewed restore procedure.

## Verification

The isolated rehearsal covers both the 31-migration production shape and current schema: no cleanup before refund; no unreviewed deletion; empty-only table retirement; forced final-audit failure and guard restoration; changed balance rejection and preservation of later credits; paused scheduling/delivery during maintenance; literal zero catalog/history rows; unchanged identities, Owner/MFA and money records; idempotent reruns; new auctions/bids after cleanup without public-code reuse; and provider-evidence blockers. Fixtures are synthetic and send no real messages or payments. Results are in [catalog-purge-rehearsal.json](catalog-purge-rehearsal.json).

Run with an operator-created disposable loopback `RESET_TEST_BASE_URL` ending in `_test`, `APP_ENV=local`, and `NODE_ENV=test`:

```powershell
npx.cmd tsx scripts/rehearse-catalog-purge.ts
```
