import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {requireAdmin} from './boundary';
import {AdminError} from './errors';
import type {StaffRole} from './permissions';
import {arifPayAvailability,arifPayHash} from '../payments/arifpay-provider';
import {verifyArifPayCheckout} from '../payments/arifpay';
import {allowIdentityRequest} from '@/lib/rate-limit';

export const arifPayAdminRoles:readonly StaffRole[]=['OWNER','PAYMENTS_OPERATOR','AUDITOR','SUPPORT'];
function allow(role:StaffRole,write=false){if(!(write?['OWNER','PAYMENTS_OPERATOR']:arifPayAdminRoles).includes(role))throw new AdminError(403,'Your staff role cannot perform this payment task.');}
const states=['SUBMITTING','PENDING','BID_ACCEPTED','NEEDS_REVIEW','FAILED','CANCELLED','EXPIRED'] as const;
const filters=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(128).default(''),status:z.enum(['','attention','waiting',...states]).default(''),channel:z.enum(['','TELEBIRR','MPESA']).default('')});
// An explicit projection keeps payer encryption, nonce, hashes, keys and raw
// provider/receipt payloads out of every staff response.
const selection={id:true,userId:true,auctionId:true,auctionSlug:true,bidNumber:true,fee:true,feeVersion:true,currency:true,channel:true,status:true,reason:true,bidId:true,creditJournalId:true,sessionId:true,transactionId:true,attempts:true,nextCheckAt:true,expiresAt:true,createdAt:true,updatedAt:true,user:{select:{name:true}},auction:{select:{code:true,presentation:true,product:{select:{title:true}},terms:{select:{ruleVersion:true}}}}} satisfies Prisma.ArifPayCheckoutSelect;
type Row=Prisma.ArifPayCheckoutGetPayload<{select:typeof selection}>;
function view(row:Row,role:StaffRole){
 const p=row.auction.presentation as {title?:string}|null;
 const canCheck=['SUBMITTING','PENDING'].includes(row.status)||row.status==='NEEDS_REVIEW'&&!row.creditJournalId&&row.reason==='PROVIDER_CONFIRMATION_REQUIRED';
 return {id:row.id,userId:row.userId,playerName:row.user.name,auctionId:row.auctionId,auctionSlug:row.auctionSlug,auctionCode:row.auction.code,title:p?.title??row.auction.product?.title??'Auction',ruleVersion:row.auction.terms?.ruleVersion??null,bidNumber:row.bidNumber.toString(),fee:row.fee.toString(),feeVersion:row.feeVersion,currency:row.currency,channel:row.channel,status:row.status,reason:row.reason&&/^[A-Z0-9_]{1,64}$/.test(row.reason)?row.reason:null,bidId:row.bidId,verified:!!row.creditJournalId,providerSession:role==='SUPPORT'?null:row.sessionId,providerReference:role==='SUPPORT'?null:row.transactionId,attempts:row.attempts,nextCheckAt:row.nextCheckAt.toISOString(),expiresAt:row.expiresAt.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),canCheck};
}
export async function arifPayAdminTotals(client:PrismaClient,now:Date){
 if(process.env.ARIFPAY_SCHEMA_READY!=='true')throw new AdminError(503,'Direct-payment storage is not ready.');
 const offset=3*3600000,local=new Date(now.getTime()+offset),start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offset);
 const [row]=await client.$queryRaw<{totalEtb:string;todayEtb:string;count:number}[]>(Prisma.sql`
 SELECT COALESCE(SUM(c.fee),0)::text AS "totalEtb",
 COALESCE(SUM(c.fee) FILTER (WHERE b."acceptedAt">=${start.toISOString()}::timestamp),0)::text AS "todayEtb",COUNT(*)::int AS count
 FROM "ArifPayCheckout" c JOIN "Bid" b ON b.id=c."bidId" AND b."userId"=c."userId" AND b."auctionId"=c."auctionId"
 JOIN "Auction" a ON a.id=c."auctionId" JOIN "user" u ON u.id=c."userId"
 WHERE c.status='BID_ACCEPTED' AND c."creditJournalId" IS NOT NULL AND b."acceptedAt"<=${now.toISOString()}::timestamp
 AND NOT a."isDemo" AND a."testRunId" IS NULL AND u."telegramId" IS NOT NULL AND u.id NOT LIKE 'demo-showcase-%'
 AND NOT EXISTS (SELECT 1 FROM "StaffMember" s WHERE s."userId"=u.id)
 AND NOT EXISTS (SELECT 1 FROM "TestRunActor" t WHERE t."userId"=u.id)`);
 return {state:'ready' as const,...row};
}
export async function readArifPayAdmin(client:PrismaClient,headers:Headers,id:string|undefined,params:URLSearchParams){
 const actor=await requireAdmin(client,headers);allow(actor.role);
 const health={...arifPayAvailability(),schemaReady:process.env.ARIFPAY_SCHEMA_READY==='true'};
 if(id){
  if(!health.schemaReady)throw new AdminError(503,'Direct-payment storage is not ready.');
  const row=await client.arifPayCheckout.findUnique({where:{id:z.uuid().parse(id)},select:selection});if(!row)throw new AdminError(404,'Bid payment not found.');
  await client.adminAudit.create({data:{actorId:actor.id,action:'ARIFPAY_DETAILS_READ',target:row.id,details:{}}});
  return {item:view(row,actor.role),health};
 }
 const f=filters.parse(Object.fromEntries(params));
 if(!health.schemaReady)return {health,items:[],total:0,page:f.page,totalPages:0,summary:null};
 const base:Prisma.ArifPayCheckoutWhereInput={auction:{isDemo:false,testRunId:null}};
 const where:Prisma.ArifPayCheckoutWhereInput={...base,...(f.status?{status:f.status==='attention'?'NEEDS_REVIEW':f.status==='waiting'?{in:['SUBMITTING','PENDING']}:f.status}:{}),...(f.channel?{channel:f.channel}:{}),...(f.q?{OR:[{id:{contains:f.q}},{userId:{contains:f.q}},{user:{name:{contains:f.q,mode:'insensitive'}}},{auction:{code:{contains:f.q,mode:'insensitive'}}}]}:{})};
 const [rows,total,pending,review,accepted]=await Promise.all([client.arifPayCheckout.findMany({where,select:selection,orderBy:[{createdAt:'desc'},{id:'desc'}],take:25,skip:(f.page-1)*25}),client.arifPayCheckout.count({where}),client.arifPayCheckout.count({where:{...base,status:{in:['SUBMITTING','PENDING']}}}),client.arifPayCheckout.count({where:{...base,status:'NEEDS_REVIEW'}}),client.arifPayCheckout.count({where:{...base,status:'BID_ACCEPTED',bidId:{not:null},creditJournalId:{not:null}}})]);
 return {health,items:rows.map(row=>view(row,actor.role)),total,page:f.page,totalPages:Math.ceil(total/25),summary:{pending,review,accepted}};
}
export async function checkArifPayAdmin(client:PrismaClient,headers:Headers,input:unknown){
 const b=z.object({id:z.uuid(),key:z.uuid(),reason:z.string().trim().min(5).max(300)}).strict().parse(input);
 const actor=await requireAdmin(client,headers,{fresh:true});allow(actor.role,true);
 if(!arifPayAvailability().recoveryEnabled)throw new AdminError(503,'Provider checks are disabled. No payment was changed.');
 if(!await allowIdentityRequest(client,'admin-arifpay',actor.id,10))throw new AdminError(429,'Wait a minute before checking more payments.');
 // Audit the attempt before any provider call; retries use the same key.
 await client.$transaction(async tx=>{
  const current=await requireAdmin(tx,headers,{fresh:true,lock:true});allow(current.role,true);
  const row=await tx.arifPayCheckout.findUnique({where:{id:b.id},select:{id:true}});if(!row)throw new AdminError(404,'Bid payment not found.');
  const operationKey=`arifpay-check:${b.key}`,requestHash=arifPayHash(JSON.stringify(b)),prior=await tx.adminAudit.findUnique({where:{operationKey}});
  if(prior){if(prior.actorId!==current.id||prior.requestHash!==requestHash)throw new AdminError(409,'Retry with the original payment details.');return;}
  await tx.adminAudit.create({data:{actorId:current.id,action:'ARIFPAY_PROVIDER_CHECK',target:b.id,operationKey,requestHash,details:{reason:b.reason}}});
 });
 await verifyArifPayCheckout(client,b.id,undefined,async tx=>{const current=await requireAdmin(tx,headers,{fresh:true,lock:true});allow(current.role,true)});
 return readArifPayAdmin(client,headers,b.id,new URLSearchParams());
}
export type ArifPayAdminList=Awaited<ReturnType<typeof readArifPayAdmin>> & {items:ReturnType<typeof view>[];total:number;page:number;totalPages:number;summary:{pending:number;review:number;accepted:number}|null};
export type ArifPayAdminDetail={item:ReturnType<typeof view>;health:ReturnType<typeof arifPayAvailability>&{schemaReady:boolean}};
