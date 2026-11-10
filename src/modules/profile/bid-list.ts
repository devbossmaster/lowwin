import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';

export const personalBidListQuerySchema=z.object({
  // Keep older bookmarked history links usable; new clients emit finished.
  view:z.preprocess(value=>value==='history'?'finished':value,z.enum(['live','finished']).default('live')),
  page:z.coerce.number().int().min(1).max(1000).default(1),
  language:z.enum(['en','am']).optional(),
}).strict();

export type PersonalBidListItem={
  id:string;amount:string;acceptedAt:string;
  outcome:'LIVE'|'PENDING'|'WON'|'LOST'|'CANCELLED'|'NO_WINNER';
  auction:{ruleVersion:string|null;code:string;slug:string|null;status:string;title:string;titleAm:string|null;image:{path:string;alt:string}|null;startsAt:string|null;endsAt:string|null;isDemo:boolean};
};
type BidListRow={id:string;amount:string;acceptedAt:string;outcome:PersonalBidListItem['outcome'];ruleVersion:string|null;code:string;slug:string|null;status:string;title:string;titleAm:string|null;imagePath:string|null;imageAlt:string|null;startsAt:string|null;endsAt:string|null;isDemo:boolean};

/** Owner-only accepted records, not checkout attempts or financial receipts.
 * One bounded statement shares a database clock/snapshot for page membership
 * and outcomes. Product copy, thumbnail and result state arrive together; no
 * ledger/provider reads, counters, or per-row requests are needed by this list.
 */
export async function getPersonalBidList(client:PrismaClient,userId:string,input:unknown={}){
  const query=personalBidListQuerySchema.parse(input),pageSize=20;
  const accepting=Prisma.sql`a.status IN ('SCHEDULED','LIVE') AND a."startsAt"<=clock.now AND a."endsAt">clock.now AND s.id IS NULL`;
  const membership=query.view==='live'?accepting:Prisma.sql`NOT coalesce((${accepting}),false)`;
  const [result]=await client.$queryRaw<Array<{serverNow:Date;rows:BidListRow[]}>>`
    WITH clock AS MATERIALIZED (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now),
    bid_page AS (
      SELECT b.id,b.amount::text,b."acceptedAt" AT TIME ZONE 'UTC' AS "acceptedAt",
        t."ruleVersion",a."publicCode"::text AS code,a.slug,a.status,a."isDemo",
        a."startsAt" AT TIME ZONE 'UTC' AS "startsAt",a."endsAt" AT TIME ZONE 'UTC' AS "endsAt",
        CASE WHEN jsonb_typeof(a.presentation->'title')='string' THEN a.presentation->>'title' ELSE coalesce(p.title,a."publicCode"::text) END AS title,
        CASE WHEN jsonb_typeof(a.presentation->'titleAm')='string' THEN a.presentation->>'titleAm' ELSE p."titleAm" END AS "titleAm",
        CASE WHEN jsonb_typeof(a.presentation->'images')='array' THEN a.presentation->'images'->0->>'path' ELSE image.path END AS "imagePath",
        CASE WHEN jsonb_typeof(a.presentation->'images')='array' THEN a.presentation->'images'->0->>'alt' ELSE image.alt END AS "imageAlt",
        CASE WHEN a.status='CANCELLED' THEN 'CANCELLED'
          WHEN ${accepting} THEN 'LIVE'
          WHEN rp."publishedAt"<=clock.now THEN
            CASE WHEN s.outcome='WINNER' THEN CASE WHEN s."winningBidId"=b.id THEN 'WON' ELSE 'LOST' END
              WHEN s.outcome='CANCELLED' THEN 'CANCELLED'
              WHEN s.outcome='NO_WINNER' THEN 'NO_WINNER' ELSE 'PENDING' END
          ELSE 'PENDING' END AS outcome
      FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId" CROSS JOIN clock
      LEFT JOIN "AuctionTerms" t ON t."auctionId"=a.id
      LEFT JOIN "Product" p ON p.id=a."productId"
      LEFT JOIN LATERAL (SELECT pi.path,pi.alt FROM "ProductImage" pi WHERE pi."productId"=p.id ORDER BY pi."sortOrder" LIMIT 1) image ON true
      LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id
      LEFT JOIN "ResultPublication" rp ON rp."settlementId"=s.id
      WHERE b."userId"=${userId} AND ${membership}
      ORDER BY b."acceptedAt" DESC,b.id DESC OFFSET ${(query.page-1)*pageSize} LIMIT ${pageSize+1}
    )
    SELECT clock.now AT TIME ZONE 'UTC' AS "serverNow",
      coalesce(jsonb_agg(to_jsonb(bid_page) ORDER BY bid_page."acceptedAt" DESC,bid_page.id DESC) FILTER (WHERE bid_page.id IS NOT NULL),'[]'::jsonb) AS rows
    FROM clock LEFT JOIN bid_page ON true GROUP BY clock.now`;
  const items:PersonalBidListItem[]=result.rows.slice(0,pageSize).map(row=>({
    id:row.id,amount:row.amount,acceptedAt:new Date(row.acceptedAt).toISOString(),outcome:row.outcome,
    auction:{ruleVersion:row.ruleVersion,code:row.code,slug:row.slug,status:row.status,title:row.title,titleAm:row.titleAm,
      image:row.imagePath?{path:row.imagePath,alt:row.imageAlt??row.title}:null,
      startsAt:row.startsAt?new Date(row.startsAt).toISOString():null,endsAt:row.endsAt?new Date(row.endsAt).toISOString():null,isDemo:row.isDemo},
  }));
  return {items,page:query.page,pageSize,hasNext:result.rows.length>pageSize,serverNow:result.serverNow.toISOString()};
}
export type PersonalBidList=Awaited<ReturnType<typeof getPersonalBidList>>;
