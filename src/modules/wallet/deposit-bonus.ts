import {createHash} from 'node:crypto';
import {Prisma,type PrismaClient,type ChapaCheckout} from '@prisma/client';
import {z} from 'zod';
import {centsToEtb} from '@/lib/money';

type DB=Pick<PrismaClient,'$queryRaw'>;
type Tx=Prisma.TransactionClient;
const storage=new WeakMap<object,{until:number;ready:boolean}>();
/** An additive rollout may precede its migration. Probe without touching a
 * missing relation (which would abort a financial transaction). No env flag. */
export async function depositBonusStorageReady(client:DB,fresh=false){
 const prior=storage.get(client);if(!fresh&&prior&&prior.until>Date.now())return prior.ready;
 const rows=await client.$queryRaw<Array<{ready:boolean}>>`SELECT to_regclass('public."DepositBonusPolicy"') IS NOT NULL AND to_regclass('public."DepositBonusLot"') IS NOT NULL AND to_regclass('public."DepositBonusUse"') IS NOT NULL AND to_regclass('public."DepositBonusExpiry"') IS NOT NULL AS ready`;
 const ready=rows[0]?.ready===true;storage.set(client,{until:Date.now()+30000,ready});return ready;
}
const defaults={configured:false,enabled:false,percent:10,minAmount:'100.00',maxBonus:null as string|null,validityDays:7,endsAt:null as string|null,version:0,updatedAt:null as string|null};
export async function getDepositBonusPolicy(client:PrismaClient|Tx,ready?:boolean){
 if(!(ready??await depositBonusStorageReady(client)))return {...defaults};
 const policy=await client.depositBonusPolicy.findUnique({where:{id:'default'}});
 if(!policy)return {...defaults};
 return {configured:true,enabled:policy.enabled,percent:policy.percent,minAmount:centsToEtb(policy.minCents),maxBonus:policy.maxBonusCents===null?null:centsToEtb(policy.maxBonusCents),validityDays:policy.validityDays,endsAt:policy.endsAt?.toISOString()??null,version:policy.version,updatedAt:policy.updatedAt.toISOString()};
}
const cents=z.string().regex(/^[1-9]\d{0,12}$/);
const quoteSchema=z.object({policyVersion:z.number().int().positive(),percent:z.number().int().min(10).max(100),minAmountCents:cents,maxBonusCents:cents.nullable(),validityDays:z.number().int().min(1).max(365),endsAt:z.iso.datetime().nullable(),quotedAt:z.iso.datetime(),amountCents:cents}).strict();
export type DepositBonusQuote=z.infer<typeof quoteSchema>;
export function calculateDepositBonus(principal:bigint,percent:number,cap:bigint|null){const amount=principal*BigInt(percent)/100n;return cap!==null&&amount>cap?cap:amount;}
export function depositBonusQuote(order:Pick<ChapaCheckout,'purpose'|'initialization'|'amountCents'>):DepositBonusQuote|null{
 const value=order.initialization&&typeof order.initialization==='object'&&!Array.isArray(order.initialization)?order.initialization.depositBonus:undefined;
 if(value===undefined||value===null)return null;
 const quote=quoteSchema.parse(value);
 if(order.purpose!=='TOP_UP'||order.amountCents<BigInt(quote.minAmountCents)||BigInt(quote.amountCents)!==calculateDepositBonus(order.amountCents,quote.percent,quote.maxBonusCents===null?null:BigInt(quote.maxBonusCents)))throw Error('Deposit bonus quote does not match its top-up.');
 return quote;
}
export function ownDepositBonus(order:Pick<ChapaCheckout,'purpose'|'initialization'|'amountCents'|'creditJournalId'>){
 const quote=depositBonusQuote(order);return quote?{amount:centsToEtb(BigInt(quote.amountCents)),totalCredit:centsToEtb(order.amountCents+BigInt(quote.amountCents)),policyVersion:quote.policyVersion,validityDays:quote.validityDays,credited:order.creditJournalId!==null}:null;
}
/** Policy share-lock and database time fix eligibility once before dispatch.
 * Later disabling/ending an offer does not rewrite an already quoted payment. */
export async function quoteDepositBonusInTransaction(tx:Tx,amountCents:bigint,ready:boolean):Promise<DepositBonusQuote|null>{
 if(!ready)return null;
 const [row]=await tx.$queryRaw<Array<{enabled:boolean;percent:number;minCents:bigint;maxBonusCents:bigint|null;validityDays:number;endsAt:Date|null;version:number;now:Date}>>`SELECT *,clock_timestamp() AT TIME ZONE 'UTC' AS now FROM "DepositBonusPolicy" WHERE id='default' FOR SHARE`;
 if(!row?.enabled||amountCents<row.minCents||row.endsAt&&row.endsAt<=row.now)return null;
 const bonus=calculateDepositBonus(amountCents,row.percent,row.maxBonusCents);if(bonus<=0n)return null;
 return {policyVersion:row.version,percent:row.percent,minAmountCents:String(row.minCents),maxBonusCents:row.maxBonusCents===null?null:String(row.maxBonusCents),validityDays:row.validityDays,endsAt:row.endsAt?.toISOString()??null,quotedAt:row.now.toISOString(),amountCents:String(bonus)};
}
/** Caller owns the wallet lock. Principal receipt and this immutable bonus lot
 * commit together; its validity starts at verified credit, not intent creation. */
export async function creditDepositBonusInTransaction(tx:Tx,order:ChapaCheckout,walletId:string,issuanceId:string,principalJournalId:string,evidenceHash:string){
 const quote=depositBonusQuote(order);if(!quote)return null;
 const [{now}]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
 const expiresAt=new Date(now.getTime()+quote.validityDays*86400000),amount=new Prisma.Decimal(centsToEtb(BigInt(quote.amountCents)));
 const bonus=await tx.ledgerAccount.upsert({where:{name:`user:${order.userId}:bonus`},create:{name:`user:${order.userId}:bonus`,kind:'BONUS',walletId},update:{}});
 const result={checkoutId:order.id,principalJournalId,amountCents:quote.amountCents,policyVersion:quote.policyVersion,validityDays:quote.validityDays,expiresAt:expiresAt.toISOString()};
 const op=await tx.operation.create({data:{userId:order.userId,scope:'DEPOSIT_BONUS',key:order.id,requestHash:evidenceHash,result}});
 const journal=await tx.journal.create({data:{operationId:op.id,kind:'DEPOSIT_BONUS',reference:`deposit-bonus:${order.id}`,postings:{create:[{accountId:issuanceId,delta:amount.negated()},{accountId:bonus.id,delta:amount}]}}});
 return tx.depositBonusLot.create({data:{checkoutId:order.id,userId:order.userId,amountCents:BigInt(quote.amountCents),policyVersion:quote.policyVersion,validityDays:quote.validityDays,journalId:journal.id,createdAt:now,expiresAt}});
}
export type BonusFunds={bonusAvailable:string;bonusExpiresAt:string|null};
export async function readDepositBonusFunds(client:DB,userId:string,ready?:boolean):Promise<BonusFunds>{
 if(!(ready??await depositBonusStorageReady(client)))return {bonusAvailable:'0',bonusExpiresAt:null};
 const [row]=await client.$queryRaw<Array<{amount:string;expiresAt:Date|null}>>`
  SELECT COALESCE(sum(l."amountCents"-COALESCE(u.used,0)),0)::text AS amount,min(l."expiresAt") AS "expiresAt"
  FROM "DepositBonusLot" l LEFT JOIN LATERAL (SELECT sum("amountCents") AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
  WHERE l."userId"=${userId} AND l."expiresAt">clock_timestamp() AT TIME ZONE 'UTC'
   AND l."amountCents">COALESCE(u.used,0) AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId")`;
 return {bonusAvailable:new Prisma.Decimal(centsToEtb(BigInt(row?.amount??'0'))).toString(),bonusExpiresAt:row?.expiresAt?.toISOString()??null};
}
/** Fee-only bridge. Its deferred database proof requires the linked accepted
 * real v4 bid and gross fee journal in this very transaction. Earliest expiry
 * is consumed first. External BID payments never invoke this helper. */
export async function consumeDepositBonusInTransaction(tx:Tx,input:{userId:string;bidId:string;netFeeCents:bigint},ready?:boolean){
 if(input.netFeeCents<=0n||!(ready??await depositBonusStorageReady(tx)))return 0n;
 const lots=await tx.$queryRaw<Array<{checkoutId:string;remaining:bigint;expiresAt:Date}>>`
  WITH active AS (SELECT l."checkoutId",(l."amountCents"-COALESCE(u.used,0))::bigint AS remaining,l."expiresAt"
  FROM "DepositBonusLot" l LEFT JOIN LATERAL(SELECT sum("amountCents") AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
  WHERE l."userId"=${input.userId} AND l."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND l."amountCents">COALESCE(u.used,0)
   AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId")), ranked AS (
   SELECT *,COALESCE(sum(remaining) OVER(ORDER BY "expiresAt","checkoutId" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior FROM active)
  SELECT "checkoutId",remaining,"expiresAt" FROM ranked WHERE prior<${input.netFeeCents} ORDER BY "expiresAt","checkoutId"`;
 let needed=input.netFeeCents;const usages:Array<{checkoutId:string;amountCents:bigint}>=[];
 for(const lot of lots){if(needed<=0n)break;const amount=lot.remaining<needed?lot.remaining:needed;usages.push({checkoutId:lot.checkoutId,amountCents:amount});needed-=amount;}
 const used=input.netFeeCents-needed;if(!used)return 0n;
 const bonus=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${input.userId}:bonus`}}),available=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${input.userId}:available`}});
 const result={bidId:input.bidId,amountCents:String(used)},hash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
 const op=await tx.operation.create({data:{userId:input.userId,scope:'DEPOSIT_BONUS_USE',key:input.bidId,requestHash:hash,result}}),amount=new Prisma.Decimal(centsToEtb(used));
 await tx.journal.create({data:{operationId:op.id,kind:'DEPOSIT_BONUS_USE',reference:`bid:${input.bidId}`,postings:{create:[{accountId:bonus.id,delta:amount.negated()},{accountId:available.id,delta:amount}]}}});
 await tx.depositBonusUse.createMany({data:usages.map(use=>({...use,userId:input.userId,bidId:input.bidId,operationId:op.id}))});return used;
}
/** Bounded worker cleanup; spendability already excludes expired lots even if
 * the worker is down. The wallet lock makes expiry/consumption mutually exclusive. */
export async function expireDepositBonusLots(client:PrismaClient,limit=20){
 if(!await depositBonusStorageReady(client))return {expired:0};
 const rows=await client.$queryRaw<Array<{checkoutId:string;userId:string}>>`SELECT l."checkoutId",l."userId" FROM "DepositBonusLot" l WHERE l."expiresAt"<=clock_timestamp() AT TIME ZONE 'UTC' AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId") ORDER BY l."expiresAt",l."checkoutId" LIMIT ${Math.min(50,Math.max(1,limit))}`;
 let expired=0;const started=Date.now();
 for(const row of rows){if(Date.now()-started>=1000)break;await client.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'");await tx.$executeRawUnsafe("SET LOCAL statement_timeout='1000ms'");
  const [lock]=await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`wallet:${row.userId}`},0)) AS locked`;if(!lock?.locked)return;
  const wallet=await tx.wallet.findUniqueOrThrow({where:{userId:row.userId}});await tx.$executeRaw`SELECT lock_wallet_hold_state(${wallet.id})`;
  const [lot]=await tx.$queryRaw<Array<{remaining:bigint;now:Date}>>`SELECT (l."amountCents"-COALESCE((SELECT sum(u."amountCents") FROM "DepositBonusUse" u WHERE u."checkoutId"=l."checkoutId"),0))::bigint AS remaining,clock_timestamp() AT TIME ZONE 'UTC' AS now FROM "DepositBonusLot" l WHERE l."checkoutId"=${row.checkoutId} AND l."expiresAt"<=clock_timestamp() AT TIME ZONE 'UTC' AND NOT EXISTS(SELECT 1 FROM "DepositBonusExpiry" e WHERE e."checkoutId"=l."checkoutId")`;
  if(!lot)return;
  let journalId:string|null=null;
  if(lot.remaining>0n){
   const bonus=await tx.ledgerAccount.findUniqueOrThrow({where:{name:`user:${row.userId}:bonus`}}),issuance=await tx.ledgerAccount.findUniqueOrThrow({where:{name:'platform:issuance'}}),result={checkoutId:row.checkoutId,amountCents:String(lot.remaining)};
   const op=await tx.operation.create({data:{userId:row.userId,scope:'DEPOSIT_BONUS_EXPIRY',key:row.checkoutId,requestHash:createHash('sha256').update(JSON.stringify(result)).digest('hex'),result}}),amount=new Prisma.Decimal(centsToEtb(lot.remaining));
   journalId=(await tx.journal.create({data:{operationId:op.id,kind:'DEPOSIT_BONUS_EXPIRY',reference:`deposit-bonus:${row.checkoutId}`,postings:{create:[{accountId:bonus.id,delta:amount.negated()},{accountId:issuance.id,delta:amount}]}}})).id;
  }
  await tx.depositBonusExpiry.create({data:{checkoutId:row.checkoutId,userId:row.userId,amountCents:lot.remaining,journalId,createdAt:lot.now}});expired++;
 },{maxWait:1000,timeout:2500});}
 return {expired};
}

export async function listOwnDepositBonuses(client:PrismaClient,userId:string,raw:unknown={}){
 const {page}=z.object({page:z.coerce.number().int().min(1).max(1000).default(1)}).strict().parse(raw),pageSize=20,ready=await depositBonusStorageReady(client),policy=await getDepositBonusPolicy(client,ready);
 if(!ready)return {policy,items:[],page,nextPage:null as number|null};
 const rows=await client.$queryRaw<Array<{id:string;amount:bigint;remaining:bigint;creditedAt:Date;expiresAt:Date;now:Date}>>`
  SELECT l."checkoutId" AS id,l."amountCents" AS amount,(l."amountCents"-COALESCE(u.used,0))::bigint AS remaining,l."createdAt" AS "creditedAt",l."expiresAt",clock_timestamp() AT TIME ZONE 'UTC' AS now
  FROM "DepositBonusLot" l LEFT JOIN LATERAL(SELECT sum("amountCents") AS used FROM "DepositBonusUse" WHERE "checkoutId"=l."checkoutId") u ON true
  WHERE l."userId"=${userId} ORDER BY l."createdAt" DESC,l."checkoutId" DESC OFFSET ${(page-1)*pageSize} LIMIT ${pageSize+1}`;
 return {policy,items:rows.slice(0,pageSize).map(row=>({id:row.id,amount:centsToEtb(row.amount),remaining:centsToEtb(row.expiresAt<=row.now?0n:row.remaining),creditedAt:row.creditedAt.toISOString(),expiresAt:row.expiresAt.toISOString(),status:row.remaining===0n?'used' as const:row.expiresAt<=row.now?'expired' as const:'active' as const})),page,nextPage:rows.length>pageSize?page+1:null};
}
