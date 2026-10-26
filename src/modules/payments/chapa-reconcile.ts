import type {Prisma,PrismaClient} from '@prisma/client';

export type ChapaReceiptDrift={kind:'CHAPA_RECEIPT';name:string;code:'JOURNAL_LINK'|'OPERATION_LINK'|'CHECKOUT_PROOF'|'POSTINGS'|'PAID_STATE'|'BID_RECEIPT'};

/** Audit committed evidence in one MVCC snapshot. This detects drift; it never
 * treats a browser/webhook response as payment evidence or repairs money. */
export async function reconcileChapaReceipts(client:PrismaClient|Prisma.TransactionClient):Promise<ChapaReceiptDrift[]>{
 if(process.env.CHAPA_SCHEMA_READY!=='true')return [];
 return client.$queryRaw<ChapaReceiptDrift[]>`
  WITH paid AS (
   SELECT c.*,j.kind AS journal_kind,j.reference AS journal_reference,
    o.id AS operation_id,o.scope AS operation_scope,o.key AS operation_key,o."userId" AS operation_user,
    o."requestHash" AS operation_hash,o.result AS operation_result,
    b."userId" AS bid_user,b."auctionId" AS bid_auction,b.amount AS bid_amount,
    b."feePoints" AS bid_fee,b."termsVersion" AS bid_fee_version,bo.key AS bid_key,
    bo.scope AS bid_scope,bo."userId" AS bid_operation_user,
    c."amountCents"::numeric/100 AS net_fee
   FROM "ChapaCheckout" c
   LEFT JOIN "Journal" j ON j.id=c."creditJournalId"
   LEFT JOIN "Operation" o ON o.id=j."operationId"
   LEFT JOIN "Bid" b ON b.id=c."bidId"
   LEFT JOIN "Operation" bo ON bo.id=b."operationId"
  ), findings AS (
   SELECT 'journal:'||j.id AS name,'JOURNAL_LINK' AS code
   FROM "Journal" j LEFT JOIN "ChapaCheckout" c ON c."creditJournalId"=j.id
   WHERE j.kind='CHAPA_RECEIPT' GROUP BY j.id HAVING count(c.id)<>1
   UNION ALL
   SELECT 'operation:'||o.id,'OPERATION_LINK'
   FROM "Operation" o LEFT JOIN "Journal" j ON j."operationId"=o.id
   LEFT JOIN "ChapaCheckout" c ON c."creditJournalId"=j.id
   WHERE o.scope='CHAPA_RECEIPT' AND (j.id IS NULL OR j.kind<>'CHAPA_RECEIPT' OR c.id IS NULL)
   UNION ALL
   SELECT 'checkout:'||p.id,'CHECKOUT_PROOF' FROM paid p WHERE p."creditJournalId" IS NOT NULL AND (
    p.journal_kind IS DISTINCT FROM 'CHAPA_RECEIPT' OR p.journal_reference IS DISTINCT FROM 'chapa:'||p."merchantReference"
    OR p.operation_scope IS DISTINCT FROM 'CHAPA_RECEIPT' OR p.operation_key IS DISTINCT FROM p.id
    OR p.operation_user IS DISTINCT FROM p."userId"
    OR p."evidenceHash" IS NULL OR p."evidenceHash" !~ '^[a-f0-9]{64}$' OR p.operation_hash IS DISTINCT FROM p."evidenceHash"
    OR p."chapaReference" IS NULL OR p."chapaReference" !~ '^[A-Za-z0-9_-]{1,128}$'
    OR p.currency<>'ETB' OR p.mode NOT IN ('test','live')
    OR p.operation_result->>'checkoutId' IS DISTINCT FROM p.id
    OR p.operation_result->>'merchantReference' IS DISTINCT FROM p."merchantReference"
    OR p.operation_result->>'chapaReference' IS DISTINCT FROM p."chapaReference"
    OR p.operation_result->>'mode' IS DISTINCT FROM p.mode
    OR p.operation_result->>'amountCents' IS DISTINCT FROM p."amountCents"::text
    OR p.operation_result->>'currency' IS DISTINCT FROM p.currency
   )
   UNION ALL
   SELECT 'checkout:'||p.id,'POSTINGS' FROM paid p
   LEFT JOIN LATERAL (
    SELECT count(*) AS count,COALESCE(sum(t.delta),0) AS balance,
     count(*) FILTER(WHERE a.name='platform:issuance' AND a.kind='ISSUANCE' AND a."walletId" IS NULL AND t.delta=-p.net_fee) AS issuance,
     count(*) FILTER(WHERE a.name='user:'||p."userId"||':available' AND a.kind='AVAILABLE' AND w."userId"=p."userId" AND t.delta=p.net_fee) AS available
    FROM "Posting" t JOIN "LedgerAccount" a ON a.id=t."accountId" LEFT JOIN "Wallet" w ON w.id=a."walletId"
    WHERE t."journalId"=p."creditJournalId"
   ) posts ON true WHERE p."creditJournalId" IS NOT NULL AND (posts.count<>2 OR posts.balance<>0 OR posts.issuance<>1 OR posts.available<>1)
   UNION ALL
   SELECT 'checkout:'||p.id,'PAID_STATE' FROM paid p WHERE
    p.status IN ('CREDITED','BID_ACCEPTED') AND p."creditJournalId" IS NULL
    OR p."creditJournalId" IS NOT NULL AND NOT (
     p.purpose='TOP_UP' AND p.status='CREDITED' AND p."bidId" IS NULL AND p.receipt IS NULL AND p.reason IS NULL
     OR p.purpose='BID' AND p.status='BID_ACCEPTED' AND p."bidId" IS NOT NULL AND p.receipt IS NOT NULL AND p.reason IS NULL
     OR p.purpose='BID' AND p.status='NEEDS_REVIEW' AND p."bidId" IS NULL AND p.receipt IS NULL AND p.reason IS NOT NULL
    )
   UNION ALL
   SELECT 'checkout:'||p.id,'BID_RECEIPT' FROM paid p WHERE p.status='BID_ACCEPTED' AND (
    p.bid_user IS DISTINCT FROM p."userId" OR p.bid_auction IS DISTINCT FROM p."auctionId"
    OR p.bid_operation_user IS DISTINCT FROM p."userId" OR p.bid_scope IS DISTINCT FROM 'BID'
    OR p.bid_amount IS DISTINCT FROM p."bidNumber" OR p.bid_fee IS DISTINCT FROM p."grossFee"
    OR p.bid_fee_version IS DISTINCT FROM p."feeVersion" OR p.bid_key IS DISTINCT FROM p.key
    OR p.receipt->'bid'->>'id' IS DISTINCT FROM p."bidId"
    OR p.receipt->'bid'->>'auctionSlug' IS DISTINCT FROM p."auctionSlug"
    OR p.receipt->'bid'->>'amount' IS DISTINCT FROM trim_scale(p."bidNumber")::text
    OR p.receipt->'bid'->>'feePoints' IS DISTINCT FROM trim_scale(p."grossFee")::text
    OR p.receipt->'bid'->>'termsVersion' IS DISTINCT FROM p."feeVersion"::text
    OR p.receipt->'charge'->>'feePoints' IS DISTINCT FROM trim_scale(p."grossFee")::text
    OR COALESCE(p.receipt->'charge'->>'discountPoints','0') IS DISTINCT FROM trim_scale(p."discountPoints")::text
    OR COALESCE(p.receipt->'charge'->>'netFeePoints',p.receipt->'charge'->>'feePoints') IS DISTINCT FROM trim_scale(p.net_fee)::text
    OR p.receipt->'charge'->>'newlyUnavailable' IS DISTINCT FROM trim_scale(p.net_fee)::text
    OR p.receipt->'charge'->>'couponId' IS DISTINCT FROM p."couponId"
    OR p.receipt->'hold'->>'extraReserved' IS DISTINCT FROM '0'
   )
  ) SELECT 'CHAPA_RECEIPT' AS kind,name,code FROM findings ORDER BY name,code`;
}
