import {Prisma,type PrismaClient,type Outbox} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {auctionMaintenanceHalted,lockAuctionMaintenance} from '../auctions/maintenance';
import {notificationDatabasePathReady} from './notification-db-path';

// Prisma DateTime columns store UTC timestamp values without a timezone.
// Normalize database wall-clock expressions, independently of display time (EAT).
export const expansionKinds=['GLOBAL_CAMPAIGN','AUCTION_FINALIZED','AUCTION_PARTICIPANTS','BROADCAST_DELETE'];
export const highPriorityKinds=['DEPOSIT_CREDITED','BID_ACCEPTED','WINNER_CONGRATULATIONS','AUCTION_FEE_REFUNDED'];
export type NotificationRecipient={telegramId:string;name:string;chatId:string|null;blocked:boolean|null};
export type ClaimedNotification=Outbox&{leaseToken:string;leaseUntil:Date;broadcastRecipient?:NotificationRecipient|null};
export type ClaimOptions={limit?:number;priority?:'high'|'bulk';kind?:string};
const bounded=(value:number|undefined,fallback:number,max:number)=>Math.max(1,Math.min(max,Math.floor(Number.isFinite(value)?value!:fallback)));
const claimable=Prisma.sql`state='PENDING' AND "nextAttemptAt"<=(clock_timestamp() AT TIME ZONE 'UTC') AND ("leaseUntil" IS NULL OR "leaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')) AND NOT ${auctionMaintenanceHalted}`;

async function claimWithDatabaseRoutine(client:PrismaClient,limit:number,priority:ClaimOptions['priority'],kind:string|null,expansion:boolean,includeBroadcastRecipient:boolean){
 const projection=includeBroadcastRecipient?Prisma.sql`(result.claimed).*,result."broadcastRecipient"`:Prisma.sql`(result.claimed).*`;
 try{
  return await client.$queryRaw<ClaimedNotification[]>`
   SELECT ${projection} FROM public.lowwin_claim_notifications(${randomUUID()},${limit}::integer,${priority??null}::text,${kind}::text,${expansion}) result
  `;
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2010'&&error.meta?.code==='0A000'
   &&typeof error.meta.message==='string'&&/^(?:ERROR: )?Notification claim requires READ COMMITTED$/.test(error.meta.message))return null;
  throw error;
 }
}

async function claimRows(client:PrismaClient,picked:Prisma.Sql,includeBroadcastRecipient=false){
 const token=randomUUID();
 const writeLease=Prisma.sql`
  UPDATE "Outbox" o
  SET "leaseToken"=${token},"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '120 seconds',"claimedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
  FROM picked WHERE o.id=picked.id RETURNING o.*
 `;
 const statement=includeBroadcastRecipient?Prisma.sql`
  WITH picked AS MATERIALIZED (${picked}), claimed AS (${writeLease})
  SELECT o.*,CASE WHEN u.id IS NOT NULL THEN jsonb_build_object(
   'telegramId',u."telegramId",'name',u.name,'chatId',c."chatId",'blocked',c.blocked
  ) END AS "broadcastRecipient"
  FROM claimed o LEFT JOIN "user" u
   ON o.kind='BROADCAST' AND u.id=o.payload->>'recipientUserId' AND u."telegramId" IS NOT NULL
  LEFT JOIN "BotChat" c ON c."telegramId"=u."telegramId"
 `:Prisma.sql`WITH picked AS MATERIALIZED (${picked}) ${writeLease}`;
 return client.$transaction(async tx=>{
  // Acquire the maintenance barrier before taking the statement snapshot.
  await lockAuctionMaintenance(tx);
  return tx.$queryRaw<ClaimedNotification[]>(statement);
 },{timeout:5000,maxWait:5000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Bounded row locks end at claim commit, before preparation, rate waits or HTTP. */
export async function claimNotifications(client:PrismaClient,options:ClaimOptions={}){
 const limit=bounded(options.limit,12,32);
 const includeBroadcastRecipient=options.priority!=='high'&&(!options.kind||options.kind==='BROADCAST');
 if(await notificationDatabasePathReady(client)){
  const claimed=await claimWithDatabaseRoutine(client,limit,options.priority,options.kind||null,false,includeBroadcastRecipient);
  if(claimed!==null)return claimed;
 }
 const base=Prisma.sql`${claimable} AND kind NOT IN (${Prisma.join(expansionKinds)}) ${options.kind?Prisma.sql`AND kind=${options.kind}`:Prisma.empty}`;
 const high=Prisma.sql`AND kind IN (${Prisma.join(highPriorityKinds)})`;
 const bulk=Prisma.sql`AND kind NOT IN (${Prisma.join(highPriorityKinds)})`;
 const select=(filter:Prisma.Sql,take:Prisma.Sql)=>Prisma.sql`
  SELECT id FROM "Outbox" WHERE ${base} ${filter} ORDER BY "nextAttemptAt",id FOR UPDATE SKIP LOCKED LIMIT (${take})
 `;
 if(options.priority||options.kind||limit===1)return claimRows(client,select(options.priority==='high'?high:options.priority==='bulk'?bulk:Prisma.empty,Prisma.sql`${limit}`),includeBroadcastRecipient);

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
 `,includeBroadcastRecipient);
}

export async function claimExpansion(client:PrismaClient){
 if(await notificationDatabasePathReady(client)){
  const claimed=await claimWithDatabaseRoutine(client,1,undefined,null,true,false);
  if(claimed!==null)return claimed[0]??null;
 }
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
type Acknowledgement={row:ClaimedNotification;delivered:DeliveredMessage};
export type NotificationAcknowledger=(row:ClaimedNotification,delivered:DeliveredMessage)=>Promise<boolean>;

async function recordAcknowledgedDeliveries(client:PrismaClient,batch:readonly Acknowledgement[]){
 const values=batch.map(({row,delivered})=>Prisma.sql`(${row.id},${row.leaseToken},${randomUUID()},${delivered.auctionId??null}::text,${delivered.chatId},${BigInt(delivered.messageId)}::bigint)`);
 return client.$queryRaw<{id:string}[]>`
  WITH delivery(id,"leaseToken","recordId","auctionId","chatId","messageId") AS (VALUES ${Prisma.join(values)}), owned AS MATERIALIZED (
   SELECT o.id FROM "Outbox" o JOIN delivery d ON d.id=o.id AND d."leaseToken"=o."leaseToken"
   WHERE o.state='PENDING' ORDER BY o.id FOR NO KEY UPDATE OF o
  ), acknowledged AS (
   UPDATE "Outbox" o SET state='SENT',"sentAt"=clock_timestamp() AT TIME ZONE 'UTC',attempts=o.attempts+1,
    "lastError"=NULL,"leaseToken"=NULL,"leaseUntil"=NULL
   FROM owned,delivery d WHERE o.id=owned.id AND o.id=d.id AND o.state='PENDING' AND o."leaseToken"=d."leaseToken"
   RETURNING o.id,o."testRunId",o."sentAt",d."recordId",d."auctionId",d."chatId",d."messageId"
  ), recorded AS (
   INSERT INTO "TelegramMessage" (id,"outboxId","auctionId","testRunId","chatId","messageId","sentAt")
   SELECT "recordId",id,"auctionId","testRunId","chatId","messageId","sentAt" FROM acknowledged
   ON CONFLICT ("outboxId") DO NOTHING
  )
  SELECT id FROM acknowledged
 `;
}

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

/** Coalesce acknowledgements across the worker's delivery lanes. Each caller
 * still waits for its own durable result and handles an uncertain reply. */
export function createNotificationAcknowledger(client:PrismaClient):NotificationAcknowledger{
 const maxBatch=8,flushAfterMs=35;
 type Pending=Acknowledgement&{queuedAt:number;resolve:(saved:boolean)=>void;reject:(error:unknown)=>void};
 const waiting:Pending[]=[],pendingIds=new Set<string>();
 let timer:ReturnType<typeof setTimeout>|undefined,flushing=false;

 function schedule(){
  if(flushing||!waiting.length)return;
  clearTimeout(timer);
  const wait=flushAfterMs-(performance.now()-waiting[0].queuedAt);
  if(waiting.length>=maxBatch||wait<=0)void flush();
  else timer=setTimeout(()=>void flush(),wait);
 }

 async function flush(){
  timer=undefined;
  flushing=true;
  const batch=waiting.splice(0,maxBatch);
  try{
   const saved=new Set((await recordAcknowledgedDeliveries(client,batch)).map(row=>row.id));
   for(const item of batch)item.resolve(saved.has(item.row.id));
  }catch(error){
   for(const item of batch)item.reject(error);
  }finally{
   for(const item of batch)pendingIds.delete(item.row.id);
   flushing=false;
   schedule();
  }
 }

 return (row,delivered)=>{
  if(delivered.logicalKey||pendingIds.has(row.id)||!Number.isSafeInteger(delivered.messageId))return acknowledgeDelivery(client,row,delivered);
  return new Promise((resolve,reject)=>{
   pendingIds.add(row.id);
   waiting.push({row,delivered,queuedAt:performance.now(),resolve,reject});
   schedule();
  });
 };
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
