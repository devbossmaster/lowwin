import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';

export const walletHistoryQuerySchema=z.object({page:z.coerce.number().int().min(1).max(1000).default(1),type:z.enum(['all','topup','bid','refund']).default('all')}).strict();
export type WalletHistoryType='topup'|'bid'|'refund'|'hold'|'adjustment';
export type WalletHistoryKind='TOP_UP'|'PAYMENT_CREDIT'|'BID_FEE'|'FEE_REFUND'|'COMPENSATION'|'HOLD_RESERVE'|'HOLD_RELEASE'|'ADJUSTMENT';
type HistoryRow={id:string;at:Date;type:WalletHistoryType;kind:WalletHistoryKind;delta:string};

/** Confirmed, owner-only changes to available funds. Provider attempts are not
 * wallet activity. A paid external bid credits and spends in one transaction;
 * its transit postings are deliberately excluded rather than called a deposit.
 * Coupons are folded into their linked fee using the committed own postings.
 */
export async function getWalletHistory(client:PrismaClient,userId:string,input:unknown={}){
 const query=walletHistoryQuerySchema.parse(input),pageSize=20;
 const filter=query.type==='all'?Prisma.empty:Prisma.sql`WHERE entry.type=${query.type}`;
 const rows=await client.$queryRaw<HistoryRow[]>`
  WITH external_receipts AS MATERIALIZED (
   SELECT c.id,c."creditJournalId",c."bidId",c.receipt FROM "ChapaCheckout" c
   JOIN "Journal" j ON j.id=c."creditJournalId" AND j.kind='CHAPA_RECEIPT'
   JOIN "Operation" o ON o.id=j."operationId" AND o.scope='CHAPA_RECEIPT' AND o.key=c.id AND o."userId"=c."userId"
   WHERE c."userId"=${userId} AND c.purpose='BID' AND c.status='BID_ACCEPTED'
  ), external_bids AS MATERIALIZED (
   SELECT "bidId" AS id FROM external_receipts WHERE "bidId" IS NOT NULL
   UNION SELECT child->>'id' FROM external_receipts c
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.receipt->'bids')='array' THEN c.receipt->'bids' ELSE '[]'::jsonb END) child
   UNION SELECT c."bidId" FROM "ArifPayCheckout" c
    JOIN "Journal" j ON j.id=c."creditJournalId" AND j.kind='ARIFPAY_RECEIPT'
    JOIN "Operation" o ON o.id=j."operationId" AND o.scope='ARIFPAY_RECEIPT' AND o.key=c.id AND o."userId"=c."userId"
    WHERE c."userId"=${userId} AND c.status='BID_ACCEPTED' AND c."bidId" IS NOT NULL
  ), entries AS (
   SELECT j.id,j."createdAt" AS at,
    CASE WHEN j.kind IN ('CHAPA_RECEIPT','TOPUP_CREDIT','ADMIN_CREDIT','ARIFPAY_RECEIPT') THEN 'topup'
      WHEN j.kind='BID_FEE' THEN 'bid'
      WHEN j.kind IN ('AUCTION_FEE_REFUND','AUCTION_RESET_COMPENSATION') THEN 'refund'
      WHEN j.kind IN ('HOLD_RESERVE','HOLD_RELEASE') THEN 'hold' ELSE 'adjustment' END AS type,
    CASE WHEN j.kind='CHAPA_RECEIPT' AND received.purpose='BID' THEN 'PAYMENT_CREDIT'
      WHEN j.kind IN ('CHAPA_RECEIPT','TOPUP_CREDIT','ADMIN_CREDIT','ARIFPAY_RECEIPT') THEN 'TOP_UP'
      WHEN j.kind='BID_FEE' THEN 'BID_FEE'
      WHEN j.kind='AUCTION_FEE_REFUND' THEN 'FEE_REFUND'
      WHEN j.kind='AUCTION_RESET_COMPENSATION' THEN 'COMPENSATION'
      WHEN j.kind='HOLD_RESERVE' THEN 'HOLD_RESERVE' WHEN j.kind='HOLD_RELEASE' THEN 'HOLD_RELEASE' ELSE 'ADJUSTMENT' END AS kind,
    (p.delta+coalesce(discount_posting.delta,0))::text AS delta
   FROM "Wallet" w JOIN "LedgerAccount" account ON account."walletId"=w.id AND account.kind='AVAILABLE'
   JOIN "Posting" p ON p."accountId"=account.id JOIN "Journal" j ON j.id=p."journalId"
   JOIN "Operation" o ON o.id=j."operationId" AND o."userId"=w."userId"
   LEFT JOIN "Bid" b ON b."operationId"=o.id AND b."userId"=w."userId"
   LEFT JOIN "ChapaCheckout" received ON received."creditJournalId"=j.id AND received."userId"=w."userId"
   LEFT JOIN "ReferralRedemption" redemption ON redemption."bidId"=b.id AND redemption."userId"=w."userId" AND j.kind='BID_FEE'
   LEFT JOIN "Operation" discount_operation ON discount_operation.id=redemption."operationId" AND discount_operation."userId"=w."userId" AND discount_operation.scope='REFERRAL_DISCOUNT'
   LEFT JOIN "Journal" discount ON discount."operationId"=discount_operation.id AND discount.kind='REFERRAL_DISCOUNT'
   LEFT JOIN "Posting" discount_posting ON discount_posting."journalId"=discount.id AND discount_posting."accountId"=account.id
   WHERE w."userId"=${userId} AND p.delta<>0
    AND NOT EXISTS (SELECT 1 FROM external_receipts c WHERE c."creditJournalId"=j.id)
    AND NOT EXISTS (SELECT 1 FROM external_bids e WHERE e.id=b.id)
    AND NOT (j.kind='ARIFPAY_RECEIPT' AND EXISTS (SELECT 1 FROM "ArifPayCheckout" c WHERE c."userId"=w."userId" AND c."creditJournalId"=j.id AND c.status='BID_ACCEPTED'))
    AND NOT (j.kind='REFERRAL_DISCOUNT' AND EXISTS (
      SELECT 1 FROM "ReferralRedemption" r JOIN "Bid" used ON used.id=r."bidId" AND used."userId"=w."userId"
      JOIN "Journal" fee ON fee."operationId"=used."operationId" AND fee.kind='BID_FEE'
      JOIN "Posting" fee_posting ON fee_posting."journalId"=fee.id AND fee_posting."accountId"=account.id
      WHERE r."userId"=w."userId" AND r."operationId"=o.id))
  )
  SELECT entry.id,entry.at,entry.type,entry.kind,entry.delta FROM entries entry ${filter}
   ${query.type==='all'?Prisma.sql`WHERE entry.delta::numeric<>0`:Prisma.sql`AND entry.delta::numeric<>0`}
   ORDER BY entry.at DESC,entry.id DESC OFFSET ${(query.page-1)*pageSize} LIMIT ${pageSize+1}`;
 return {items:rows.slice(0,pageSize).map(row=>({...row,at:row.at.toISOString(),status:'confirmed' as const})),page:query.page,pageSize,hasNext:rows.length>pageSize};
}
export type WalletHistory=Awaited<ReturnType<typeof getWalletHistory>>;
