import {Prisma,type PrismaClient} from '@prisma/client';
import {permissions,type StaffRole} from './permissions';
import {AdminError} from './errors';
import {depositAttentionWhere} from '../payments/review-filter';

export function auctionStatusWhere(status:string,now:Date):Prisma.AuctionWhereInput {
 const running:Prisma.AuctionWhereInput={testRunId:null,publishedAt:{not:null},status:{in:['SCHEDULED','LIVE']},settlement:{is:null}};
 switch(status){
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
export async function auctionList(client:PrismaClient,now:Date,{page=1,q='',status='',category='',take=25}={}){
 const where:Prisma.AuctionWhereInput={...auctionStatusWhere(status,now),...(category?{categoryId:category}:{}),...(q?{OR:[{code:{contains:q,mode:'insensitive'}},{product:{title:{contains:q,mode:'insensitive'}}}]}:{})};
 const [rows,total]=await Promise.all([client.auction.findMany({where,select:{id:true,code:true,publicCode:true,slug:true,status:true,startsAt:true,endsAt:true,publishedAt:true,isDemo:true,presentation:true,settlement:{select:{outcome:true}},product:{select:{title:true,images:{select:{path:true,alt:true},orderBy:{sortOrder:'asc'},take:1}}},terms:{select:{minParticipants:true}},draft:{select:{version:true}},closeErrorCode:true},orderBy:[{endsAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take,skip:(page-1)*take}),client.auction.count({where})]);
 const counts=rows.length?await client.$queryRaw<{auctionId:string;participants:bigint;bids:bigint}[]>(Prisma.sql`SELECT "auctionId", COUNT(DISTINCT "userId") AS participants, COUNT(*) AS bids FROM "Bid" WHERE "auctionId" IN (${Prisma.join(rows.map(r=>r.id))}) GROUP BY "auctionId"`):[];
 const categories=await client.category.findMany({select:{id:true,name:true},orderBy:{name:'asc'}});
 return {categories,items:rows.map(r=>({...r,product:presentedProduct(r),displayStatus:displayAuctionStatus(r,now),participants:Number(counts.find(c=>c.auctionId===r.id)?.participants??0),acceptedBids:Number(counts.find(c=>c.auctionId===r.id)?.bids??0)})),total,page,totalPages:Math.ceil(total/take),serverNow:now.toISOString()};
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
 support?:{state:'ready';count:number}|{state:'error'};
 closing?:{state:'ready';failed:number;pending:number}|{state:'error'};
 deposits?:{state:'ready';totalEtb:string;todayEtb:string;count:number}|{state:'error'};
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
export async function overviewDeposits(client:PrismaClient,now:Date){
 const [row]=await client.$queryRaw<{totalEtb:string;todayEtb:string;count:number}[]>(Prisma.sql`
 SELECT trunc(COALESCE(SUM(c."amountCents"),0)/100,2)::text AS "totalEtb",
 trunc(COALESCE(SUM(c."amountCents") FILTER (WHERE c."createdAt">=${eatDayStart(now)}),0)/100,2)::text AS "todayEtb",
 COUNT(*)::int AS count FROM "PaymentClaim" c
 JOIN "TopUpIntent" t ON t.id=c."intentId" JOIN "user" u ON u.id=c."userId"
 WHERE t.provider IN ('CHECK_ET','VERIFY_ET') AND t.status='CREDITED' AND t."caseState"<>'REVERSED'
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
 if(grants.includes('catalog'))jobs.push(part('auctions',async()=>{const [live,upcoming,drafts,completed]=await Promise.all([auctionList(client,actor.now,{status:'LIVE',take:5}),client.auction.count({where:auctionStatusWhere('UPCOMING',actor.now)}),client.auction.count({where:{status:'DRAFT'}}),client.auction.count({where:auctionStatusWhere('COMPLETED',actor.now)})]);return {state:'ready',live:live.total,upcoming,drafts,completed,items:live.items.length?live.items:(await auctionList(client,actor.now,{status:'UPCOMING',take:5})).items}}));
 if(['OWNER','SUPPORT','PAYMENTS_OPERATOR','AUDITOR'].includes(actor.role))jobs.push(part('payments',async()=>({state:'ready',count:await client.topUpIntent.count({where:depositAttentionWhere(actor.now)})})));
 if(grants.includes('fulfillment'))jobs.push(part('deliveries',async()=>({state:'ready',count:(await deliveryQueue(client,actor,{status:'INCOMPLETE'})).total})));
 if(grants.includes('support'))jobs.push(part('support',async()=>({state:'ready',count:await client.supportCase.count({where:{status:{in:['OPEN','INVESTIGATING']}}})})));
 if(grants.includes('catalog'))jobs.push(part('closing',async()=>({state:'ready',failed:await client.auction.count({where:auctionStatusWhere('FAILED',actor.now)}),pending:await client.auction.count({where:auctionStatusWhere('CLOSING',actor.now)})})));
 if(grants.includes('wallets'))jobs.push(part('deposits',()=>overviewDeposits(client,actor.now)));
 if(grants.includes('support')||grants.includes('audit'))jobs.push(part('players',()=>overviewPlayers(client,actor.now)));
 await Promise.all(jobs);return data;
}

function presentedProduct(row:{presentation:Prisma.JsonValue|null;product:{title:string;images:{path:string;alt:string}[]}|null}){
 const p=row.presentation as {title?:string;images?:{path:string;alt:string}[]}|null;
 return row.product?{...row.product,title:p?.title??row.product.title,images:p?.images??row.product.images}:null;
}
