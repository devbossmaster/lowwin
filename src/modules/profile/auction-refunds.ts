import {Prisma,type PrismaClient} from '@prisma/client';
import type {AuctionRefundView} from '@/lib/auction-refund';

/** One bounded, owner-scoped read for an entire visible auction page. Amounts
 * describe committed refunds; pending intents never masquerade as credits. */
export async function ownAuctionRefunds(client:PrismaClient|Prisma.TransactionClient,userId:string,codes:string[]){
 const unique=[...new Set(codes)].slice(0,20);if(!unique.length)return new Map<string,AuctionRefundView>();
 const rows=await client.$queryRaw<Array<{code:string;status:string;cash:string;bonus:string;bonusExpired:string;completedAt:Date|null}>>(Prisma.sql`
  SELECT a."publicCode"::text AS code,r.status,
   CASE WHEN r.status='COMPLETED' THEN r."cashPoints" ELSE 0 END::text AS cash,
   (COALESCE(sum(b."creditedCents"),0)::numeric/100)::text AS bonus,
   (COALESCE(sum(b."expiredCents"),0)::numeric/100)::text AS "bonusExpired",r."completedAt"
  FROM "AuctionRefund" r JOIN "AuctionSettlement" s ON s.id=r."settlementId"
  JOIN "Auction" a ON a.id=s."auctionId" LEFT JOIN "DepositBonusRefund" b ON b."refundId"=r.id
  WHERE r."userId"=${userId} AND s.outcome='CANCELLED' AND a."publicCode"::text IN (${Prisma.join(unique)})
  GROUP BY a."publicCode",r.id,r.status,r."cashPoints",r."completedAt"`);
 return new Map<string,AuctionRefundView>(rows.map(row=>[row.code,{status:row.status==='COMPLETED'?'completed':'pending',cash:row.cash,bonus:row.bonus,bonusExpired:row.bonusExpired,completedAt:row.completedAt?.toISOString()??null}]));
}
