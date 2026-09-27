import { Prisma } from '@prisma/client';
import {legacyTermsInEtb} from '@/lib/money';
import { z } from 'zod';
import { db } from '@/lib/db';

// SQL selection and DTO mapping are independent allowlists. Never select the
// settlement proof, participant movements, winning user/bid IDs or raw bids here.
export const publicAuctionSelect = {
  slug:true,code:true,status:true,startsAt:true,endsAt:true,featured:true,isDemo:true,
  fulfillmentSummary:true,fulfillmentRegion:true,
  product:{select:{title:true,description:true,condition:true,images:{orderBy:{sortOrder:'asc'},select:{path:true,alt:true,sourceType:true,sourceCredit:true}}}},
  category:{select:{slug:true,name:true}},
  terms:{select:{version:true,ruleVersion:true,minPoints:true,maxPoints:true,stepPoints:true,entryFeePoints:true,maxDistinctBids:true,noWinnerTerms:true,cancellationTerms:true,fulfillmentSnapshot:true}},
  result:{select:{outcome:true,winningPoints:true,explanation:true,isDemo:true,closedAt:true,publishedAt:true}},
  settlement:{select:{outcome:true,winningPoints:true,completedAt:true}},
} satisfies Prisma.AuctionSelect;
type AuctionRow = Prisma.AuctionGetPayload<{ select: typeof publicAuctionSelect }>;
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(''),
  status: z.enum(['all','live','upcoming','closing','closed']).optional().default('all'),
  category: z.preprocess(value=>value===''?undefined:value,z.string().regex(/^[a-z0-9-]{1,80}$/).optional()),
  sort: z.enum(['ending','newest','title']).optional().default('ending'),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CatalogAuction = ReturnType<typeof toPublicAuction>;

export async function serverNow() {
  const rows = await db.$queryRaw<{now: Date}[]>`SELECT now() AS now`;
  return rows[0].now;
}
export function effectiveStatus(row: Pick<AuctionRow,'status'|'startsAt'|'endsAt'>, now: Date) {
  if (row.status === 'CANCELLED') return 'cancelled' as const;
  if (row.status === 'CLOSED') return 'closed' as const;
  if (row.endsAt && row.endsAt <= now) return 'closing' as const;
  if (row.startsAt && row.startsAt > now) return 'upcoming' as const;
  return 'live' as const;
}
export function publicWhere(now: Date): Prisma.AuctionWhereInput {
  return { publishedAt: { lte: now }, status: { in: ['SCHEDULED','LIVE','CLOSED','CANCELLED'] }, slug: { not: null },
    product: { is: { visible: true, category: { visible: true } } }, category: { is: { visible: true } }, terms: { isNot: null } };
}
function statusWhere(status: CatalogQuery['status'], now: Date): Prisma.AuctionWhereInput {
  if (status === 'live') return {status:{in:['SCHEDULED','LIVE']},startsAt:{lte:now},endsAt:{gt:now}};
  if (status === 'upcoming') return {status:{in:['SCHEDULED','LIVE']},startsAt:{gt:now}};
  if (status === 'closing') return {status:{in:['SCHEDULED','LIVE']},endsAt:{lte:now}};
  if (status === 'closed') return {status:{in:['CLOSED','CANCELLED']}};
  return {};
}
export function toPublicAuction(row: AuctionRow, now: Date) {
  const status = effectiveStatus(row,now);
  const settled=row.settlement;
  const result=settled&&['closed','cancelled'].includes(status)?{
    outcome:settled.outcome,winningPoints:settled.winningPoints?.toString()??null,
    explanation:settled.outcome==='WINNER'?'The winning ETB amount was the smallest amount accepted exactly once. All other holds were released.':settled.outcome==='NO_WINNER'?'No accepted amount was unique. All holds were released; disclosed entry fees were retained.':'The auction was cancelled before settlement. All holds and charged entry fees were returned.',
    isDemo:row.isDemo,closedAt:settled.completedAt.toISOString(),source:'SETTLED' as const,
    demoLabel:row.isDemo?'DEMO · settled test':null,winnerDisplay:settled.outcome==='WINNER'?'Anonymous winner':null,
  }:status==='closed'&&row.result&&row.result.publishedAt<=now?{
    outcome:row.result.outcome,winningPoints:row.result.winningPoints?.toString()??null,
    explanation:legacyTermsInEtb(row.result.explanation),isDemo:row.result.isDemo,closedAt:row.result.closedAt.toISOString(),source:'ILLUSTRATIVE' as const,
    demoLabel:'DEMO example',winnerDisplay:null,
  }:null;
  return {
    slug:row.slug!,code:row.code,status,featured:row.featured,isDemo:row.isDemo,
    startsAt:row.startsAt!.toISOString(),endsAt:row.endsAt!.toISOString(),
    product:{title:row.product!.title,description:row.product!.description,condition:row.product!.condition,
      images:row.product!.images.map(image=>({path:image.path,alt:image.alt,sourceType:image.sourceType,sourceCredit:image.sourceCredit}))},
    category:{slug:row.category!.slug,name:row.category!.name},
    fulfillment:{summary:row.fulfillmentSummary!,region:row.fulfillmentRegion!},
    terms:{version:row.terms!.version,ruleVersion:row.terms!.ruleVersion,minPoints:row.terms!.minPoints.toString(),maxPoints:row.terms!.maxPoints.toString(),stepPoints:row.terms!.stepPoints.toString(),entryFeePoints:row.terms!.entryFeePoints.toString(),maxDistinctBids:row.terms!.maxDistinctBids,noWinnerTerms:legacyTermsInEtb(row.terms!.noWinnerTerms),cancellationTerms:legacyTermsInEtb(row.terms!.cancellationTerms),fulfillmentSnapshot:row.terms!.fulfillmentSnapshot},
    result,
  };
}
export async function listAuctions(input: CatalogQuery, now?: Date, pageSize = 6) {
  now ??= await serverNow();
  const query = catalogQuerySchema.parse(input);
  const where: Prisma.AuctionWhereInput = {AND:[publicWhere(now),statusWhere(query.status,now),
    query.category?{category:{is:{slug:query.category}}}:{},
    query.q?{OR:[{code:{contains:query.q,mode:'insensitive'}},{product:{is:{title:{contains:query.q,mode:'insensitive'}}}}]}:{}]};
  const orderBy: Prisma.AuctionOrderByWithRelationInput[] = query.sort==='newest' ? [{publishedAt:'desc'},{id:'asc'}] : query.sort==='title' ? [{product:{title:'asc'}},{id:'asc'}] : query.status==='closed' ? [{endsAt:'desc'},{id:'asc'}] : query.status==='upcoming' ? [{startsAt:'asc'},{id:'asc'}] : [{endsAt:'asc'},{id:'asc'}];
  let rows: AuctionRow[];
  let total: number;
  if (query.status==='all' && query.sort==='ending') {
    // One database-ordered page: active end times, future start times, then recent closes.
    const categoryFilter=query.category?Prisma.sql`AND c.slug = ${query.category}`:Prisma.empty;
    const searchFilter=query.q?Prisma.sql`AND (p.title ILIKE ${`%${query.q}%`} OR a.code ILIKE ${`%${query.q}%`})`:Prisma.empty;
    const ids=await db.$queryRaw<{id:string}[]>`
      SELECT a.id FROM "Auction" a
      JOIN "Product" p ON p.id = a."productId"
      JOIN "Category" pc ON pc.id = p."categoryId"
      JOIN "Category" c ON c.id = a."categoryId"
      JOIN "AuctionTerms" t ON t."auctionId" = a.id
      WHERE a."publishedAt" <= ${now} AND a.status IN ('SCHEDULED','LIVE','CLOSED','CANCELLED')
        AND a.slug IS NOT NULL AND p.visible AND pc.visible AND c.visible ${categoryFilter} ${searchFilter}
      ORDER BY CASE WHEN a.status IN ('CLOSED','CANCELLED') OR a."endsAt" <= ${now} THEN 2
                    WHEN a."startsAt" > ${now} THEN 1 ELSE 0 END,
               CASE WHEN a.status IN ('SCHEDULED','LIVE') AND a."startsAt" <= ${now} AND a."endsAt" > ${now} THEN a."endsAt" END ASC,
               CASE WHEN a."startsAt" > ${now} THEN a."startsAt" END ASC,
               CASE WHEN a.status IN ('CLOSED','CANCELLED') OR a."endsAt" <= ${now} THEN a."endsAt" END DESC,
               a.id ASC
      LIMIT ${pageSize} OFFSET ${(query.page-1)*pageSize}`;
    const found=ids.length?await db.auction.findMany({where:{id:{in:ids.map(item=>item.id)}},select:{...publicAuctionSelect,id:true}}):[];
    const byId=new Map(found.map(item=>[item.id,item]));
    rows=ids.map(item=>byId.get(item.id)!).filter(Boolean);
    total=await db.auction.count({where});
  } else [rows,total] = await db.$transaction([db.auction.findMany({where,select:publicAuctionSelect,orderBy,skip:(query.page-1)*pageSize,take:pageSize}),db.auction.count({where})]);
  return {items:rows.map(row=>toPublicAuction(row,now)),total,page:query.page,pageSize,totalPages:Math.ceil(total/pageSize),serverNow:now.toISOString()};
}
export async function getAuction(slug: string, now?: Date) {
  now ??= await serverNow();
  const row = await db.auction.findFirst({where:{AND:[publicWhere(now),{slug}]},select:publicAuctionSelect});
  return row?toPublicAuction(row,now):null;
}
export async function listCategories(now?: Date) {
  now ??= await serverNow();
  const [categories,auctions] = await db.$transaction([
    db.category.findMany({where:{visible:true},orderBy:[{sortOrder:'asc'},{name:'asc'}],select:{slug:true,name:true,description:true,requiresEligibilityReview:true,id:true}}),
    db.auction.findMany({where:publicWhere(now),select:{categoryId:true,status:true,startsAt:true,endsAt:true}}),
  ]);
  return categories.map(({id,...category})=>({ ...category, counts:auctions.reduce((counts,row)=>{if(row.categoryId===id){const status=effectiveStatus(row,now);if(status!=='closing')counts[status==='cancelled'?'closed':status]++;counts.all++;}return counts;},{all:0,live:0,upcoming:0,closed:0}) }));
}
export async function getCategory(slug: string, now?: Date) {
  now ??= await serverNow();
  const categories=await listCategories(now);
  return categories.find(category=>category.slug===slug)??null;
}
export async function listResults(page = 1, now?: Date) {
  now ??= await serverNow();
  const where: Prisma.AuctionWhereInput = {AND:[publicWhere(now),statusWhere('closed',now),{result:{is:{publishedAt:{lte:now}}}}]};
  const [rows,total]=await db.$transaction([db.auction.findMany({where,select:publicAuctionSelect,orderBy:[{endsAt:'desc'},{id:'asc'}],skip:(page-1)*6,take:6}),db.auction.count({where})]);
  return {items:rows.map(row=>toPublicAuction(row,now)),total,page,totalPages:Math.ceil(total/6)};
}
export async function getResult(code: string, now?: Date) {
  now ??= await serverNow();
  const row=await db.auction.findFirst({where:{AND:[publicWhere(now),statusWhere('closed',now),{code,result:{is:{publishedAt:{lte:now}}}}]},select:publicAuctionSelect});
  return row?toPublicAuction(row,now):null;
}
