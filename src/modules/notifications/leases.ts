import {Prisma,type PrismaClient,type Outbox} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {auctionMaintenanceHalted,lockAuctionMaintenance} from '../auctions/maintenance';

// Prisma DateTime columns store UTC timestamp values without a timezone.
// Normalize database wall-clock expressions, independently of display time (EAT).
export const expansionKinds=['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS','BROADCAST_DELETE'];
export const highPriorityKinds=['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'];
export type ClaimedNotification=Outbox&{leaseToken:string;leaseUntil:Date};
export type ClaimOptions={limit?:number;priority?:'high'|'bulk';kind?:string};
const bounded=(value:number|undefined,fallback:number,max:number)=>Math.max(1,Math.min(max,Math.floor(Number.isFinite(value)?value!:fallback)));
const claimable=Prisma.sql`state='PENDING' AND "nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')) AND NOT ${auctionMaintenanceHalted}`;

async function claimRows(client:PrismaClient,picked:Prisma.Sql){
 const token=randomUUID();
 return client.$transaction(async tx=>{
  // Acquire the maintenance barrier before taking the statement snapshot.
  await lockAuctionMaintenance(tx);
  return tx.$queryRaw<ClaimedNotification[]>(Prisma.sql`
   WITH picked AS MATERIALIZED (${picked})
   UPDATE "Outbox" o
   SET "leaseToken"=${token},"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '120 seconds',"claimedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
   FROM picked WHERE o.id=picked.id RETURNING o.*
  `);
 },{timeout:5000,maxWait:5000});
}

/** Bounded row locks end at claim commit, before preparation, rate waits or HTTP. */
export async function claimNotifications(client:PrismaClient,options:ClaimOptions={}){
 const limit=bounded(options.limit,12,32);
 const base=Prisma.sql`${claimable} AND kind NOT IN (${Prisma.join(expansionKinds)}) ${options.kind?Prisma.sql`AND kind=${options.kind}`:Prisma.empty}`;
 const high=Prisma.sql`AND kind IN (${Prisma.join(highPriorityKinds)})`;
 const bulk=Prisma.sql`AND kind NOT IN (${Prisma.join(highPriorityKinds)})`;
 const select=(filter:Prisma.Sql,take:Prisma.Sql)=>Prisma.sql`
  SELECT id FROM "Outbox" WHERE ${base} ${filter} ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT (${take})
 `;
 if(options.priority||options.kind||limit===1)return claimRows(client,select(options.priority==='high'?high:options.priority==='bulk'?bulk:Prisma.empty,Prisma.sql`${limit}`));

 const bulkSlots=Math.max(1,Math.floor(limit/4));
 return claimRows(client,Prisma.sql`
  WITH picked_high AS MATERIALIZED (
   ${select(high,Prisma.sql`${limit-bulkSlots}`)}
  ), picked_bulk AS MATERIALIZED (
   ${select(bulk,Prisma.sql`${bulkSlots}`)}
  ), preferred AS MATERIALIZED (
   SELECT id FROM picked_high UNION ALL SELECT id FROM picked_bulk
  ), additional AS MATERIALIZED (
   ${select(Prisma.sql`AND id NOT IN (SELECT id FROM preferred)`,Prisma.sql`${limit}-(SELECT count(*) FROM preferred)`)}
  )
  SELECT id FROM preferred UNION ALL SELECT id FROM additional
 `);
}

export async function claimExpansion(client:PrismaClient){
 const [row]=await claimRows(client,Prisma.sql`
  SELECT id FROM "Outbox" WHERE ${claimable} AND kind IN (${Prisma.join(expansionKinds)})
  ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT 1
 `);
 return row??null;
}

export const logicalDeliveryKey=(botId:string,auctionId:string,userId:string)=>`${botId}:${createHash('sha256').update(`public-result:${auctionId}:${userId}`).digest('hex')}`;
export async function claimLogicalDelivery(client:PrismaClient,row:ClaimedNotification,botId:string,auctionId:string,userId:string){
 const key=logicalDeliveryKey(botId,auctionId,userId);
 const rows=await client.$queryRaw<{key:string}[]>`INSERT INTO "TelegramDeliveryLease" (key,"botId","outboxId","leaseToken","leaseUntil") VALUES (${key},${botId},${row.id},${row.leaseToken},${row.leaseUntil}) ON CONFLICT(key) DO UPDATE SET "outboxId"=EXCLUDED."outboxId","leaseToken"=EXCLUDED."leaseToken","leaseUntil"=EXCLUDED."leaseUntil" WHERE "TelegramDeliveryLease"."sentAt" IS NULL AND "TelegramDeliveryLease"."leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC') RETURNING key`;
 if(rows.length)return {key,acquired:true,sent:false};
 const saved=await client.telegramDeliveryLease.findUnique({where:{key},select:{sentAt:true,leaseToken:true}});
 return {key,acquired:saved?.leaseToken===row.leaseToken,sent:!!saved?.sentAt};
}

type DeliveredMessage={chatId:string;messageId:number;auctionId?:string;logicalKey?:string};

/** Commit the ordinary acknowledgement and its Telegram message ID together
 * with one database round trip. Public-result aliases keep their logical lease. */
export async function acknowledgeDelivery(client:PrismaClient,row:ClaimedNotification,delivered:DeliveredMessage){
 const {chatId,messageId,auctionId,logicalKey}=delivered;
 if(logicalKey)return finishClaim(client,row,{state:'SENT',sentAt:new Date(),attempts:{increment:1},lastError:null},delivered);
 const [completed]=await client.$queryRaw<{id:string}[]>`
  WITH acknowledged AS (
   UPDATE "Outbox" SET state='SENT',"sentAt"=clock_timestamp() AT TIME ZONE 'UTC',attempts=attempts+1,
    "lastError"=NULL,"leaseToken"=NULL,"leaseUntil"=NULL
   WHERE id=${row.id} AND state='PENDING' AND "leaseToken"=${row.leaseToken}
   RETURNING id,"testRunId","sentAt"
  ), recorded AS (
   INSERT INTO "TelegramMessage" (id,"outboxId","auctionId","testRunId","chatId","messageId","sentAt")
   SELECT ${randomUUID()},id,${auctionId??null},"testRunId",${chatId},${BigInt(messageId)},"sentAt" FROM acknowledged
   ON CONFLICT ("outboxId") DO NOTHING
  )
  SELECT id FROM acknowledged
 `;
 return !!completed;
}

/** A stale worker can never mutate another claim or record its acknowledgement. */
export async function finishClaim(client:PrismaClient,row:ClaimedNotification,data:Prisma.OutboxUpdateManyMutationInput,delivered?:DeliveredMessage){
 return client.$transaction(async tx=>{
  const changed=await tx.outbox.updateMany({where:{id:row.id,state:'PENDING',leaseToken:row.leaseToken},data:{...data,leaseToken:null,leaseUntil:null}});
  if(!changed.count)return false;
  if(delivered){
   const sentAt=new Date();
   if(delivered.logicalKey){
    const logical=await tx.telegramDeliveryLease.updateMany({where:{key:delivered.logicalKey,leaseToken:row.leaseToken,sentAt:null},data:{sentAt,messageId:BigInt(delivered.messageId)}});
    if(!logical.count)throw Error('Notification logical delivery ownership changed');
   }
   await tx.telegramMessage.upsert({where:{outboxId:row.id},create:{outboxId:row.id,auctionId:delivered.auctionId,testRunId:row.testRunId,chatId:delivered.chatId,messageId:BigInt(delivered.messageId),sentAt},update:{}});
  }else await tx.telegramDeliveryLease.deleteMany({where:{outboxId:row.id,leaseToken:row.leaseToken,sentAt:null}});
  return true;
 },{timeout:5000,maxWait:5000});
}
