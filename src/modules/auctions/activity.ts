import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {effectiveStatus} from './catalog';
import {cachedPublicData} from '../cache/public-data';

const code=z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647));
export const activityCodesSchema=z.array(code).min(1).max(50).transform(values=>[...new Set(values)].sort((a,b)=>a-b));
export type AuctionActivity={code:string;views:string;bids:number;status:'live'|'upcoming'|'closing'|'closed'|'cancelled';startsAt:string;endsAt:string;resultReady:boolean};
const visibleAuction=Prisma.sql`a."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC'
 AND a.status IN ('SCHEDULED','LIVE','CLOSED','CANCELLED') AND a.slug IS NOT NULL AND a."testRunId" IS NULL
 AND EXISTS (SELECT 1 FROM "Product" p JOIN "Category" pc ON pc.id=p."categoryId" WHERE p.id=a."productId" AND p.visible AND pc.visible)
 AND EXISTS (SELECT 1 FROM "Category" c WHERE c.id=a."categoryId" AND c.visible)
 AND EXISTS (SELECT 1 FROM "AuctionTerms" t WHERE t."auctionId"=a.id)`;

export async function readAuctionActivity(client:PrismaClient,codes:number[]){
 return cachedPublicData(`auction-activity:${codes.join(',')}`,750,async()=>{
  const rows=await client.$queryRaw<Array<{code:string;views:string;bids:number;status:string;startsAt:Date;endsAt:Date;now:Date;resultReady:boolean}>>`
   SELECT a."publicCode"::text AS code,a."publicViewCount"::text AS views,a."acceptedBidCount" AS bids,a.status,a."startsAt",a."endsAt",
    clock_timestamp() AT TIME ZONE 'UTC' AS now,
    (a.status IN ('CLOSED','CANCELLED') AND (EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
     OR EXISTS (SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id AND r."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC'))) AS "resultReady"
   FROM "Auction" a WHERE a."publicCode" IN (${Prisma.join(codes)}) AND ${visibleAuction}`;
  return rows.map(row=>({code:row.code,views:row.views,bids:row.bids,status:effectiveStatus(row,row.now),startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),resultReady:row.resultReady} satisfies AuctionActivity));
 });
}

/** A single atomic statement records a visible product view and returns its count. */
export async function recordAuctionView(client:PrismaClient,identifier:string){
 const parsed=code.safeParse(identifier);
 const match=parsed.success?Prisma.sql`a."publicCode"=${parsed.data}`:Prisma.sql`a.slug=${identifier}`;
 const rows=await client.$queryRaw<Array<{views:string}>>`UPDATE "Auction" a SET "publicViewCount"=a."publicViewCount"+1
  WHERE ${match} AND ${visibleAuction} RETURNING a."publicViewCount"::text AS views`;
 return rows[0]??null;
}
