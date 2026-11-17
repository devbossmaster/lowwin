import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import type {PersonalBidListItem} from './bid-list';
import {ownAuctionRefunds} from './auction-refunds';
import type {AuctionRefundView} from '@/lib/auction-refund';

const bidCursorSchema=z.object({at:z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/),id:z.string().uuid()}).strict();
function decodeCursor(value:string|undefined){
 if(!value)return null;
 try{return bidCursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')))}catch{throw new z.ZodError([{code:'custom',path:['bidCursor'],message:'Invalid bid cursor'}])}
}
export const personalBidAuctionListQuerySchema=z.object({
 view:z.preprocess(value=>value==='history'?'finished':value,z.enum(['live','finished']).default('live')),
 page:z.coerce.number().int().min(1).max(1000).default(1),language:z.enum(['en','am']).optional(),
 grouped:z.literal('1'),auction:z.string().regex(/^\d{1,10}$/).optional(),bidCursor:z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict().refine(value=>!value.bidCursor||!!value.auction,{path:['bidCursor'],message:'An auction is required for bid continuation'});

export type PersonalBidAuctionGroup={auction:PersonalBidListItem['auction'];outcome:PersonalBidListItem['outcome'];refund?:AuctionRefundView;bids:Array<Omit<PersonalBidListItem,'auction'>>;bidCount:number;hasMoreBids:boolean;nextBidCursor:string|null};
export type PersonalBidAuctionList={items:PersonalBidAuctionGroup[];page:number;pageSize:number;hasNext:boolean;serverNow:string};
type BidRow={id:string;amount:string;acceptedAt:string;outcome:PersonalBidListItem['outcome'];cursorAt:string};
type GroupRow={id:string;ruleVersion:string|null;code:string;slug:string|null;status:string;title:string;titleAm:string|null;imagePath:string|null;imageAlt:string|null;startsAt:string|null;endsAt:string|null;isDemo:boolean;outcome:PersonalBidListItem['outcome'];bidCount:number;bids:BidRow[]};

/** Page auctions first, then fetch their owned accepted numbers in one bounded
 * statement. An auction never reappears merely because it has >20 bids. Normal
 * 100-number auctions arrive together; legacy larger groups have an owned,
 * timestamp/ID cursor rather than silently truncating or unbounded responses. */
export async function getPersonalBidAuctionList(client:PrismaClient,userId:string,input:unknown):Promise<PersonalBidAuctionList>{
 const query=personalBidAuctionListQuerySchema.parse(input),cursor=decodeCursor(query.bidCursor),pageSize=10,bidLimit=100;
 const accepting=Prisma.sql`a.status IN ('SCHEDULED','LIVE') AND a."startsAt"<=clock.now AND a."endsAt">clock.now AND s.id IS NULL`;
 const membership=query.view==='live'?accepting:Prisma.sql`NOT coalesce((${accepting}),false)`;
 const auctionFilter=query.auction?Prisma.sql`AND a."publicCode"::text=${query.auction}`:Prisma.empty;
 const continuation=cursor?Prisma.sql`AND (b."acceptedAt",b.id)<(${cursor.at}::timestamp,${cursor.id})`:Prisma.empty;
 const [result]=await client.$queryRaw<Array<{serverNow:Date;rows:GroupRow[];hasNext:boolean}>>`
  WITH clock AS MATERIALIZED (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now),
  auction_page AS MATERIALIZED (
   SELECT a.id,max(b."acceptedAt") AS latest
   FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" CROSS JOIN clock
   LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id
   WHERE b."userId"=${userId} AND ${membership} ${auctionFilter}
   GROUP BY a.id ORDER BY latest DESC,a.id DESC
   OFFSET ${query.auction?0:(query.page-1)*pageSize} LIMIT ${query.auction?1:pageSize+1}
  ), selected AS (SELECT * FROM auction_page ORDER BY latest DESC,id DESC LIMIT ${pageSize}),
  auction_groups AS (
   SELECT a.id,selected.latest,t."ruleVersion",a."publicCode"::text AS code,a.slug,a.status,a."isDemo",
    a."startsAt" AT TIME ZONE 'UTC' AS "startsAt",a."endsAt" AT TIME ZONE 'UTC' AS "endsAt",
    CASE WHEN jsonb_typeof(a.presentation->'title')='string' THEN a.presentation->>'title' ELSE coalesce(p.title,a."publicCode"::text) END AS title,
    CASE WHEN jsonb_typeof(a.presentation->'titleAm')='string' THEN a.presentation->>'titleAm' ELSE p."titleAm" END AS "titleAm",
    CASE WHEN jsonb_typeof(a.presentation->'images')='array' THEN a.presentation->'images'->0->>'path' ELSE image.path END AS "imagePath",
    CASE WHEN jsonb_typeof(a.presentation->'images')='array' THEN a.presentation->'images'->0->>'alt' ELSE image.alt END AS "imageAlt",
    totals.count AS "bidCount",numbers.rows AS bids,
    CASE WHEN a.status='CANCELLED' THEN 'CANCELLED' WHEN ${accepting} THEN 'LIVE'
     WHEN rp."publishedAt"<=clock.now THEN CASE WHEN s.outcome='WINNER' THEN
      CASE WHEN EXISTS(SELECT 1 FROM "Bid" winner WHERE winner.id=s."winningBidId" AND winner."userId"=${userId} AND winner."auctionId"=a.id) THEN 'WON' ELSE 'LOST' END
      WHEN s.outcome='CANCELLED' THEN 'CANCELLED' WHEN s.outcome='NO_WINNER' THEN 'NO_WINNER' ELSE 'PENDING' END ELSE 'PENDING' END AS outcome
   FROM selected JOIN "Auction" a ON a.id=selected.id CROSS JOIN clock
   LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id LEFT JOIN "Product" p ON p.id=a."productId"
   LEFT JOIN LATERAL (SELECT pi.path,pi.alt FROM "ProductImage" pi WHERE pi."productId"=p.id ORDER BY pi."sortOrder" LIMIT 1) image ON true
   LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id LEFT JOIN "ResultPublication" rp ON rp."settlementId"=s.id
   CROSS JOIN LATERAL (SELECT count(*)::int AS count FROM "Bid" b WHERE b."userId"=${userId} AND b."auctionId"=a.id) totals
   CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(to_jsonb(number_page) ORDER BY number_page."cursorAt" DESC,number_page.id DESC),'[]'::jsonb) AS rows FROM (
     SELECT b.id,b.amount::text,b."acceptedAt" AT TIME ZONE 'UTC' AS "acceptedAt",b."acceptedAt"::text AS "cursorAt",
      CASE WHEN a.status='CANCELLED' THEN 'CANCELLED' WHEN ${accepting} THEN 'LIVE'
       WHEN rp."publishedAt"<=clock.now THEN CASE WHEN s.outcome='WINNER' THEN CASE WHEN s."winningBidId"=b.id THEN 'WON' ELSE 'LOST' END
        WHEN s.outcome='CANCELLED' THEN 'CANCELLED' WHEN s.outcome='NO_WINNER' THEN 'NO_WINNER' ELSE 'PENDING' END ELSE 'PENDING' END AS outcome
     FROM "Bid" b WHERE b."userId"=${userId} AND b."auctionId"=a.id ${continuation}
     ORDER BY b."acceptedAt" DESC,b.id DESC LIMIT ${bidLimit+1}
    ) number_page
   ) numbers
  )
  SELECT clock.now AT TIME ZONE 'UTC' AS "serverNow",(SELECT count(*)>${pageSize} FROM auction_page) AS "hasNext",
   coalesce(jsonb_agg(to_jsonb(auction_groups) ORDER BY auction_groups.latest DESC,auction_groups.id DESC) FILTER (WHERE auction_groups.id IS NOT NULL),'[]'::jsonb) AS rows
  FROM clock LEFT JOIN auction_groups ON true GROUP BY clock.now`;
 const items=result.rows.map(row=>{
  const bids=row.bids.slice(0,bidLimit),last=bids.at(-1),hasMoreBids=row.bids.length>bidLimit;
  return {auction:{ruleVersion:row.ruleVersion,code:row.code,slug:row.slug,status:row.status,title:row.title,titleAm:row.titleAm,image:row.imagePath?{path:row.imagePath,alt:row.imageAlt??row.title}:null,startsAt:row.startsAt?new Date(row.startsAt).toISOString():null,endsAt:row.endsAt?new Date(row.endsAt).toISOString():null,isDemo:row.isDemo},outcome:row.outcome,bids:bids.map(bid=>({id:bid.id,amount:bid.amount,acceptedAt:new Date(bid.acceptedAt).toISOString(),outcome:bid.outcome})),bidCount:row.bidCount,hasMoreBids,nextBidCursor:hasMoreBids&&last?Buffer.from(JSON.stringify({at:last.cursorAt,id:last.id})).toString('base64url'):null};
 });
 const refunds=await ownAuctionRefunds(client,userId,items.filter(item=>item.outcome==='CANCELLED'&&item.auction.ruleVersion==='lowest-unique-v5').map(item=>item.auction.code));
 return {items:items.map(item=>({...item,...(refunds.has(item.auction.code)?{refund:refunds.get(item.auction.code)!}:{})})),page:query.auction?1:query.page,pageSize,hasNext:result.hasNext,serverNow:result.serverNow.toISOString()};
}
