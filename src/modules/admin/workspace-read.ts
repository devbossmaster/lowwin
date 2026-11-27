import {Prisma,type PrismaClient} from '@prisma/client';
import {centsToEtb} from '@/lib/admin-money';
import {permissions,type StaffRole} from './permissions';
import {AdminError} from './errors';

export function auctionStatusWhere(status:string,now:Date):Prisma.AuctionWhereInput {
 const running:Prisma.AuctionWhereInput={testRunId:null,publishedAt:{not:null},status:{in:['SCHEDULED','LIVE']},settlement:{is:null}};
 switch(status){
  case 'IN_PROGRESS':return {...running};
  case 'LIVE':return {...running,startsAt:{lte:now},endsAt:{gt:now}};
  case 'UPCOMING':case 'SCHEDULED':return {...running,startsAt:{gt:now},endsAt:{gt:now}};
  case 'CLOSING':case 'PENDING':return {...running,endsAt:{lte:now}};
  case 'FAILED':return {...running,endsAt:{lte:now},closeErrorCode:{not:null}};
  case 'COMPLETED':case 'CLOSED':return {testRunId:null,status:'CLOSED',settlement:{isNot:null}};
  case 'CANCELLED':return {testRunId:null,status:'CANCELLED'};
  case 'DRAFT':return {testRunId:null,status:'DRAFT'};
  case '':return {testRunId:null};
  default:throw new AdminError(422,'Choose a valid auction status.');
 }
}
export function displayAuctionStatus(a:{status:string;publishedAt:Date|null;startsAt:Date|null;endsAt:Date|null;settlement:unknown},now:Date){
 if(a.status==='CANCELLED')return 'CANCELLED';if(a.settlement)return 'COMPLETED';if(!a.publishedAt)return 'DRAFT';
 if(a.endsAt&&a.endsAt<=now)return 'CLOSING';if(a.startsAt&&a.startsAt>now)return 'UPCOMING';return 'LIVE';
}
export async function auctionList(client:PrismaClient,now:Date,{page=1,q='',status='',category='',take=25,includeCategories=true}={}){
 const where:Prisma.AuctionWhereInput={...auctionStatusWhere(status,now),...(category?{categoryId:category}:{}),...(q?{OR:[{code:{contains:q,mode:'insensitive'}},{product:{title:{contains:q,mode:'insensitive'}}}]}:{})};
 const categoryRead=includeCategories?client.category.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}):Promise.resolve([]);
 const [rows,total,categories]=await Promise.all([client.auction.findMany({where,select:{id:true,code:true,publicCode:true,slug:true,status:true,startsAt:true,endsAt:true,publishedAt:true,isDemo:true,presentation:true,settlement:{select:{outcome:true}},product:{select:{title:true,images:{select:{path:true,alt:true},orderBy:{sortOrder:'asc'},take:1}}},terms:{select:{minParticipants:true}},draft:{select:{version:true}},closeErrorCode:true},orderBy:[{endsAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take,skip:(page-1)*take}),client.auction.count({where}),categoryRead]);
 const counts=rows.length?await client.$queryRaw<{auctionId:string;participants:bigint;bids:bigint}[]>(Prisma.sql`SELECT "auctionId", COUNT(DISTINCT "userId") AS participants, COUNT(*) AS bids FROM "Bid" WHERE "auctionId" IN (${Prisma.join(rows.map(r=>r.id))}) GROUP BY "auctionId"`):[];
 const byAuction=new Map(counts.map(count=>[count.auctionId,count]));
 return {categories,items:rows.map(r=>({...r,product:presentedProduct(r),displayStatus:displayAuctionStatus(r,now),participants:Number(byAuction.get(r.id)?.participants??0),acceptedBids:Number(byAuction.get(r.id)?.bids??0)})),total,page,totalPages:Math.ceil(total/take),serverNow:now.toISOString()};
}
export async function deliveryQueue(client:PrismaClient,actor:{id:string;role:StaffRole},{page=1,q='',status=''}={}){
 if(!['','INCOMPLETE','PENDING','CLAIMED','PACKING','SHIPPED','DELIVERED','DISPUTED'].includes(status))throw new AdminError(422,'Choose a valid delivery status.');
 const where=Prisma.sql`s.outcome='WINNER' AND a."testRunId" IS NULL ${actor.role==='OWNER'?Prisma.empty:Prisma.sql`AND f."assignedTo"=${actor.id}`} ${q?Prisma.sql`AND (a.code ILIKE ${'%'+q+'%'} OR p.title ILIKE ${'%'+q+'%'})`:Prisma.empty} ${status==='INCOMPLETE'?Prisma.sql`AND (f.state IS NULL OR f.state<>'DELIVERED')`:status?Prisma.sql`AND COALESCE(f.state,'PENDING')=${status}`:Prisma.empty}`;
 const from=Prisma.sql`FROM "AuctionSettlement" s JOIN "Auction" a ON a.id=s."auctionId" LEFT JOIN "Product" p ON p.id=a."productId" LEFT JOIN "FulfillmentCase" f ON f."auctionId"=a.id`;
 const [count,rows]=await Promise.all([client.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count ${from} WHERE ${where}`),client.$queryRaw<{auctionId:string;completedAt:Date;code:string;isDemo:boolean;title:string|null;state:string;version:number;assignedTo:string|null;tracking:string;winnerLabel:string|null;assigneeLabel:string|null}[]>(Prisma.sql`SELECT a.id AS "auctionId",s."completedAt",a.code,a."isDemo",p.title,COALESCE(f.state,'PENDING') AS state,COALESCE(f.version,0) AS version,f."assignedTo",COALESCE(f.tracking,'') AS tracking,u.name AS "winnerLabel",staff.email AS "assigneeLabel" ${from} LEFT JOIN "user" u ON u.id=s."winnerUserId" LEFT JOIN "user" staff ON staff.id=f."assignedTo" WHERE ${where} ORDER BY s."completedAt" DESC,a.id LIMIT 25 OFFSET ${(page-1)*25}`)]);
 return {items:rows.map(r=>({...r,auction:{code:r.code,isDemo:r.isDemo,product:{title:r.title}}})),total:Number(count[0].count),page,totalPages:Math.ceil(Number(count[0].count)/25)};
}
export type OverviewData={
 serverNow:string;
 auctions?:{state:'ready';live:number;drafts:number;upcoming:number;completed:number;items:Awaited<ReturnType<typeof auctionList>>['items']}|{state:'error'};
 payments?:{state:'ready';count:number}|{state:'error'};
 deliveries?:{state:'ready';count:number}|{state:'error'};
 closing?:{state:'ready';failed:number;pending:number}|{state:'error'};
 fees?:{state:'ready';totalEtb:string;todayEtb:string;count:number;grossFees:string;discounts:string;refunds:string;deposits:string;available:string;held:string}|{state:'error'};
 players?:{state:'ready';total:number;today:number;biddersToday:number}|{state:'error'};
};
export function eatDayStart(now:Date){
 const offset=3*60*60*1000,local=new Date(now.getTime()+offset);
 return new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offset);
}
// Registered Telegram players; staff and explicitly enrolled test identities are excluded.
const realPlayer=Prisma.sql`u."telegramId" IS NOT NULL AND u.id NOT LIKE 'demo-showcase-%'
 AND NOT EXISTS (SELECT 1 FROM "StaffMember" s WHERE s."userId"=u.id)
 AND NOT EXISTS (SELECT 1 FROM "TestRunActor" t WHERE t."userId"=u.id)`;
type OverviewCount={state:'ready';count:number}|{state:'error'};
type DailyMoney={depositEtb:string;successfulPayments:number;paymentEtb:string};
export type OverviewSummary={
 serverNow:string;
 auctions?:OverviewCount;
 players?:OverviewCount;
 walletPaidBids?:OverviewCount;
 deliveries?:OverviewCount;
 daily?:{newMembers?:OverviewCount;money?:({state:'ready'}&DailyMoney)|{state:'error'}};
};
export type OverviewAuctions={serverNow:string;items:{id:string;code:string;title:string;image:string|null;displayStatus:string;participants:number;acceptedBids:number;endsAt:Date|null}[]};

const creditedProviderDeposit=Prisma.sql`t.provider IN ('CHECK_ET','VERIFY_ET') AND t.status='CREDITED' AND t."caseState"<>'REVERSED'`;
const utcTimestamp=(value:Date)=>Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

async function overviewWalletPaidBids(client:PrismaClient,today:Prisma.Sql,now:Prisma.Sql):Promise<OverviewCount>{
 // A direct checkout can post a wallet debit and accept several bids atomically.
 // Its receipt links each accepted child, while bidId only links the first one.
 const [row]=await client.$queryRaw<{count:number}[]>(Prisma.sql`
  SELECT COUNT(*)::int AS count
  FROM "Bid" b
  JOIN "Auction" a ON a.id=b."auctionId"
  JOIN "user" u ON u.id=b."userId"
  JOIN "Operation" o ON o.id=b."operationId" AND o.scope='BID' AND o."userId"=b."userId"
  JOIN "Journal" j ON j."operationId"=o.id AND j.kind='BID_FEE'
  WHERE b."acceptedAt">=${today} AND b."acceptedAt"<=${now} AND b."feePoints">0
    AND NOT a."isDemo" AND NOT a."isSettlementFixture" AND a."testRunId" IS NULL AND ${realPlayer}
    AND COALESCE(o.result#>>'{charge,netFeePoints}' !~ '^0([.]0+)?$',true)
    AND EXISTS (
     SELECT 1 FROM "Posting" p JOIN "LedgerAccount" l ON l.id=p."accountId" AND l.kind IN ('AVAILABLE','BONUS')
     JOIN "Wallet" w ON w.id=l."walletId" AND w."userId"=b."userId"
     WHERE p."journalId"=j.id AND p.delta<0
    )
    AND NOT EXISTS (
     SELECT 1 FROM "ChapaCheckout" c
     WHERE c."userId"=b."userId" AND c."auctionId"=a.id AND c.purpose='BID'
       AND c.status='BID_ACCEPTED' AND c."creditJournalId" IS NOT NULL
       AND (c."bidId"=b.id OR c.receipt->'bids' @> jsonb_build_array(jsonb_build_object('id',b.id)))
    )
    AND NOT EXISTS (
     SELECT 1 FROM "ArifPayCheckout" c WHERE c."bidId"=b.id AND c."userId"=b."userId"
       AND c.status='BID_ACCEPTED' AND c."creditJournalId" IS NOT NULL
    )`);
 return {state:'ready',count:row.count};
}

async function overviewDailyMoney(client:PrismaClient,today:Prisma.Sql,now:Prisma.Sql):Promise<DailyMoney>{
 // Use the posting date of each confirmed receipt. Wallet spending and bonuses
 // would otherwise count the same incoming funds again.
 const [row]=await client.$queryRaw<{depositCents:string;successfulPayments:number;paymentCents:string}[]>(Prisma.sql`
  WITH received AS (
   SELECT c."amountCents" AS cents,c.purpose='TOP_UP' AS deposit
   FROM "ChapaCheckout" c
   JOIN "Journal" j ON j.id=c."creditJournalId" AND j.kind='CHAPA_RECEIPT'
   JOIN "Operation" o ON o.id=j."operationId" AND o.scope='CHAPA_RECEIPT' AND o."userId"=c."userId" AND o.key=c.id
   JOIN "user" u ON u.id=c."userId"
   LEFT JOIN "Auction" a ON a.id=c."auctionId"
   WHERE c.mode='live' AND c.currency='ETB'
     AND (c.purpose='TOP_UP' AND c.status='CREDITED'
       OR c.purpose='BID' AND NOT a."isDemo" AND NOT a."isSettlementFixture" AND a."testRunId" IS NULL)
     AND j."createdAt">=${today} AND j."createdAt"<=${now}
     AND o.result->>'checkoutId'=c.id AND o.result->>'mode'='live'
     AND o.result->>'currency'='ETB' AND o.result->>'amountCents'=c."amountCents"::text
     AND ${realPlayer}
   UNION ALL
   SELECT c."amountCents",true
   FROM "PaymentClaim" c
   JOIN "TopUpIntent" t ON t.id=c."intentId" AND t."journalId"=c."journalId" AND t."userId"=c."userId"
   JOIN "user" u ON u.id=c."userId"
   WHERE c."createdAt">=${today} AND c."createdAt"<=${now} AND ${creditedProviderDeposit} AND ${realPlayer}
  )
  SELECT COALESCE(SUM(cents) FILTER (WHERE deposit),0)::text AS "depositCents",
    COUNT(*)::int AS "successfulPayments",COALESCE(SUM(cents),0)::text AS "paymentCents"
  FROM received`);
 return {depositEtb:centsToEtb(row.depositCents),successfulPayments:row.successfulPayments,paymentEtb:centsToEtb(row.paymentCents)};
}

/** Use one count snapshot and a separate bounded receipt read for allowed staff. */
export async function readOverviewSummary(client:PrismaClient,actor:{id:string;role:StaffRole;now:Date}):Promise<OverviewSummary>{
 const grants=permissions(actor.role),catalog=grants.includes('catalog'),players=['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(actor.role),deliveries=['OWNER','FULFILLMENT','AUDITOR'].includes(actor.role),chapaReady=process.env.CHAPA_SCHEMA_READY==='true';
 const data:OverviewSummary={serverNow:actor.now.toISOString()};
 const today=utcTimestamp(eatDayStart(actor.now)),now=utcTimestamp(actor.now);
 const money=grants.includes('wallets');
 const columns:Partial<Record<'auctions'|'players'|'deliveries',Prisma.Sql>>={};
 if(catalog)columns.auctions=Prisma.sql`(SELECT COUNT(*)::int FROM "Auction" a WHERE a."testRunId" IS NULL AND a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND a."startsAt"<=${now} AND a."endsAt">${now} AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)) AS auctions`;
 if(players)columns.players=Prisma.sql`player_counts.total AS players,player_counts.today AS "newMembers"`;
 if(deliveries)columns.deliveries=Prisma.sql`(SELECT COUNT(*)::int FROM "AuctionSettlement" s JOIN "Auction" a ON a.id=s."auctionId" LEFT JOIN "FulfillmentCase" f ON f."auctionId"=a.id WHERE s.outcome='WINNER' AND NOT a."isDemo" AND a."testRunId" IS NULL AND COALESCE(f.state,'PENDING')<>'DELIVERED' ${actor.role==='FULFILLMENT'?Prisma.sql`AND f."assignedTo"=${actor.id}`:Prisma.empty}) AS deliveries`;
 const keys=Object.keys(columns) as (keyof typeof columns)[];
 const playerCounts=players?Prisma.sql`FROM (
  SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE u."createdAt">=${today})::int AS today
  FROM "user" u WHERE u."createdAt"<=${now} AND ${realPlayer}
 ) player_counts`:Prisma.empty;
 const [counts,dailyMoney,walletPaidBids]=await Promise.all([
  keys.length?client.$queryRaw<Record<string,number>[]>(Prisma.sql`SELECT ${Prisma.join(Object.values(columns))} ${playerCounts}`).then(([row])=>row).catch(()=>null):null,
  money&&chapaReady?overviewDailyMoney(client,today,now).catch(()=>null):null,
  players&&chapaReady?overviewWalletPaidBids(client,today,now).catch(()=>null):null,
 ]);
 const count=(key:string):OverviewCount=>counts?{state:'ready',count:counts[key]}:{state:'error'};
 for(const key of keys)data[key]=count(key);
 if(players)data.walletPaidBids=walletPaidBids??{state:'error'};
 if(players||money)data.daily={
  ...(players?{newMembers:count('newMembers')}:{}),
  ...(money?{money:dailyMoney?{state:'ready',...dailyMoney}:{state:'error'}}:{}),
 };
 return data;
}
/** One bounded query; private snapshots and financial evidence stay off this read model. */
export async function readOverviewAuctions(client:PrismaClient,actor:{role:StaffRole;now:Date}):Promise<OverviewAuctions>{
 if(!permissions(actor.role).includes('catalog'))throw new AdminError(403,'Your staff role does not grant this permission.');
 const now=utcTimestamp(actor.now);
 const items=await client.$queryRaw<OverviewAuctions['items']>(Prisma.sql`WITH selected AS (
 SELECT a.id,a.code,a."productId",a."endsAt",a."startsAt",a.presentation FROM "Auction" a
 WHERE a."testRunId" IS NULL AND a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND NOT EXISTS(SELECT 1 FROM "AuctionSettlement" s WHERE s."auctionId"=a.id)
 ORDER BY a."endsAt" ASC NULLS LAST,a.id ASC LIMIT 5)
 SELECT a.id,a.code,COALESCE(a.presentation->>'title',p.title,'Auction') AS title,
 COALESCE(a.presentation->'images'->0->>'path',(SELECT i.path FROM "ProductImage" i WHERE i."productId"=a."productId" ORDER BY i."sortOrder",i.id LIMIT 1)) AS image,
 CASE WHEN a."endsAt"<=${now} THEN 'CLOSING' WHEN a."startsAt">${now} THEN 'UPCOMING' ELSE 'LIVE' END AS "displayStatus",
 (SELECT COUNT(DISTINCT b."userId")::int FROM "Bid" b WHERE b."auctionId"=a.id) AS participants,
 (SELECT COUNT(*)::int FROM "Bid" b WHERE b."auctionId"=a.id) AS "acceptedBids",a."endsAt"
 FROM selected a LEFT JOIN "Product" p ON p.id=a."productId" ORDER BY a."endsAt" ASC NULLS LAST,a.id ASC`);
 return {serverNow:actor.now.toISOString(),items};
}
export async function overviewDeposits(client:PrismaClient,now:Date){
 const [row]=await client.$queryRaw<{totalEtb:string;todayEtb:string;count:number}[]>(Prisma.sql`
 SELECT trunc(COALESCE(SUM(c."amountCents"),0)/100,2)::text AS "totalEtb",
 trunc(COALESCE(SUM(c."amountCents") FILTER (WHERE c."createdAt">=${eatDayStart(now)}),0)/100,2)::text AS "todayEtb",
 COUNT(*)::int AS count FROM "PaymentClaim" c
 JOIN "TopUpIntent" t ON t.id=c."intentId" JOIN "user" u ON u.id=c."userId"
 WHERE ${creditedProviderDeposit}
 AND c."createdAt"<=${now} AND ${realPlayer}`);
 return {state:'ready' as const,...row};
}
export async function overviewPlayers(client:PrismaClient,now:Date){
 const [row]=await client.$queryRaw<{total:number;today:number;biddersToday:number}[]>(Prisma.sql`
 SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE u."createdAt">=${eatDayStart(now)})::int AS today,
 (SELECT COUNT(DISTINCT b."userId")::int FROM "Bid" b JOIN "Auction" a ON a.id=b."auctionId"
 JOIN "user" u ON u.id=b."userId" WHERE b."acceptedAt">=${eatDayStart(now)} AND b."acceptedAt"<=${now}
 AND a."testRunId" IS NULL AND NOT a."isDemo" AND ${realPlayer}) AS "biddersToday"
 FROM "user" u WHERE u."createdAt"<=${now} AND ${realPlayer}`);
 return {state:'ready' as const,...row};
}
export async function readOverview(client:PrismaClient,actor:{id:string;role:StaffRole;now:Date}):Promise<OverviewData>{
 const data:OverviewData={serverNow:actor.now.toISOString()},grants=permissions(actor.role),jobs:Promise<void>[]=[];
 async function part<K extends Exclude<keyof OverviewData,'serverNow'>>(key:K,load:()=>Promise<NonNullable<OverviewData[K]>>){try{data[key]=await load()}catch{data[key]={state:'error'} as OverviewData[K]}}
 if(grants.includes('catalog')){
  const catalog=(async()=>{
   const [queue,counts]=await Promise.all([
    auctionList(client,actor.now,{status:'IN_PROGRESS',take:5,includeCategories:false}),
    client.$queryRaw<{live:number;upcoming:number;drafts:number;completed:number;failed:number;pending:number}[]>(Prisma.sql`
     SELECT COUNT(*) FILTER(WHERE a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND s.id IS NULL AND a."startsAt"<=${actor.now} AND a."endsAt">${actor.now})::int AS live,
     COUNT(*) FILTER(WHERE a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND s.id IS NULL AND a."startsAt">${actor.now} AND a."endsAt">${actor.now})::int AS upcoming,
     COUNT(*) FILTER(WHERE a.status='DRAFT')::int AS drafts,
     COUNT(*) FILTER(WHERE a.status='CLOSED' AND s.id IS NOT NULL)::int AS completed,
     COUNT(*) FILTER(WHERE a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND s.id IS NULL AND a."endsAt"<=${actor.now} AND a."closeErrorCode" IS NOT NULL)::int AS failed,
     COUNT(*) FILTER(WHERE a."publishedAt" IS NOT NULL AND a.status IN ('SCHEDULED','LIVE') AND s.id IS NULL AND a."endsAt"<=${actor.now})::int AS pending
     FROM "Auction" a LEFT JOIN "AuctionSettlement" s ON s."auctionId"=a.id WHERE a."testRunId" IS NULL`),
   ]);
   return {queue,counts:counts[0]};
  })();
  jobs.push(part('auctions',async()=>{const {queue,counts}=await catalog;return {state:'ready',live:counts.live,upcoming:counts.upcoming,drafts:counts.drafts,completed:counts.completed,items:queue.items}}));
  jobs.push(part('closing',async()=>{const {counts}=await catalog;return {state:'ready',failed:counts.failed,pending:counts.pending}}));
 }
 if(['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(actor.role))jobs.push(part('payments',async()=>{
  if(process.env.CHAPA_SCHEMA_READY!=='true')throw new AdminError(503,'Chapa payment storage is not ready.');
  return {state:'ready',count:await client.chapaCheckout.count({where:{status:'NEEDS_REVIEW'}})};
 }));
 if(grants.includes('fulfillment'))jobs.push(part('deliveries',async()=>{
  const [row]=await client.$queryRaw<{count:number}[]>(Prisma.sql`SELECT COUNT(*)::int AS count FROM "AuctionSettlement" s JOIN "Auction" a ON a.id=s."auctionId" LEFT JOIN "FulfillmentCase" f ON f."auctionId"=a.id WHERE s.outcome='WINNER' AND NOT a."isDemo" AND a."testRunId" IS NULL AND COALESCE(f.state,'PENDING')<>'DELIVERED' ${actor.role==='OWNER'?Prisma.empty:Prisma.sql`AND f."assignedTo"=${actor.id}`}`);
  return {state:'ready',count:row.count};
 }));
 // Full ledger reports are deliberately excluded from the ordinary landing read.
 if(grants.includes('support')||grants.includes('audit'))jobs.push(part('players',()=>overviewPlayers(client,actor.now)));
 await Promise.all(jobs);return data;
}

function presentedProduct(row:{presentation:Prisma.JsonValue|null;product:{title:string;images:{path:string;alt:string}[]}|null}){
 const p=row.presentation as {title?:string;images?:{path:string;alt:string}[]}|null;
 return row.product?{...row.product,title:p?.title??row.product.title,images:p?.images??row.product.images}:null;
}
