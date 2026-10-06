import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {effectiveStatus} from './catalog';
import {cachedPublicData} from '../cache/public-data';
import {allowIdentityRequest} from '@/lib/rate-limit';

const code=z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647));
export const activityCodesSchema=z.array(code).min(1).max(50).transform(values=>[...new Set(values)].sort((a,b)=>a-b));
export type AuctionActivity={code:string;views:string;bids:number;bidders:number;status:'live'|'upcoming'|'closing'|'closed'|'cancelled';startsAt:string;endsAt:string;resultReady:boolean};
const visibleAuction=Prisma.sql`a."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC'
 AND a.status IN ('SCHEDULED','LIVE','CLOSED','CANCELLED') AND a.slug IS NOT NULL AND a."testRunId" IS NULL
 AND EXISTS (SELECT 1 FROM "Product" p JOIN "Category" pc ON pc.id=p."categoryId" WHERE p.id=a."productId" AND p.visible AND pc.visible)
 AND EXISTS (SELECT 1 FROM "Category" c WHERE c.id=a."categoryId" AND c.visible)
 AND EXISTS (SELECT 1 FROM "AuctionTerms" t WHERE t."auctionId"=a.id)`;

export async function readAuctionActivity(client:PrismaClient,codes:number[]){
 return cachedPublicData(`auction-activity:${codes.join(',')}`,750,async()=>{
  const rows=await client.$queryRaw<Array<{code:string;views:string;bids:number;bidders:number;status:string;startsAt:Date;endsAt:Date;now:Date;resultReady:boolean}>>`
   SELECT a."publicCode"::text AS code,a."publicViewCount"::text AS views,a."acceptedBidCount" AS bids,
    (SELECT count(DISTINCT b."userId")::int FROM "Bid" b WHERE b."auctionId"=a.id) AS bidders,
    a.status,a."startsAt",a."endsAt",
    clock_timestamp() AT TIME ZONE 'UTC' AS now,
    (a.status IN ('CLOSED','CANCELLED') AND (EXISTS (SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
     OR EXISTS (SELECT 1 FROM "PublicAuctionResult" r WHERE r."auctionId"=a.id AND r."publishedAt"<=clock_timestamp() AT TIME ZONE 'UTC'))) AS "resultReady"
   FROM "Auction" a WHERE a."publicCode" IN (${Prisma.join(codes)}) AND ${visibleAuction}`;
  return rows.map(row=>({code:row.code,views:row.views,bids:row.bids,bidders:row.bidders,status:effectiveStatus(row,row.now),startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),resultReady:row.resultReady} satisfies AuctionActivity));
 });
}

export const AUCTION_VIEW_WINDOW_MS=24*60*60*1000;
/** One qualified impression per verified person and auction in a rolling day.
 * The database transaction deduplicates across tabs, devices and replicas. */
export async function recordAuctionView(client:PrismaClient,identifier:string,viewerId:string){
 if(!viewerId)throw Error('A verified viewer is required.');
 const parsed=code.safeParse(identifier);
 const match=parsed.success?Prisma.sql`a."publicCode"=${parsed.data}`:Prisma.sql`a.slug=${identifier}`;
 return client.$transaction(async tx=>{
  const [auction]=await tx.$queryRaw<Array<{id:string;views:string}>>`SELECT a.id,a."publicViewCount"::text AS views FROM "Auction" a WHERE ${match} AND ${visibleAuction} FOR UPDATE OF a`;
  if(!auction)return null;
  if(!await allowIdentityRequest(tx,'auction-view',`${auction.id}:${viewerId}`,1,AUCTION_VIEW_WINDOW_MS))return {views:auction.views,counted:false};
  const updated=await tx.auction.update({where:{id:auction.id},data:{publicViewCount:{increment:1}},select:{publicViewCount:true}});
  return {views:updated.publicViewCount.toString(),counted:true};
 });
}
