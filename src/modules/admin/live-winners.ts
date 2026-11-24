import {Prisma,type PrismaClient} from '@prisma/client';
import {RULE_V1,RULE_V2,RULE_V3,RULE_V4,RULE_V5} from '../auctions/rules';
import {safeResultIdentity} from '../auctions/result-identity';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';

const pageSize=25;
const supportedRules=[RULE_V1,RULE_V2,RULE_V3,RULE_V4,RULE_V5];
type NoLeaderReason='NO_BIDS'|'MINIMUM_PARTICIPANTS'|'NO_UNIQUE_BID';
type LiveAuctionRow={
 auctionId:string;publicCode:number;title:string;endsAt:Date;ruleVersion:string;
 bidderName:string|null;amount:string|null;reason:NoLeaderReason|null;
};
type SnapshotRow={total:number;serverNow:Date}&(LiveAuctionRow|{auctionId:null});

export async function readLiveWinners(client:PrismaClient,actor:{role:StaffRole},{page,q}:{page:number;q:string}){
 if(actor.role!=='OWNER')throw new AdminError(403,'Only the Owner can view provisional live winners.');
 const title=Prisma.sql`COALESCE(NULLIF(a.presentation->>'title',''),p.title)`;
 const search=q?Prisma.sql`AND (strpos(lower(${title}),lower(${q}))>0 OR strpos(a."publicCode"::text,${q})>0)`:Prisma.empty;
 // Count the live catalog and choose only page-sized candidates before
 // reading accepted bids. One database snapshot handles concurrent bids.
 const rows=await client.$queryRaw<SnapshotRow[]>(Prisma.sql`
  WITH observed AS (SELECT statement_timestamp() AT TIME ZONE 'UTC' AS "serverNow"),
  live AS MATERIALIZED (
   SELECT a.id AS "auctionId",a."publicCode",${title} AS title,a."endsAt",t."ruleVersion",t."minParticipants"
   FROM "Auction" a
   JOIN "AuctionTerms" t ON t."auctionId"=a.id
   JOIN "Product" p ON p.id=a."productId" AND p.visible
   JOIN "Category" pc ON pc.id=p."categoryId" AND pc.visible
   JOIN "Category" ac ON ac.id=a."categoryId" AND ac.visible
   CROSS JOIN observed
   WHERE a.status IN ('SCHEDULED','LIVE') AND a.slug IS NOT NULL
     AND a."publishedAt"<=observed."serverNow" AND a."startsAt"<=observed."serverNow" AND a."endsAt">observed."serverNow"
     AND NOT a."isDemo" AND NOT a."isSettlementFixture" AND a."testRunId" IS NULL
     AND t."ruleVersion" IN (${Prisma.join(supportedRules)})
     AND NOT EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
     AND NOT EXISTS (SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id)
     ${search}
  ),
  selected AS MATERIALIZED (
   SELECT * FROM live ORDER BY "endsAt","auctionId" LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}
  )
  SELECT observed."serverNow",inventory.total,s."auctionId",s."publicCode",s.title,s."endsAt",s."ruleVersion",
    candidate."bidderName",candidate.amount,candidate.reason
  FROM observed
  CROSS JOIN (SELECT COUNT(*)::int AS total FROM live) inventory
  LEFT JOIN selected s ON true
  LEFT JOIN LATERAL (
   WITH eligible AS MATERIALIZED (
    SELECT b.amount,b."userId" FROM "Bid" b
    WHERE b."auctionId"=s."auctionId" AND b."acceptedAt"<s."endsAt" AND b."acceptedAt"<=observed."serverNow"
   ),
   participation AS (SELECT COUNT(DISTINCT "userId") AS participants FROM eligible),
   lowest AS (
    SELECT amount,MIN("userId") AS "userId" FROM eligible GROUP BY amount
    HAVING COUNT(*)=1 ORDER BY amount LIMIT 1
   )
   SELECT u.name AS "bidderName",l.amount::text AS amount,
    CASE WHEN participation.participants=0 THEN 'NO_BIDS'
      WHEN s."ruleVersion"<>${RULE_V1} AND participation.participants<s."minParticipants" THEN 'MINIMUM_PARTICIPANTS'
      WHEN l.amount IS NULL THEN 'NO_UNIQUE_BID'
    END AS reason
   FROM participation
   LEFT JOIN lowest l ON s."ruleVersion"=${RULE_V1} OR participation.participants>=s."minParticipants"
   LEFT JOIN "user" u ON u.id=l."userId"
  ) candidate ON s."auctionId" IS NOT NULL
  ORDER BY s."endsAt",s."auctionId"
 `);
 const [{total,serverNow}]=rows;
 const items=rows.flatMap(row=>row.auctionId===null?[]:[{
  auctionId:row.auctionId,publicCode:row.publicCode,title:row.title,endsAt:row.endsAt.toISOString(),ruleVersion:row.ruleVersion,
  leader:row.reason===null&&row.amount!==null?{
   bidderName:safeResultIdentity({name:row.bidderName}).displayName??'Player',amount:new Prisma.Decimal(row.amount).toString(),
  }:null,
  reason:row.reason,
 }]);
 return {items,page,total,totalPages:Math.ceil(total/pageSize),serverNow:serverNow.toISOString()};
}
