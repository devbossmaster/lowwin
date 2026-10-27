-- Read only. One result includes every check, even when SQL Editor displays
-- only the final SELECT. Save and review it immediately before execution.
-- This report does not approve or execute a reset.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL TIME ZONE 'UTC';

WITH target_auctions AS (
 SELECT a.id,a.code,a.status,t."ruleVersion",a."acceptedBidCount",
        COUNT(b.id) AS actual_bids,COUNT(DISTINCT b."userId") AS players,
        COALESCE(SUM(b."feePoints"),0)::text AS gross_fees
 FROM "Auction" a
 LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id
 LEFT JOIN "Bid" b ON b."auctionId"=a.id
 WHERE a.id IN (__RESET_TARGET_IDS__)
 GROUP BY a.id,t."ruleVersion"
), balances AS (
 SELECT kind,SUM(balance)::text AS balance FROM "LedgerAccount" GROUP BY kind
), ledger_mismatches AS (
 SELECT la.id,la.balance::text,COALESCE(SUM(p.delta),0)::text AS posting_balance
 FROM "LedgerAccount" la LEFT JOIN "Posting" p ON p."accountId"=la.id
 GROUP BY la.id HAVING la.balance<>COALESCE(SUM(p.delta),0)
), journal_mismatches AS (
 SELECT j.id,COUNT(p.id) AS postings,COALESCE(SUM(p.delta),0)::text AS balance
 FROM "Journal" j LEFT JOIN "Posting" p ON p."journalId"=j.id
 GROUP BY j.id HAVING COUNT(p.id)<2 OR SUM(p.delta)<>0
), held_mismatches AS (
 SELECT w.id,la.balance::text,COALESCE(SUM(h.points),0)::text AS holds
 FROM "Wallet" w JOIN "LedgerAccount" la ON la."walletId"=w.id AND la.kind='HELD'
 LEFT JOIN "AuctionHold" h ON h."walletId"=w.id
 GROUP BY w.id,la.balance HAVING la.balance<>COALESCE(SUM(h.points),0)
), payment_statuses AS (
 SELECT status,"caseState",COUNT(*) AS count FROM "TopUpIntent" GROUP BY status,"caseState"
), payment_review AS (
 SELECT id,"userId",status,"reasonCode","caseState" FROM "TopUpIntent"
 WHERE status IN ('PENDING','VERIFYING','SUBMITTING','NEEDS_REVIEW','PROVIDER_OUTAGE','DUPLICATE_CONFLICT')
), settlements AS (
 SELECT outcome,COUNT(*) AS count FROM "AuctionSettlement" GROUP BY outcome
), outbox AS (
 SELECT kind,state,COUNT(*) AS count FROM "Outbox" GROUP BY kind,state
), migrations AS (
 SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"
), latest_maintenance AS (
 SELECT action,target,"createdAt" FROM "AdminAudit"
 WHERE action IN ('AUCTIONS_MAINTENANCE_HALTED','AUCTIONS_MAINTENANCE_RESUMED')
 ORDER BY "createdAt" DESC,id DESC LIMIT 1
), reset_completion AS (
 SELECT action,target,"requestHash","createdAt" FROM "AdminAudit"
 WHERE "operationKey"=__RESET_COMPLETE_KEY__
)
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'observed_at',transaction_timestamp(),
 'target_auctions',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM target_auctions a),'[]'::jsonb),
 'balances',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.kind) FROM balances b),'[]'::jsonb),
 'ledger_mismatches',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM ledger_mismatches l),'[]'::jsonb),
 'journal_mismatches',COALESCE((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM journal_mismatches j),'[]'::jsonb),
 'held_mismatches',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM held_mismatches h),'[]'::jsonb),
 'payment_statuses',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.status,p."caseState") FROM payment_statuses p),'[]'::jsonb),
 'payment_review',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM payment_review p),'[]'::jsonb),
 'settlements',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.outcome) FROM settlements s),'[]'::jsonb),
 'outbox',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.kind,o.state) FROM outbox o),'[]'::jsonb),
 'migrations',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.migration_name) FROM migrations m),'[]'::jsonb),
 'registered_users',(SELECT COUNT(*) FROM "user"),
 'wallets',(SELECT COUNT(*) FROM "Wallet"),
 'catalog_counts',jsonb_build_object('auctions',(SELECT COUNT(*) FROM "Auction"),'products',(SELECT COUNT(*) FROM "Product"),'categories',(SELECT COUNT(*) FROM "Category")),
 'latest_maintenance',(SELECT to_jsonb(m) FROM latest_maintenance m),
 'reset_completion',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM reset_completion r),'[]'::jsonb)
) AS inventory;
ROLLBACK;
