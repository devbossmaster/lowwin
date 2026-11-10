import {Prisma,type PrismaClient,type Outbox} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {auctionMaintenance} from '../auctions/maintenance';
import {chapaReceiptKind} from './chapa-receipt';

export const notificationLeaseMs=120_000;
export const expansionKinds=['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS'];
export const highPriorityKinds=['CONTACT_CONFIRMED',chapaReceiptKind,'AUCTION_WON','AUCTION_FALLBACK_WON','FULFILLMENT_UPDATED'];
export type ClaimedNotification=Outbox&{leaseToken:string;leaseUntil:Date};
export type ClaimOptions={limit?:number;priority?:'high'|'bulk';kind?:string};
const bounded=(value:number|undefined,fallback:number,max:number)=>Math.max(1,Math.min(max,Math.floor(Number.isFinite(value)?value!:fallback)));

/** Bounded row locks end at claim commit, before preparation, rate waits or HTTP. */
export async function claimNotifications(client:PrismaClient,options:ClaimOptions={}){
 const limit=bounded(options.limit,12,32),token=randomUUID();
 return client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))return [];
  const base=Prisma.sql`state='PENDING' AND "nextAttemptAt"<=clock_timestamp() AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp()) AND kind NOT IN (${Prisma.join(expansionKinds)}) ${options.kind?Prisma.sql`AND kind=${options.kind}`:Prisma.empty}`;
  const select=async(priority:'high'|'bulk'|undefined,take:number,excluded:string[]=[])=>take?tx.$queryRaw<Outbox[]>(Prisma.sql`SELECT * FROM "Outbox" WHERE ${base} ${priority==='high'?Prisma.sql`AND kind IN (${Prisma.join(highPriorityKinds)})`:priority==='bulk'?Prisma.sql`AND kind NOT IN (${Prisma.join(highPriorityKinds)})`:Prisma.empty} ${excluded.length?Prisma.sql`AND id NOT IN (${Prisma.join(excluded)})`:Prisma.empty} ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT ${take}`):[];
  let rows:Outbox[]=[];
  if(options.priority||options.kind||limit===1)rows=await select(options.priority,limit);
  else{
   const bulk=Math.max(1,Math.floor(limit/4));
   rows=[...await select('high',limit-bulk),...await select('bulk',bulk)];
   if(rows.length<limit)rows.push(...await select(undefined,limit-rows.length,rows.map(row=>row.id)));
  }
  if(!rows.length)return [];
  return tx.$queryRaw<ClaimedNotification[]>(Prisma.sql`UPDATE "Outbox" SET "leaseToken"=${token},"leaseUntil"=clock_timestamp()+interval '120 seconds',"claimedAt"=clock_timestamp() WHERE id IN (${Prisma.join(rows.map(row=>row.id))}) RETURNING *`);
 },{timeout:5000,maxWait:5000});
}

export async function claimExpansion(client:PrismaClient){
 const token=randomUUID();
 return client.$transaction(async tx=>{
  if(await auctionMaintenance(tx))return null;
  const rows=await tx.$queryRaw<Outbox[]>(Prisma.sql`SELECT * FROM "Outbox" WHERE state='PENDING' AND kind IN (${Prisma.join(expansionKinds)}) AND "nextAttemptAt"<=clock_timestamp() AND ("leaseUntil" IS NULL OR "leaseUntil"<=clock_timestamp()) ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1`);
  if(!rows.length)return null;
  return tx.outbox.update({where:{id:rows[0].id},data:{leaseToken:token,leaseUntil:new Date(Date.now()+notificationLeaseMs),claimedAt:new Date()}}) as Promise<ClaimedNotification>;
 },{timeout:5000,maxWait:5000});
}

export const logicalDeliveryKey=(botId:string,auctionId:string,userId:string)=>`${botId}:${createHash('sha256').update(`public-result:${auctionId}:${userId}`).digest('hex')}`;
export async function claimLogicalDelivery(client:PrismaClient,row:ClaimedNotification,botId:string,auctionId:string,userId:string){
 const key=logicalDeliveryKey(botId,auctionId,userId);
 const rows=await client.$queryRaw<{key:string}[]>`INSERT INTO "TelegramDeliveryLease" (key,"botId","outboxId","leaseToken","leaseUntil") VALUES (${key},${botId},${row.id},${row.leaseToken},${row.leaseUntil}) ON CONFLICT(key) DO UPDATE SET "outboxId"=EXCLUDED."outboxId","leaseToken"=EXCLUDED."leaseToken","leaseUntil"=EXCLUDED."leaseUntil" WHERE "TelegramDeliveryLease"."sentAt" IS NULL AND "TelegramDeliveryLease"."leaseUntil"<=clock_timestamp() RETURNING key`;
 if(rows.length)return {key,acquired:true,sent:false};
 const saved=await client.telegramDeliveryLease.findUnique({where:{key},select:{sentAt:true,leaseToken:true}});
 return {key,acquired:saved?.leaseToken===row.leaseToken,sent:!!saved?.sentAt};
}

/** A stale worker can never mutate another claim or record its acknowledgement. */
export async function finishClaim(client:PrismaClient,row:ClaimedNotification,data:Prisma.OutboxUpdateManyMutationInput,delivered?:{chatId:string;messageId:number;auctionId?:string;logicalKey?:string}){
 return client.$transaction(async tx=>{
  const changed=await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{...data,leaseToken:null,leaseUntil:null}});
  if(!changed.count)return false;
  if(delivered){
   if(delivered.logicalKey){
    const logical=await tx.telegramDeliveryLease.updateMany({where:{key:delivered.logicalKey,leaseToken:row.leaseToken,sentAt:null},data:{sentAt:new Date(),messageId:BigInt(delivered.messageId)}});
    if(!logical.count)throw Error('Notification logical delivery ownership changed');
   }
   await tx.telegramMessage.upsert({where:{outboxId:row.id},create:{outboxId:row.id,auctionId:delivered.auctionId,testRunId:row.testRunId,chatId:delivered.chatId,messageId:BigInt(delivered.messageId)},update:{}});
  }else await tx.telegramDeliveryLease.deleteMany({where:{outboxId:row.id,leaseToken:row.leaseToken,sentAt:null}});
  return true;
 },{timeout:5000,maxWait:5000});
}
