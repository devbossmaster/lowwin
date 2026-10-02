import {resultExplanation} from './rules';
import { Prisma } from '@prisma/client';
import {legacyTermsInEtb} from '@/lib/money';
import { z } from 'zod';
import { db } from '@/lib/db';
import {cachedPublicData} from '@/modules/cache/public-data';

// SQL selection and DTO mapping are independent allowlists. Never select the
// settlement proof, participant movements, winning user/bid IDs or raw bids here.
// Only the completed winner's name and contact suffix enter the public result.
export const publicAuctionSelect = {
  slug:true,code:true,publicCode:true,status:true,startsAt:true,endsAt:true,featured:true,isDemo:true,acceptedBidCount:true,publicViewCount:true,presentation:true,
  fulfillmentSummary:true,fulfillmentSummaryAm:true,fulfillmentRegion:true,fulfillmentRegionAm:true,
  product:{select:{title:true,titleAm:true,description:true,descriptionAm:true,condition:true,conditionAm:true,images:{orderBy:{sortOrder:'asc'},select:{path:true,alt:true,sourceType:true,sourceCredit:true}}}},
  category:{select:{slug:true,name:true,nameAm:true}},
  terms:{select:{version:true,ruleVersion:true,minParticipants:true,minPoints:true,maxPoints:true,stepPoints:true,entryFeePoints:true,maxDistinctBids:true,noWinnerTerms:true,cancellationTerms:true,fulfillmentSnapshot:true}},
  feeRevisions:{orderBy:[{effectiveAt:'desc' as const},{version:'desc' as const}],take:1,select:{version:true,feePoints:true}},
  result:{select:{outcome:true,winningPoints:true,explanation:true,isDemo:true,closedAt:true,publishedAt:true}},
  settlement:{select:{decision:true,outcome:true,winningPoints:true,completedAt:true,winner:{select:{name:true,ownContact:{select:{lastFour:true,revokedAt:true}}}}}},
} satisfies Prisma.AuctionSelect;
type AuctionRow = Prisma.AuctionGetPayload<{ select: typeof publicAuctionSelect }>;
const presentationSchema=z.object({title:z.string(),titleAm:z.string().nullable().optional(),description:z.string(),descriptionAm:z.string().nullable().optional(),condition:z.string(),conditionAm:z.string().nullable().optional(),images:z.array(z.object({path:z.string(),alt:z.string(),sourceType:z.string(),sourceCredit:z.string().nullable().optional()}))}).strict();
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
  const timestamp=await cachedPublicData('public-clock',1000,async()=>{
    const rows = await db.$queryRaw<{now: Date}[]>`SELECT now() AS now`;
    return rows[0].now.toISOString();
  });
  return new Date(timestamp);
}
export function effectiveStatus(row: Pick<AuctionRow,'status'|'startsAt'|'endsAt'>, now: Date) {
  if (row.status === 'CANCELLED') return 'cancelled' as const;
  if (row.status === 'CLOSED') return 'closed' as const;
  if (row.endsAt && row.endsAt <= now) return 'closing' as const;
  if (row.startsAt && row.startsAt > now) return 'upcoming' as const;
  return 'live' as const;
}
export function publicWhere(now: Date): Prisma.AuctionWhereInput {
  return { publishedAt: { lte: now }, status: { in: ['SCHEDULED','LIVE','CLOSED','CANCELLED'] }, slug: { not: null },testRunId:null,
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
  const presentation=presentationSchema.safeParse(row.presentation);
  const product=presentation.success?presentation.data:row.product!;
  const settled=row.settlement;
  const result=settled&&['closed','cancelled'].includes(status)?{
    outcome:settled.outcome,winningPoints:settled.winningPoints?.toString()??null,
    decision:settled.decision,explanation:resultExplanation(settled.outcome,settled.decision),
    isDemo:row.isDemo,closedAt:settled.completedAt.toISOString(),source:'SETTLED' as const,
    demoLabel:row.isDemo?'DEMO · settled test':null,winnerDisplay:settled.outcome==='WINNER'?(settled.winner?.name.trim()||null):null,
    winnerPhoneMasked:settled.outcome==='WINNER'&&settled.winner?.ownContact&&!settled.winner.ownContact.revokedAt&&/^\d{4}$/.test(settled.winner.ownContact.lastFour)?`********${settled.winner.ownContact.lastFour.slice(-2)}`:null,
    acceptedBidCount:row.acceptedBidCount,
  }:status==='closed'&&row.result&&row.result.publishedAt<=now?{
    outcome:row.result.outcome,winningPoints:row.result.winningPoints?.toString()??null,
    decision:null,explanation:legacyTermsInEtb(row.result.explanation),isDemo:row.result.isDemo,closedAt:row.result.closedAt.toISOString(),source:'ILLUSTRATIVE' as const,
    demoLabel:'DEMO example',winnerDisplay:null,winnerPhoneMasked:null,
    acceptedBidCount:null,
  }:null;
  return {
    slug:row.slug!,code:row.publicCode.toString(),status,featured:row.featured,isDemo:row.isDemo,bidCount:row.acceptedBidCount,
    viewCount:row.publicViewCount.toString(),
    startsAt:row.startsAt!.toISOString(),endsAt:row.endsAt!.toISOString(),
    product:{title:product.title,titleAm:product.titleAm??row.product!.titleAm,description:product.description,descriptionAm:product.descriptionAm??row.product!.descriptionAm,condition:product.condition,conditionAm:product.conditionAm??row.product!.conditionAm,
      images:product.images.map(image=>({path:image.path,alt:image.alt,sourceType:image.sourceType,sourceCredit:image.sourceCredit??null}))},
    category:{slug:row.category!.slug,name:row.category!.name,nameAm:row.category!.nameAm},
    fulfillment:{summary:row.fulfillmentSummary!,summaryAm:row.fulfillmentSummaryAm,region:row.fulfillmentRegion!,regionAm:row.fulfillmentRegionAm},
    terms:{version:row.feeRevisions[0]?.version??row.terms!.version,ruleVersion:row.terms!.ruleVersion,minParticipants:row.terms!.minParticipants,minPoints:row.terms!.minPoints.toString(),maxPoints:row.terms!.maxPoints?.toString()??null,stepPoints:row.terms!.stepPoints.toString(),entryFeePoints:(row.feeRevisions[0]?.feePoints??row.terms!.entryFeePoints).toString(),maxDistinctBids:row.terms!.maxDistinctBids,noWinnerTerms:legacyTermsInEtb(row.terms!.noWinnerTerms),cancellationTerms:legacyTermsInEtb(row.terms!.cancellationTerms),fulfillmentSnapshot:row.terms!.fulfillmentSnapshot},
    result,
  };
}
export async function listAuctions(input: CatalogQuery, now?: Date, pageSize = 6) {
  const query = catalogQuerySchema.parse(input);
  return cachedPublicData(`auctions:${pageSize}:${JSON.stringify(query)}:${now?.toISOString()??'current'}`,3000,async()=>{
  const at=now??await serverNow();
  const searchedPublicCode=/^[1-9]\d*$/.test(query.q)&&Number.isSafeInteger(Number(query.q))?Number(query.q):null;
  const where: Prisma.AuctionWhereInput = {AND:[publicWhere(at),{status:{not:'CANCELLED'}},statusWhere(query.status,at),
    query.category?{category:{is:{slug:query.category}}}:{},
    query.q?{OR:[{code:{contains:query.q,mode:'insensitive'}},{product:{is:{OR:[{title:{contains:query.q,mode:'insensitive'}},{titleAm:{contains:query.q,mode:'insensitive'}}]}}},{presentation:{path:['title'],string_contains:query.q}},{presentation:{path:['titleAm'],string_contains:query.q}},...(searchedPublicCode?[{publicCode:searchedPublicCode}]:[])]}:{}]};
  const orderBy: Prisma.AuctionOrderByWithRelationInput[] = query.sort==='newest' ? [{publishedAt:'desc'},{id:'asc'}] : query.sort==='title' ? [{product:{title:'asc'}},{id:'asc'}] : query.status==='closed' ? [{endsAt:'desc'},{id:'asc'}] : query.status==='upcoming' ? [{startsAt:'asc'},{id:'asc'}] : [{endsAt:'asc'},{id:'asc'}];
  let rows: AuctionRow[];
  let total: number;
  if (query.status==='all' && query.sort==='ending') {
    // One database-ordered page: active end times, future start times, then recent closes.
    const categoryFilter=query.category?Prisma.sql`AND c.slug = ${query.category}`:Prisma.empty;
    const searchFilter=query.q?Prisma.sql`AND (COALESCE(a.presentation->>'title',p.title) ILIKE ${`%${query.q}%`} OR COALESCE(a.presentation->>'titleAm',p."titleAm") ILIKE ${`%${query.q}%`} OR a.code ILIKE ${`%${query.q}%`} OR a."publicCode"::text = ${query.q})`:Prisma.empty;
    const ids=await db.$queryRaw<{id:string}[]>`
      SELECT a.id FROM "Auction" a
      JOIN "Product" p ON p.id = a."productId"
      JOIN "Category" pc ON pc.id = p."categoryId"
      JOIN "Category" c ON c.id = a."categoryId"
      JOIN "AuctionTerms" t ON t."auctionId" = a.id
      WHERE a."publishedAt" <= ${at} AND a.status IN ('SCHEDULED','LIVE','CLOSED') AND a."testRunId" IS NULL
        AND a.slug IS NOT NULL AND p.visible AND pc.visible AND c.visible ${categoryFilter} ${searchFilter}
      ORDER BY CASE WHEN a.status IN ('CLOSED','CANCELLED') OR a."endsAt" <= ${at} THEN 2
                    WHEN a."startsAt" > ${at} THEN 1 ELSE 0 END,
               CASE WHEN a.status IN ('SCHEDULED','LIVE') AND a."startsAt" <= ${at} AND a."endsAt" > ${at} THEN a."endsAt" END ASC,
               CASE WHEN a."startsAt" > ${at} THEN a."startsAt" END ASC,
               CASE WHEN a.status IN ('CLOSED','CANCELLED') OR a."endsAt" <= ${at} THEN a."endsAt" END DESC,
               a.id ASC
      LIMIT ${pageSize} OFFSET ${(query.page-1)*pageSize}`;
    const found=ids.length?await db.auction.findMany({where:{id:{in:ids.map(item=>item.id)}},select:{...publicAuctionSelect,id:true}}):[];
    const byId=new Map(found.map(item=>[item.id,item]));
    rows=ids.map(item=>byId.get(item.id)!).filter(Boolean);
    total=await db.auction.count({where});
  } else [rows,total] = await db.$transaction([db.auction.findMany({where,select:publicAuctionSelect,orderBy,skip:(query.page-1)*pageSize,take:pageSize}),db.auction.count({where})]);
  return {items:rows.map(row=>toPublicAuction(row,at)),total,page:query.page,pageSize,totalPages:Math.ceil(total/pageSize),serverNow:at.toISOString()};
  });
}
export async function getAuction(slug: string, now?: Date) {
  return cachedPublicData(`auction:${slug}:${now?.toISOString()??'current'}`,3000,async()=>{
  const at=now??await serverNow();
  const code=/^[1-9]\d{0,9}$/.test(slug)?Number(slug):null;
  const identifier=code!==null&&code<=2147483647?{publicCode:code}:{slug};
  const row = await db.auction.findFirst({where:{AND:[publicWhere(at),identifier]},select:publicAuctionSelect});
  return row?toPublicAuction(row,at):null;
  });
}
// The header needs only public summary fields, not descriptions or rule snapshots.
export async function listQuickLiveAuctions(page=1) {
  return cachedPublicData(`quick-live:${page}`,3000,async()=>{
  const now=await serverNow(),pageSize=6;
  const where:Prisma.AuctionWhereInput={AND:[publicWhere(now),statusWhere('live',now)]};
  const [rows,total]=await Promise.all([
    db.auction.findMany({where,orderBy:[{publishedAt:'desc'},{id:'asc'}],skip:(page-1)*pageSize,take:pageSize,
      select:{slug:true,publicCode:true,endsAt:true,isDemo:true,acceptedBidCount:true,presentation:true,product:{select:{title:true,titleAm:true,images:{orderBy:{sortOrder:'asc'},take:1,select:{path:true}}}}}}),
    db.auction.count({where})
  ]);
  return {items:rows.map(row=>{const override=presentationSchema.safeParse(row.presentation);return {slug:row.slug!,code:String(row.publicCode),endsAt:row.endsAt!.toISOString(),isDemo:row.isDemo,bidCount:row.acceptedBidCount,product:override.success?{title:override.data.title,titleAm:override.data.titleAm??row.product!.titleAm,images:override.data.images.slice(0,1).map(image=>({path:image.path}))}:row.product!}}),total,page,totalPages:Math.ceil(total/pageSize),serverNow:now.toISOString()};
  });
}
export async function listCategories(now?: Date) {
  return cachedPublicData(`categories:${now?.toISOString()??'current'}`,5000,async()=>{
  now ??= await serverNow();
  // Aggregate in PostgreSQL instead of transferring every auction for each page.
  // Visibility matches publicWhere, including the product's own category.
  const rows=await db.$queryRaw<{slug:string;name:string;nameAm:string|null;description:string;descriptionAm:string|null;requiresEligibilityReview:boolean;all:number;live:number;upcoming:number;closed:number}[]>`
    SELECT c.slug,c.name,c."nameAm",c.description,c."descriptionAm",c."requiresEligibilityReview",
      count(a.id)::int AS all,
      count(a.id) FILTER (WHERE a.status IN ('SCHEDULED','LIVE') AND a."startsAt"<=${now} AND a."endsAt">${now})::int AS live,
      count(a.id) FILTER (WHERE a.status IN ('SCHEDULED','LIVE') AND a."startsAt">${now} AND a."endsAt">${now})::int AS upcoming,
      count(a.id) FILTER (WHERE a.status IN ('CLOSED','CANCELLED'))::int AS closed
    FROM "Category" c
    LEFT JOIN ("Auction" a
      JOIN "Product" p ON p.id=a."productId" AND p.visible
      JOIN "Category" pc ON pc.id=p."categoryId" AND pc.visible
      JOIN "AuctionTerms" t ON t."auctionId"=a.id)
      ON a."categoryId"=c.id AND a."publishedAt"<=${now} AND a."testRunId" IS NULL
        AND a.slug IS NOT NULL AND a.status IN ('SCHEDULED','LIVE','CLOSED','CANCELLED')
    WHERE c.visible GROUP BY c.id ORDER BY c."sortOrder",c.name`;
  return rows.map(({all,live,upcoming,closed,...category})=>({...category,counts:{all,live,upcoming,closed}}));
  });
}
export async function getCategory(slug: string, now?: Date) {
  const categories=await listCategories(now);
  return categories.find(category=>category.slug===slug)??null;
}
export async function listResults(page = 1, now?: Date) {
  return cachedPublicData(`legacy-results:${page}:${now?.toISOString()??'current'}`,5000,async()=>{
  const at=now??await serverNow();
  const where: Prisma.AuctionWhereInput = {AND:[publicWhere(at),statusWhere('closed',at),{result:{is:{publishedAt:{lte:at}}}}]};
  const [rows,total]=await db.$transaction([db.auction.findMany({where,select:publicAuctionSelect,orderBy:[{endsAt:'desc'},{id:'asc'}],skip:(page-1)*6,take:6}),db.auction.count({where})]);
  return {items:rows.map(row=>toPublicAuction(row,at)),total,page,totalPages:Math.ceil(total/6)};
  });
}
export async function getResult(code: string, now?: Date) {
  return cachedPublicData(`legacy-result:${code}:${now?.toISOString()??'current'}`,5000,async()=>{
  const at=now??await serverNow();
  const row=await db.auction.findFirst({where:{AND:[publicWhere(at),statusWhere('closed',at),{code,result:{is:{publishedAt:{lte:at}}}}]},select:publicAuctionSelect});
  return row?toPublicAuction(row,at):null;
  });
}
